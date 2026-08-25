/**
 * Email cron run health constants (EMAIL-6G-C).
 * Monitoring only — no EmailEvent retry / worker coupling.
 */

export const EMAIL_CRON_RUN_STATUS = {
  FAILED: "failed",
  RUNNING: "running",
  SUCCESS: "success",
} as const;

export type EmailCronRunStatus =
  (typeof EMAIL_CRON_RUN_STATUS)[keyof typeof EMAIL_CRON_RUN_STATUS];

export const EMAIL_CRON_RUN_STATUSES = [
  EMAIL_CRON_RUN_STATUS.RUNNING,
  EMAIL_CRON_RUN_STATUS.SUCCESS,
  EMAIL_CRON_RUN_STATUS.FAILED,
] as const;

export const isEmailCronRunStatus = (
  value: string,
): value is EmailCronRunStatus =>
  (EMAIL_CRON_RUN_STATUSES as readonly string[]).includes(value);

/** Admin health level (computed, not a DB status). */
export const EMAIL_CRON_HEALTH_LEVEL = {
  ATTENTION: "attention",
  INCIDENT: "incident",
  OK: "ok",
} as const;

export type EmailCronHealthLevel =
  (typeof EMAIL_CRON_HEALTH_LEVEL)[keyof typeof EMAIL_CRON_HEALTH_LEVEL];

/** No completed/started run observed within this window → silence alert. */
export const EMAIL_CRON_SILENCE_AFTER_MS = 2 * 60 * 60 * 1000;

/** No success within this window → incident. */
export const EMAIL_CRON_NO_SUCCESS_INCIDENT_MS = 4 * 60 * 60 * 1000;

/** `running` longer than this → potentially interrupted (Vercel timeout / crash). */
export const EMAIL_CRON_STUCK_RUNNING_MS = 15 * 60 * 1000;

/** Consecutive terminal `failed` runs that escalate health to incident. */
export const EMAIL_CRON_CONSECUTIVE_FAILURES_INCIDENT = 2;

/** Compact history rows on /app/emails. */
export const EMAIL_CRON_RECENT_RUNS_LIMIT = 10;

/** Cap stored global cron error messages (no stack traces). */
export const EMAIL_CRON_ERROR_MESSAGE_MAX_LEN = 500;
