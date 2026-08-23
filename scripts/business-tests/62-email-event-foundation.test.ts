/**
 * Business regression — EMAIL-6B EmailEvent outbox foundation.
 *
 * Schema + constants + primitives (ensure/claim/transitions/reclaim/due).
 * In-memory Prisma-shaped store — no Resend, no cron, no domain email send.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Prisma, type EmailEvent } from "@prisma/client";

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_STATUSES,
  EMAIL_EVENT_TYPE,
  EMAIL_EVENT_TYPES,
  isEmailEventStatus,
  isEmailEventType,
} from "../../app/constants/emailEvent";
import {
  cancelEmailEvent,
  claimEmailEvent,
  EmailEventIdentityConflictError,
  ensureEmailEvent,
  listDueEmailEvents,
  markEmailEventFailed,
  markEmailEventSent,
  parseEmailEventMeta,
  reclaimStuckEmailEvents,
  requeueEmailEventAfterFailure,
  serializeEmailEventMeta,
  type EmailEventDb,
  type EnsureEmailEventInput,
} from "../../app/services/email/email-event.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const NOW = new Date("2026-08-23T12:00:00.000Z");
const FUTURE = new Date("2026-08-23T18:00:00.000Z");
const PAST = new Date("2026-08-23T10:00:00.000Z");

let idSeq = 0;
const nextId = () => `evt_${++idSeq}`;

const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`idempotencyKey`)",
    {
      clientVersion: "test",
      code: "P2002",
      meta: { target: ["idempotencyKey"] },
    },
  );

type MemoryRow = EmailEvent;

const matchesScalar = (
  actual: unknown,
  expected: unknown,
): boolean => {
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    !(expected instanceof Date)
  ) {
    const filter = expected as Record<string, unknown>;
    if ("lt" in filter) {
      const bound = filter.lt;
      if (actual instanceof Date && bound instanceof Date) {
        return actual.getTime() < bound.getTime();
      }
      if (typeof actual === "number" && typeof bound === "number") {
        return actual < bound;
      }
      return false;
    }
    if ("lte" in filter) {
      const bound = filter.lte;
      if (actual instanceof Date && bound instanceof Date) {
        return actual.getTime() <= bound.getTime();
      }
      if (typeof actual === "number" && typeof bound === "number") {
        return actual <= bound;
      }
      return false;
    }
    if ("in" in filter && Array.isArray(filter.in)) {
      return filter.in.includes(actual);
    }
  }

  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }

  return actual === expected;
};

const matchesWhere = (
  row: MemoryRow,
  where: Record<string, unknown> | undefined,
): boolean => {
  if (!where) {
    return true;
  }

  if (Array.isArray(where.OR)) {
    const { OR, ...rest } = where;
    if (!matchesWhere(row, rest)) {
      return false;
    }
    return OR.some((clause) =>
      matchesWhere(row, clause as Record<string, unknown>),
    );
  }

  for (const [key, expected] of Object.entries(where)) {
    if (key === "OR") {
      continue;
    }
    if (!matchesScalar(row[key as keyof MemoryRow], expected)) {
      return false;
    }
  }

  return true;
};

const applyData = (
  row: MemoryRow,
  data: Record<string, unknown>,
  touchedAt: Date,
): MemoryRow => {
  const next: MemoryRow = { ...row, updatedAt: touchedAt };

  for (const [key, value] of Object.entries(data)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      "increment" in (value as Record<string, unknown>)
    ) {
      const current = next[key as keyof MemoryRow];
      const amount = (value as { increment: number }).increment;
      (next as Record<string, unknown>)[key] =
        (typeof current === "number" ? current : 0) + amount;
      continue;
    }

    (next as Record<string, unknown>)[key] = value;
  }

  return next;
};

type MemoryOptions = {
  /** When true, create always throws P2002 after optional insert hook. */
  createThrowsP2002?: boolean;
};

