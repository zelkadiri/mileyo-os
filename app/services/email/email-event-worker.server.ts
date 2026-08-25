/**
 * Generic EmailEvent worker (EMAIL-6D / EMAIL-6F).
 *
 * Reclaim → list due → claim → handler → transition.
 * processEmailEventById shares the same claim/handler/transition core (no reclaim).
 * No domain email knowledge, no Resend, no trySend*, no template content.
 */

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_PROCESSING_BATCH_LIMIT,
  EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES,
  EMAIL_EVENT_RETRY_DELAY_MINUTES,
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_WORKER_MAX_ERRORS,
} from "../../constants/emailEvent";
import {
  EMAIL_BATCH_DEFAULT_CONCURRENCY,
  dispatchEmailBatch,
} from "./email-batch-dispatcher.server";
import {
  EMAIL_EVENT_HANDLER_REGISTRY,
  getEmailEventHandler,
  type EmailEventHandlerRegistry,
  type EmailEventHandlerResult,
} from "./email-event-handlers.server";
import {
  cancelEmailEvent,
  claimEmailEvent,
  claimFailedEmailEventForManualRetry,
  getEmailEventById,
  listDueEmailEvents,
  markEmailEventFailed,
  markEmailEventSent,
  reclaimStuckEmailEvents,
  requeueEmailEventAfterFailure,
  type EmailEventDb,
  type EmailEventRecord,
} from "./email-event.server";

export type EmailEventWorkerError = {
  errorCode?: string;
  eventId: string;
  eventType: string;
  message: string;
};

export type ProcessDueEmailEventsSummary = {
  cancelled: number;
  claimed: number;
  errors: EmailEventWorkerError[];
  failed: number;
  reclaimed: number;
  retried: number;
  scanned: number;
  sent: number;
  skippedNotClaimed: number;
  unsupported: number;
};

export type ProcessDueEmailEventsOptions = {
  client?: EmailEventDb;
  concurrency?: number;
  handlers?: EmailEventHandlerRegistry;
  limit?: number;
  now?: Date;
  shop?: string;
};

export type ProcessEmailEventByIdResult =
  | {
      eventId: string;
      providerId?: string | null;
      status: "sent";
    }
  | {
      errorCode?: string;
      eventId: string;
      message?: string;
      status: "queued_for_retry";
    }
  | {
      eventId: string;
      reason?: string;
      status: "cancelled";
    }
  | {
      errorCode?: string;
      eventId: string;
      message?: string;
      status: "failed";
    }
  | {
      eventId: string;
      reason?: string;
      status: "not_claimed";
    }
  | {
      eventId: string;
      status: "not_found";
    };

export type ProcessEmailEventByIdOptions = {
  client?: EmailEventDb;
  eventId: string;
  handlers?: EmailEventHandlerRegistry;
  now?: Date;
};

export type ManualRetryEmailEventResult =
  | {
      attemptCount: number;
      eventId: string;
      eventType: string;
      providerId?: string | null;
      status: "sent";
    }
  | {
      attemptCount: number;
      errorCode?: string;
      eventId: string;
      eventType: string;
      message?: string;
      status: "failed";
    }
  | {
      attemptCount: number;
      eventId: string;
      eventType: string;
      status: "cancelled";
    }
  | {
      eventId: string;
      reason?: string;
      status: "not_eligible";
    }
  | {
      eventId: string;
      status: "not_found";
    };

export type ManualRetryEmailEventOptions = {
  client?: EmailEventDb;
  eventId: string;
  handlers?: EmailEventHandlerRegistry;
  now?: Date;
  shop: string;
};

/** How retryable handler failures are applied after a claim. */
type EmailEventFailureMode = "automatic" | "manual";

type AppliedHandlerOutcome =
  | { kind: "sent"; providerId?: string }
  | { kind: "cancelled" }
  | { kind: "failed"; errorCode?: string; message?: string }
  | { kind: "queued_for_retry"; errorCode?: string; message?: string }
  | { kind: "unsupported"; errorCode: string; message: string };

const minutesToMs = (minutes: number): number => minutes * 60_000;

export const computeEmailEventRetryAt = (now: Date): Date =>
  new Date(now.getTime() + minutesToMs(EMAIL_EVENT_RETRY_DELAY_MINUTES));

