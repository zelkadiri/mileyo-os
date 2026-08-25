/**
 * Business regression — EMAIL-6G-B safe manual retry of failed EmailEvents.
 *
 * Memory EmailEventDb + static UI/source checks. No Resend, no Prisma migration.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Prisma, type EmailEvent } from "@prisma/client";

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_TYPE,
} from "../../app/constants/emailEvent";
import { RETRY_EMAIL_EVENT_INTENT } from "../../app/features/emails/emails-types";
import {
  claimEmailEvent,
  ensureEmailEvent,
  listDueEmailEvents,
  type EmailEventDb,
  type EnsureEmailEventInput,
} from "../../app/services/email/email-event.server";
import {
  manualRetryEmailEvent,
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

const countOccurrences = (source: string, pattern: RegExp): number =>
  (source.match(pattern) || []).length;

const SHOP = "mileyo-dev.myshopify.com";
const OTHER_SHOP = "other-shop.myshopify.com";
const NOW = new Date("2026-08-25T15:00:00.000Z");

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
    if ("gte" in filter) {
      const bound = filter.gte;
      if (actual instanceof Date && bound instanceof Date) {
        return actual.getTime() >= bound.getTime();
      }
      if (typeof actual === "number" && typeof bound === "number") {
        return actual >= bound;
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

const seedEvent = async (
  client: EmailEventDb,
  overrides: Partial<EnsureEmailEventInput> & {
    attemptCount?: number;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    nextAttemptAt?: Date | null;
    providerId?: string | null;
    status?: string;
  } = {},
) => {
  const input: EnsureEmailEventInput = {
    eventType: overrides.eventType ?? EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED,
    idempotencyKey: overrides.idempotencyKey ?? `key_${nextId()}`,
    referenceId: overrides.referenceId ?? "sel_1",
    referenceType: overrides.referenceType ?? "subscription_meal_selection",
    shop: overrides.shop ?? SHOP,
    recipientEmail: overrides.recipientEmail ?? "client@example.com",
    metaJson: overrides.metaJson ?? null,
  };

  const ensured = await ensureEmailEvent(input, client);
  await client.emailEvent.updateMany({
    data: {
      ...(overrides.attemptCount !== undefined
        ? { attemptCount: overrides.attemptCount }
        : {}),
      ...(overrides.nextAttemptAt !== undefined
        ? { nextAttemptAt: overrides.nextAttemptAt }
        : {}),
      ...(overrides.status !== undefined ? { status: overrides.status } : {}),
      ...(overrides.lastErrorCode !== undefined
        ? { lastErrorCode: overrides.lastErrorCode }
        : {}),
      ...(overrides.lastErrorMessage !== undefined
        ? { lastErrorMessage: overrides.lastErrorMessage }
        : {}),
      ...(overrides.providerId !== undefined
        ? { providerId: overrides.providerId }
        : {}),
    },
    where: { id: ensured.event.id },
  });

  const event = await client.emailEvent.findUnique({
    where: { id: ensured.event.id },
  });
  if (!event) {
    throw new Error("seedEvent: missing after ensure");
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
  const ctx = createBusinessTestContext("77-email-manual-retry");

  ctx.scenario("A–E. Eligibility by status");
  {
    const client = createMemoryEmailEventDb();
    const failed = await seedEvent(client, {
      attemptCount: 2,
      idempotencyKey: "elig_failed",
      lastErrorCode: "old_error",
      lastErrorMessage: "previous",
      status: EMAIL_EVENT_STATUS.FAILED,
    });
    const sent = await seedEvent(client, {
      attemptCount: 1,
      idempotencyKey: "elig_sent",
      status: EMAIL_EVENT_STATUS.SENT,
    });
    const pending = await seedEvent(client, {
      attemptCount: 0,
      idempotencyKey: "elig_pending",
      status: EMAIL_EVENT_STATUS.PENDING,
    });
    const processing = await seedEvent(client, {
      attemptCount: 1,
      idempotencyKey: "elig_processing",
      status: EMAIL_EVENT_STATUS.PROCESSING,
    });
    const cancelled = await seedEvent(client, {
      attemptCount: 1,
      idempotencyKey: "elig_cancelled",
      status: EMAIL_EVENT_STATUS.CANCELLED,
    });

    const ok = await manualRetryEmailEvent({
      client,
      eventId: failed.id,
      handlers: {
        [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async () => ({
          outcome: "sent",
          providerId: "re_ok_1",
        }),
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("A. failed → retry autorisé (sent)", ok.status, "sent");

    for (const [label, event] of [
      ["B. sent", sent],
      ["C. pending", pending],
      ["D. processing", processing],
      ["E. cancelled", cancelled],
    ] as const) {
      const result = await manualRetryEmailEvent({
        client,
        eventId: event.id,
        handlers: {
          [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async () => ({
            outcome: "sent",
            providerId: "should_not",
          }),
        },
        now: NOW,
        shop: SHOP,
      });
      ctx.assertEqual(`${label} → refusé`, result.status, "not_eligible");
      const after = await loadEvent(client, event.id);
      ctx.assertEqual(
        `${label} status inchangé`,
        after.status,
        event.status,
      );
    }
  }

  ctx.scenario("F. Shop isolation");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedEvent(client, {
      attemptCount: 3,
      idempotencyKey: "shop_iso",
      shop: OTHER_SHOP,
      status: EMAIL_EVENT_STATUS.FAILED,
    });
    const result = await manualRetryEmailEvent({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async () => ({
          outcome: "sent",
          providerId: "x",
        }),
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("wrong shop → not_eligible", result.status, "not_eligible");
    if (result.status === "not_eligible") {
      ctx.assertEqual("reason wrong_shop", result.reason, "wrong_shop");
    }
    const after = await loadEvent(client, event.id);
    ctx.assertEqual(
      "autre shop intact",
      after.status,
      EMAIL_EVENT_STATUS.FAILED,
    );
    ctx.assertEqual("attemptCount inchangé", after.attemptCount, 3);
  }

  ctx.scenario("G. Atomic double retry — une seule transition gagne");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedEvent(client, {
      attemptCount: 4,
      idempotencyKey: "atomic_1",
      status: EMAIL_EVENT_STATUS.FAILED,
    });

    let handlerCalls = 0;
    const handlers = {
      [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async () => {
        handlerCalls += 1;
        return { outcome: "sent" as const, providerId: "re_atomic" };
      },
    };

    const [first, second] = await Promise.all([
      manualRetryEmailEvent({
        client,
        eventId: event.id,
        handlers,
        now: NOW,
        shop: SHOP,
      }),
      manualRetryEmailEvent({
        client,
        eventId: event.id,
        handlers,
        now: NOW,
        shop: SHOP,
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    ctx.assertTrue(
      "une sent + une not_eligible",
      statuses[0] === "not_eligible" && statuses[1] === "sent",
    );
    ctx.assertEqual("handler appelé une seule fois", handlerCalls, 1);
    const after = await loadEvent(client, event.id);
    ctx.assertEqual("attemptCount = 5", after.attemptCount, 5);
  }

  ctx.scenario("H–I. attemptCount jamais reset ; 5 → manual 6");
  {
    const client = createMemoryEmailEventDb();
    const event = await seedEvent(client, {
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS,
      idempotencyKey: "max_manual",
      lastErrorCode: "exhausted",
      lastErrorMessage: "auto max",
      status: EMAIL_EVENT_STATUS.FAILED,
    });
    const idempotencyKeyBefore = event.idempotencyKey;

    const result = await manualRetryEmailEvent({
      client,
      eventId: event.id,
      handlers: {
        [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async ({ event: claimed }) => {
          ctx.assertEqual(
            "H. attemptCount jamais reset au claim",
            claimed.attemptCount,
            EMAIL_EVENT_MAX_ATTEMPTS + 1,
          );
          ctx.assertEqual(
            "M. même idempotencyKey",
            claimed.idempotencyKey,
            idempotencyKeyBefore,
          );
          return {
            errorCode: "still_down",
            message: "provider down",
            outcome: "retryable_failure",
          };
        },
      },
      now: NOW,
      shop: SHOP,
    });

    ctx.assertEqual("I. manual attempt 6 échoue → failed", result.status, "failed");
    if (result.status === "failed") {
      ctx.assertEqual("attemptCount reporté = 6", result.attemptCount, 6);
    }
    const after = await loadEvent(client, event.id);
    ctx.assertEqual("status failed", after.status, EMAIL_EVENT_STATUS.FAILED);
    ctx.assertEqual("attemptCount = 6", after.attemptCount, 6);
    ctx.assertEqual(
      "O. error actualisée",
      after.lastErrorCode,
      "still_down",
    );
    ctx.assertEqual(
      "idempotencyKey conservée en DB",
      after.idempotencyKey,
      idempotencyKeyBefore,
    );
    ctx.assertTrue(
      "K. pas pending +60 min",
      after.nextAttemptAt == null,
    );
  }

  ctx.scenario("J. Cap worker automatique reste 5");
  {
    const client = createMemoryEmailEventDb();
    // Exhausted row wrongly left pending would still be refused by automatic claim.
    const exhaustedPending = await seedEvent(client, {
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS,
      idempotencyKey: "auto_cap",
      nextAttemptAt: null,
      status: EMAIL_EVENT_STATUS.PENDING,
    });

    const due = await listDueEmailEvents({
      client,
      limit: 10,
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual(
      "listDue ignore attemptCount >= MAX",
      due.filter((row) => row.id === exhaustedPending.id).length,
      0,
    );

    const claim = await claimEmailEvent({
      client,
      eventId: exhaustedPending.id,
      now: NOW,
    });
    ctx.assertFalse("claim automatique refuse MAX", claim.claimed);

    const summary = await processDueEmailEvents({
      client,
      handlers: {
        [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async () => ({
          outcome: "sent",
          providerId: "should_not",
        }),
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("cron scanned 0 pour exhausted pending", summary.scanned, 0);
    ctx.assertEqual("cron sent 0", summary.sent, 0);
  }

  ctx.scenario("K–L. Manual failure → failed ; manual success → sent + providerId");
  {
    const client = createMemoryEmailEventDb();
    const failEvent = await seedEvent(client, {
      attemptCount: 1,
      idempotencyKey: "man_fail",
      status: EMAIL_EVENT_STATUS.FAILED,
    });
    const failResult = await manualRetryEmailEvent({
      client,
      eventId: failEvent.id,
      handlers: {
        [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async () => ({
          errorCode: "retryable_again",
          message: "transient",
          outcome: "retryable_failure",
        }),
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("K. manual failure status", failResult.status, "failed");
    const afterFail = await loadEvent(client, failEvent.id);
    ctx.assertEqual(
      "K. reste failed (pas pending)",
      afterFail.status,
      EMAIL_EVENT_STATUS.FAILED,
    );
    ctx.assertEqual("K. attemptCount = 2", afterFail.attemptCount, 2);
    ctx.assertTrue("K. nextAttemptAt null", afterFail.nextAttemptAt == null);

    const successEvent = await seedEvent(client, {
      attemptCount: 5,
      idempotencyKey: "man_ok",
      status: EMAIL_EVENT_STATUS.FAILED,
    });
    const okResult = await manualRetryEmailEvent({
      client,
      eventId: successEvent.id,
      handlers: {
        [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: async () => ({
          outcome: "sent",
          providerId: "re_manual_ok",
        }),
      },
      now: NOW,
      shop: SHOP,
    });
    ctx.assertEqual("L. manual success", okResult.status, "sent");
    const afterOk = await loadEvent(client, successEvent.id);
    ctx.assertEqual("L. status sent", afterOk.status, EMAIL_EVENT_STATUS.SENT);
    ctx.assertEqual("N. providerId stocké", afterOk.providerId, "re_manual_ok");
    ctx.assertEqual("L. attemptCount = 6", afterOk.attemptCount, 6);
    ctx.assertTrue(
      "lastError cleared on sent (convention existante)",
      afterOk.lastErrorCode == null && afterOk.lastErrorMessage == null,
    );
  }

  ctx.scenario("P–R. UI drawer only + confirmation ; pas de retry table");
  {
    const render = readRepoFile("app/features/emails/emails-render.tsx");
    ctx.assertTrue(
      "P. bouton Réessayer l’envoi présent",
      render.includes("Réessayer l’envoi"),
    );
    ctx.assertTrue(
      "P. section Actions conditionnée status=failed",
      render.includes('detail.status === "failed"') &&
        render.includes("Actions"),
    );
    ctx.assertTrue(
      "Q. confirmation UI",
      render.includes("Réessayer cet email ?") &&
        render.includes("même clé d’idempotence") &&
        render.includes("Annuler") &&
        (render.includes(">Réessayer<") ||
          render.includes('isRetrySubmitting ? "Envoi…" : "Réessayer"')),
    );
    ctx.assertTrue(
      "Q. note opérateur",
      render.includes(
        "À utiliser après avoir vérifié la cause de l’échec.",
      ),
    );

    // Table body: no retry button / post form in the events table section.
    const tableStart = render.indexOf("<table");
    const tableEnd = render.indexOf("</table>");
    ctx.assertTrue("table présente", tableStart >= 0 && tableEnd > tableStart);
    const tableChunk = render.slice(tableStart, tableEnd);
    ctx.assertFalse(
      "R. aucun retry dans table principale",
      tableChunk.includes("Réessayer") ||
        tableChunk.includes('method="post"') ||
        tableChunk.includes(RETRY_EMAIL_EVENT_INTENT),
    );
  }

  ctx.scenario("S. Auth admin + input minimal");
  {
    const route = readRepoFile("app/routes/app.emails.tsx");
    const actions = readRepoFile(
      "app/features/emails/emails-actions.server.ts",
    );
    ctx.assertTrue(
      "S. action authentifie admin",
      route.includes("authenticate.admin") && route.includes("handleEmailsAction"),
    );
    ctx.assertTrue(
      "S. shop depuis session uniquement",
      route.includes("session.shop") &&
        !actions.includes("formData.get(\"shop\")"),
    );
    ctx.assertTrue(
      "S. intent + eventId seulement",
      actions.includes("RETRY_EMAIL_EVENT_INTENT") &&
        actions.includes("eventId") &&
        !actions.includes("recipientEmail") &&
        !actions.includes("idempotencyKey"),
    );
    ctx.assertEqual(
      "intent constant",
      RETRY_EMAIL_EVENT_INTENT,
      "retryEmailEvent",
    );
  }

  ctx.scenario("T. Aucune migration / schema");
  {
    const touched = [
      "app/services/email/email-event.server.ts",
      "app/services/email/email-event-worker.server.ts",
      "app/features/emails/emails-actions.server.ts",
      "app/features/emails/emails-render.tsx",
      "app/routes/app.emails.tsx",
    ];
    for (const relativePath of touched) {
      const source = readRepoFile(relativePath);
      ctx.assertFalse(
        `${relativePath} ne touche pas migrate`,
        source.includes("prisma migrate") ||
          source.includes("manualRetryCount") ||
          source.includes("manualRetryAt") ||
          source.includes("retriedBy"),
      );
    }
    ctx.assertTrue(
      "EmailEvent model intact",
      readRepoFile("prisma/schema.prisma").includes("model EmailEvent"),
    );
    ctx.assertFalse(
      "pas de nouveau fichier migration 6G-B",
      existsSync(
        join(
          repoRoot,
          "prisma/migrations",
          "20260825150000_email_manual_retry",
        ),
      ),
    );
  }

  ctx.scenario("U. Logging manuel sans PII");
  {
    const actions = readRepoFile(
      "app/features/emails/emails-actions.server.ts",
    );
    ctx.assertTrue(
      "log [emailAdmin] manualRetry",
      actions.includes('[emailAdmin] manualRetry'),
    );
    ctx.assertFalse(
      "pas de recipientEmail dans le log manuel",
      /console\.log\(\s*"\[emailAdmin\] manualRetry"[\s\S]*recipientEmail/.test(
        actions,
      ) || actions.includes("recipientEmail:"),
    );
    ctx.assertFalse(
      "pas de metaJson dans le log",
      actions.includes("metaJson"),
    );
    ctx.assertTrue(
      "log inclut eventId/eventType/shop/attemptCount/result",
      actions.includes("eventId:") &&
        actions.includes("eventType:") &&
        actions.includes("shop") &&
        actions.includes("attemptCount:") &&
        actions.includes("result:"),
    );
  }

  ctx.scenario("Architecture — claim failed→processing ; dynamic import");
  {
    const primitives = readRepoFile(
      "app/services/email/email-event.server.ts",
    );
    const worker = readRepoFile(
      "app/services/email/email-event-worker.server.ts",
    );
    const actions = readRepoFile(
      "app/features/emails/emails-actions.server.ts",
    );

    ctx.assertTrue(
      "claimFailedEmailEventForManualRetry existe",
      primitives.includes("claimFailedEmailEventForManualRetry") &&
        primitives.includes("status: EMAIL_EVENT_STATUS.FAILED") &&
        primitives.includes("status: EMAIL_EVENT_STATUS.PROCESSING"),
    );
    ctx.assertTrue(
      "claim manuel filtre shop",
      /claimFailedEmailEventForManualRetry[\s\S]*shop,/.test(primitives),
    );
    ctx.assertTrue(
      "claim auto garde lt MAX",
      primitives.includes("attemptCount: { lt: EMAIL_EVENT_MAX_ATTEMPTS }"),
    );
    ctx.assertTrue(
      "manualRetryEmailEvent + failureMode manual",
      worker.includes("manualRetryEmailEvent") &&
        worker.includes('failureMode === "manual"') &&
        worker.includes('failureMode: "manual"'),
    );
    ctx.assertTrue(
      "dynamic import worker (anti-cycle)",
      actions.includes('await import(') &&
        actions.includes("email-event-worker.server"),
    );

    const runner = readRepoFile(
      "scripts/business-tests/00-run-business-regression-suite.ts",
    );
    ctx.assertEqual(
      "Suite 77 enregistrée une seule fois",
      countOccurrences(runner, /77-email-manual-retry\.test\.ts/g),
      1,
    );
  }

  const exitCode = finishSuite("77-email-manual-retry", ctx);
  process.exit(exitCode);
};

runSuite().catch((error) => {
  console.error(error);
  process.exit(1);
});
