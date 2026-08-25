/**
 * EmailCronRun persistence (EMAIL-6G-C).
 *
 * Monitoring is secondary: every DB call is fail-open.
 * A monitoring failure must never block processDueEmailEvents.
 * No PII — shop + counters + timestamps + safe global error only.
 */

import {
  EMAIL_CRON_ERROR_MESSAGE_MAX_LEN,
  EMAIL_CRON_RUN_STATUS,
} from "../../constants/emailCron";
import db from "../../db.server";
import type { ProcessDueEmailEventsSummary } from "./email-event-worker.server";

export type EmailCronRunRecord = {
  completedAt: Date | null;
  createdAt: Date;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  failedCount: number | null;
  id: string;
  processedCount: number | null;
  reclaimedCount: number | null;
  requeuedCount: number | null;
  sentCount: number | null;
  shop: string;
  startedAt: Date;
  status: string;
};

type EmailCronRunCreateArgs = {
  data: {
    shop: string;
    startedAt: Date;
    status: string;
  };
};

type EmailCronRunUpdateArgs = {
  data: {
    completedAt: Date;
    durationMs: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    failedCount?: number | null;
    processedCount?: number | null;
    reclaimedCount?: number | null;
    requeuedCount?: number | null;
    sentCount?: number | null;
    status: string;
  };
  where: { id: string };
};

export type EmailCronRunDb = {
  emailCronRun: {
    create: (args: EmailCronRunCreateArgs) => Promise<EmailCronRunRecord>;
    update: (args: EmailCronRunUpdateArgs) => Promise<EmailCronRunRecord>;
  };
};

const defaultClient = (): EmailCronRunDb => db as unknown as EmailCronRunDb;

const truncateSafeMessage = (message: string): string => {
  const trimmed = message.trim();
  if (trimmed.length <= EMAIL_CRON_ERROR_MESSAGE_MAX_LEN) {
    return trimmed;
  }
  return trimmed.slice(0, EMAIL_CRON_ERROR_MESSAGE_MAX_LEN);
};

export const safeCronErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return truncateSafeMessage(error.message);
  }
  return "Email event retry cron failed unexpectedly.";
};

const logMonitoringFailure = (
  phase: "start" | "complete_success" | "complete_failure",
  error: unknown,
  context: Record<string, unknown>,
) => {
  const message =
    error instanceof Error ? error.message : "unknown monitoring error";
  console.error("[emailCronRun] monitoring persistence failed", {
    ...context,
    message,
    phase,
  });
};

/**
 * Create a running EmailCronRun. Fail-open: returns null if monitoring DB fails.
 */
export const startEmailCronRun = async ({
  client,
  now = new Date(),
  shop,
}: {
  client?: EmailCronRunDb;
  now?: Date;
  shop: string;
}): Promise<EmailCronRunRecord | null> => {
  try {
    const dbClient = client ?? defaultClient();
    return await dbClient.emailCronRun.create({
      data: {
        shop,
        startedAt: now,
        status: EMAIL_CRON_RUN_STATUS.RUNNING,
      },
    });
  } catch (error) {
    logMonitoringFailure("start", error, { shop });
    return null;
  }
};

/**
 * Mark run success with worker summary counters.
 * Fail-open: logs and returns null — caller must still return worker success.
 *
 * Mapping from ProcessDueEmailEventsSummary:
 * - processedCount ← claimed
 * - sentCount ← sent
 * - failedCount ← failed
 * - requeuedCount ← retried
 * - reclaimedCount ← reclaimed
 */
export const completeEmailCronRunSuccess = async ({
  client,
  now = new Date(),
  runId,
  startedAt,
  summary,
}: {
  client?: EmailCronRunDb;
  now?: Date;
  runId: string;
  startedAt: Date;
  summary: ProcessDueEmailEventsSummary;
}): Promise<EmailCronRunRecord | null> => {
  try {
    const dbClient = client ?? defaultClient();
    const durationMs = Math.max(0, now.getTime() - startedAt.getTime());
    return await dbClient.emailCronRun.update({
      data: {
        completedAt: now,
        durationMs,
        failedCount: summary.failed,
        processedCount: summary.claimed,
        reclaimedCount: summary.reclaimed,
        requeuedCount: summary.retried,
        sentCount: summary.sent,
        status: EMAIL_CRON_RUN_STATUS.SUCCESS,
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
export const completeEmailCronRunFailure = async ({
  client,
  errorCode = "cron_exception",
  errorMessage,
  now = new Date(),
  runId,
  startedAt,
}: {
  client?: EmailCronRunDb;
  errorCode?: string;
  errorMessage: string;
  now?: Date;
  runId: string;
  startedAt: Date;
}): Promise<EmailCronRunRecord | null> => {
  try {
    const dbClient = client ?? defaultClient();
    const durationMs = Math.max(0, now.getTime() - startedAt.getTime());
    return await dbClient.emailCronRun.update({
      data: {
        completedAt: now,
        durationMs,
        errorCode,
        errorMessage: truncateSafeMessage(errorMessage),
        status: EMAIL_CRON_RUN_STATUS.FAILED,
      },
      where: { id: runId },
    });
  } catch (error) {
    logMonitoringFailure("complete_failure", error, { runId });
    return null;
  }
};
