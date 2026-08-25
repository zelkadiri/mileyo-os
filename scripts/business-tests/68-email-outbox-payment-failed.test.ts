/**
 * Business regression — EMAIL-6F payment failed outbox cutover.
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
  backfillPaymentFailedStampFromSentEvent,
  buildPaymentFailedEmailEventIdempotencyKey,
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_PAYMENT_RECOVERY,
} from "../../app/services/email/email-outbox-event-driven.server";
import {
  __resetPaymentFailedEmailEventTestDb,
  __setPaymentFailedEmailEventTestDb,
  paymentFailedEmailEventHandler,
  processPaymentFailedEmailEvent,
} from "../../app/services/email/payment-failed-email-event-handler.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const RECOVERY_ID = "rec_pf_1";
const SELECTION_ID = "sel_pf_1";
const NOW = new Date("2026-08-25T12:00:00.000Z");

const baseRecovery = () => ({
  failureCount: 1,
  id: RECOVERY_ID,
  nextRetryAt: new Date("2026-08-26T12:00:00.000Z"),
  paymentFailedEmailSentAt: null as Date | null,
  status: RECOVERY_STATUS.PROCESSING as string,
  subscriptionMealSelectionId: SELECTION_ID,
});

const baseSelection = () => ({
  active: true,
  customerEmail: "client@example.com",
  id: SELECTION_ID,
  shop: SHOP,
  shopifyOrderId: "order_1",
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
});

const createMemoryDb = ({
  recovery = baseRecovery(),
  selection = baseSelection(),
}: {
  recovery?: ReturnType<typeof baseRecovery> | null;
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
    updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      if (selection) {
        Object.assign(selection, data);
      }
      return { count: selection ? 1 : 0 };
    },
  },
  subscriptionPaymentRecovery: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      recovery && recovery.id === where.id ? recovery : null,
    updateMany: async ({
      data,
      where,
    }: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      if (!recovery) {
        return { count: 0 };
      }
      if (where.id && recovery.id !== where.id) {
        return { count: 0 };
      }
      if (
        where.paymentFailedEmailSentAt === null &&
        recovery.paymentFailedEmailSentAt !== null
      ) {
        return { count: 0 };
      }
      Object.assign(recovery, data);
      return { count: 1 };
    },
  },
});

const buildEvent = (overrides: Partial<EmailEvent> = {}): EmailEvent => ({
  attemptCount: 1,
  cancelledAt: null,
  createdAt: NOW,
  eventType: EMAIL_EVENT_TYPE.PAYMENT_FAILED,
  id: "evt_pf_1",
  idempotencyKey: buildPaymentFailedEmailEventIdempotencyKey(RECOVERY_ID),
  lastAttemptAt: NOW,
  lastErrorCode: null,
  lastErrorMessage: null,
  metaJson: null,
  nextAttemptAt: null,
  processingStartedAt: NOW,
  providerId: null,
  recipientEmail: "client@example.com",
  referenceId: RECOVERY_ID,
  referenceType: EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_PAYMENT_RECOVERY,
  sentAt: null,
  shop: SHOP,
  status: EMAIL_EVENT_STATUS.PROCESSING,
  updatedAt: NOW,
  ...overrides,
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("68-email-outbox-payment-failed");
  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const handlerSource = readRepoFile(
    "app/services/email/payment-failed-email-event-handler.server.ts",
  );
  const handlersSource = readRepoFile(
    "app/services/email/email-event-handlers.server.ts",
  );

  const scheduleRecoverySource = recoverySource.slice(
    recoverySource.indexOf("const scheduleRecoveryAfterFailure"),
    recoverySource.indexOf("export type ProcessBillingAttemptFailureResult"),
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
      "scheduleRecovery ensureAndProcessEmailEventImmediately",
      scheduleRecoverySource.includes("ensureAndProcessEmailEventImmediately"),
    );
    ctx.assertTrue(
      "scheduleRecovery PAYMENT_FAILED",
      scheduleRecoverySource.includes("EMAIL_EVENT_TYPE.PAYMENT_FAILED") ||
        scheduleRecoverySource.includes("payment_failed"),
    );
    ctx.assertFalse(
      "failureCount===1 sans trySendMileyoPaymentFailedEmail",
      (() => {
        const blockStart = scheduleRecoverySource.indexOf(
          "if (nextFailureCount === 1)",
        );
        const blockEnd = scheduleRecoverySource.indexOf(
          "if (nextFailureCount >= MAX_RECOVERY_FAILURES",
        );
        const block = scheduleRecoverySource.slice(blockStart, blockEnd);
        return block.includes("trySendMileyoPaymentFailedEmail");
      })(),
    );
    ctx.assertTrue(
      "Shopify sendPaymentUpdateEmailForSelection conservé",
      scheduleRecoverySource.includes("sendPaymentUpdateEmailForSelection"),
    );
    ctx.assertTrue(
      "handler stampPaymentFailedEmailSentAt",
      handlerSource.includes("stampPaymentFailedEmailSentAt"),
    );
    ctx.assertTrue(
      "handler classifyEmailSendFailureForEmailEvent",
      handlerSource.includes("classifyEmailSendFailureForEmailEvent"),
    );
    ctx.assertTrue(
      "registry payment_failed",
      handlersSource.includes("EMAIL_EVENT_TYPE.PAYMENT_FAILED") &&
        EMAIL_EVENT_HANDLER_REGISTRY[EMAIL_EVENT_TYPE.PAYMENT_FAILED] ===
          paymentFailedEmailEventHandler,
    );
  }

  ctx.scenario("B. Idempotency key + helpers");
  {
    ctx.assertEqual(
      "clé payment_failed:{recoveryId}",
      buildPaymentFailedEmailEventIdempotencyKey(RECOVERY_ID),
      `payment_failed:${RECOVERY_ID}`,
    );
  }

  ctx.scenario("C. Handler — stamp déjà présent → sent sans send");
  {
    const recovery = {
      ...baseRecovery(),
      paymentFailedEmailSentAt: NOW,
    };
    const memoryDb = createMemoryDb({ recovery });
    __setPaymentFailedEmailEventTestDb(memoryDb as never);
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

    const result = await processPaymentFailedEmailEvent({
      event: buildEvent({ providerId: "re_prior" }),
      now: NOW,
    });
    ctx.assertEqual("stamp présent → sent", result.outcome, "sent");
    ctx.assertEqual("aucun send", sendCalls, 0);

    __resetSendEmailTestDeps();
    __resetPaymentFailedEmailEventTestDb();
    __resetEmailOutboxEventDrivenTestDb();
  }

  ctx.scenario("D. Handler — recovered → cancelled");
  {
    const memoryDb = createMemoryDb({
      recovery: {
        ...baseRecovery(),
        status: RECOVERY_STATUS.RECOVERED,
      },
    });
    __setPaymentFailedEmailEventTestDb(memoryDb as never);

    const result = await processPaymentFailedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("recovered cancelled", result.outcome, "cancelled");
    if (result.outcome === "cancelled") {
      ctx.assertEqual("reason", result.reason, "recovery_recovered");
    }

    __resetPaymentFailedEmailEventTestDb();
  }

  ctx.scenario("E. Handler — failureCount 2 envoie si stamp null + problème actif");
  {
    const recovery = {
      ...baseRecovery(),
      failureCount: 2,
      paymentFailedEmailSentAt: null,
      status: RECOVERY_STATUS.RETRY_SCHEDULED,
    };
    const memoryDb = createMemoryDb({ recovery });
    __setPaymentFailedEmailEventTestDb(memoryDb as never);
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    const calls: Array<{ options?: { idempotencyKey?: string } }> = [];
    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async (
              _payload: Record<string, unknown>,
              options?: { idempotencyKey?: string },
            ) => {
              calls.push({ options });
              return { data: { id: "re_pf_fc2" }, error: null };
            },
          },
        }) as unknown as ResendClient,
    });

    const event = buildEvent();
    const result = await processPaymentFailedEmailEvent({
      event,
      now: NOW,
    });
    ctx.assertEqual("failureCount 2 → sent", result.outcome, "sent");
    ctx.assertEqual(
      "idempotencyKey transmise",
      calls[0]?.options?.idempotencyKey,
      event.idempotencyKey,
    );
    ctx.assertTrue("stamp posé", Boolean(recovery.paymentFailedEmailSentAt));

    __resetSendEmailTestDeps();
    __resetPaymentFailedEmailEventTestDb();
    __resetEmailOutboxEventDrivenTestDb();
  }

  ctx.scenario("F. classify retryable / permanent");
  {
    const retryable = classifyEmailSendFailureForEmailEvent({
      message: "slow down",
      ok: false,
      providerErrorCode: "rate_limit_exceeded",
      reason: "rate_limit_exceeded",
    });
    ctx.assertEqual(
      "rate_limit retryable",
      retryable.outcome,
      "retryable_failure",
    );

    const permanent = classifyEmailSendFailureForEmailEvent({
      message: "Payload mismatch",
      ok: false,
      providerErrorCode: "invalid_idempotent_request",
      reason: "invalid_idempotent_request",
    });
    ctx.assertEqual(
      "invalid_idempotent permanent",
      permanent.outcome,
      "permanent_failure",
    );
  }

  ctx.scenario("G. Backfill stamp from sent event");
  {
    const recovery = baseRecovery();
    const memoryDb = createMemoryDb({ recovery });
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    const backfilled = await backfillPaymentFailedStampFromSentEvent({
      event: buildEvent({
        sentAt: NOW,
        status: EMAIL_EVENT_STATUS.SENT,
      }),
      recoveryId: RECOVERY_ID,
    });
    ctx.assertTrue("backfill ok", backfilled);
    ctx.assertTrue(
      "stamp after backfill",
      recovery.paymentFailedEmailSentAt instanceof Date,
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

  return finishSuite("68-email-outbox-payment-failed", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
