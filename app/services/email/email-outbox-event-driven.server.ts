/**
 * EmailEvent outbox helpers for event-driven transactional emails (EMAIL-6F).
 * Idempotency keys, meta parsing, ensure+immediate, stamps/backfill, pause episode.
 */

import { randomBytes } from "node:crypto";

import {
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_TYPE,
} from "../../constants/emailEvent";
import db from "../../db.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type { EmailEventHandlerRegistry } from "./email-event-handlers.server";
import {
  ensureEmailEvent,
  parseEmailEventMeta,
  serializeEmailEventMeta,
  type EmailEventDb,
  type EmailEventRecord,
  type EnsureEmailEventInput,
} from "./email-event.server";
import type {
  ProcessEmailEventByIdResult,
} from "./email-event-worker.server";
import { EmailEventMetaParseError } from "./email-outbox-campaign.server";
import type { SubscriptionPauseCause } from "./email.types";
import { isAllowedSubscriptionPauseCause } from "./subscription-email.server";

export {
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  EmailEventMetaParseError,
  buildCampaignEmailEventMetaJson,
  classifyEmailSendFailureForEmailEvent,
  parseEmailEventDeliveryDateMeta,
} from "./email-outbox-campaign.server";

export const EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_PAYMENT_RECOVERY =
  "subscription_payment_recovery";

let testEventDrivenDb: typeof db | null = null;

