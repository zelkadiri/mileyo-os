/**
 * EmailEvent outbox primitives (EMAIL-6B).
 *
 * Infrastructure only: persist / claim / transition. No sendEmail, no Resend,
 * no cutoff/delivery/portal knowledge, no retry cron.
 *
 * recipientEmail is monitoring/debug only. Future retries must re-resolve and
 * re-validate the recipient via domain email services — never trust this field
 * as the business source of truth.
 */

import type { EmailEvent } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_STATUS,
} from "../../constants/emailEvent";
import db from "../../db.server";

export type EmailEventRecord = EmailEvent;

export type EnsureEmailEventInput = {
  shop: string;
  idempotencyKey: string;
  eventType: string;
  referenceType: string;
  referenceId: string;
  recipientEmail?: string | null;
  metaJson?: string | null;
};

export type EnsureEmailEventResult = {
  created: boolean;
  event: EmailEventRecord;
};

export type ClaimEmailEventResult =
  | { claimed: true; event: EmailEventRecord }
  | { claimed: false };

export type EmailEventTransitionResult =
  | { ok: true; event: EmailEventRecord }
  | { ok: false; reason: "not_found" | "invalid_transition" };

/** Narrow Prisma-shaped delegate used by outbox primitives (injectable for tests). */
export type EmailEventDb = {
  emailEvent: {
    create: (args: {
      data: {
        attemptCount?: number;
        eventType: string;
        idempotencyKey: string;
        metaJson?: string | null;
        recipientEmail?: string | null;
        referenceId: string;
        referenceType: string;
        shop: string;
        status: string;
      };
    }) => Promise<EmailEventRecord>;
    findMany: (args: {
      orderBy: { createdAt: "asc" | "desc" };
      take: number;
      where: Record<string, unknown>;
    }) => Promise<EmailEventRecord[]>;
    findUnique: (args: {
      where: { id?: string; idempotencyKey?: string };
    }) => Promise<EmailEventRecord | null>;
    updateMany: (args: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
};

export class EmailEventIdentityConflictError extends Error {
  readonly code = "email_event_identity_conflict" as const;
  readonly existing: EmailEventRecord;
  readonly expected: {
    eventType: string;
    idempotencyKey: string;
    referenceId: string;
    referenceType: string;
    shop: string;
  };

  constructor({
    existing,
    expected,
  }: {
    existing: EmailEventRecord;
    expected: EmailEventIdentityConflictError["expected"];
  }) {
    const mismatches: string[] = [];
    if (existing.shop !== expected.shop) {
      mismatches.push("shop");
    }
    if (existing.eventType !== expected.eventType) {
      mismatches.push("eventType");
    }
    if (existing.referenceType !== expected.referenceType) {
      mismatches.push("referenceType");
    }
    if (existing.referenceId !== expected.referenceId) {
      mismatches.push("referenceId");
    }

    super(
      `EmailEvent identity conflict for idempotencyKey=${expected.idempotencyKey} (mismatched: ${mismatches.join(", ")})`,
    );
    this.name = "EmailEventIdentityConflictError";
    this.existing = existing;
    this.expected = expected;
  }
}

const isPrismaUniqueConstraintError = (error: unknown) =>
  error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
  error.code === "P2002";

const assertStableIdentity = ({
  existing,
  input,
}: {
  existing: EmailEventRecord;
  input: EnsureEmailEventInput;
}): void => {
  if (
    existing.shop !== input.shop ||
    existing.eventType !== input.eventType ||
    existing.referenceType !== input.referenceType ||
    existing.referenceId !== input.referenceId
  ) {
    throw new EmailEventIdentityConflictError({
      existing,
      expected: {
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        shop: input.shop,
      },
    });
  }
};

/** Thin JSON helpers — meta stays a opaque string at the DB layer. */
export const serializeEmailEventMeta = (
  meta: Record<string, unknown>,
): string => JSON.stringify(meta);

export const parseEmailEventMeta = (
  metaJson: string | null | undefined,
): Record<string, unknown> | null => {
  if (metaJson == null || metaJson.trim() === "") {
    return null;
  }

  const parsed: unknown = JSON.parse(metaJson);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EmailEvent metaJson must be a JSON object");
  }

  return parsed as Record<string, unknown>;
};

const resolveDb = (client?: EmailEventDb): EmailEventDb =>
  client ?? (db as unknown as EmailEventDb);

/**
 * Idempotent create-or-get. On concurrent creates, unique(idempotencyKey) +
 * P2002 recovery guarantees a single row. Identity fields are never rewritten.
 * recipientEmail / metaJson on an existing row are left unchanged (V1).
 */
export const ensureEmailEvent = async (
  input: EnsureEmailEventInput,
  client?: EmailEventDb,
): Promise<EnsureEmailEventResult> => {
  const emailEvent = resolveDb(client).emailEvent;

  const existing = await emailEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    assertStableIdentity({ existing, input });
    return { created: false, event: existing };
  }

  try {
    const created = await emailEvent.create({
      data: {
        attemptCount: 0,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        metaJson: input.metaJson ?? null,
        recipientEmail: input.recipientEmail ?? null,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        shop: input.shop,
        status: EMAIL_EVENT_STATUS.PENDING,
      },
    });

    return { created: true, event: created };
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const raced = await emailEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });

    if (!raced) {
      throw error;
    }

    assertStableIdentity({ existing: raced, input });
    return { created: false, event: raced };
  }
};

