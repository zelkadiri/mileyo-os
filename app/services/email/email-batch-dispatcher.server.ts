/**
 * Generic bounded-concurrency batch executor for transactional email runners.
 *
 * Infra only: no Prisma models, no cutoff/delivery helpers, no templates,
 * no Mileyo business rules. Callers own eligibility, send, and stamping.
 */

export const EMAIL_BATCH_DEFAULT_CONCURRENCY = 3;
export const EMAIL_BATCH_DEFAULT_MAX_ERRORS = 50;

export type EmailBatchWorkerResult =
  | {
      outcome: "success";
    }
  | {
      outcome: "skipped";
      reason?: string;
    }
  | {
      outcome: "failed";
      message?: string;
      reason?: string;
    };

export type DispatchEmailBatchOptions<TItem> = {
  concurrency?: number;
  getItemKey?: (item: TItem) => string;
  items: TItem[];
  maxErrors?: number;
  worker: (item: TItem) => Promise<EmailBatchWorkerResult>;
};

export type EmailBatchDispatchError = {
  itemKey?: string;
  message: string;
  reason?: string;
};

export type DispatchEmailBatchResult = {
  attempted: number;
  errors: EmailBatchDispatchError[];
  failed: number;
  skipped: number;
  succeeded: number;
};

const assertValidConcurrency = (concurrency: number): void => {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(
      `dispatchEmailBatch: concurrency must be a positive integer (got ${String(concurrency)})`,
    );
  }
};

const assertValidMaxErrors = (maxErrors: number): void => {
  if (!Number.isInteger(maxErrors) || maxErrors < 0) {
    throw new Error(
      `dispatchEmailBatch: maxErrors must be a non-negative integer (got ${String(maxErrors)})`,
    );
  }
};

const pushBoundedError = ({
  errors,
  itemKey,
  maxErrors,
  message,
  reason,
}: {
  errors: EmailBatchDispatchError[];
  itemKey?: string;
  maxErrors: number;
  message: string;
  reason?: string;
}): void => {
  if (errors.length >= maxErrors) {
    return;
  }

  errors.push({
    ...(itemKey !== undefined ? { itemKey } : {}),
    message,
    ...(reason !== undefined ? { reason } : {}),
  });
};

/**
 * Process items with a fixed-size worker pool (default concurrency 3).
 * Isolates per-item failures; never retries; never paces artificially.
 */
export const dispatchEmailBatch = async <TItem>(
  options: DispatchEmailBatchOptions<TItem>,
): Promise<DispatchEmailBatchResult> => {
  const concurrency = options.concurrency ?? EMAIL_BATCH_DEFAULT_CONCURRENCY;
  const maxErrors = options.maxErrors ?? EMAIL_BATCH_DEFAULT_MAX_ERRORS;

  assertValidConcurrency(concurrency);
  assertValidMaxErrors(maxErrors);

  const { getItemKey, items, worker } = options;

  const result: DispatchEmailBatchResult = {
    attempted: 0,
    errors: [],
    failed: 0,
    skipped: 0,
    succeeded: 0,
  };

  if (items.length === 0) {
    return result;
  }

  let nextIndex = 0;

  const runPoolWorker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      const item = items[index]!;
      result.attempted += 1;

      const itemKey = getItemKey?.(item);

      try {
        const workerResult = await worker(item);

        if (workerResult.outcome === "success") {
          result.succeeded += 1;
          continue;
        }

        if (workerResult.outcome === "skipped") {
          result.skipped += 1;
          continue;
        }

        result.failed += 1;
        pushBoundedError({
          errors: result.errors,
          itemKey,
          maxErrors,
          message:
            workerResult.message ??
            workerResult.reason ??
            "worker returned failed",
          reason: workerResult.reason,
        });
      } catch (error) {
        result.failed += 1;
        pushBoundedError({
          errors: result.errors,
          itemKey,
          maxErrors,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const poolSize = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: poolSize }, () => runPoolWorker()),
  );

  return result;
};
