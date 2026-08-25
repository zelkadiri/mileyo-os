/**
 * Business regression — EMAIL-6F payment recovered outbox cutover.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type EmailEvent } from "@prisma/client";

import {
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_TYPE,
} from "../../app/constants/emailEvent";
import {
  RECOVERY_STATUS,
} from "../../app/constants/subscriptionPaymentRecovery";
import {
  ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
  EMAIL_FROM_ENV,
  RESEND_API_KEY_ENV,
  __resetSendEmailTestDeps,
  __setSendEmailTestDeps,
} from "../../app/services/email/email.server";
import type { ResendClient } from "../../app/services/email/email-client.server";
import {
  EMAIL_EVENT_HANDLER_REGISTRY,
} from "../../app/services/email/email-event-handlers.server";
import {
  __resetEmailOutboxEventDrivenTestDb,
  __setEmailOutboxEventDrivenTestDb,
  backfillPaymentRecoveredStampFromSentEvent,
  buildPaymentRecoveredEmailEventIdempotencyKey,
  buildPaymentRecoveredEmailEventMetaJson,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  parsePaymentRecoveredEmailEventMeta,
} from "../../app/services/email/email-outbox-event-driven.server";
import {
  __resetPaymentRecoveredEmailEventTestDb,
  __setPaymentRecoveredEmailEventTestDb,
  paymentRecoveredEmailEventHandler,
  processPaymentRecoveredEmailEvent,
} from "../../app/services/email/payment-recovered-email-event-handler.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const SELECTION_ID = "sel_pr_1";
const ORDER_ID = "order_pr_1";
const RECOVERY_IDS = ["rec_pr_a", "rec_pr_b"];
const NOW = new Date("2026-08-25T12:00:00.000Z");

const baseSelection = () => ({
  active: true,
  customerEmail: "client@example.com",
  id: SELECTION_ID,
  shop: SHOP,
  shopifyOrderId: ORDER_ID,
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
});

const baseRecoveries = () =>
  RECOVERY_IDS.map((id) => ({
    id,
    paymentRecoveredEmailSentAt: null as Date | null,
    status: RECOVERY_STATUS.RECOVERED,
    subscriptionMealSelectionId: SELECTION_ID,
  }));

const createMemoryDb = ({
  recoveries = baseRecoveries(),
  selection = baseSelection(),
}: {
  recoveries?: ReturnType<typeof baseRecoveries>;
  selection?: ReturnType<typeof baseSelection> | null;
} = {}) => ({
  boxOrder: {
    findUnique: async () => ({
      customerEmail: "client@example.com",
      customerName: "Client",
    }),
  },
  subscriptionMealSelection: {
    findUnique: async () => selection,
  },
  subscriptionPaymentRecovery: {
    findMany: async ({
      where,
    }: {
      where?: { id?: { in: string[] } };
    }) => {
      if (where?.id?.in) {
        return recoveries.filter((row) => where.id!.in.includes(row.id));
      }
      return recoveries;
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      let count = 0;
      const ids =
        where.id &&
        typeof where.id === "object" &&
        where.id !== null &&
        "in" in (where.id as object)
          ? ((where.id as { in: string[] }).in ?? [])
          : null;

      for (const recovery of recoveries) {
        if (ids && !ids.includes(recovery.id)) {
          continue;
        }
        if (
          where.paymentRecoveredEmailSentAt === null &&
          recovery.paymentRecoveredEmailSentAt !== null
        ) {
          continue;
        }
        Object.assign(recovery, data);
        count += 1;
      }
      return { count };
    },
  },
});

const buildEvent = (overrides: Partial<EmailEvent> = {}): EmailEvent => ({
  attemptCount: 1,
  cancelledAt: null,
  createdAt: NOW,
  eventType: EMAIL_EVENT_TYPE.PAYMENT_RECOVERED,
  id: "evt_pr_1",
  idempotencyKey: buildPaymentRecoveredEmailEventIdempotencyKey(
    SELECTION_ID,
    ORDER_ID,
  ),
  lastAttemptAt: NOW,
  lastErrorCode: null,
  lastErrorMessage: null,
  metaJson: buildPaymentRecoveredEmailEventMetaJson({
    orderId: ORDER_ID,
    recoveryIds: RECOVERY_IDS,
  }),
  nextAttemptAt: null,
  processingStartedAt: NOW,
  providerId: null,
  recipientEmail: "client@example.com",
  referenceId: SELECTION_ID,
  referenceType: EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  sentAt: null,
  shop: SHOP,
  status: EMAIL_EVENT_STATUS.PROCESSING,
  updatedAt: NOW,
  ...overrides,
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("69-email-outbox-payment-recovered");
  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const handlersSource = readRepoFile(
    "app/services/email/email-event-handlers.server.ts",
  );

  const closeRecoverySource = recoverySource.slice(
    recoverySource.indexOf("export const closeRecoveryOnSuccessfulOrder"),
    recoverySource.indexOf("export type ProcessDueRecoveryRetriesOptions"),
  );

  const previousFlag = process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];
  const previousApiKey = process.env[RESEND_API_KEY_ENV];
  const previousEmailFrom = process.env[EMAIL_FROM_ENV];
  process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = "true";
  process.env[RESEND_API_KEY_ENV] = "re_test_key_not_used";
  process.env[EMAIL_FROM_ENV] = "Mileyo <hello@mileyo.test>";

  ctx.scenario("A. Source cutover + registry");
  {
    ctx.assertTrue(
      "closeRecovery ensureAndProcessEmailEventImmediately",
      closeRecoverySource.includes("ensureAndProcessEmailEventImmediately"),
    );
    ctx.assertTrue(
      "closeRecovery PAYMENT_RECOVERED",
      closeRecoverySource.includes("EMAIL_EVENT_TYPE.PAYMENT_RECOVERED") ||
        closeRecoverySource.includes("payment_recovered"),
    );
    ctx.assertFalse(
      "closeRecovery sans trySend dans le chemin principal",
      closeRecoverySource.includes("trySendMileyoPaymentRecoveredEmail("),
    );
    ctx.assertTrue(
      "handler registered",
      EMAIL_EVENT_HANDLER_REGISTRY[EMAIL_EVENT_TYPE.PAYMENT_RECOVERED] ===
        paymentRecoveredEmailEventHandler,
    );
    ctx.assertTrue(
      "registry source payment_recovered",
      handlersSource.includes("EMAIL_EVENT_TYPE.PAYMENT_RECOVERED"),
    );
  }

  ctx.scenario("B. Key + meta orderId + recoveryIds");
  {
    ctx.assertEqual(
      "clé payment_recovered:{selectionId}:{orderId}",
      buildPaymentRecoveredEmailEventIdempotencyKey(SELECTION_ID, ORDER_ID),
      `payment_recovered:${SELECTION_ID}:${ORDER_ID}`,
    );
    const meta = parsePaymentRecoveredEmailEventMeta(
      buildPaymentRecoveredEmailEventMetaJson({
        orderId: ORDER_ID,
        recoveryIds: RECOVERY_IDS,
      }),
    );
    ctx.assertEqual("meta orderId", meta.orderId, ORDER_ID);
    ctx.assertEqual("meta recoveryIds length", meta.recoveryIds.length, 2);
    ctx.assertEqual("meta recoveryIds[0]", meta.recoveryIds[0], RECOVERY_IDS[0]);
  }

  ctx.scenario("C. Handler stamps exact recoveryIds");
  {
    const recoveries = baseRecoveries();
    const memoryDb = createMemoryDb({ recoveries });
    __setPaymentRecoveredEmailEventTestDb(memoryDb as never);
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => ({ data: { id: "re_pr_1" }, error: null }),
          },
        }) as unknown as ResendClient,
    });

    const result = await processPaymentRecoveredEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("outcome sent", result.outcome, "sent");
    ctx.assertTrue(
      "stamp a",
      recoveries[0]!.paymentRecoveredEmailSentAt instanceof Date,
    );
    ctx.assertTrue(
      "stamp b",
      recoveries[1]!.paymentRecoveredEmailSentAt instanceof Date,
    );

    __resetSendEmailTestDeps();
    __resetPaymentRecoveredEmailEventTestDb();
    __resetEmailOutboxEventDrivenTestDb();
  }

  ctx.scenario("D. Partial stamps → complete without resend");
  {
    const recoveries = baseRecoveries();
    recoveries[0]!.paymentRecoveredEmailSentAt = NOW;
    const memoryDb = createMemoryDb({ recoveries });
    __setPaymentRecoveredEmailEventTestDb(memoryDb as never);
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    let sendCalls = 0;
    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => {
              sendCalls += 1;
              return { data: { id: "re_should_not" }, error: null };
            },
          },
        }) as unknown as ResendClient,
    });

    const result = await processPaymentRecoveredEmailEvent({
      event: buildEvent({ providerId: "re_prior" }),
      now: NOW,
    });
    ctx.assertEqual("partial → sent", result.outcome, "sent");
    ctx.assertEqual("aucun send", sendCalls, 0);
    ctx.assertTrue(
      "stamp b complété",
      recoveries[1]!.paymentRecoveredEmailSentAt instanceof Date,
    );

    __resetSendEmailTestDeps();
    __resetPaymentRecoveredEmailEventTestDb();
    __resetEmailOutboxEventDrivenTestDb();
  }

  ctx.scenario("E. Backfill helper");
  {
    const recoveries = baseRecoveries();
    const memoryDb = createMemoryDb({ recoveries });
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    const stamped = await backfillPaymentRecoveredStampFromSentEvent({
      event: buildEvent({
        sentAt: NOW,
        status: EMAIL_EVENT_STATUS.SENT,
      }),
      recoveryIds: RECOVERY_IDS,
    });
    ctx.assertEqual("backfill count", stamped, 2);
    ctx.assertTrue(
      "backfill a",
      recoveries[0]!.paymentRecoveredEmailSentAt instanceof Date,
    );

    __resetEmailOutboxEventDrivenTestDb();
  }

  if (previousFlag === undefined) {
    delete process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];
  } else {
    process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = previousFlag;
  }
  if (previousApiKey === undefined) {
    delete process.env[RESEND_API_KEY_ENV];
  } else {
    process.env[RESEND_API_KEY_ENV] = previousApiKey;
  }
  if (previousEmailFrom === undefined) {
    delete process.env[EMAIL_FROM_ENV];
  } else {
    process.env[EMAIL_FROM_ENV] = previousEmailFrom;
  }

  return finishSuite("69-email-outbox-payment-recovered", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
