/**
 * Generic EmailEvent worker (EMAIL-6D).
 *
 * Reclaim → list due → claim → handler → transition.
 * No domain email knowledge, no Resend, no trySend*, no template content.
 */

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_PROCESSING_BATCH_LIMIT,
  EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES,
  EMAIL_EVENT_RETRY_DELAY_MINUTES,
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
  now,
  result,
  summary,
}: {
  client?: EmailEventDb;
  event: EmailEventRecord;
  now: Date;
  result: EmailEventHandlerResult;
  summary: ProcessDueEmailEventsSummary;
}): Promise<void> => {
  if (result.outcome === "sent") {
    await markEmailEventSent({
      client,
      eventId: event.id,
      providerId: result.providerId ?? "",
      sentAt: now,
    });
    summary.sent += 1;
    return;
  }

  if (result.outcome === "cancelled") {
    await cancelEmailEvent({
      cancelledAt: now,
      client,
      eventId: event.id,
    });
    summary.cancelled += 1;
    return;
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
    summary.failed += 1;
    pushWorkerError({
      errorCode,
      eventId: event.id,
      eventType: event.eventType,
      message,
      summary,
    });
    return;
  }

  // retryable_failure
  const errorCode = result.errorCode ?? "retryable_failure";
  const message = result.message ?? "retryable failure";

  if (event.attemptCount >= EMAIL_EVENT_MAX_ATTEMPTS) {
    await markEmailEventFailed({
      client,
      eventId: event.id,
      lastErrorCode: errorCode,
      lastErrorMessage: message,
    });
    summary.failed += 1;
    pushWorkerError({
      errorCode,
      eventId: event.id,
      eventType: event.eventType,
      message,
      summary,
    });
    return;
  }

  await requeueEmailEventAfterFailure({
    client,
    eventId: event.id,
    lastErrorCode: errorCode,
    lastErrorMessage: message,
    nextAttemptAt: computeEmailEventRetryAt(now),
  });
  summary.retried += 1;
  pushWorkerError({
    errorCode,
    eventId: event.id,
    eventType: event.eventType,
    message,
    summary,
  });
};

const processClaimedEvent = async ({
  client,
  event,
  handlers,
  now,
  summary,
}: {
  client?: EmailEventDb;
  event: EmailEventRecord;
  handlers: EmailEventHandlerRegistry;
  now: Date;
  summary: ProcessDueEmailEventsSummary;
}): Promise<void> => {
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
    summary.unsupported += 1;
    summary.failed += 1;
    pushWorkerError({
      errorCode,
      eventId: event.id,
      eventType: event.eventType,
      message,
      summary,
    });
    return;
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

  await applyHandlerResult({ client, event, now, result, summary });
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
        await processClaimedEvent({
          client,
          event: claimResult.event,
          handlers,
          now,
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