export const computeEmailEventStaleBefore = (now: Date): Date =>
  new Date(
    now.getTime() - minutesToMs(EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES),
  );

const emptySummary = (): ProcessDueEmailEventsSummary => ({
  cancelled: 0,
  claimed: 0,
  errors: [],
  failed: 0,
  reclaimed: 0,
  retried: 0,
  scanned: 0,
  sent: 0,
  skippedNotClaimed: 0,
  unsupported: 0,
});

const pushWorkerError = ({
  errorCode,
  eventId,
  eventType,
  message,
  summary,
}: {
  errorCode?: string;
  eventId: string;
  eventType: string;
  message: string;
  summary: ProcessDueEmailEventsSummary;
}): void => {
  if (summary.errors.length >= EMAIL_EVENT_WORKER_MAX_ERRORS) {
    return;
  }

  summary.errors.push({
    eventId,
    eventType,
    message,
    ...(errorCode !== undefined ? { errorCode } : {}),
  });
};

const safeErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 500);
  }
  return "handler threw an unexpected error";
};

const applyHandlerResult = async ({
  client,
  event,
  failureMode,
  now,
  result,
}: {
  client?: EmailEventDb;
  event: EmailEventRecord;
  failureMode: EmailEventFailureMode;
  now: Date;
  result: EmailEventHandlerResult;
}): Promise<AppliedHandlerOutcome> => {
  if (result.outcome === "sent") {
    await markEmailEventSent({
      client,
      eventId: event.id,
      providerId: result.providerId ?? "",
      sentAt: now,
    });
    return { kind: "sent", providerId: result.providerId };
  }

  if (result.outcome === "cancelled") {
    await cancelEmailEvent({
      cancelledAt: now,
      client,
      eventId: event.id,
    });
    return { kind: "cancelled" };
  }

  if (result.outcome === "permanent_failure") {
    const errorCode = result.errorCode ?? "permanent_failure";
    const message = result.message ?? "permanent failure";
    await markEmailEventFailed({
      client,
      eventId: event.id,
      lastErrorCode: errorCode,
      lastErrorMessage: message,
    });
    return { kind: "failed", errorCode, message };
  }

  // retryable_failure
  const errorCode = result.errorCode ?? "retryable_failure";
  const message = result.message ?? "retryable failure";

  // Manual retry = one explicit attempt. Never reopen an automatic retry chain.
  if (
    failureMode === "manual" ||
    event.attemptCount >= EMAIL_EVENT_MAX_ATTEMPTS
  ) {
    await markEmailEventFailed({
      client,
      eventId: event.id,
      lastErrorCode: errorCode,
      lastErrorMessage: message,
    });
    return { kind: "failed", errorCode, message };
  }

  await requeueEmailEventAfterFailure({
    client,
    eventId: event.id,
    lastErrorCode: errorCode,
    lastErrorMessage: message,
    nextAttemptAt: computeEmailEventRetryAt(now),
  });
  return { kind: "queued_for_retry", errorCode, message };
};

/**
 * Shared post-claim processing for batch worker, processEmailEventById,
 * and manual admin retry.
 */
const processClaimedEvent = async ({
  client,
  event,
  failureMode,
  handlers,
  now,
}: {
  client?: EmailEventDb;
  event: EmailEventRecord;
  failureMode: EmailEventFailureMode;
  handlers: EmailEventHandlerRegistry;
  now: Date;
}): Promise<AppliedHandlerOutcome> => {
  const handler = getEmailEventHandler(event.eventType, handlers);

  if (!handler) {
    const errorCode = "unsupported_event_type";
    const message = `No EmailEvent handler registered for eventType=${event.eventType}`;
    await markEmailEventFailed({
      client,
      eventId: event.id,
      lastErrorCode: errorCode,
      lastErrorMessage: message,
    });
    return { kind: "unsupported", errorCode, message };
  }

  let result: EmailEventHandlerResult;
  try {
    result = await handler({ event, now });
  } catch (error) {
    result = {
      errorCode: "handler_exception",
      message: safeErrorMessage(error),
      outcome: "retryable_failure",
    };
  }

  return applyHandlerResult({ client, event, failureMode, now, result });
};

