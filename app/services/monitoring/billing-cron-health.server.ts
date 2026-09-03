/**
 * Billing cron health classification + admin loader helpers (MONITORING-1).
 * Pure classification uses server `now`. No billing worker writes.
 */

import {
  CRON_CONSECUTIVE_FAILURES_INCIDENT,
  CRON_HEALTH_LEVEL,
  CRON_NAME,
  CRON_NO_SUCCESS_INCIDENT_MS,
  CRON_RECENT_RUNS_LIMIT,
  CRON_RUN_STATUS,
  CRON_SILENCE_AFTER_MS,
  CRON_STUCK_RUNNING_MS,
  type CronHealthLevel,
} from "../../constants/cronRun";
import db from "../../db.server";

export type BillingCronRunRow = {
  completedAt: Date | null;
  durationMs: number | null;
  errorCode: string | null;
  errorCount: number | null;
  errorMessage: string | null;
  id: string;
  processedCount: number | null;
  skippedCount: number | null;
  startedAt: Date;
  status: string;
};

export type BillingCronRunSummary = {
  completedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorCount: number | null;
  errorMessage: string | null;
  id: string;
  isStuckRunning: boolean;
  processedCount: number | null;
  skippedCount: number | null;
  startedAt: string;
  status: string;
};

export type BillingCronHealth = {
  healthLevel: CronHealthLevel;
  isSilent: boolean;
  lastFailed: BillingCronRunSummary | null;
  lastRun: BillingCronRunSummary | null;
  lastSuccess: BillingCronRunSummary | null;
  recentRuns: BillingCronRunSummary[];
  serverNow: string;
};

const toIso = (value: Date | null | undefined): string | null =>
  value == null ? null : value.toISOString();

export const mapBillingCronRunSummary = (
  row: BillingCronRunRow,
  now: Date,
): BillingCronRunSummary => {
  const isStuckRunning =
    row.status === CRON_RUN_STATUS.RUNNING &&
    now.getTime() - row.startedAt.getTime() > CRON_STUCK_RUNNING_MS;

  return {
    completedAt: toIso(row.completedAt),
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    errorCount: row.errorCount,
    errorMessage: row.errorMessage,
    id: row.id,
    isStuckRunning,
    processedCount: row.processedCount,
    skippedCount: row.skippedCount,
    startedAt: row.startedAt.toISOString(),
    status: row.status,
  };
};

export type ClassifyBillingCronHealthInput = {
  consecutiveFailedCount: number;
  hasAnyRun: boolean;
  lastRun: BillingCronRunRow | null;
  lastSuccessAt: Date | null;
  now: Date;
};

/**
 * Computed health: awaiting_first_run / OK / Attention / Incident.
 *
 * awaiting_first_run: no CronRun rows yet (post-migration / first deploy).
 *
 * Incident:
 * - no success within 4h (when at least one run exists)
 * - consecutive failed runs ≥ threshold
 *
 * Attention:
 * - silence > 2h
 * - last run failed
 * - stuck running > 15m
 *
 * OK: last success within 2h and none of the above.
 */
export const classifyBillingCronHealthLevel = ({
  consecutiveFailedCount,
  hasAnyRun,
  lastRun,
  lastSuccessAt,
  now,
}: ClassifyBillingCronHealthInput): CronHealthLevel => {
  if (!hasAnyRun) {
    return CRON_HEALTH_LEVEL.AWAITING_FIRST_RUN;
  }

  const nowMs = now.getTime();

  if (
    consecutiveFailedCount >= CRON_CONSECUTIVE_FAILURES_INCIDENT ||
    lastSuccessAt == null ||
    nowMs - lastSuccessAt.getTime() > CRON_NO_SUCCESS_INCIDENT_MS
  ) {
    return CRON_HEALTH_LEVEL.INCIDENT;
  }

  const lastActivityAt = lastRun?.startedAt ?? null;
  const isSilent =
    lastActivityAt == null ||
    nowMs - lastActivityAt.getTime() > CRON_SILENCE_AFTER_MS;

  const lastRunFailed = lastRun?.status === CRON_RUN_STATUS.FAILED;
  const isStuck =
    lastRun?.status === CRON_RUN_STATUS.RUNNING &&
    nowMs - lastRun.startedAt.getTime() > CRON_STUCK_RUNNING_MS;

  if (isSilent || lastRunFailed || isStuck) {
    return CRON_HEALTH_LEVEL.ATTENTION;
  }

  if (nowMs - lastSuccessAt.getTime() <= CRON_SILENCE_AFTER_MS) {
    return CRON_HEALTH_LEVEL.OK;
  }

  return CRON_HEALTH_LEVEL.ATTENTION;
};