/** @internal Mileyo business regression tests only. */
export const __setEmailOutboxEventDrivenTestDb = (
  client: typeof db | null,
): void => {
  testEventDrivenDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetEmailOutboxEventDrivenTestDb = (): void => {
  testEventDrivenDb = null;
};

const resolveEventDrivenDb = () => testEventDrivenDb ?? db;

// ── Idempotency keys ─────────────────────────────────────────────────────────

export const buildPaymentFailedEmailEventIdempotencyKey = (
  recoveryId: string,
): string => `payment_failed:${recoveryId}`;

export const buildPaymentRecoveredEmailEventIdempotencyKey = (
  selectionId: string,
  orderId: string,
): string => `payment_recovered:${selectionId}:${orderId}`;

export const buildSubscriptionCreatedEmailEventIdempotencyKey = (
  selectionId: string,
): string => `subscription_created:${selectionId}`;

export const buildSubscriptionPausedEmailEventIdempotencyKey = (
  selectionId: string,
  episodeId: string,
): string => `subscription_paused:${selectionId}:${episodeId}`;

export const buildMealSelectionConfirmedEmailEventIdempotencyKey = (
  selectionId: string,
  effectiveDeliveryDate: string,
): string => `meal_selection_confirmed:${selectionId}:${effectiveDeliveryDate}`;

// ── Meta builders / parsers ───────────────────────────────────────────────────

export type PaymentRecoveredEmailEventMeta = {
  orderId: string;
  recoveryIds: string[];
};

export type SubscriptionPausedEmailEventMeta = {
  cause: SubscriptionPauseCause;
  episodeId: string;
};

export const buildPaymentRecoveredEmailEventMetaJson = ({
  orderId,
  recoveryIds,
}: {
  orderId: string;
  recoveryIds: string[];
}): string => serializeEmailEventMeta({ orderId, recoveryIds });

export const parsePaymentRecoveredEmailEventMeta = (
  metaJson: string | null | undefined,
): PaymentRecoveredEmailEventMeta => {
  const parsed = parseEmailEventMeta(metaJson);

  if (!parsed) {
    throw new EmailEventMetaParseError("EmailEvent metaJson is required");
  }

  const orderId = parsed.orderId;
  const recoveryIds = parsed.recoveryIds;

  if (typeof orderId !== "string" || !orderId.trim()) {
    throw new EmailEventMetaParseError(
      "EmailEvent metaJson.orderId must be a non-empty string",
    );
  }

  if (
    !Array.isArray(recoveryIds) ||
    recoveryIds.length === 0 ||
    recoveryIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new EmailEventMetaParseError(
      "EmailEvent metaJson.recoveryIds must be a non-empty string array",
    );
  }

  return {
    orderId,
    recoveryIds: recoveryIds as string[],
  };
};

export const buildSubscriptionPausedEmailEventMetaJson = ({
  cause,
  episodeId,
}: {
  cause: SubscriptionPauseCause;
  episodeId: string;
}): string => serializeEmailEventMeta({ cause, episodeId });

export const parseSubscriptionPausedEmailEventMeta = (
  metaJson: string | null | undefined,
): SubscriptionPausedEmailEventMeta => {
  const parsed = parseEmailEventMeta(metaJson);

  if (!parsed) {
    throw new EmailEventMetaParseError("EmailEvent metaJson is required");
  }

  const episodeId = parsed.episodeId;
  const cause = parsed.cause;

  if (typeof episodeId !== "string" || !episodeId.trim()) {
    throw new EmailEventMetaParseError(
      "EmailEvent metaJson.episodeId must be a non-empty string",
    );
  }

  if (typeof cause !== "string" || !isAllowedSubscriptionPauseCause(cause)) {
    throw new EmailEventMetaParseError(
      "EmailEvent metaJson.cause must be a valid SubscriptionPauseCause",
    );
  }

  return { cause, episodeId };
};

// ── Ensure + immediate processing ─────────────────────────────────────────────

export type EnsureAndProcessEmailEventResult = {
  created: boolean;
  event: EmailEventRecord;
  processResult: ProcessEmailEventByIdResult | null;
};

/**
 * Idempotent ensure + optional immediate claim/process.
 * Callers must isolate this from the business transaction (try/catch).
 * When flag OFF, returns null without creating an event.
 */
export const ensureAndProcessEmailEventImmediately = async ({
  backfillStamp,
  client,
  handlers,
  input,
  now,
}: {
  backfillStamp?: (event: EmailEventRecord) => Promise<unknown>;
  client?: EmailEventDb;
  handlers?: EmailEventHandlerRegistry;
  input: EnsureEmailEventInput;
  now?: Date;
}): Promise<EnsureAndProcessEmailEventResult | null> => {
  if (!isMileyoTransactionalEmailEnabled()) {
    return null;
  }

  const { created, event } = await ensureEmailEvent(input, client);

  if (event.status === EMAIL_EVENT_STATUS.SENT) {
    if (backfillStamp) {
      await backfillStamp(event);
    }
    return { created, event, processResult: null };
  }

  if (event.status !== EMAIL_EVENT_STATUS.PENDING) {
    return { created, event, processResult: null };
  }

  // Dynamic import avoids a module cycle:
  // recovery/billing → event-driven → worker → handlers → modificationBlock → billing
  const { processEmailEventById } = await import("./email-event-worker.server");

  const processResult = await processEmailEventById({
    client,
    eventId: event.id,
    handlers,
    now,
  });

  return { created, event, processResult };
};

// ── Pause episode ─────────────────────────────────────────────────────────────

const generatePauseEmailEpisodeId = (): string =>
  `c${randomBytes(16).toString("hex")}`;

/**
 * Atomically ensure a stable pause-email episode id for a selection.
 * Replay of paused→paused returns the same episode (never regenerates).
 */
export const ensureSubscriptionPauseEmailEpisode = async (
  selectionId: string,
): Promise<string> => {
  const prisma = resolveEventDrivenDb();

  const existing = await prisma.subscriptionMealSelection.findUnique({
    select: { subscriptionPauseEmailEpisodeId: true },
    where: { id: selectionId },
  });

  if (existing?.subscriptionPauseEmailEpisodeId) {
    return existing.subscriptionPauseEmailEpisodeId;
  }

  const episodeId = generatePauseEmailEpisodeId();

  const updateResult = await prisma.subscriptionMealSelection.updateMany({
    data: { subscriptionPauseEmailEpisodeId: episodeId },
    where: {
      id: selectionId,
      subscriptionPauseEmailEpisodeId: null,
    },
  });

  if (updateResult.count === 1) {
    return episodeId;
  }

  const raced = await prisma.subscriptionMealSelection.findUnique({
    select: { subscriptionPauseEmailEpisodeId: true },
    where: { id: selectionId },
  });

  if (!raced?.subscriptionPauseEmailEpisodeId) {
    throw new Error(
      `Failed to ensure subscriptionPauseEmailEpisodeId for selection=${selectionId}`,
    );
  }

  return raced.subscriptionPauseEmailEpisodeId;
};

// ── Stamps ────────────────────────────────────────────────────────────────────

export const stampPaymentFailedEmailSentAt = async ({
  recoveryId,
  sentAt = new Date(),
}: {
  recoveryId: string;
  sentAt?: Date;
}): Promise<boolean> => {
  const updateResult =
    await resolveEventDrivenDb().subscriptionPaymentRecovery.updateMany({
      data: { paymentFailedEmailSentAt: sentAt },
      where: {
        id: recoveryId,
        paymentFailedEmailSentAt: null,
      },
    });

  return updateResult.count > 0;
};

export const stampPaymentRecoveredEmailSentAt = async ({
  recoveryIds,
  sentAt = new Date(),
}: {
  recoveryIds: string[];
  sentAt?: Date;
}): Promise<number> => {
  if (recoveryIds.length === 0) {
    return 0;
  }

  const updateResult =
    await resolveEventDrivenDb().subscriptionPaymentRecovery.updateMany({
      data: { paymentRecoveredEmailSentAt: sentAt },
      where: {
        id: { in: recoveryIds },
        paymentRecoveredEmailSentAt: null,
      },
    });

  return updateResult.count;
};

export const stampSubscriptionCreatedEmailSentAt = async ({
  selectionId,
  sentAt = new Date(),
}: {
  selectionId: string;
  sentAt?: Date;
}): Promise<boolean> => {
  const updateResult =
    await resolveEventDrivenDb().subscriptionMealSelection.updateMany({
      data: { subscriptionCreatedEmailSentAt: sentAt },
      where: {
        id: selectionId,
        subscriptionCreatedEmailSentAt: null,
      },
    });

  return updateResult.count > 0;
};

export const stampSubscriptionPausedEmailSentAt = async ({
  selectionId,
  sentAt = new Date(),
}: {
  selectionId: string;
  sentAt?: Date;
}): Promise<boolean> => {
  const updateResult =
    await resolveEventDrivenDb().subscriptionMealSelection.updateMany({
      data: { subscriptionPausedEmailSentAt: sentAt },
      where: {
        id: selectionId,
        subscriptionPausedEmailSentAt: null,
      },
    });

  return updateResult.count > 0;
};

export const stampMealSelectionConfirmedForDelivery = async ({
  deliveryDate,
  selectionId,
  sentAt = new Date(),
}: {
  deliveryDate: string;
  selectionId: string;
  sentAt?: Date;
}): Promise<boolean> => {
  const updateResult =
    await resolveEventDrivenDb().subscriptionMealSelection.updateMany({
      data: {
        mealSelectionConfirmedDeliveryDate: deliveryDate,
        mealSelectionConfirmedEmailSentAt: sentAt,
      },
      where: {
        id: selectionId,
        OR: [
          { mealSelectionConfirmedDeliveryDate: null },
          { mealSelectionConfirmedDeliveryDate: { not: deliveryDate } },
        ],
      },
    });

  return updateResult.count > 0;
};

// ── Backfill from sent events ─────────────────────────────────────────────────

export const backfillPaymentFailedStampFromSentEvent = async ({
  event,
  recoveryId,
}: {
  event: EmailEventRecord;
  recoveryId: string;
}): Promise<boolean> => {
  if (
    event.status !== EMAIL_EVENT_STATUS.SENT ||
    event.eventType !== EMAIL_EVENT_TYPE.PAYMENT_FAILED
  ) {
    return false;
  }

  return stampPaymentFailedEmailSentAt({
    recoveryId,
    sentAt: event.sentAt ?? new Date(),
  });
};

export const backfillPaymentRecoveredStampFromSentEvent = async ({
  event,
  recoveryIds,
}: {
  event: EmailEventRecord;
  recoveryIds: string[];
}): Promise<number> => {
  if (
    event.status !== EMAIL_EVENT_STATUS.SENT ||
    event.eventType !== EMAIL_EVENT_TYPE.PAYMENT_RECOVERED
  ) {
    return 0;
  }

  return stampPaymentRecoveredEmailSentAt({
    recoveryIds,
    sentAt: event.sentAt ?? new Date(),
  });
};

export const backfillSubscriptionCreatedStampFromSentEvent = async ({
  event,
  selectionId,
}: {
  event: EmailEventRecord;
  selectionId: string;
}): Promise<boolean> => {
  if (
    event.status !== EMAIL_EVENT_STATUS.SENT ||
    event.eventType !== EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED
  ) {
    return false;
  }

  return stampSubscriptionCreatedEmailSentAt({
    selectionId,
    sentAt: event.sentAt ?? new Date(),
  });
};

export const backfillSubscriptionPausedStampFromSentEvent = async ({
  episodeId,
  event,
  selectionId,
}: {
  episodeId: string;
  event: EmailEventRecord;
  selectionId: string;
}): Promise<boolean> => {
  if (
    event.status !== EMAIL_EVENT_STATUS.SENT ||
    event.eventType !== EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED
  ) {
    return false;
  }

  const selection =
    await resolveEventDrivenDb().subscriptionMealSelection.findUnique({
      select: { subscriptionPauseEmailEpisodeId: true },
      where: { id: selectionId },
    });

  if (selection?.subscriptionPauseEmailEpisodeId !== episodeId) {
    return false;
  }

  return stampSubscriptionPausedEmailSentAt({
    selectionId,
    sentAt: event.sentAt ?? new Date(),
  });
};

export const backfillMealSelectionConfirmedStampFromSentEvent = async ({
  deliveryDate,
  event,
  selectionId,
}: {
  deliveryDate: string;
  event: EmailEventRecord;
  selectionId: string;
}): Promise<boolean> => {
  if (
    event.status !== EMAIL_EVENT_STATUS.SENT ||
    event.eventType !== EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED
  ) {
    return false;
  }

  return stampMealSelectionConfirmedForDelivery({
    deliveryDate,
    selectionId,
    sentAt: event.sentAt ?? new Date(),
  });
};