const recordClaimedOutcomeInSummary = ({
  event,
  outcome,
  summary,
}: {
  event: EmailEventRecord;
  outcome: AppliedHandlerOutcome;
  summary: ProcessDueEmailEventsSummary;
}): void => {
  if (outcome.kind === "sent") {
    summary.sent += 1;
    return;
  }

  if (outcome.kind === "cancelled") {
    summary.cancelled += 1;
    return;
  }

  if (outcome.kind === "queued_for_retry") {
    summary.retried += 1;
    pushWorkerError({
      errorCode: outcome.errorCode,
      eventId: event.id,
      eventType: event.eventType,
      message: outcome.message ?? "retryable failure",
      summary,
    });
    return;
  }

  if (outcome.kind === "unsupported") {
    summary.unsupported += 1;
    summary.failed += 1;
    pushWorkerError({
      errorCode: outcome.errorCode,
      eventId: event.id,
      eventType: event.eventType,
      message: outcome.message,
      summary,
    });
    return;
  }

  // failed
  summary.failed += 1;
  pushWorkerError({
    errorCode: outcome.errorCode,
    eventId: event.id,
    eventType: event.eventType,
    message: outcome.message ?? "permanent failure",
    summary,
  });
};

/**
 * Claim + process a single EmailEvent by id (immediate path for event-driven emails).
 * Does not reclaim stuck processing rows — that remains a cron batch responsibility.
 */
