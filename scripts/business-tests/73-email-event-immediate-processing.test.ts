/**
 * Business regression — EMAIL-6F processEmailEventById (immediate path).
 *
 * Claim / handler outcomes / retry / max / not_claimed / unsupported.
 * In-memory EmailEventDb — no Resend, no reclaim in by-id path.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Prisma, type EmailEvent } from "@prisma/client";

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_TYPE,
} from "../../app/constants/emailEvent";
import {
  ensureEmailEvent,
  type EmailEventDb,
  type EnsureEmailEventInput,
} from "../../app/services/email/email-event.server";
import {
  computeEmailEventRetryAt,
  processDueEmailEvents,
  processEmailEventById,
} from "../../app/services/email/email-event-worker.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const NOW = new Date("2026-08-25T12:00:00.000Z");

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

const createMemoryEmailEventDb = (): EmailEventDb & {
  rows: Map<string, MemoryRow>;
} => {
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
        if (byKey.has(key)) {
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
    eventType: overrides.eventType ?? EMAIL_EVENT_TYPE.UPCOMING_DELIVERY,
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

const loadEvent = async (client: EmailEventDb, id: string) => {
  const event = await client.emailEvent.findUnique({ where: { id } });
  if (!event) {
    throw new Error(`event missing: ${id}`);
  }
  return event;
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("73-email-event-immediate-processing");
  const workerSource = readRepoFile(
    "app/services/email/email-event-worker.server.ts",
  );

  ctx.scenario("A. Pending → process by id → sent + providerId");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, { idempotencyKey: "imm_sent" });
    let handlerCalls = 0;
    const result = await processEmailEventById({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => {
          handlerCalls += 1;
          return { outcome: "sent", providerId: "re_imm_1" };
        },
      },
      now: NOW,
    });
    ctx.assertEqual("handler appelé", handlerCalls, 1);
    ctx.assertEqual("status sent", result.status, "sent");
    if (result.status === "sent") {
      ctx.assertEqual("providerId résultat", result.providerId, "re_imm_1");
    }
    const after = await loadEvent(client, event.id);
    ctx.assertEqual("row status sent", after.status, EMAIL_EVENT_STATUS.SENT);
    ctx.assertEqual("row providerId", after.providerId, "re_imm_1");
    ctx.assertEqual("attemptCount 1", after.attemptCount, 1);
  }

  ctx.scenario("B. Retryable → pending + nextAttemptAt ~60 min");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, { idempotencyKey: "imm_retry" });
    const result = await processEmailEventById({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          errorCode: "transport_timeout",
          message: "timeout",
          outcome: "retryable_failure",
        }),
      },
      now: NOW,
    });
    ctx.assertEqual("queued_for_retry", result.status, "queued_for_retry");
    const after = await loadEvent(client, event.id);
    ctx.assertEqual("status pending", after.status, EMAIL_EVENT_STATUS.PENDING);
    ctx.assertEqual(
      "nextAttemptAt +60m",
      after.nextAttemptAt?.getTime(),
      computeEmailEventRetryAt(NOW).getTime(),
    );
  }

  ctx.scenario("C. Permanent → failed");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, { idempotencyKey: "imm_perm" });
    const result = await processEmailEventById({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          errorCode: "invalid_payload",
          message: "bad",
          outcome: "permanent_failure",
        }),
      },
      now: NOW,
    });
    ctx.assertEqual("failed", result.status, "failed");
    ctx.assertEqual(
      "row failed",
      (await loadEvent(client, event.id)).status,
      EMAIL_EVENT_STATUS.FAILED,
    );
  }

  ctx.scenario("D. Cancelled → cancelled");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, { idempotencyKey: "imm_cancel" });
    const result = await processEmailEventById({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          outcome: "cancelled",
          reason: "obsolete",
        }),
      },
      now: NOW,
    });
    ctx.assertEqual("cancelled", result.status, "cancelled");
    const after = await loadEvent(client, event.id);
    ctx.assertEqual(
      "row cancelled",
      after.status,
      EMAIL_EVENT_STATUS.CANCELLED,
    );
    ctx.assertTrue("cancelledAt set", after.cancelledAt instanceof Date);
  }

  ctx.scenario("E. Handler throw → queued_for_retry");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, { idempotencyKey: "imm_throw" });
    const result = await processEmailEventById({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => {
          throw new Error("boom handler");
        },
      },
      now: NOW,
    });
    ctx.assertEqual("throw → queued_for_retry", result.status, "queued_for_retry");
    if (result.status === "queued_for_retry") {
      ctx.assertEqual("handler_exception", result.errorCode, "handler_exception");
    }
    ctx.assertEqual(
      "row pending",
      (await loadEvent(client, event.id)).status,
      EMAIL_EVENT_STATUS.PENDING,
    );
  }

  ctx.scenario("F. Max attempt → failed");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, {
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS - 1,
      idempotencyKey: "imm_max",
    });
    const result = await processEmailEventById({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          errorCode: "still_failing",
          message: "nope",
          outcome: "retryable_failure",
        }),
      },
      now: NOW,
    });
    ctx.assertEqual("max → failed", result.status, "failed");
    const after = await loadEvent(client, event.id);
    ctx.assertEqual("status failed", after.status, EMAIL_EVENT_STATUS.FAILED);
    ctx.assertEqual(
      "attemptCount = max",
      after.attemptCount,
      EMAIL_EVENT_MAX_ATTEMPTS,
    );
  }

  ctx.scenario("G. Claim lost → not_claimed");
  {
    const client = createMemoryEmailEventDb();
    const processing = await seedPending(client, {
      idempotencyKey: "imm_proc",
      status: EMAIL_EVENT_STATUS.PROCESSING,
    });
    const sent = await seedPending(client, {
      idempotencyKey: "imm_already_sent",
      status: EMAIL_EVENT_STATUS.SENT,
    });

    const processingResult = await processEmailEventById({
      client,
      eventId: processing.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          outcome: "sent",
          providerId: "should_not",
        }),
      },
      now: NOW,
    });
    ctx.assertEqual(
      "processing → not_claimed",
      processingResult.status,
      "not_claimed",
    );

    const sentResult = await processEmailEventById({
      client,
      eventId: sent.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          outcome: "sent",
          providerId: "should_not",
        }),
      },
      now: NOW,
    });
    ctx.assertEqual("sent → not_claimed", sentResult.status, "not_claimed");
  }

  ctx.scenario("H. Unsupported event type → failed");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, {
      eventType: "unknown_future_type",
      idempotencyKey: "imm_unsup",
    });
    const result = await processEmailEventById({
      client,
      eventId: event.id,
      handlers: {},
      now: NOW,
    });
    ctx.assertEqual("unsupported → failed", result.status, "failed");
    if (result.status === "failed") {
      ctx.assertEqual(
        "unsupported_event_type",
        result.errorCode,
        "unsupported_event_type",
      );
    }
    ctx.assertEqual(
      "row failed",
      (await loadEvent(client, event.id)).status,
      EMAIL_EVENT_STATUS.FAILED,
    );
  }

  ctx.scenario("I. providerId persisted on sent");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, { idempotencyKey: "imm_pid" });
    await processEmailEventById({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          outcome: "sent",
          providerId: "re_persisted",
        }),
      },
      now: NOW,
    });
    ctx.assertEqual(
      "providerId persisted",
      (await loadEvent(client, event.id)).providerId,
      "re_persisted",
    );
  }

  ctx.scenario("J. Structural — by-id sans reclaim, batch worker intact");
  {
    ctx.assertTrue(
      "processEmailEventById exporté",
      /export const processEmailEventById/.test(workerSource),
    );
    ctx.assertTrue(
      "processDueEmailEvents exporté",
      /export const processDueEmailEvents/.test(workerSource),
    );

    const byIdStart = workerSource.indexOf("export const processEmailEventById");
    const byIdEnd = workerSource.indexOf("export const processDueEmailEvents");
    const byIdBody = workerSource.slice(byIdStart, byIdEnd);
    ctx.assertFalse(
      "processEmailEventById n'appelle pas reclaimStuckEmailEvents",
      byIdBody.includes("reclaimStuckEmailEvents"),
    );
    ctx.assertTrue(
      "processDueEmailEvents appelle encore reclaimStuckEmailEvents",
      workerSource
        .slice(byIdEnd)
        .includes("reclaimStuckEmailEvents"),
    );
    ctx.assertEqual(
      "processDueEmailEvents toujours appelable",
      typeof processDueEmailEvents,
      "function",
    );
    ctx.assertEqual(
      "processEmailEventById toujours appelable",
      typeof processEmailEventById,
      "function",
    );
  }

  return finishSuite("73-email-event-immediate-processing", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
