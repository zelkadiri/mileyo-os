/**
 * CronRun persistence (MONITORING-1).
 *
 * Monitoring is secondary: every DB call is fail-open.
 * A monitoring failure must never block process-subscriptions.
 * No PII — shop + cronName + counters + timestamps + safe global error only.
 */

import {
  CRON_ERROR_MESSAGE_MAX_LEN,
  CRON_RUN_STATUS,
} from "../../constants/cronRun";
import db from "../../db.server";

export type CronRunRecord = {
  completedAt: Date | null;
  createdAt: Date;
  cronName: string;
  durationMs: number | null;
  errorCode: string | null;
  errorCount: number | null;
  errorMessage: string | null;
  id: string;
  processedCount: number | null;
  shop: string;
  skippedCount: number | null;
  startedAt: Date;
  status: string;
};

export type CronRunSuccessSummary = {
  errorCount: number;
  processedCount: number;
  skippedCount: number;
};

type CronRunCreateArgs = {
  data: {
    cronName: string;
    shop: string;
    startedAt: Date;
    status: string;
  };
};

type CronRunUpdateArgs = {
  data: {
    completedAt: Date;
    durationMs: number;
    errorCode?: string | null;
    errorCount?: number | null;
    errorMessage?: string | null;
    processedCount?: number | null;
    skippedCount?: number | null;
    status: string;
  };
  where: { id: string };
};

export type CronRunDb = {
  cronRun: {
    create: (args: CronRunCreateArgs) => Promise<CronRunRecord>;
    update: (args: CronRunUpdateArgs) => Promise<CronRunRecord>;
  };
};

const defaultClient = (): CronRunDb => db as unknown as CronRunDb;

const truncateSafeMessage = (message: string): string => {
  const trimmed = message.trim();
  if (trimmed.length <= CRON_ERROR_MESSAGE_MAX_LEN) {
    return trimmed;
  }
  return trimmed.slice(0, CRON_ERROR_MESSAGE_MAX_LEN);
};

export const safeCronRunErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return truncateSafeMessage(error.message);
  }
  return "Cron job failed unexpectedly.";
};

const logMonitoringFailure = (
  phase: "start" | "complete_success" | "complete_failure",
  error: unknown,
  context: Record<string, unknown>,
) => {
  const message =
    error instanceof Error ? error.message : "unknown monitoring error";
  console.error("[cronRun] monitoring persistence failed", {
    ...context,
    message,
    phase,
  });
};

/**
 * Create a running CronRun. Fail-open: returns null if monitoring DB fails.
 */
export const startCronRun = async ({
  client,
  cronName,
  now = new Date(),
  shop,
}: {
  client?: CronRunDb;
  cronName: string;
  now?: Date;
  shop: string;
}): Promise<CronRunRecord | null> => {
  try {
    const dbClient = client ?? defaultClient();
    return await dbClient.cronRun.create({
      data: {
        cronName,
        shop,
        startedAt: now,
        status: CRON_RUN_STATUS.RUNNING,
      },
    });
  } catch (error) {
    logMonitoringFailure("start", error, { cronName, shop });
    return null;
  }
};

/**
 * Mark run success with worker summary counters.
 * Fail-open: logs and returns null — caller must still return worker success.
 */
export const completeCronRunSuccess = async ({
  client,
  now = new Date(),
  runId,
  startedAt,
  summary,
}: {
  client?: CronRunDb;
  now?: Date;
  runId: string;
  startedAt: Date;
  summary: CronRunSuccessSummary;
}): Promise<CronRunRecord | null> => {
  try {
    const dbClient = client ?? defaultClient();
    const durationMs = Math.max(0, now.getTime() - startedAt.getTime());
    return await dbClient.cronRun.update({
      data: {
        completedAt: now,
        durationMs,
        errorCount: summary.errorCount,
        processedCount: summary.processedCount,
        skippedCount: summary.skippedCount,
        status: CRON_RUN_STATUS.SUCCESS,
      },
      where: { id: runId },
    });
  } catch (error) {
    logMonitoringFailure("complete_success", error, { runId });
    return null;
  }
};

/**
 * Mark run failed after a global cron exception.
 * Fail-open. Does not store stack traces.
 */
export const completeCronRunFailure = async ({
  client,
  errorCode = "cron_exception",
  errorMessage,
  now = new Date(),
  runId,
  startedAt,
}: {
  client?: CronRunDb;
  errorCode?: string;
  errorMessage: string;
  now?: Date;
  runId: string;
  startedAt: Date;
}): Promise<CronRunRecord | null> => {
  try {
    const dbClient = client ?? defaultClient();
    const durationMs = Math.max(0, now.getTime() - startedAt.getTime());
    return await dbClient.cronRun.update({
      data: {
        completedAt: now,
        durationMs,
        errorCode,
        errorMessage: truncateSafeMessage(errorMessage),
        status: CRON_RUN_STATUS.FAILED,
      },
      where: { id: runId },
    });
  } catch (error) {
    logMonitoringFailure("complete_failure", error, { runId });
    return null;
  }
};