export const processEmailEventById = async (
  options: ProcessEmailEventByIdOptions,
): Promise<ProcessEmailEventByIdResult> => {
  const now = options.now ?? new Date();
  const handlers = options.handlers ?? EMAIL_EVENT_HANDLER_REGISTRY;
  const { client, eventId } = options;

  const existing = await getEmailEventById({ client, eventId });

  if (!existing) {
    return { eventId, status: "not_found" };
  }

  const claimResult = await claimEmailEvent({
    client,
    eventId,
    now,
  });

  if (!claimResult.claimed) {
    return {
      eventId,
      reason: existing.status,
      status: "not_claimed",
    };
  }

  try {
    const outcome = await processClaimedEvent({
      client,
      event: claimResult.event,
      failureMode: "automatic",
      handlers,
      now,
    });

    if (outcome.kind === "sent") {
      return {
        eventId,
        providerId: outcome.providerId ?? null,
        status: "sent",
      };
    }

    if (outcome.kind === "cancelled") {
      return { eventId, status: "cancelled" };
    }

    if (outcome.kind === "queued_for_retry") {
      return {
        errorCode: outcome.errorCode,
        eventId,
        message: outcome.message,
        status: "queued_for_retry",
      };
    }

    return {
      errorCode: outcome.errorCode,
      eventId,
      message: outcome.message,
      status: "failed",
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    console.log("[emailEventWorker] processEmailEventById transition error", {
      eventId,
      message,
    });
    return {
      errorCode: "worker_transition_error",
      eventId,
      message,
      status: "failed",
    };
  }
};

/**
 * Operator-triggered retry for a failed EmailEvent (EMAIL-6G-B).
 *
 * Claims failed → processing (shop-scoped, may exceed automatic max attempts),
 * then runs the same handler path. Retryable failures become terminal failed
 * (no pending +60min automatic chain).
 */
export const manualRetryEmailEvent = async (
  options: ManualRetryEmailEventOptions,
): Promise<ManualRetryEmailEventResult> => {
  const now = options.now ?? new Date();
  const handlers = options.handlers ?? EMAIL_EVENT_HANDLER_REGISTRY;
  const { client, eventId, shop } = options;

  const existing = await getEmailEventById({ client, eventId });

  if (!existing) {
    return { eventId, status: "not_found" };
  }

  // Shop isolation before claim (claim also guards shop+status atomically).
  if (existing.shop !== shop) {
    return {
      eventId,
      reason: "wrong_shop",
      status: "not_eligible",
    };
  }

  if (existing.status !== EMAIL_EVENT_STATUS.FAILED) {
    return {
      eventId,
      reason: existing.status,
      status: "not_eligible",
    };
  }

  const claimResult = await claimFailedEmailEventForManualRetry({
    client,
    eventId,
    now,
    shop,
  });

  if (!claimResult.claimed) {
    return {
      eventId,
      reason: "not_failed_anymore",
      status: "not_eligible",
    };
  }

  const claimed = claimResult.event;

  try {
    const outcome = await processClaimedEvent({
      client,
      event: claimed,
      failureMode: "manual",
      handlers,
      now,
    });

    if (outcome.kind === "sent") {
      return {
        attemptCount: claimed.attemptCount,
        eventId,
        eventType: claimed.eventType,
        providerId: outcome.providerId ?? null,
        status: "sent",
      };
    }

    if (outcome.kind === "cancelled") {
      return {
        attemptCount: claimed.attemptCount,
        eventId,
        eventType: claimed.eventType,
        status: "cancelled",
      };
    }

    return {
      attemptCount: claimed.attemptCount,
      errorCode: outcome.errorCode,
      eventId,
      eventType: claimed.eventType,
      message: outcome.message,
      status: "failed",
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    console.log("[emailEventWorker] manualRetryEmailEvent transition error", {
      attemptCount: claimed.attemptCount,
      eventId,
      eventType: claimed.eventType,
      message,
      shop,
    });
    return {
      attemptCount: claimed.attemptCount,
      errorCode: "worker_transition_error",
      eventId,
      eventType: claimed.eventType,
      message,
      status: "failed",
    };
  }
};

/**
 * Process due EmailEvent rows for one shop (or all shops when shop omitted).
 * Domain handlers are optional — empty production registry is valid (scanned=0).
 */
export const processDueEmailEvents = async (
  options: ProcessDueEmailEventsOptions = {},
): Promise<ProcessDueEmailEventsSummary> => {
  const now = options.now ?? new Date();
  const limit = options.limit ?? EMAIL_EVENT_PROCESSING_BATCH_LIMIT;
  const concurrency = options.concurrency ?? EMAIL_BATCH_DEFAULT_CONCURRENCY;
  const handlers = options.handlers ?? EMAIL_EVENT_HANDLER_REGISTRY;
  const { client, shop } = options;

  const summary = emptySummary();

  const reclaimResult = await reclaimStuckEmailEvents({
    client,
    now,
    shop,
    staleBefore: computeEmailEventStaleBefore(now),
  });
  summary.reclaimed = reclaimResult.reclaimed;

  const dueEvents = await listDueEmailEvents({
    client,
    limit,
    now,
    shop,
  });
  summary.scanned = dueEvents.length;

  if (dueEvents.length === 0) {
    console.log("[emailEventWorker] completed", {
      cancelled: summary.cancelled,
      claimed: summary.claimed,
      failed: summary.failed,
      reclaimed: summary.reclaimed,
      retried: summary.retried,
      scanned: summary.scanned,
      sent: summary.sent,
      skippedNotClaimed: summary.skippedNotClaimed,
      unsupported: summary.unsupported,
      errorCount: summary.errors.length,
    });
    return summary;
  }

  await dispatchEmailBatch({
    concurrency,
    getItemKey: (event) => event.id,
    items: dueEvents,
    maxErrors: EMAIL_EVENT_WORKER_MAX_ERRORS,
    worker: async (listedEvent) => {
      const claimResult = await claimEmailEvent({
        client,
        eventId: listedEvent.id,
        now,
      });

      if (!claimResult.claimed) {
        summary.skippedNotClaimed += 1;
        return { outcome: "skipped", reason: "not_claimed" };
      }

      summary.claimed += 1;

      try {
        const outcome = await processClaimedEvent({
          client,
          event: claimResult.event,
          failureMode: "automatic",
          handlers,
          now,
        });
        recordClaimedOutcomeInSummary({
          event: claimResult.event,
          outcome,
          summary,
        });
        return { outcome: "success" };
      } catch (error) {
        const message = safeErrorMessage(error);
        summary.failed += 1;
        pushWorkerError({
          errorCode: "worker_transition_error",
          eventId: claimResult.event.id,
          eventType: claimResult.event.eventType,
          message,
          summary,
        });
        return {
          message,
          outcome: "failed",
          reason: "worker_transition_error",
        };
      }
    },
  });

  console.log("[emailEventWorker] completed", {
    cancelled: summary.cancelled,
    claimed: summary.claimed,
    failed: summary.failed,
    reclaimed: summary.reclaimed,
    retried: summary.retried,
    scanned: summary.scanned,
    sent: summary.sent,
    skippedNotClaimed: summary.skippedNotClaimed,
    unsupported: summary.unsupported,
    errorCount: summary.errors.length,
  });

  return summary;
};