const createMemoryEmailEventDb = (
  options: MemoryOptions = {},
): EmailEventDb & { rows: Map<string, MemoryRow> } => {
  const rows = new Map<string, MemoryRow>();
  const byKey = new Map<string, string>();

  const findUnique = async ({
    where,
  }: {
    where: { id?: string; idempotencyKey?: string };
  }) => {
    if (where.id) {
      return rows.get(where.id) ?? null;
    }
    if (where.idempotencyKey) {
      const id = byKey.get(where.idempotencyKey);
      return id ? (rows.get(id) ?? null) : null;
    }
    return null;
  };

  const client: EmailEventDb & { rows: Map<string, MemoryRow> } = {
    rows,
    emailEvent: {
      findUnique,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const key = String(data.idempotencyKey);
        if (byKey.has(key) || options.createThrowsP2002) {
          throw uniqueError();
        }

        const now = new Date();
        const id = nextId();
        const row: MemoryRow = {
          id,
          shop: String(data.shop),
          idempotencyKey: key,
          eventType: String(data.eventType),
          referenceType: String(data.referenceType),
          referenceId: String(data.referenceId),
          recipientEmail:
            data.recipientEmail === undefined
              ? null
              : (data.recipientEmail as string | null),
          status: String(data.status),
          attemptCount:
            typeof data.attemptCount === "number" ? data.attemptCount : 0,
          lastAttemptAt: (data.lastAttemptAt as Date | null | undefined) ?? null,
          nextAttemptAt: (data.nextAttemptAt as Date | null | undefined) ?? null,
          processingStartedAt:
            (data.processingStartedAt as Date | null | undefined) ?? null,
          providerId: (data.providerId as string | null | undefined) ?? null,
          lastErrorCode:
            (data.lastErrorCode as string | null | undefined) ?? null,
          lastErrorMessage:
            (data.lastErrorMessage as string | null | undefined) ?? null,
          metaJson: (data.metaJson as string | null | undefined) ?? null,
          sentAt: (data.sentAt as Date | null | undefined) ?? null,
          cancelledAt: (data.cancelledAt as Date | null | undefined) ?? null,
          createdAt: now,
          updatedAt: now,
        };

        rows.set(id, row);
        byKey.set(key, id);
        return row;
      },
      updateMany: async ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        let count = 0;
        const touchedAt = new Date();
        for (const [id, row] of rows) {
          if (!matchesWhere(row, where)) {
            continue;
          }
          rows.set(id, applyData(row, data, touchedAt));
          count += 1;
        }
        return { count };
      },
      findMany: async ({
        orderBy,
        take,
        where,
      }: {
        orderBy?: { createdAt?: "asc" | "desc" };
        take?: number;
        where?: Record<string, unknown>;
      }) => {
        let list = [...rows.values()].filter((row) => matchesWhere(row, where));
        if (orderBy?.createdAt === "asc") {
          list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        } else if (orderBy?.createdAt === "desc") {
          list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (typeof take === "number") {
          list = list.slice(0, take);
        }
        return list;
      },
    } as unknown as EmailEventDb["emailEvent"],
  };

  return client;
};