const countConsecutiveFailed = (runsNewestFirst: BillingCronRunRow[]): number => {
  let count = 0;
  for (const run of runsNewestFirst) {
    if (run.status === CRON_RUN_STATUS.FAILED) {
      count += 1;
      continue;
    }
    if (run.status === CRON_RUN_STATUS.RUNNING) {
      continue;
    }
    break;
  }
  return count;
};

/**
 * Load billing cron health for /app/monitoring.
 * Fail-open: if CronRun queries fail, return awaiting_first_run-style empty
 * so observability never breaks the admin page.
 */
export const loadBillingCronHealth = async ({
  now,
  shop,
}: {
  now: Date;
  shop: string;
}): Promise<BillingCronHealth> => {
  const emptyHealth = (): BillingCronHealth => ({
    healthLevel: CRON_HEALTH_LEVEL.AWAITING_FIRST_RUN,
    isSilent: true,
    lastFailed: null,
    lastRun: null,
    lastSuccess: null,
    recentRuns: [],
    serverNow: now.toISOString(),
  });

  try {
    const [recentRows, lastSuccessRow, lastFailedRow] = await Promise.all([
      db.cronRun.findMany({
        orderBy: { startedAt: "desc" },
        take: CRON_RECENT_RUNS_LIMIT,
        where: { cronName: CRON_NAME.PROCESS_SUBSCRIPTIONS, shop },
      }),
      db.cronRun.findFirst({
        orderBy: { startedAt: "desc" },
        where: {
          cronName: CRON_NAME.PROCESS_SUBSCRIPTIONS,
          shop,
          status: CRON_RUN_STATUS.SUCCESS,
        },
      }),
      db.cronRun.findFirst({
        orderBy: { startedAt: "desc" },
        where: {
          cronName: CRON_NAME.PROCESS_SUBSCRIPTIONS,
          shop,
          status: CRON_RUN_STATUS.FAILED,
        },
      }),
    ]);

    const rows = recentRows as BillingCronRunRow[];
    const lastRunRow = rows[0] ?? null;
    const lastSuccessAt =
      (lastSuccessRow as BillingCronRunRow | null)?.startedAt ?? null;
    const consecutiveFailedCount = countConsecutiveFailed(rows);
    const hasAnyRun = rows.length > 0;

    const healthLevel = classifyBillingCronHealthLevel({
      consecutiveFailedCount,
      hasAnyRun,
      lastRun: lastRunRow,
      lastSuccessAt,
      now,
    });

    const lastRun = lastRunRow ? mapBillingCronRunSummary(lastRunRow, now) : null;
    const recentRuns = rows.map((row) => mapBillingCronRunSummary(row, now));
    const lastSuccess = lastSuccessRow
      ? mapBillingCronRunSummary(lastSuccessRow as BillingCronRunRow, now)
      : null;
    const lastFailed = lastFailedRow
      ? mapBillingCronRunSummary(lastFailedRow as BillingCronRunRow, now)
      : null;

    const lastActivityAt = lastRunRow?.startedAt ?? null;
    const isSilent =
      lastActivityAt == null ||
      now.getTime() - lastActivityAt.getTime() > CRON_SILENCE_AFTER_MS;

    return {
      healthLevel,
      isSilent,
      lastFailed,
      lastRun,
      lastSuccess,
      recentRuns,
      serverNow: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown health load error";
    console.error("[billingCronHealth] load failed (fail-open)", {
      message,
      shop,
    });
    return emptyHealth();
  }
};
