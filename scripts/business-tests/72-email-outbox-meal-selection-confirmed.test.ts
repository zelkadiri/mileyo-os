/**
 * Business regression — EMAIL-6F meal selection confirmed outbox cutover.
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
  SUBSCRIPTION_CYCLE_TIMEZONE,
} from "../../app/constants/subscriptionCycle";
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
  backfillMealSelectionConfirmedStampFromSentEvent,
  buildCampaignEmailEventMetaJson,
  buildMealSelectionConfirmedEmailEventIdempotencyKey,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
} from "../../app/services/email/email-outbox-event-driven.server";
import {
  __resetMealSelectionConfirmedEmailEventTestDb,
  __setMealSelectionConfirmedEmailEventTestDb,
  mealSelectionConfirmedEmailEventHandler,
  processMealSelectionConfirmedEmailEvent,
} from "../../app/services/email/meal-selection-confirmed-email-event-handler.server";
import {
  parseDeliveryDate,
  parisWallClockToInstant,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const SELECTION_ID = "sel_msc_1";
const DELIVERY = "2026-08-27";
const NOW = parisWallClockToInstant({
  date: parseDeliveryDate("2026-08-24")!,
  hour: 10,
  minute: 0,
  timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
});

const baseSelection = () => ({
  active: true,
  customerEmail: "client@example.com",
  id: SELECTION_ID,
  mealSelectionConfirmedDeliveryDate: null as string | null,
  mealSelectionConfirmedEmailSentAt: null as Date | null,
  mealSelectionLastExplicitDeliveryDate: DELIVERY,
  mealsCount: 8,
  nextScheduledDeliveryDate: DELIVERY,
  preferredDeliveryWeekday: 4,
  selectedMeals: ["A", "B", "C", "D", "A", "B", "C", "D"],
  shop: SHOP,
  shopifyOrderId: "order_1",
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
});

const createMemoryDb = ({
  selection = baseSelection(),
  hasOrder = true,
}: {
  hasOrder?: boolean;
  selection?: ReturnType<typeof baseSelection> | null;
} = {}) => ({
  boxOrder: {
    findUnique: async () =>
      hasOrder
        ? {
            customerEmail: "client@example.com",
            customerName: "Client",
          }
        : null,
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
      Object.assign(selection, data);
      return { count: 1 };
    },
  },
});

const buildEvent = (overrides: Partial<EmailEvent> = {}): EmailEvent => ({
  attemptCount: 1,
  cancelledAt: null,
  createdAt: NOW,
  eventType: EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED,
  id: "evt_msc_1",
  idempotencyKey: buildMealSelectionConfirmedEmailEventIdempotencyKey(
    SELECTION_ID,
    DELIVERY,
  ),
  lastAttemptAt: NOW,
  lastErrorCode: null,
  lastErrorMessage: null,
  metaJson: buildCampaignEmailEventMetaJson(DELIVERY),
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
  const ctx = createBusinessTestContext(
    "72-email-outbox-meal-selection-confirmed",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const handlersSource = readRepoFile(
    "app/services/email/email-event-handlers.server.ts",
  );

  const updateFutureBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleUpdateFutureMealSelectionAction"),
    portalActionsSource.indexOf("export const handlePortalAction"),
  );

  const previousFlag = process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];
  const previousApiKey = process.env[RESEND_API_KEY_ENV];
  const previousEmailFrom = process.env[EMAIL_FROM_ENV];
  process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = "true";
  process.env[RESEND_API_KEY_ENV] = "re_test_key_not_used";
  process.env[EMAIL_FROM_ENV] = "Mileyo <hello@mileyo.test>";

  ctx.scenario("A. Portal cutover + registry");
  {
    ctx.assertTrue(
      "updateFuture ensureAndProcessEmailEventImmediately",
      updateFutureBlock.includes("ensureAndProcessEmailEventImmediately"),
    );
    ctx.assertTrue(
      "updateFuture MEAL_SELECTION_CONFIRMED",
      updateFutureBlock.includes("EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED"),
    );
    ctx.assertTrue(
      "handler registered",
      EMAIL_EVENT_HANDLER_REGISTRY[
        EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED
      ] === mealSelectionConfirmedEmailEventHandler,
    );
    ctx.assertTrue(
      "registry source",
      handlersSource.includes("EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED"),
    );
  }

  ctx.scenario("B. Idempotency key");
  {
    ctx.assertEqual(
      "clé meal_selection_confirmed:{selectionId}:{date}",
      buildMealSelectionConfirmedEmailEventIdempotencyKey(
        SELECTION_ID,
        DELIVERY,
      ),
      `meal_selection_confirmed:${SELECTION_ID}:${DELIVERY}`,
    );
  }

  ctx.scenario("C. Handler cancel paths");
  {
    __setMealSelectionConfirmedEmailEventTestDb(
      createMemoryDb({ selection: baseSelection() }) as never,
    );
    const mismatch = await processMealSelectionConfirmedEmailEvent({
      event: buildEvent({
        metaJson: buildCampaignEmailEventMetaJson("2026-09-03"),
      }),
      now: NOW,
    });
    ctx.assertEqual("cycle mismatch cancelled", mismatch.outcome, "cancelled");
    if (mismatch.outcome === "cancelled") {
      ctx.assertEqual("reason", mismatch.reason, "delivery_cycle_mismatch");
    }

    __setMealSelectionConfirmedEmailEventTestDb(
      createMemoryDb({
        selection: {
          ...baseSelection(),
          mealSelectionLastExplicitDeliveryDate: "2026-08-20",
        },
      }) as never,
    );
    const noExplicit = await processMealSelectionConfirmedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("no explicit cancelled", noExplicit.outcome, "cancelled");
    if (noExplicit.outcome === "cancelled") {
      ctx.assertEqual("reason", noExplicit.reason, "no_explicit_selection");
    }

    __setMealSelectionConfirmedEmailEventTestDb(
      createMemoryDb({
        selection: {
          ...baseSelection(),
          active: false,
          status: "paused",
        },
      }) as never,
    );
    const inactive = await processMealSelectionConfirmedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("inactive cancelled", inactive.outcome, "cancelled");

    __setMealSelectionConfirmedEmailEventTestDb(
      createMemoryDb({
        hasOrder: false,
        selection: {
          ...baseSelection(),
          customerEmail: null as unknown as string,
        },
      }) as never,
    );
    const noRecipient = await processMealSelectionConfirmedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("no recipient cancelled", noRecipient.outcome, "cancelled");
    if (noRecipient.outcome === "cancelled") {
      ctx.assertEqual("reason", noRecipient.reason, "no_recipient");
    }

    __resetMealSelectionConfirmedEmailEventTestDb();
  }

  ctx.scenario("D. Handler success + already stamped");
  {
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection });
    __setMealSelectionConfirmedEmailEventTestDb(memoryDb as never);
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
              return { data: { id: "re_msc_1" }, error: null };
            },
          },
        }) as unknown as ResendClient,
    });

    const event = buildEvent();
    const sent = await processMealSelectionConfirmedEmailEvent({
      event,
      now: NOW,
    });
    ctx.assertEqual("sent", sent.outcome, "sent");
    ctx.assertEqual(
      "idempotencyKey",
      calls[0]?.options?.idempotencyKey,
      event.idempotencyKey,
    );
    ctx.assertEqual(
      "stamp deliveryDate",
      selection.mealSelectionConfirmedDeliveryDate,
      DELIVERY,
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
    const already = await processMealSelectionConfirmedEmailEvent({
      event: buildEvent({ providerId: "re_prior" }),
      now: NOW,
    });
    ctx.assertEqual("already → sent", already.outcome, "sent");
    ctx.assertEqual("aucun send", sendCalls, 0);

    __resetSendEmailTestDeps();
    __resetMealSelectionConfirmedEmailEventTestDb();
    __resetEmailOutboxEventDrivenTestDb();
  }

  ctx.scenario("E. Backfill");
  {
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection });
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    const ok = await backfillMealSelectionConfirmedStampFromSentEvent({
      deliveryDate: DELIVERY,
      event: buildEvent({
        sentAt: NOW,
        status: EMAIL_EVENT_STATUS.SENT,
      }),
      selectionId: SELECTION_ID,
    });
    ctx.assertTrue("backfill", ok);
    ctx.assertEqual(
      "backfill deliveryDate",
      selection.mealSelectionConfirmedDeliveryDate,
      DELIVERY,
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

  return finishSuite("72-email-outbox-meal-selection-confirmed", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
