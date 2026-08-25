/**
 * Email cron health classification + admin loader helpers (EMAIL-6G-C).
 * Pure classification uses server `now`. No EmailEvent writes.
 */

import {
  EMAIL_CRON_CONSECUTIVE_FAILURES_INCIDENT,
  EMAIL_CRON_HEALTH_LEVEL,
  EMAIL_CRON_NO_SUCCESS_INCIDENT_MS,
  EMAIL_CRON_RECENT_RUNS_LIMIT,
  EMAIL_CRON_RUN_STATUS,
  EMAIL_CRON_SILENCE_AFTER_MS,
  EMAIL_CRON_STUCK_RUNNING_MS,
  type EmailCronHealthLevel,
} from "../../constants/emailCron";
import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES,
  EMAIL_EVENT_STATUS,
} from "../../constants/emailEvent";
import db from "../../db.server";
import type {
  EmailAdminAlert,
  EmailAdminCronHealth,
  EmailAdminCronRunSummary,
} from "./emails-types";

type CronRunRow = {
  completedAt: Date | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  failedCount: number | null;
  id: string;
  processedCount: number | null;
  reclaimedCount: number | null;
  requeuedCount: number | null;
  sentCount: number | null;
  startedAt: Date;
  status: string;
};

const toIso = (value: Date | null | undefined): string | null =>
  value == null ? null : value.toISOString();

export const mapCronRunSummary = (
  row: CronRunRow,
  now: Date,
): EmailAdminCronRunSummary => {
  const isStuckRunning =
    row.status === EMAIL_CRON_RUN_STATUS.RUNNING &&
    now.getTime() - row.startedAt.getTime() > EMAIL_CRON_STUCK_RUNNING_MS;

  return {
    completedAt: toIso(row.completedAt),
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    failedCount: row.failedCount,
    id: row.id,
    isStuckRunning,
    processedCount: row.processedCount,
    reclaimedCount: row.reclaimedCount,
    requeuedCount: row.requeuedCount,
    sentCount: row.sentCount,
    startedAt: row.startedAt.toISOString(),
    status: row.status,
  };
};

export type ClassifyEmailCronHealthInput = {
  consecutiveFailedCount: number;
  lastRun: CronRunRow | null;
  lastSuccessAt: Date | null;
  now: Date;
};

/**
 * Computed health: OK / Attention / Incident (not a DB status).
 *
 * Incident:
 * - no success within 4h (or never)
 * - consecutive failed runs ≥ threshold
 *
 * Attention:
 * - silence > 2h
 * - last run failed
 * - stuck running > 15m
 *
 * OK: last success within 2h and none of the above.
 */
export const classifyEmailCronHealthLevel = ({
  consecutiveFailedCount,
  lastRun,
  lastSuccessAt,
  now,
}: ClassifyEmailCronHealthInput): EmailCronHealthLevel => {
  const nowMs = now.getTime();

  if (
    consecutiveFailedCount >= EMAIL_CRON_CONSECUTIVE_FAILURES_INCIDENT ||
    lastSuccessAt == null ||
    nowMs - lastSuccessAt.getTime() > EMAIL_CRON_NO_SUCCESS_INCIDENT_MS
  ) {
    return EMAIL_CRON_HEALTH_LEVEL.INCIDENT;
  }

  const lastActivityAt = lastRun?.startedAt ?? null;
  const isSilent =
    lastActivityAt == null ||
    nowMs - lastActivityAt.getTime() > EMAIL_CRON_SILENCE_AFTER_MS;

  const lastRunFailed = lastRun?.status === EMAIL_CRON_RUN_STATUS.FAILED;
  const isStuck =
    lastRun?.status === EMAIL_CRON_RUN_STATUS.RUNNING &&
    nowMs - lastRun.startedAt.getTime() > EMAIL_CRON_STUCK_RUNNING_MS;

  if (isSilent || lastRunFailed || isStuck) {
    return EMAIL_CRON_HEALTH_LEVEL.ATTENTION;
  }

  if (nowMs - lastSuccessAt.getTime() <= EMAIL_CRON_SILENCE_AFTER_MS) {
    return EMAIL_CRON_HEALTH_LEVEL.OK;
  }

  return EMAIL_CRON_HEALTH_LEVEL.ATTENTION;
};

export type BuildEmailCronAlertsInput = {
  exhaustedCount: number;
  failedCount: number;
  lastRun: EmailAdminCronRunSummary | null;
  lastSuccessAt: string | null;
  now: Date;
  staleProcessingCount: number;
};