/**
 * Atomically claim a pending due event for processing.
 * Succeeds only when status=pending, due (nextAttemptAt null|<=now),
 * and attemptCount < EMAIL_EVENT_MAX_ATTEMPTS.
 */
export const claimEmailEvent = async ({
  client,
  eventId,
  now = new Date(),
}: {
  client?: EmailEventDb;
  eventId: string;
  now?: Date;
}): Promise<ClaimEmailEventResult> => {
  const emailEvent = resolveDb(client).emailEvent;

  const updateResult = await emailEvent.updateMany({
    data: {
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
      processingStartedAt: now,
      status: EMAIL_EVENT_STATUS.PROCESSING,
    },
    where: {
      attemptCount: { lt: EMAIL_EVENT_MAX_ATTEMPTS },
      id: eventId,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      status: EMAIL_EVENT_STATUS.PENDING,
    },
  });

  if (updateResult.count !== 1) {
    return { claimed: false };
  }

  const event = await emailEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return { claimed: false };
  }

  return { claimed: true, event };
};

export const markEmailEventSent = async ({
  client,
  eventId,
  providerId,
  sentAt = new Date(),
}: {
  client?: EmailEventDb;
  eventId: string;
  providerId: string;
  sentAt?: Date;
}): Promise<EmailEventTransitionResult> => {
  const emailEvent = resolveDb(client).emailEvent;

  const updateResult = await emailEvent.updateMany({
    data: {
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: null,
      processingStartedAt: null,
      providerId,
      sentAt,
      status: EMAIL_EVENT_STATUS.SENT,
    },
    where: {
      id: eventId,
      status: EMAIL_EVENT_STATUS.PROCESSING,
    },
  });

  if (updateResult.count !== 1) {
    const existing = await emailEvent.findUnique({ where: { id: eventId } });
    return {
      ok: false,
      reason: existing ? "invalid_transition" : "not_found",
    };
  }

  const event = await emailEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, event };
};

/**
 * Retryable failure: processing → pending. Does not increment attemptCount
 * (already incremented at claim). Caller supplies nextAttemptAt (backoff in 6D).
 */
export const requeueEmailEventAfterFailure = async ({
  client,
  eventId,
  lastErrorCode,
  lastErrorMessage,
  nextAttemptAt,
}: {
  client?: EmailEventDb;
  eventId: string;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  nextAttemptAt: Date;
}): Promise<EmailEventTransitionResult> => {
  const emailEvent = resolveDb(client).emailEvent;

  const updateResult = await emailEvent.updateMany({
    data: {
      lastErrorCode: lastErrorCode ?? null,
      lastErrorMessage: lastErrorMessage ?? null,
      nextAttemptAt,
      processingStartedAt: null,
      status: EMAIL_EVENT_STATUS.PENDING,
    },
    where: {
      id: eventId,
      status: EMAIL_EVENT_STATUS.PROCESSING,
    },
  });

  if (updateResult.count !== 1) {
    const existing = await emailEvent.findUnique({ where: { id: eventId } });
    return {
      ok: false,
      reason: existing ? "invalid_transition" : "not_found",
    };
  }

  const event = await emailEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, event };
};

