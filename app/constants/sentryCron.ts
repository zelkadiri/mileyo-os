/**
 * Sentry Cron Monitor slugs + upsert config (MONITORING-1B).
 * Alerting only — DB CronRun / EmailCronRun remain operator source of truth.
 * No shop-scoped or dynamic slugs.
 */

export const SENTRY_CRON_MONITOR_SLUG = {
  PROCESS_EMAIL_RETRIES: "mileyo-process-email-retries",
  PROCESS_SUBSCRIPTIONS: "mileyo-process-subscriptions",
} as const;

export type SentryCronMonitorSlug =
  (typeof SENTRY_CRON_MONITOR_SLUG)[keyof typeof SENTRY_CRON_MONITOR_SLUG];

/** Vercel cron schedules (UTC). */
export const SENTRY_CRON_SCHEDULE = {
  PROCESS_EMAIL_RETRIES: "5 * * * *",
  PROCESS_SUBSCRIPTIONS: "0 * * * *",
} as const;

/** Minutes after expected tick before Sentry marks the run as missed. */
export const SENTRY_CRON_CHECKIN_MARGIN_MINUTES = 15;

/** Minutes `in_progress` may last before Sentry marks a timeout failure. */
export const SENTRY_CRON_MAX_RUNTIME_MINUTES = 30;

export const SENTRY_CRON_TIMEZONE = "UTC";

export type SentryCronMonitorConfig = {
  checkinMargin: number;
  maxRuntime: number;
  schedule: { type: "crontab"; value: string };
  timezone: string;
};

export const SENTRY_CRON_MONITOR_CONFIG: Record<
  SentryCronMonitorSlug,
  SentryCronMonitorConfig
> = {
  [SENTRY_CRON_MONITOR_SLUG.PROCESS_SUBSCRIPTIONS]: {
    checkinMargin: SENTRY_CRON_CHECKIN_MARGIN_MINUTES,
    maxRuntime: SENTRY_CRON_MAX_RUNTIME_MINUTES,
    schedule: {
      type: "crontab",
      value: SENTRY_CRON_SCHEDULE.PROCESS_SUBSCRIPTIONS,
    },
    timezone: SENTRY_CRON_TIMEZONE,
  },
  [SENTRY_CRON_MONITOR_SLUG.PROCESS_EMAIL_RETRIES]: {
    checkinMargin: SENTRY_CRON_CHECKIN_MARGIN_MINUTES,
    maxRuntime: SENTRY_CRON_MAX_RUNTIME_MINUTES,
    schedule: {
      type: "crontab",
      value: SENTRY_CRON_SCHEDULE.PROCESS_EMAIL_RETRIES,
    },
    timezone: SENTRY_CRON_TIMEZONE,
  },
};