const seedPending = async (
  client: EmailEventDb,
  overrides: Partial<EnsureEmailEventInput> & {
    attemptCount?: number;
    nextAttemptAt?: Date | null;
    status?: string;
  } = {},
) => {
  const input: EnsureEmailEventInput = {
    eventType: EMAIL_EVENT_TYPE.UPCOMING_DELIVERY,
    idempotencyKey: overrides.idempotencyKey ?? `key_${nextId()}`,
    referenceId: overrides.referenceId ?? "sel_1",
    referenceType: overrides.referenceType ?? "subscription_meal_selection",
    shop: overrides.shop ?? SHOP,
    recipientEmail: overrides.recipientEmail ?? "client@example.com",
    metaJson: overrides.metaJson ?? null,
  };

  const ensured = await ensureEmailEvent(input, client);
  if (
    overrides.attemptCount !== undefined ||
    overrides.nextAttemptAt !== undefined ||
    overrides.status !== undefined
  ) {
    await client.emailEvent.updateMany({
      data: {
        ...(overrides.attemptCount !== undefined
          ? { attemptCount: overrides.attemptCount }
          : {}),
        ...(overrides.nextAttemptAt !== undefined
          ? { nextAttemptAt: overrides.nextAttemptAt }
          : {}),
        ...(overrides.status !== undefined ? { status: overrides.status } : {}),
      },
      where: { id: ensured.event.id },
    });
  }

  const event = await client.emailEvent.findUnique({
    where: { id: ensured.event.id },
  });
  if (!event) {
    throw new Error("seedPending: event missing after ensure");
  }
  return event;
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("62-email-event-foundation");

  ctx.scenario("A. Schema — modèle + unique + indexes");
  {
    const schema = readRepoFile("prisma/schema.prisma");
    const migration = readRepoFile(
      "prisma/migrations/20260823220000_add_email_event_outbox/migration.sql",
    );

    ctx.assertTrue("modèle EmailEvent présent", schema.includes("model EmailEvent"));
    ctx.assertTrue(
      "idempotencyKey @unique",
      schema.includes("idempotencyKey") && schema.includes("@unique"),
    );
    ctx.assertTrue(
      "index status,nextAttemptAt",
      schema.includes("@@index([status, nextAttemptAt])"),
    );
    ctx.assertTrue(
      "index shop,status,nextAttemptAt",
      schema.includes("@@index([shop, status, nextAttemptAt])"),
    );
    ctx.assertTrue(
      "index eventType,createdAt",
      schema.includes("@@index([eventType, createdAt])"),
    );
    ctx.assertTrue(
      "index referenceType,referenceId",
      schema.includes("@@index([referenceType, referenceId])"),
    );
    ctx.assertTrue(
      "migration crée EmailEvent",
      migration.includes('CREATE TABLE "EmailEvent"'),
    );
    ctx.assertTrue(
      "migration unique idempotencyKey",
      migration.includes("EmailEvent_idempotencyKey_key"),
    );
    ctx.assertTrue(
      "recipientEmail documenté monitoring-only",
      schema.includes("recipientEmail is monitoring-only") ||
        readRepoFile("app/services/email/email-event.server.ts").includes(
          "monitoring/debug only",
        ),
    );
  }

  ctx.scenario("B. Constants — statuts / types / max attempts");
  {
    ctx.assertEqual("max attempts V1", EMAIL_EVENT_MAX_ATTEMPTS, 5);
    ctx.assertEqual(
      "5 statuts exacts",
      EMAIL_EVENT_STATUSES.join(","),
      "pending,processing,sent,failed,cancelled",
    );
    ctx.assertTrue("isEmailEventStatus pending", isEmailEventStatus("pending"));
    ctx.assertFalse("isEmailEventStatus unknown", isEmailEventStatus("queued"));
    ctx.assertEqual("7 event types", EMAIL_EVENT_TYPES.length, 7);
    ctx.assertTrue(
      "payment_failed type",
      isEmailEventType(EMAIL_EVENT_TYPE.PAYMENT_FAILED),
    );
    ctx.assertEqual(
      "upcoming_delivery value",
      EMAIL_EVENT_TYPE.UPCOMING_DELIVERY,
      "upcoming_delivery",
    );
  }

  ctx.scenario("C. Ensure — create / idempotent / P2002 / identity");
  {
    const client = createMemoryEmailEventDb();
    const input: EnsureEmailEventInput = {
      eventType: EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER,
      idempotencyKey: "ensure_key_1",
      referenceId: "sel_a",
      referenceType: "subscription_meal_selection",
      shop: SHOP,
      recipientEmail: "a@example.com",
      metaJson: serializeEmailEventMeta({ deliveryDate: "2026-08-30" }),
    };

    const first = await ensureEmailEvent(input, client);
    ctx.assertTrue("create nouvel event", first.created);
    ctx.assertEqual("status pending", first.event.status, EMAIL_EVENT_STATUS.PENDING);
    ctx.assertEqual("attemptCount 0", first.event.attemptCount, 0);

    const second = await ensureEmailEvent(input, client);
    ctx.assertFalse("second ensure created=false", second.created);
    ctx.assertEqual("même id", second.event.id, first.event.id);

    const raceClient = createMemoryEmailEventDb({ createThrowsP2002: true });
    // Pre-insert winner row as if another process committed first.
    const winnerStore = createMemoryEmailEventDb();
    const winner = await ensureEmailEvent(input, winnerStore);
    // Wire findUnique to see winner while create throws P2002.
    const hybrid: EmailEventDb = {
      emailEvent: {
        ...raceClient.emailEvent,
        findUnique: async (args: {
          where: { id?: string; idempotencyKey?: string };
        }) => {
          if (args.where.idempotencyKey === input.idempotencyKey) {
            return winner.event;
          }
          if (args.where.id === winner.event.id) {
            return winner.event;
          }
          return null;
        },
        create: async () => {
          throw uniqueError();
        },
      } as unknown as EmailEventDb["emailEvent"],
    };
    const raced = await ensureEmailEvent(input, hybrid);
    ctx.assertFalse("P2002 path created=false", raced.created);
    ctx.assertEqual("P2002 path même id", raced.event.id, winner.event.id);

    let identityError: unknown = null;
    try {
      await ensureEmailEvent(
        {
          ...input,
          eventType: EMAIL_EVENT_TYPE.PAYMENT_FAILED,
        },
        client,
      );
    } catch (error) {
      identityError = error;
    }
    ctx.assertTrue(
      "identité incohérente → erreur",
      identityError instanceof EmailEventIdentityConflictError,
    );
  }

  ctx.scenario("D. Claim — due / guards / attemptCount");
  {
    const client = createMemoryEmailEventDb();

    const due = await seedPending(client, {
      idempotencyKey: "claim_due",
      nextAttemptAt: null,
    });
    const claimDue = await claimEmailEvent({
      client,
      eventId: due.id,
      now: NOW,
    });
    ctx.assertTrue("pending due → claim", claimDue.claimed);
    if (claimDue.claimed) {
      ctx.assertEqual(
        "claim → processing",
        claimDue.event.status,
        EMAIL_EVENT_STATUS.PROCESSING,
      );
      ctx.assertEqual("attemptCount +1", claimDue.event.attemptCount, 1);
      ctx.assertEqual(
        "lastAttemptAt set",
        claimDue.event.lastAttemptAt?.toISOString(),
        NOW.toISOString(),
      );
      ctx.assertEqual(
        "processingStartedAt set",
        claimDue.event.processingStartedAt?.toISOString(),
        NOW.toISOString(),
      );
    }

    const future = await seedPending(client, {
      idempotencyKey: "claim_future",
      nextAttemptAt: FUTURE,
    });
    const claimFuture = await claimEmailEvent({
      client,
      eventId: future.id,
      now: NOW,
    });
    ctx.assertFalse("pending future → pas claim", claimFuture.claimed);

    const processing = await seedPending(client, {
      idempotencyKey: "claim_processing",
    });
    await client.emailEvent.updateMany({
      data: { status: EMAIL_EVENT_STATUS.PROCESSING },
      where: { id: processing.id },
    });
    ctx.assertFalse(
      "processing → pas claim",
      (
        await claimEmailEvent({
          client,
          eventId: processing.id,
          now: NOW,
        })
      ).claimed,
    );

    const sent = await seedPending(client, { idempotencyKey: "claim_sent" });
    await client.emailEvent.updateMany({
      data: { status: EMAIL_EVENT_STATUS.SENT },
      where: { id: sent.id },
    });
    ctx.assertFalse(
      "sent → pas claim",
      (await claimEmailEvent({ client, eventId: sent.id, now: NOW })).claimed,
    );

    const failed = await seedPending(client, { idempotencyKey: "claim_failed" });
    await client.emailEvent.updateMany({
      data: { status: EMAIL_EVENT_STATUS.FAILED },
      where: { id: failed.id },
    });
    ctx.assertFalse(
      "failed → pas claim",
      (await claimEmailEvent({ client, eventId: failed.id, now: NOW })).claimed,
    );

    const cancelled = await seedPending(client, {
      idempotencyKey: "claim_cancelled",
    });
    await client.emailEvent.updateMany({
      data: { status: EMAIL_EVENT_STATUS.CANCELLED },
      where: { id: cancelled.id },
    });
    ctx.assertFalse(
      "cancelled → pas claim",
      (
        await claimEmailEvent({
          client,
          eventId: cancelled.id,
          now: NOW,
        })
      ).claimed,
    );

    const maxed = await seedPending(client, {
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS,
      idempotencyKey: "claim_max",
    });
    ctx.assertFalse(
      "max attempts → pas claim",
      (await claimEmailEvent({ client, eventId: maxed.id, now: NOW })).claimed,
    );

    const once = await seedPending(client, { idempotencyKey: "claim_once" });
    const firstClaim = await claimEmailEvent({
      client,
      eventId: once.id,
      now: NOW,
    });
    const secondClaim = await claimEmailEvent({
      client,
      eventId: once.id,
      now: NOW,
    });
    ctx.assertTrue("premier claim ok", firstClaim.claimed);
    ctx.assertFalse("second claim refuse", secondClaim.claimed);
    if (firstClaim.claimed) {
      ctx.assertEqual(
        "attemptCount incrémenté une fois",
        firstClaim.event.attemptCount,
        1,
      );
    }
  }

  ctx.scenario("E. Sent — processing → sent / invalid");
  {
    const client = createMemoryEmailEventDb();
    const pending = await seedPending(client, { idempotencyKey: "sent_1" });
    const claimed = await claimEmailEvent({
      client,
      eventId: pending.id,
      now: NOW,
    });
    ctx.assertTrue("préclaim sent", claimed.claimed);

    const sent = await markEmailEventSent({
      client,
      eventId: pending.id,
      providerId: "re_abc123",
      sentAt: NOW,
    });
    ctx.assertTrue("processing → sent", sent.ok);
    if (sent.ok) {
      ctx.assertEqual("status sent", sent.event.status, EMAIL_EVENT_STATUS.SENT);
      ctx.assertEqual("providerId stocké", sent.event.providerId, "re_abc123");
      ctx.assertNull("lastErrorCode clear", sent.event.lastErrorCode);
      ctx.assertNull("lastErrorMessage clear", sent.event.lastErrorMessage);
      ctx.assertNull("processingStartedAt clear", sent.event.processingStartedAt);
      ctx.assertNull("nextAttemptAt clear", sent.event.nextAttemptAt);
    }

    const invalid = await markEmailEventSent({
      client,
      eventId: pending.id,
      providerId: "re_dup",
    });
    ctx.assertFalse("transition invalide refusée", invalid.ok);
    if (!invalid.ok) {
      ctx.assertEqual(
        "reason invalid_transition",
        invalid.reason,
        "invalid_transition",
      );
    }
  }

  ctx.scenario("F. Retry — requeue sans incrémenter attemptCount");
  {
    const client = createMemoryEmailEventDb();
    const pending = await seedPending(client, { idempotencyKey: "retry_1" });
    const claimed = await claimEmailEvent({
      client,
      eventId: pending.id,
      now: NOW,
    });
    ctx.assertTrue("préclaim retry", claimed.claimed);
    const attemptsBefore =
      claimed.claimed ? claimed.event.attemptCount : -1;

    const requeued = await requeueEmailEventAfterFailure({
      client,
      eventId: pending.id,
      lastErrorCode: "send_error",
      lastErrorMessage: "provider timeout",
      nextAttemptAt: FUTURE,
    });
    ctx.assertTrue("processing → pending", requeued.ok);
    if (requeued.ok) {
      ctx.assertEqual(
        "status pending",
        requeued.event.status,
        EMAIL_EVENT_STATUS.PENDING,
      );
      ctx.assertEqual(
        "nextAttemptAt stocké",
        requeued.event.nextAttemptAt?.toISOString(),
        FUTURE.toISOString(),
      );
      ctx.assertEqual(
        "attemptCount inchangé",
        requeued.event.attemptCount,
        attemptsBefore,
      );
      ctx.assertEqual("error code", requeued.event.lastErrorCode, "send_error");
      ctx.assertNull(
        "processingStartedAt clear",
        requeued.event.processingStartedAt,
      );
    }
  }

  ctx.scenario("G. Failed — terminal");
  {
    const client = createMemoryEmailEventDb();
    const pending = await seedPending(client, { idempotencyKey: "fail_1" });
    await claimEmailEvent({ client, eventId: pending.id, now: NOW });

    const failed = await markEmailEventFailed({
      client,
      eventId: pending.id,
      lastErrorCode: "max_attempts",
      lastErrorMessage: "exhausted",
    });
    ctx.assertTrue("processing → failed", failed.ok);
    if (failed.ok) {
      ctx.assertEqual(
        "status failed",
        failed.event.status,
        EMAIL_EVENT_STATUS.FAILED,
      );
      ctx.assertEqual(
        "error code stocké",
        failed.event.lastErrorCode,
        "max_attempts",
      );
      ctx.assertEqual(
        "error message stockée",
        failed.event.lastErrorMessage,
        "exhausted",
      );
      ctx.assertNull("nextAttemptAt null", failed.event.nextAttemptAt);
      ctx.assertNull(
        "processingStartedAt null",
        failed.event.processingStartedAt,
      );
    }
  }

  ctx.scenario("H. Cancel — pending / processing");
  {
    const client = createMemoryEmailEventDb();
    const pending = await seedPending(client, { idempotencyKey: "cancel_p" });
    const cancelledPending = await cancelEmailEvent({
      cancelledAt: NOW,
      client,
      eventId: pending.id,
    });
    ctx.assertTrue("pending → cancelled", cancelledPending.ok);
    if (cancelledPending.ok) {
      ctx.assertEqual(
        "status cancelled",
        cancelledPending.event.status,
        EMAIL_EVENT_STATUS.CANCELLED,
      );
      ctx.assertEqual(
        "cancelledAt set",
        cancelledPending.event.cancelledAt?.toISOString(),
        NOW.toISOString(),
      );
    }

    const processing = await seedPending(client, { idempotencyKey: "cancel_x" });
    await claimEmailEvent({ client, eventId: processing.id, now: NOW });
    const cancelledProcessing = await cancelEmailEvent({
      cancelledAt: NOW,
      client,
      eventId: processing.id,
    });
    ctx.assertTrue("processing → cancelled", cancelledProcessing.ok);
    if (cancelledProcessing.ok) {
      ctx.assertEqual(
        "cancelledAt set (processing)",
        cancelledProcessing.event.cancelledAt?.toISOString(),
        NOW.toISOString(),
      );
      ctx.assertNull(
        "processingStartedAt clear",
        cancelledProcessing.event.processingStartedAt,
      );
    }
  }

  ctx.scenario("I. Reclaim — stale vs récent");
  {
    const client = createMemoryEmailEventDb();
    const stale = await seedPending(client, { idempotencyKey: "reclaim_stale" });
    await claimEmailEvent({ client, eventId: stale.id, now: PAST });
    const before = await client.emailEvent.findUnique({ where: { id: stale.id } });
    const attempts = before?.attemptCount ?? -1;

    const recent = await seedPending(client, {
      idempotencyKey: "reclaim_recent",
    });
    await claimEmailEvent({ client, eventId: recent.id, now: NOW });

    const staleBefore = new Date("2026-08-23T11:00:00.000Z");
    const result = await reclaimStuckEmailEvents({
      client,
      now: NOW,
      staleBefore,
    });
    ctx.assertEqual("un reclaim", result.reclaimed, 1);

    const staleAfter = await client.emailEvent.findUnique({
      where: { id: stale.id },
    });
    const recentAfter = await client.emailEvent.findUnique({
      where: { id: recent.id },
    });
    ctx.assertEqual(
      "stale → pending",
      staleAfter?.status,
      EMAIL_EVENT_STATUS.PENDING,
    );
    ctx.assertEqual(
      "attemptCount conservé",
      staleAfter?.attemptCount,
      attempts,
    );
    ctx.assertEqual(
      "nextAttemptAt = now",
      staleAfter?.nextAttemptAt?.toISOString(),
      NOW.toISOString(),
    );
    ctx.assertEqual(
      "récent inchangé processing",
      recentAfter?.status,
      EMAIL_EVENT_STATUS.PROCESSING,
    );
  }

  ctx.scenario("J. Due list — tri / filtres / limit");
  {
    const client = createMemoryEmailEventDb();

    const older = await seedPending(client, {
      idempotencyKey: "due_older",
      nextAttemptAt: null,
    });
    // Force earlier createdAt for stable FIFO.
    const olderRow = client.rows.get(older.id)!;
    client.rows.set(older.id, {
      ...olderRow,
      createdAt: new Date("2026-08-23T08:00:00.000Z"),
    });

    const newer = await seedPending(client, {
      idempotencyKey: "due_newer",
      nextAttemptAt: PAST,
    });
    const newerRow = client.rows.get(newer.id)!;
    client.rows.set(newer.id, {
      ...newerRow,
      createdAt: new Date("2026-08-23T09:00:00.000Z"),
    });

    await seedPending(client, {
      idempotencyKey: "due_future",
      nextAttemptAt: FUTURE,
    });
    await seedPending(client, {
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS,
      idempotencyKey: "due_maxed",
      nextAttemptAt: null,
    });

    const due = await listDueEmailEvents({ client, limit: 10, now: NOW });
    ctx.assertEqual("2 due", due.length, 2);
    ctx.assertEqual("tri createdAt asc [0]", due[0]?.id, older.id);
    ctx.assertEqual("tri createdAt asc [1]", due[1]?.id, newer.id);

    const limited = await listDueEmailEvents({ client, limit: 1, now: NOW });
    ctx.assertEqual("limit respectée", limited.length, 1);
    ctx.assertEqual("limit = oldest", limited[0]?.id, older.id);

    ctx.assertTrue(
      "future exclus",
      due.every((event) => event.idempotencyKey !== "due_future"),
    );
    ctx.assertTrue(
      "max attempts exclus",
      due.every((event) => event.idempotencyKey !== "due_maxed"),
    );
  }

  ctx.scenario("K. Meta helpers + pas de couplage send");
  {
    const json = serializeEmailEventMeta({ cycleKey: "2026-W34" });
    ctx.assertEqual(
      "serialize roundtrip",
      parseEmailEventMeta(json)?.cycleKey,
      "2026-W34",
    );
    ctx.assertNull("parse null", parseEmailEventMeta(null));

    const serviceSource = readRepoFile(
      "app/services/email/email-event.server.ts",
    );
    ctx.assertFalse(
      "pas d'import sendEmail",
      /from\s+["'][^"']*email\.server["']/.test(serviceSource) ||
        /import\s*\{[^}]*sendEmail/.test(serviceSource),
    );
    ctx.assertFalse(
      "pas d'import Resend client",
      /from\s+["']resend["']/.test(serviceSource) ||
        /createEmailClient/.test(serviceSource),
    );
    ctx.assertFalse(
      "pas d'import cutoff/delivery métier",
      /from\s+["'][^"']*deliverySchedule/.test(serviceSource) ||
        /from\s+["'][^"']*cutoff/.test(serviceSource),
    );
  }

  return finishSuite("62-email-event-foundation", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