export const markEmailEventFailed = async ({
  client,
  eventId,
  lastErrorCode,
  lastErrorMessage,
}: {
  client?: EmailEventDb;
  eventId: string;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}): Promise<EmailEventTransitionResult> => {
  const emailEvent = resolveDb(client).emailEvent;

  const updateResult = await emailEvent.updateMany({
    data: {
      lastErrorCode: lastErrorCode ?? null,
      lastErrorMessage: lastErrorMessage ?? null,
      nextAttemptAt: null,
      processingStartedAt: null,
      status: EMAIL_EVENT_STATUS.FAILED,
    },
    where: {
      id: eventId,
      status: EMAIL_EVENT_STATUS.PROCESSING,
    },
  });

  if (updateResult.count !== 1) {
    const existing = await emailEvent.findUnique({ where: { id: eventId } });
    return {
      ok: false,
      reason: existing ? "invalid_transition" : "not_found",
    };
  }

  const event = await emailEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, event };
};

/**
 * Cancel obsolete work. Allowed: pending|processing → cancelled.
 * failed → cancelled is intentionally omitted in V1 (no clear product need).
 */
export const cancelEmailEvent = async ({
  cancelledAt = new Date(),
  client,
  eventId,
}: {
  cancelledAt?: Date;
  client?: EmailEventDb;
  eventId: string;
}): Promise<EmailEventTransitionResult> => {
  const emailEvent = resolveDb(client).emailEvent;

  const updateResult = await emailEvent.updateMany({
    data: {
      cancelledAt,
      nextAttemptAt: null,
      processingStartedAt: null,
      status: EMAIL_EVENT_STATUS.CANCELLED,
    },
    where: {
      id: eventId,
      status: {
        in: [EMAIL_EVENT_STATUS.PENDING, EMAIL_EVENT_STATUS.PROCESSING],
      },
    },
  });

  if (updateResult.count !== 1) {
    const existing = await emailEvent.findUnique({ where: { id: eventId } });
    return {
      ok: false,
      reason: existing ? "invalid_transition" : "not_found",
    };
  }

  const event = await emailEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, event };
};

/**
 * Reclaim stale processing rows back to pending. Preserves attemptCount.
 * Does not send email — DB primitive only.
 */
export const reclaimStuckEmailEvents = async ({
  client,
  now = new Date(),
  shop,
  staleBefore,
}: {
  client?: EmailEventDb;
  now?: Date;
  shop?: string;
  staleBefore: Date;
}): Promise<{ reclaimed: number }> => {
  const emailEvent = resolveDb(client).emailEvent;

  const updateResult = await emailEvent.updateMany({
    data: {
      nextAttemptAt: now,
      processingStartedAt: null,
      status: EMAIL_EVENT_STATUS.PENDING,
    },
    where: {
      processingStartedAt: { lt: staleBefore },
      status: EMAIL_EVENT_STATUS.PROCESSING,
      ...(shop ? { shop } : {}),
    },
  });

  return { reclaimed: updateResult.count };
};

/**
 * List pending due events ready to claim. Mandatory limit avoids unbounded scans.
 * Ordered by createdAt asc for stable FIFO within the due window.
 */
export const listDueEmailEvents = async ({
  client,
  limit,
  now = new Date(),
  shop,
}: {
  client?: EmailEventDb;
  limit: number;
  now?: Date;
  shop?: string;
}): Promise<EmailEventRecord[]> => {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      `listDueEmailEvents: limit must be a positive integer (got ${String(limit)})`,
    );
  }

  const emailEvent = resolveDb(client).emailEvent;

  return emailEvent.findMany({
    orderBy: { createdAt: "asc" },
    take: limit,
    where: {
      attemptCount: { lt: EMAIL_EVENT_MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      status: EMAIL_EVENT_STATUS.PENDING,
      ...(shop ? { shop } : {}),
    },
  });
};