export const buildEmailCronAlerts = ({
  exhaustedCount,
  failedCount,
  lastRun,
  lastSuccessAt,
  now,
  staleProcessingCount,
}: BuildEmailCronAlertsInput): EmailAdminAlert[] => {
  const alerts: EmailAdminAlert[] = [];
  const nowMs = now.getTime();

  const lastActivityMs = lastRun
    ? new Date(lastRun.startedAt).getTime()
    : null;
  const isSilent =
    lastActivityMs == null ||
    nowMs - lastActivityMs > EMAIL_CRON_SILENCE_AFTER_MS;

  if (isSilent) {
    alerts.push({
      href: null,
      id: "cron_silence",
      message: "Le cron email n’a pas été observé récemment.",
      severity: "incident",
    });
  }

  if (lastRun?.status === EMAIL_CRON_RUN_STATUS.FAILED) {
    alerts.push({
      href: null,
      id: "cron_last_failed",
      message: "Le dernier run du cron email a échoué.",
      severity: "incident",
    });
  }

  if (lastRun?.isStuckRunning) {
    alerts.push({
      href: null,
      id: "cron_stuck_running",
      message: "Run potentiellement interrompu",
      severity: "attention",
    });
  }

  if (
    lastSuccessAt != null &&
    nowMs - new Date(lastSuccessAt).getTime() >
      EMAIL_CRON_NO_SUCCESS_INCIDENT_MS &&
    !isSilent
  ) {
    alerts.push({
      href: null,
      id: "cron_no_recent_success",
      message: "Aucun succès du cron email depuis plus de 4 heures.",
      severity: "incident",
    });
  }

  if (failedCount > 0) {
    alerts.push({
      href: "/app/emails?status=failed",
      id: "email_failed",
      message:
        failedCount === 1
          ? "1 email en échec"
          : `${failedCount} emails en échec`,
      severity: "attention",
    });
  }

  if (exhaustedCount > 0) {
    alerts.push({
      href: "/app/emails?status=failed",
      id: "email_exhausted",
      message:
        exhaustedCount === 1
          ? "1 email épuisé"
          : `${exhaustedCount} emails épuisés`,
      severity: "attention",
    });
  }

  if (staleProcessingCount > 0) {
    alerts.push({
      href: "/app/emails?status=processing",
      id: "email_stale_processing",
      message:
        staleProcessingCount === 1
          ? "1 email potentiellement bloqué"
          : `${staleProcessingCount} emails potentiellement bloqués`,
      severity: "attention",
    });
  }

  return alerts;
};

const countConsecutiveFailed = (runsNewestFirst: CronRunRow[]): number => {
  let count = 0;
  for (const run of runsNewestFirst) {
    if (run.status === EMAIL_CRON_RUN_STATUS.FAILED) {
      count += 1;
      continue;
    }
    if (run.status === EMAIL_CRON_RUN_STATUS.RUNNING) {
      continue;
    }
    break;
  }
  return count;
};

/**
 * Load cron health + visual alerts for /app/emails.
 * Fail-open: if EmailCronRun (or related) queries fail, return empty health
 * so observability never breaks the admin emails page.
 */
export const loadEmailCronHealth = async ({
  now,
  shop,
}: {
  now: Date;
  shop: string;
}): Promise<EmailAdminCronHealth> => {
  const emptyHealth = (): EmailAdminCronHealth => ({
    alerts: buildEmailCronAlerts({
      exhaustedCount: 0,
      failedCount: 0,
      lastRun: null,
      lastSuccessAt: null,
      now,
      staleProcessingCount: 0,
    }),
    healthLevel: EMAIL_CRON_HEALTH_LEVEL.INCIDENT,
    isSilent: true,
    lastFailed: null,
    lastRun: null,
    lastSuccess: null,
    recentRuns: [],
    serverNow: now.toISOString(),
    staleProcessingCount: 0,
  });

  try {
    const staleBefore = new Date(
      now.getTime() -
        EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES * 60 * 1000,
    );

    const [
      recentRows,
      lastSuccessRow,
      lastFailedRow,
      staleProcessingCount,
      failedCount,
      exhaustedCount,
    ] = await Promise.all([
      db.emailCronRun.findMany({
        orderBy: { startedAt: "desc" },
        take: EMAIL_CRON_RECENT_RUNS_LIMIT,
        where: { shop },
      }),
      db.emailCronRun.findFirst({
        orderBy: { startedAt: "desc" },
        where: { shop, status: EMAIL_CRON_RUN_STATUS.SUCCESS },
      }),
      db.emailCronRun.findFirst({
        orderBy: { startedAt: "desc" },
        where: { shop, status: EMAIL_CRON_RUN_STATUS.FAILED },
      }),
      db.emailEvent.count({
        where: {
          processingStartedAt: { lt: staleBefore },
          shop,
          status: EMAIL_EVENT_STATUS.PROCESSING,
        },
      }),
      db.emailEvent.count({
        where: { shop, status: EMAIL_EVENT_STATUS.FAILED },
      }),
      db.emailEvent.count({
        where: {
          attemptCount: { gte: EMAIL_EVENT_MAX_ATTEMPTS },
          shop,
          status: EMAIL_EVENT_STATUS.FAILED,
        },
      }),
    ]);

    const rows = recentRows as CronRunRow[];
    const lastRunRow = rows[0] ?? null;
    const lastSuccessAt =
      (lastSuccessRow as CronRunRow | null)?.startedAt ?? null;
    const consecutiveFailedCount = countConsecutiveFailed(rows);

    const healthLevel = classifyEmailCronHealthLevel({
      consecutiveFailedCount,
      lastRun: lastRunRow,
      lastSuccessAt,
      now,
    });

    const lastRun = lastRunRow ? mapCronRunSummary(lastRunRow, now) : null;
    const recentRuns = rows.map((row) => mapCronRunSummary(row, now));
    const lastSuccess = lastSuccessRow
      ? mapCronRunSummary(lastSuccessRow as CronRunRow, now)
      : null;
    const lastFailed = lastFailedRow
      ? mapCronRunSummary(lastFailedRow as CronRunRow, now)
      : null;

    const alerts = buildEmailCronAlerts({
      exhaustedCount,
      failedCount,
      lastRun,
      lastSuccessAt: toIso(lastSuccessAt),
      now,
      staleProcessingCount,
    });

    const lastActivityAt = lastRunRow?.startedAt ?? null;
    const isSilent =
      lastActivityAt == null ||
      now.getTime() - lastActivityAt.getTime() > EMAIL_CRON_SILENCE_AFTER_MS;

    return {
      alerts,
      healthLevel,
      isSilent,
      lastFailed,
      lastRun,
      lastSuccess,
      recentRuns,
      serverNow: now.toISOString(),
      staleProcessingCount,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown health load error";
    console.error("[emailCronHealth] load failed (fail-open)", {
      message,
      shop,
    });
    return emptyHealth();
  }
};
