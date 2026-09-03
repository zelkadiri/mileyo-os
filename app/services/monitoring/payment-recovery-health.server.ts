/**
 * Payment recovery overdue / stuck counters (MONITORING-1).
 * Read-only. No retries, no status mutations, no PII.
 */

import {
  RECOVERY_OVERDUE_AFTER_MS,
  RECOVERY_PROCESSING_STUCK_AFTER_MS,
} from "../../constants/cronRun";
import {
  ACTIVE_RECOVERY_STATUSES,
  RECOVERY_STATUS,
} from "../../constants/subscriptionPaymentRecovery";
import db from "../../db.server";

export type RecoveryHealthCounts = {
  finalFailedCount: number;
  overdueCount: number;
  pendingCount: number;
  processingStuckCount: number;
};

export type RecoveryHealthRow = {
  nextRetryAt: Date | null;
  status: string;
  updatedAt: Date;
};

/**
 * Classify a single recovery into mutually exclusive monitoring buckets.
 * Returns null when the row is excluded (e.g. recovered / unknown terminal).
 */
export const classifyRecoveryHealthBucket = (
  recovery: RecoveryHealthRow,
  now: Date,
): keyof RecoveryHealthCounts | null => {
  if (recovery.status === RECOVERY_STATUS.FINAL_FAILED) {
    return "finalFailedCount";
  }

  if (recovery.status === RECOVERY_STATUS.RECOVERED) {
    return null;
  }

  const isActive = (
    ACTIVE_RECOVERY_STATUSES as readonly string[]
  ).includes(recovery.status);

  if (!isActive) {
    return null;
  }

  const nowMs = now.getTime();

  if (recovery.status === RECOVERY_STATUS.PROCESSING) {
    if (
      nowMs - recovery.updatedAt.getTime() >
      RECOVERY_PROCESSING_STUCK_AFTER_MS
    ) {
      return "processingStuckCount";
    }
  }

  if (
    recovery.nextRetryAt != null &&
    recovery.nextRetryAt.getTime() <= nowMs - RECOVERY_OVERDUE_AFTER_MS
  ) {
    return "overdueCount";
  }

  return "pendingCount";
};

export const summarizeRecoveryHealthRows = (
  rows: RecoveryHealthRow[],
  now: Date,
): RecoveryHealthCounts => {
  const counts: RecoveryHealthCounts = {
    finalFailedCount: 0,
    overdueCount: 0,
    pendingCount: 0,
    processingStuckCount: 0,
  };

  for (const row of rows) {
    const bucket = classifyRecoveryHealthBucket(row, now);
    if (bucket) {
      counts[bucket] += 1;
    }
  }

  return counts;
};

/**
 * Load recovery monitoring counts for /app/monitoring.
 * Fail-open: returns zeros if the query fails.
 */
export const loadPaymentRecoveryHealth = async ({
  now,
  shop,
}: {
  now: Date;
  shop: string;
}): Promise<RecoveryHealthCounts> => {
  const empty = (): RecoveryHealthCounts => ({
    finalFailedCount: 0,
    overdueCount: 0,
    pendingCount: 0,
    processingStuckCount: 0,
  });

  try {
    const rows = await db.subscriptionPaymentRecovery.findMany({
      select: {
        nextRetryAt: true,
        status: true,
        updatedAt: true,
      },
      where: {
        shop,
        status: {
          in: [
            ...ACTIVE_RECOVERY_STATUSES,
            RECOVERY_STATUS.FINAL_FAILED,
          ],
        },
      },
    });

    return summarizeRecoveryHealthRows(rows as RecoveryHealthRow[], now);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown recovery health error";
    console.error("[paymentRecoveryHealth] load failed (fail-open)", {
      message,
      shop,
    });
    return empty();
  }
};
