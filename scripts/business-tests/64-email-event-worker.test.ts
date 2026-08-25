/**
 * Business regression — EMAIL-6D EmailEvent worker.
 *
 * Reclaim / claim / handler outcomes / retry / concurrency / unsupported.
 * In-memory EmailEventDb — no Resend, no domain trySend*, no business migration.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Prisma, type EmailEvent } from "@prisma/client";

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_PROCESSING_BATCH_LIMIT,
  EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES,
  EMAIL_EVENT_RETRY_DELAY_MINUTES,
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_TYPE,
  EMAIL_EVENT_WORKER_MAX_ERRORS,
} from "../../app/constants/emailEvent";
import { EMAIL_BATCH_DEFAULT_CONCURRENCY } from "../../app/services/email/email-batch-dispatcher.server";
import {
  EMAIL_EVENT_HANDLER_REGISTRY,
  type EmailEventHandler,
  type EmailEventHandlerRegistry,
} from "../../app/services/email/email-event-handlers.server";
import {
  ensureEmailEvent,
  type EmailEventDb,
  type EnsureEmailEventInput,
} from "../../app/services/email/email-event.server";
import {
  computeEmailEventRetryAt,
  computeEmailEventStaleBefore,
  processDueEmailEvents,
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
const NOW = new Date("2026-08-23T12:00:00.000Z");
const FUTURE = new Date("2026-08-23T18:00:00.000Z");

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

const findByKey = async (client: EmailEventDb, key: string) => {
  const rows = await client.emailEvent.findMany({
    orderBy: { createdAt: "asc" },
    take: 100,
    where: {},
  });
  const match = rows.find((row) => row.idempotencyKey === key);
  if (!match) {
    throw new Error(`event missing for key ${key}`);
  }
  return match;
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("64-email-event-worker");

  ctx.scenario("A. Foundation — empty / limit / constants");
  {
    const client = createMemoryEmailEventDb();
    const empty = await processDueEmailEvents({
      client,
      handlers: {},
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("aucun due scanned", empty.scanned, 0);
    ctx.assertEqual("aucun claimed", empty.claimed, 0);
    ctx.assertEqual("aucun sent", empty.sent, 0);
    ctx.assertEqual("retry delay 60 min", EMAIL_EVENT_RETRY_DELAY_MINUTES, 60);
    ctx.assertEqual(
      "stale after 10 min",
      EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES,
      10,
    );
    ctx.assertEqual("batch limit 100", EMAIL_EVENT_PROCESSING_BATCH_LIMIT, 100);
    ctx.assertEqual("max errors 50", EMAIL_EVENT_WORKER_MAX_ERRORS, 50);
    ctx.assertEqual(
      "concurrency default 3",
      EMAIL_BATCH_DEFAULT_CONCURRENCY,
      3,
    );
    ctx.assertEqual(
      "production registry 7 transactional handlers",
      Object.keys(EMAIL_EVENT_HANDLER_REGISTRY).length,
      7,
    );

    for (let i = 0; i < 5; i += 1) {
      await seedPending(client, { idempotencyKey: `limit_${i}` });
    }
    const limited = await processDueEmailEvents({
      client,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          outcome: "sent",
          providerId: "re_limit",
        }),
      },
      limit: 2,
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("limit respectée scanned", limited.scanned, 2);
    ctx.assertEqual("limit respectée sent", limited.sent, 2);
  }

  ctx.scenario("B. Claim — success / future skip / double worker");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, { idempotencyKey: "claim_ok" });
    let handlerCalls = 0;
    const summary = await processDueEmailEvents({
      client,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => {
          handlerCalls += 1;
          return { outcome: "sent", providerId: "re_1" };
        },
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("handler appelé", handlerCalls, 1);
    ctx.assertEqual("claimed 1", summary.claimed, 1);
    ctx.assertEqual("sent 1", summary.sent, 1);
    const after = await loadEvent(client, event.id);
    ctx.assertEqual("status sent", after.status, EMAIL_EVENT_STATUS.SENT);
    ctx.assertEqual("attemptCount 1", after.attemptCount, 1);
    ctx.assertEqual("providerId stocké", after.providerId, "re_1");

    const client2 = createMemoryEmailEventDb();
    const future = await seedPending(client2, {
      idempotencyKey: "claim_future",
      nextAttemptAt: FUTURE,
    });
    let futureCalls = 0;
    const futureSummary = await processDueEmailEvents({
      client: client2,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => {
          futureCalls += 1;
          return { outcome: "sent", providerId: "re_x" };
        },
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("future non scanné", futureSummary.scanned, 0);
    ctx.assertEqual("future handler non appelé", futureCalls, 0);
    ctx.assertEqual(
      "future reste pending",
      (await loadEvent(client2, future.id)).status,
      EMAIL_EVENT_STATUS.PENDING,
    );

    const raceClient = createMemoryEmailEventDb();
    await seedPending(raceClient, { idempotencyKey: "race_1" });
    let raceCalls = 0;
    const raceHandler: EmailEventHandler = async () => {
      raceCalls += 1;
      return { outcome: "sent", providerId: "re_race" };
    };
    const handlers: EmailEventHandlerRegistry = {
      [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: raceHandler,
    };
    const [a, b] = await Promise.all([
      processDueEmailEvents({
        client: raceClient,
        handlers,
        now: NOW,
        shop: SHOP,
      }),
      processDueEmailEvents({
        client: raceClient,
        handlers,
        now: NOW,
        shop: SHOP,
      }),
    ]);
    ctx.assertEqual("double worker → un seul handler", raceCalls, 1);
    ctx.assertEqual("claims totaux = 1", a.claimed + b.claimed, 1);
  }

  ctx.scenario("C. Outcomes — sent / retry / permanent / cancel / exception");
  {
    const client = createMemoryEmailEventDb();
    await seedPending(client, { idempotencyKey: "sent_1" });
    await seedPending(client, {
      eventType: EMAIL_EVENT_TYPE.PAYMENT_FAILED,
      idempotencyKey: "retry_1",
    });
    await seedPending(client, {
      eventType: EMAIL_EVENT_TYPE.PAYMENT_RECOVERED,
      idempotencyKey: "perm_1",
    });
    await seedPending(client, {
      eventType: EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED,
      idempotencyKey: "cancel_1",
    });
    await seedPending(client, {
      eventType: EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED,
      idempotencyKey: "throw_1",
    });

    const summary = await processDueEmailEvents({
      client,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          outcome: "sent",
          providerId: "re_ok",
        }),
        [EMAIL_EVENT_TYPE.PAYMENT_FAILED]: async () => ({
          errorCode: "transport_timeout",
          message: "timeout",
          outcome: "retryable_failure",
        }),
        [EMAIL_EVENT_TYPE.PAYMENT_RECOVERED]: async () => ({
          errorCode: "invalid_payload",
          message: "bad payload",
          outcome: "permanent_failure",
        }),
        [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async () => ({
          outcome: "cancelled",
          reason: "obsolete",
        }),
        [EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED]: async () => {
          throw new Error("boom handler");
        },
      },
      now: NOW,
      shop: SHOP,
    });

    ctx.assertEqual("sent count", summary.sent, 1);
    ctx.assertEqual("retried count", summary.retried, 2);
    ctx.assertEqual("failed permanent", summary.failed, 1);
    ctx.assertEqual("cancelled count", summary.cancelled, 1);

    const byKey = {
      sent_1: await findByKey(client, "sent_1"),
      retry_1: await findByKey(client, "retry_1"),
      perm_1: await findByKey(client, "perm_1"),
      cancel_1: await findByKey(client, "cancel_1"),
      throw_1: await findByKey(client, "throw_1"),
    };

    ctx.assertEqual("sent status", byKey.sent_1.status, EMAIL_EVENT_STATUS.SENT);
    ctx.assertEqual(
      "retry pending",
      byKey.retry_1.status,
      EMAIL_EVENT_STATUS.PENDING,
    );
    ctx.assertEqual(
      "retry nextAttemptAt +60m",
      byKey.retry_1.nextAttemptAt?.getTime(),
      computeEmailEventRetryAt(NOW).getTime(),
    );
    ctx.assertEqual("retry attemptCount 1", byKey.retry_1.attemptCount, 1);
    ctx.assertEqual(
      "retry error code",
      byKey.retry_1.lastErrorCode,
      "transport_timeout",
    );
    ctx.assertEqual(
      "perm failed",
      byKey.perm_1.status,
      EMAIL_EVENT_STATUS.FAILED,
    );
    ctx.assertEqual(
      "perm error",
      byKey.perm_1.lastErrorCode,
      "invalid_payload",
    );
    ctx.assertEqual(
      "cancelled status",
      byKey.cancel_1.status,
      EMAIL_EVENT_STATUS.CANCELLED,
    );
    ctx.assertTrue(
      "cancelledAt set",
      byKey.cancel_1.cancelledAt instanceof Date,
    );
    ctx.assertEqual(
      "exception requeued",
      byKey.throw_1.status,
      EMAIL_EVENT_STATUS.PENDING,
    );
    ctx.assertEqual(
      "handler_exception code",
      byKey.throw_1.lastErrorCode,
      "handler_exception",
    );
  }

  ctx.scenario("D. Max attempts — 5e retryable → failed terminal");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, {
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS - 1,
      idempotencyKey: "max_1",
    });
    const summary = await processDueEmailEvents({
      client,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          errorCode: "still_failing",
          message: "nope",
          outcome: "retryable_failure",
        }),
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("max → failed", summary.failed, 1);
    ctx.assertEqual("max → pas retried", summary.retried, 0);
    const after = await loadEvent(client, event.id);
    ctx.assertEqual("status failed", after.status, EMAIL_EVENT_STATUS.FAILED);
    ctx.assertEqual(
      "attemptCount = max",
      after.attemptCount,
      EMAIL_EVENT_MAX_ATTEMPTS,
    );
  }

  ctx.scenario("E. Unsupported event type → failed, no retry");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedPending(client, {
      eventType: "unknown_future_type",
      idempotencyKey: "unsup_1",
    });
    const summary = await processDueEmailEvents({
      client,
      handlers: {},
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("unsupported count", summary.unsupported, 1);
    ctx.assertEqual("failed count", summary.failed, 1);
    ctx.assertEqual("pas de retry", summary.retried, 0);
    const after = await loadEvent(client, event.id);
    ctx.assertEqual("status failed", after.status, EMAIL_EVENT_STATUS.FAILED);
    ctx.assertEqual(
      "error unsupported_event_type",
      after.lastErrorCode,
      "unsupported_event_type",
    );
  }

  ctx.scenario("F. Reclaim stale processing");
  {
    const client = createMemoryEmailEventDb();
    const stale = await seedPending(client, {
      idempotencyKey: "stale_1",
      status: EMAIL_EVENT_STATUS.PROCESSING,
    });
    const recent = await seedPending(client, {
      idempotencyKey: "recent_1",
      status: EMAIL_EVENT_STATUS.PROCESSING,
    });
    const staleStarted = new Date(
      NOW.getTime() -
        (EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES + 1) * 60_000,
    );
    const recentStarted = new Date(NOW.getTime() - 2 * 60_000);
    await client.emailEvent.updateMany({
      data: {
        attemptCount: 2,
        processingStartedAt: staleStarted,
      },
      where: { id: stale.id },
    });
    await client.emailEvent.updateMany({
      data: {
        attemptCount: 1,
        processingStartedAt: recentStarted,
      },
      where: { id: recent.id },
    });

    const summary = await processDueEmailEvents({
      client,
      handlers: {
        [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: async () => ({
          outcome: "sent",
          providerId: "re_reclaim",
        }),
      },
      now: NOW,
      shop: SHOP,
    });

    ctx.assertEqual("reclaimed 1", summary.reclaimed, 1);
    ctx.assertEqual("stale then sent", summary.sent, 1);
    const staleAfter = await loadEvent(client, stale.id);
    const recentAfter = await loadEvent(client, recent.id);
    ctx.assertEqual("stale → sent", staleAfter.status, EMAIL_EVENT_STATUS.SENT);
    ctx.assertEqual(
      "stale attemptCount conservé puis +1 claim",
      staleAfter.attemptCount,
      3,
    );
    ctx.assertEqual(
      "recent reste processing",
      recentAfter.status,
      EMAIL_EVENT_STATUS.PROCESSING,
    );
    ctx.assertEqual(
      "staleBefore helper",
      computeEmailEventStaleBefore(NOW).getTime(),
      NOW.getTime() - EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES * 60_000,
    );
  }

  ctx.scenario("G. Concurrency + errors bound + isolation");
  {
    const client = createMemoryEmailEventDb();
    let maxActive = 0;
    let active = 0;
    for (let i = 0; i < 6; i += 1) {
      await seedPending(client, {
        eventType: EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER,
        idempotencyKey: `conc_${i}`,
      });
    }
    const summary = await processDueEmailEvents({
      client,
      concurrency: 3,
      handlers: {
        [EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER]: async ({ event }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 30));
          active -= 1;
          if (event.idempotencyKey === "conc_0") {
            throw new Error("isolated boom");
          }
          return { outcome: "sent", providerId: `re_${event.idempotencyKey}` };
        },
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("maxActive ≤ 3", maxActive <= 3, true);
    ctx.assertEqual("maxActive atteint 3", maxActive, 3);
    ctx.assertEqual("5 sent malgré 1 throw", summary.sent, 5);
    ctx.assertEqual("1 retried (exception)", summary.retried, 1);

    const flood = createMemoryEmailEventDb();
    for (let i = 0; i < 60; i += 1) {
      await seedPending(flood, {
        eventType: EMAIL_EVENT_TYPE.PAYMENT_FAILED,
        idempotencyKey: `err_${i}`,
      });
    }
    const floodSummary = await processDueEmailEvents({
      client: flood,
      handlers: {
        [EMAIL_EVENT_TYPE.PAYMENT_FAILED]: async () => ({
          errorCode: "x",
          message: "fail",
          outcome: "permanent_failure",
        }),
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("failed exact 60", floodSummary.failed, 60);
    ctx.assertEqual(
      "errors bornées 50",
      floodSummary.errors.length,
      EMAIL_EVENT_WORKER_MAX_ERRORS,
    );
  }

  ctx.scenario("H. No business coupling");
  {
    const workerSource = readRepoFile(
      "app/services/email/email-event-worker.server.ts",
    );
    const handlersSource = readRepoFile(
      "app/services/email/email-event-handlers.server.ts",
    );
    ctx.assertFalse("worker sans sendEmail", /sendEmail/.test(workerSource));
    ctx.assertFalse(
      "worker sans Resend",
      /from\s+["']resend["']/.test(workerSource) ||
        /createEmailClient/.test(workerSource),
    );
    ctx.assertFalse(
      "worker sans trySend métier",
      /trySend[A-Z]/.test(workerSource),
    );
    ctx.assertFalse(
      "handlers sans trySend",
      /trySend/.test(handlersSource),
    );
    ctx.assertTrue(
      "registry production contient reminder + upcoming",
      /EMAIL_EVENT_TYPE\.MEAL_SELECTION_REMINDER/.test(handlersSource) &&
        /EMAIL_EVENT_TYPE\.UPCOMING_DELIVERY/.test(handlersSource),
    );
  }

  return finishSuite("64-email-event-worker", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
