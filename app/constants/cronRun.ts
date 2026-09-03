/**
 * Generic CronRun heartbeat constants (MONITORING-1).
 * Monitoring only — no billing / recovery / email worker coupling.
 */

export const CRON_RUN_STATUS = {
  FAILED: "failed",
  RUNNING: "running",
  SUCCESS: "success",
} as const;

export type CronRunStatus =
  (typeof CRON_RUN_STATUS)[keyof typeof CRON_RUN_STATUS];

export const CRON_RUN_STATUSES = [
  CRON_RUN_STATUS.RUNNING,
  CRON_RUN_STATUS.SUCCESS,
  CRON_RUN_STATUS.FAILED,
] as const;

export const isCronRunStatus = (value: string): value is CronRunStatus =>
  (CRON_RUN_STATUSES as readonly string[]).includes(value);

export const CRON_NAME = {
  PROCESS_SUBSCRIPTIONS: "process-subscriptions",
} as const;

export type CronName = (typeof CRON_NAME)[keyof typeof CRON_NAME];

/** Admin health level (computed, not a DB status). */
export const CRON_HEALTH_LEVEL = {
  ATTENTION: "attention",
  AWAITING_FIRST_RUN: "awaiting_first_run",
  INCIDENT: "incident",
  OK: "ok",
} as const;

export type CronHealthLevel =
  (typeof CRON_HEALTH_LEVEL)[keyof typeof CRON_HEALTH_LEVEL];

/** No started run observed within this window → silence / attention. */
export const CRON_SILENCE_AFTER_MS = 2 * 60 * 60 * 1000;

/** No success within this window → incident. */
export const CRON_NO_SUCCESS_INCIDENT_MS = 4 * 60 * 60 * 1000;

/** `running` longer than this → potentially interrupted. */
export const CRON_STUCK_RUNNING_MS = 15 * 60 * 1000;

/** Consecutive terminal `failed` runs that escalate to incident. */
export const CRON_CONSECUTIVE_FAILURES_INCIDENT = 2;

/** Compact history rows on admin monitoring. */
export const CRON_RECENT_RUNS_LIMIT = 10;

/** Cap stored global cron error messages (no stack traces). */
export const CRON_ERROR_MESSAGE_MAX_LEN = 500;

/** Recovery overdue: nextRetryAt older than this vs now. */
export const RECOVERY_OVERDUE_AFTER_MS = 2 * 60 * 60 * 1000;

/** Processing recovery stuck: updatedAt older than this. */
export const RECOVERY_PROCESSING_STUCK_AFTER_MS = 60 * 60 * 1000;
