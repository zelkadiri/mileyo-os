/**
 * Sentry Cron Check-ins (MONITORING-1B) — server-only, fail-open, no PII.
 *
 * Complements CronRun / EmailCronRun (operator source of truth) and
 * captureTechnicalError (exception issues). A check-in `error` status is a
 * monitor signal only — it does NOT call captureException, so outer cron
 * failures may produce both a Sentry issue (via captureTechnicalError) and a
 * monitor error without duplicating the exception payload.
 */
import * as Sentry from "@sentry/node";
import type { CheckIn, MonitorConfig } from "@sentry/node";

import {
  SENTRY_CRON_MONITOR_CONFIG,
  type SentryCronMonitorSlug,
} from "../../constants/sentryCron";
import { initSentry, isSentryEnabled } from "./sentry.server";

type CaptureCheckInFn = (
  checkIn: CheckIn,
  upsertMonitorConfig?: MonitorConfig,
) => string;

let captureCheckInImpl: CaptureCheckInFn = (checkIn, upsertMonitorConfig) =>
  Sentry.captureCheckIn(checkIn, upsertMonitorConfig);

const resolveMonitorConfig = (
  monitorSlug: SentryCronMonitorSlug,
): MonitorConfig => {
  const config = SENTRY_CRON_MONITOR_CONFIG[monitorSlug];

  return {
    checkinMargin: config.checkinMargin,
    maxRuntime: config.maxRuntime,
    schedule: config.schedule,
    timezone: config.timezone,
  };
};

const durationSecondsFrom = (startedAtMs: number | null | undefined): number | undefined => {
  if (startedAtMs == null || !Number.isFinite(startedAtMs)) {
    return undefined;
  }

  return Math.max(0, (Date.now() - startedAtMs) / 1000);
};

/**
 * Send `in_progress` check-in + upsert monitor schedule.
 * Returns checkInId when sent; null when Sentry is off or the SDK call fails.
 */
export const startCronCheckIn = (
  monitorSlug: SentryCronMonitorSlug,
): string | null => {
  try {
    initSentry();

    if (!isSentryEnabled()) {
      return null;
    }

    const checkInId = captureCheckInImpl(
      { monitorSlug, status: "in_progress" },
      resolveMonitorConfig(monitorSlug),
    );

    return typeof checkInId === "string" && checkInId.length > 0
      ? checkInId
      : null;
  } catch (error) {
    console.error("[sentry-cron] startCronCheckIn failed (fail-open)", {
      monitorSlug,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
};

/**
 * Complete a started check-in with `ok`. No-op when checkInId is absent.
 * Never throws into business cron callers.
 */
export const completeCronCheckInSuccess = (
  monitorSlug: SentryCronMonitorSlug,
  checkInId: string | null | undefined,
  startedAtMs?: number | null,
): void => {
  if (!checkInId) {
    return;
  }

  try {
    initSentry();

    if (!isSentryEnabled()) {
      return;
    }

    const duration = durationSecondsFrom(startedAtMs);

    captureCheckInImpl({
      checkInId,
      monitorSlug,
      status: "ok",
      ...(duration !== undefined ? { duration } : {}),
    });
  } catch (error) {
    console.error("[sentry-cron] completeCronCheckInSuccess failed (fail-open)", {
      monitorSlug,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
};

/**
 * Complete a started check-in with `error` (monitor signal only — no exception).
 * Never throws into business cron callers.
 */
export const completeCronCheckInFailure = (
  monitorSlug: SentryCronMonitorSlug,
  checkInId: string | null | undefined,
  startedAtMs?: number | null,
): void => {
  if (!checkInId) {
    return;
  }

  try {
    initSentry();

    if (!isSentryEnabled()) {
      return;
    }

    const duration = durationSecondsFrom(startedAtMs);

    captureCheckInImpl({
      checkInId,
      monitorSlug,
      status: "error",
      ...(duration !== undefined ? { duration } : {}),
    });
  } catch (error) {
    console.error("[sentry-cron] completeCronCheckInFailure failed (fail-open)", {
      monitorSlug,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
};

/** @internal Mileyo business regression tests only. */
export const __setCaptureCheckInForTests = (
  fn: CaptureCheckInFn | null,
): void => {
  captureCheckInImpl =
    fn ??
    ((checkIn, upsertMonitorConfig) =>
      Sentry.captureCheckIn(checkIn, upsertMonitorConfig));
};

/** @internal Mileyo business regression tests only. */
export const __resetSentryCronForTests = (): void => {
  captureCheckInImpl = (checkIn, upsertMonitorConfig) =>
    Sentry.captureCheckIn(checkIn, upsertMonitorConfig);
};
