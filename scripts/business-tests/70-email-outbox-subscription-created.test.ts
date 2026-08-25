/**
 * Business regression — EMAIL-6F subscription created outbox cutover.
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
  backfillSubscriptionCreatedStampFromSentEvent,
  buildSubscriptionCreatedEmailEventIdempotencyKey,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
} from "../../app/services/email/email-outbox-event-driven.server";
import {
  __resetSubscriptionCreatedEmailEventTestDb,
  __setSubscriptionCreatedEmailEventTestDb,
  processSubscriptionCreatedEmailEvent,
  subscriptionCreatedEmailEventHandler,
} from "../../app/services/email/subscription-created-email-event-handler.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const SELECTION_ID = "sel_sc_1";
const NOW = new Date("2026-08-25T12:00:00.000Z");

const baseSelection = () => ({
  active: true,
  customerEmail: "client@example.com",
  id: SELECTION_ID,
  mealsCount: 8,
  nextScheduledDeliveryDate: "2026-08-27",
  shop: SHOP,
  shopifyOrderId: "order_1",
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  subscriptionCreatedEmailSentAt: null as Date | null,
});

const createMemoryDb = ({
  selection = baseSelection(),
}: {
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
    updateMany: async ({
      data,
      where,
    }: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      if (!selection) {
        return { count: 0 };
      }
      if (where.id && selection.id !== where.id) {
        return { count: 0 };
      }
      if (
        where.subscriptionCreatedEmailSentAt === null &&
        selection.subscriptionCreatedEmailSentAt !== null
      ) {
        return { count: 0 };
      }
      Object.assign(selection, data);
      return { count: 1 };
    },
  },
});

const buildEvent = (overrides: Partial<EmailEvent> = {}): EmailEvent => ({
  attemptCount: 1,
  cancelledAt: null,
  createdAt: NOW,
  eventType: EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED,
  id: "evt_sc_1",
  idempotencyKey:
    buildSubscriptionCreatedEmailEventIdempotencyKey(SELECTION_ID),
  lastAttemptAt: NOW,
  lastErrorCode: null,
  lastErrorMessage: null,
  metaJson: null,
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
  const ctx = createBusinessTestContext("70-email-outbox-subscription-created");
  const ordersSource = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  const handlersSource = readRepoFile(
    "app/services/email/email-event-handlers.server.ts",
  );

  const createFirstBlock = ordersSource.slice(
    ordersSource.indexOf('if (decision === "create_first_subscription")'),
    ordersSource.indexOf("if (isRenewal && matchedSelection)"),
  );

  const previousFlag = process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];
  const previousApiKey = process.env[RESEND_API_KEY_ENV];
  const previousEmailFrom = process.env[EMAIL_FROM_ENV];
  process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = "true";
  process.env[RESEND_API_KEY_ENV] = "re_test_key_not_used";
  process.env[EMAIL_FROM_ENV] = "Mileyo <hello@mileyo.test>";

  ctx.scenario("A. Orders create cutover — create_first + replay");
  {
    const ensureCount = (
      ordersSource.match(/ensureAndProcessEmailEventImmediately/g) ?? []
    ).length;
    ctx.assertTrue(
      "ensureAndProcess au moins 2 fois (create_first + replay)",
      ensureCount >= 2,
    );
    ctx.assertTrue(
      "create_first ensureAndProcess",
      createFirstBlock.includes("ensureAndProcessEmailEventImmediately"),
    );
    ctx.assertTrue(
      "create_first SUBSCRIPTION_CREATED",
      createFirstBlock.includes("EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED"),
    );
    ctx.assertTrue(
      "isFirstOrderReplay ensureAndProcess",
      ordersSource.includes("if (isFirstOrderReplay)") &&
        ordersSource.includes("ensureAndProcessEmailEventImmediately"),
    );
    ctx.assertTrue(
      "handler registered",
      EMAIL_EVENT_HANDLER_REGISTRY[EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED] ===
        subscriptionCreatedEmailEventHandler,
    );
    ctx.assertTrue(
      "registry source",
      handlersSource.includes("EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED"),
    );
  }

  ctx.scenario("B. Idempotency key");
  {
    ctx.assertEqual(
      "clé subscription_created:{selectionId}",
      buildSubscriptionCreatedEmailEventIdempotencyKey(SELECTION_ID),
      `subscription_created:${SELECTION_ID}`,
    );
  }

  ctx.scenario("C. Handler stamps / cancels inactive / missing contract");
  {
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection });
    __setSubscriptionCreatedEmailEventTestDb(memoryDb as never);
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => ({ data: { id: "re_sc_1" }, error: null }),
          },
        }) as unknown as ResendClient,
    });

    const sent = await processSubscriptionCreatedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("sent", sent.outcome, "sent");
    ctx.assertTrue(
      "stamp posé",
      selection.subscriptionCreatedEmailSentAt instanceof Date,
    );

    __setSubscriptionCreatedEmailEventTestDb(
      createMemoryDb({
        selection: { ...baseSelection(), active: false, status: "paused" },
      }) as never,
    );
    const inactive = await processSubscriptionCreatedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("inactive cancelled", inactive.outcome, "cancelled");

    __setSubscriptionCreatedEmailEventTestDb(
      createMemoryDb({
        selection: { ...baseSelection(), subscriptionContractId: "" },
      }) as never,
    );
    const missing = await processSubscriptionCreatedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("missing contract cancelled", missing.outcome, "cancelled");
    if (missing.outcome === "cancelled") {
      ctx.assertEqual("reason", missing.reason, "missing_contract");
    }

    __setSubscriptionCreatedEmailEventTestDb(
      createMemoryDb({
        selection: {
          ...baseSelection(),
          subscriptionCreatedEmailSentAt: NOW,
        },
      }) as never,
    );
    let sendCalls = 0;
    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => {
              sendCalls += 1;
              return { data: { id: "x" }, error: null };
            },
          },
        }) as unknown as ResendClient,
    });
    const already = await processSubscriptionCreatedEmailEvent({
      event: buildEvent({ providerId: "re_prior" }),
      now: NOW,
    });
    ctx.assertEqual("already stamped → sent", already.outcome, "sent");
    ctx.assertEqual("aucun send", sendCalls, 0);

    __resetSendEmailTestDeps();
    __resetSubscriptionCreatedEmailEventTestDb();
    __resetEmailOutboxEventDrivenTestDb();
  }

  ctx.scenario("D. Backfill");
  {
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection });
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    const ok = await backfillSubscriptionCreatedStampFromSentEvent({
      event: buildEvent({
        sentAt: NOW,
        status: EMAIL_EVENT_STATUS.SENT,
      }),
      selectionId: SELECTION_ID,
    });
    ctx.assertTrue("backfill", ok);
    ctx.assertTrue(
      "stamp after backfill",
      selection.subscriptionCreatedEmailSentAt instanceof Date,
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

  return finishSuite("70-email-outbox-subscription-created", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
