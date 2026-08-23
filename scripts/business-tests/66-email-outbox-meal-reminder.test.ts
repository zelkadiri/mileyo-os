/**
 * Business regression — EMAIL-6E meal selection reminder outbox migration.
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
  ensureEmailEvent,
  type EmailEventDb,
  type EnsureEmailEventInput,
} from "../../app/services/email/email-event.server";
import {
  __resetEmailOutboxCampaignTestDb,
  __setEmailOutboxCampaignTestDb,
  backfillMealSelectionReminderStampFromSentEvent,
  buildCampaignEmailEventMetaJson,
  buildMealSelectionReminderEmailEventIdempotencyKey,
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  parseEmailEventDeliveryDateMeta,
} from "../../app/services/email/email-outbox-campaign.server";
import {
  __resetMealSelectionReminderEmailEventTestDb,
  __setMealSelectionReminderEmailEventTestDb,
  mealSelectionReminderEmailEventHandler,
  processMealSelectionReminderEmailEvent,
} from "../../app/services/email/meal-selection-reminder-email-event-handler.server";
import {
  SUBSCRIPTION_CYCLE_TIMEZONE,
} from "../../app/constants/subscriptionCycle";
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
const SELECTION_ID = "sel_reminder_outbox_1";
const DELIVERY = "2026-08-27";
const MONDAY_MORNING = parisWallClockToInstant({
  date: parseDeliveryDate("2026-08-24")!,
  hour: 10,
  minute: 0,
  timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
});

const baseSelection = () => ({
  active: true,
  customerEmail: "client@example.com",
  id: SELECTION_ID,
  lastBillingAttemptAt: null,
  lastBillingAttemptStatus: null,
  mealSelectionLastExplicitDeliveryDate: "2026-08-20",
  mealSelectionReminderDeliveryDate: null as string | null,
  mealSelectionReminderEmailSentAt: null as Date | null,
  mealsCount: 8,
  nextScheduledDeliveryDate: DELIVERY,
  preferredDeliveryWeekday: 4,
  resumeAttemptOrderId: null,
  resumeAttemptStatus: null,
  selectedMeals: ["A", "B"],
  shop: SHOP,
  shopifyOrderId: "order_1",
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
});

const createMemoryDb = ({
  selection = baseSelection(),
  stampUpdates = [] as Array<Record<string, unknown>>,
}: {
  selection?: ReturnType<typeof baseSelection> | null;
  stampUpdates?: Array<Record<string, unknown>>;
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
      stampUpdates.push(data);
      if (selection) {
        Object.assign(selection, data);
      }
      return { count: selection ? 1 : 0 };
    },
  },
  subscriptionPaymentRecovery: {
    findMany: async () => [],
  },
});

const buildEvent = (overrides: Partial<EmailEvent> = {}): EmailEvent => ({
  attemptCount: 1,
  cancelledAt: null,
  createdAt: MONDAY_MORNING,
  eventType: EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER,
  id: "evt_reminder_1",
  idempotencyKey: buildMealSelectionReminderEmailEventIdempotencyKey(
    SELECTION_ID,
    DELIVERY,
  ),
  lastAttemptAt: MONDAY_MORNING,
  lastErrorCode: null,
  lastErrorMessage: null,
  metaJson: buildCampaignEmailEventMetaJson(DELIVERY),
  nextAttemptAt: null,
  processingStartedAt: MONDAY_MORNING,
  providerId: null,
  recipientEmail: "client@example.com",
  referenceId: SELECTION_ID,
  referenceType: EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  sentAt: null,
  shop: SHOP,
  status: EMAIL_EVENT_STATUS.PROCESSING,
  updatedAt: MONDAY_MORNING,
  ...overrides,
});

let idSeq = 0;
const nextId = () => `evt_${++idSeq}`;

const createEmailEventStore = (): EmailEventDb => {
  const rows = new Map<string, EmailEvent>();

  return {
    emailEvent: {
      create: async ({ data }) => {
        const row = {
          attemptCount: data.attemptCount ?? 0,
          cancelledAt: null,
          createdAt: new Date(),
          eventType: data.eventType,
          id: nextId(),
          idempotencyKey: data.idempotencyKey,
          lastAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          metaJson: data.metaJson ?? null,
          nextAttemptAt: null,
          processingStartedAt: null,
          providerId: null,
          recipientEmail: data.recipientEmail ?? null,
          referenceId: data.referenceId,
          referenceType: data.referenceType,
          sentAt: null,
          shop: data.shop,
          status: data.status,
          updatedAt: new Date(),
        } satisfies EmailEvent;
        rows.set(row.idempotencyKey, row);
        return row;
      },
      findMany: async () => [...rows.values()],
      findUnique: async ({ where }) => {
        if (where.idempotencyKey) {
          return rows.get(where.idempotencyKey) ?? null;
        }
        return [...rows.values()].find((row) => row.id === where.id) ?? null;
      },
      updateMany: async () => ({ count: 0 }),
    },
  };
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("66-email-outbox-meal-reminder");
  const runnerSource = readRepoFile(
    "app/services/email/meal-selection-reminder-runner.server.ts",
  );
  const previousFlag = process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];
  const previousApiKey = process.env[RESEND_API_KEY_ENV];
  const previousEmailFrom = process.env[EMAIL_FROM_ENV];
  process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = "true";
  process.env[RESEND_API_KEY_ENV] = "re_test_key_not_used";
  process.env[EMAIL_FROM_ENV] = "Mileyo <hello@mileyo.test>";

  ctx.scenario("A. Outbox helpers + runner cutover");
  {
    const key = buildMealSelectionReminderEmailEventIdempotencyKey(
      SELECTION_ID,
      DELIVERY,
    );
    ctx.assertEqual(
      "clé exacte",
      key,
      `meal_selection_reminder:${SELECTION_ID}:${DELIVERY}`,
    );
    ctx.assertEqual(
      "meta deliveryDate",
      parseEmailEventDeliveryDateMeta(buildCampaignEmailEventMetaJson(DELIVERY))
        .deliveryDate,
      DELIVERY,
    );
    ctx.assertFalse(
      "runner sans trySendMealSelectionReminderEmail",
      runnerSource.includes("trySendMealSelectionReminderEmail"),
    );
    ctx.assertFalse(
      "runner sans sendEmail",
      /sendEmail/.test(runnerSource),
    );
    ctx.assertTrue(
      "runner ensureEmailEvent",
      runnerSource.includes("ensureEmailEvent({"),
    );
    ctx.assertTrue(
      "summary enqueuedCreated",
      runnerSource.includes("enqueuedCreated"),
    );
    ctx.assertTrue(
      "summary enqueuedExisting",
      runnerSource.includes("enqueuedExisting"),
    );
    ctx.assertTrue(
      "handler registered",
      EMAIL_EVENT_HANDLER_REGISTRY[EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER] ===
        mealSelectionReminderEmailEventHandler,
    );
  }

  ctx.scenario("B. ensureEmailEvent enqueue contract");
  {
    const client = createEmailEventStore();
    const input: EnsureEmailEventInput = {
      eventType: EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER,
      idempotencyKey: buildMealSelectionReminderEmailEventIdempotencyKey(
        SELECTION_ID,
        DELIVERY,
      ),
      metaJson: buildCampaignEmailEventMetaJson(DELIVERY),
      recipientEmail: "client@example.com",
      referenceId: SELECTION_ID,
      referenceType: EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
      shop: SHOP,
    };

    const first = await ensureEmailEvent(input, client);
    const second = await ensureEmailEvent(input, client);

    ctx.assertTrue("premier create", first.created);
    ctx.assertFalse("second existing", second.created);
    ctx.assertEqual(
      "referenceType",
      first.event.referenceType,
      EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
    );
    ctx.assertEqual("referenceId", first.event.referenceId, SELECTION_ID);
  }

  ctx.scenario("C. Handler success + stamp + idempotencyKey");
  {
    const stampUpdates: Array<Record<string, unknown>> = [];
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection, stampUpdates });
    __setMealSelectionReminderEmailEventTestDb(memoryDb as never);
    __setEmailOutboxCampaignTestDb(memoryDb as never);

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
              return { data: { id: "re_reminder_1" }, error: null };
            },
          },
        }) as unknown as ResendClient,
    });

    const event = buildEvent();
    const result = await processMealSelectionReminderEmailEvent({
      event,
      now: MONDAY_MORNING,
    });

    ctx.assertEqual("outcome sent", result.outcome, "sent");
    if (result.outcome === "sent") {
      ctx.assertEqual("providerId", result.providerId, "re_reminder_1");
    }
    ctx.assertEqual(
      "idempotencyKey transmise",
      calls[0]?.options?.idempotencyKey,
      event.idempotencyKey,
    );
    ctx.assertEqual(
      "stamp deliveryDate",
      selection.mealSelectionReminderDeliveryDate,
      DELIVERY,
    );
    ctx.assertTrue("stamp sentAt", Boolean(selection.mealSelectionReminderEmailSentAt));

    __resetSendEmailTestDeps();
    __resetMealSelectionReminderEmailEventTestDb();
    __resetEmailOutboxCampaignTestDb();
  }

  ctx.scenario("D. Handler cancelled + permanent + retryable");
  {
    const memoryDb = createMemoryDb({ selection: baseSelection() });
    __setMealSelectionReminderEmailEventTestDb(memoryDb as never);
    __setEmailOutboxCampaignTestDb(memoryDb as never);

    __setMealSelectionReminderEmailEventTestDb(
      createMemoryDb({
        selection: { ...baseSelection(), active: false },
      }) as never,
    );
    const inactiveResult = await processMealSelectionReminderEmailEvent({
      event: buildEvent(),
      now: MONDAY_MORNING,
    });
    ctx.assertEqual("inactive cancelled", inactiveResult.outcome, "cancelled");

    __setMealSelectionReminderEmailEventTestDb(
      createMemoryDb({
        selection: {
          ...baseSelection(),
          mealSelectionLastExplicitDeliveryDate: DELIVERY,
        },
      }) as never,
    );
    const explicit = await processMealSelectionReminderEmailEvent({
      event: buildEvent(),
      now: MONDAY_MORNING,
    });
    ctx.assertEqual("explicit cancelled", explicit.outcome, "cancelled");

    const mismatch = await processMealSelectionReminderEmailEvent({
      event: buildEvent({
        metaJson: buildCampaignEmailEventMetaJson("2026-09-03"),
      }),
      now: MONDAY_MORNING,
    });
    ctx.assertEqual("cycle mismatch cancelled", mismatch.outcome, "cancelled");

    const badMeta = await processMealSelectionReminderEmailEvent({
      event: buildEvent({ metaJson: "{}" }),
      now: MONDAY_MORNING,
    });
    ctx.assertEqual("meta invalide permanent", badMeta.outcome, "permanent_failure");

    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => ({
              data: null,
              error: {
                message: "slow down",
                name: "rate_limit_exceeded",
                statusCode: 429,
              },
            }),
          },
        }) as unknown as ResendClient,
    });
    __setMealSelectionReminderEmailEventTestDb(memoryDb as never);
    const rateLimited = await processMealSelectionReminderEmailEvent({
      event: buildEvent(),
      now: MONDAY_MORNING,
    });
    ctx.assertEqual("rate limit retryable", rateLimited.outcome, "retryable_failure");

    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => ({
              data: null,
              error: {
                message: "Payload mismatch",
                name: "invalid_idempotent_request",
                statusCode: 409,
              },
            }),
          },
        }) as unknown as ResendClient,
    });
    const permanent = await processMealSelectionReminderEmailEvent({
      event: buildEvent(),
      now: MONDAY_MORNING,
    });
    ctx.assertEqual(
      "invalid_idempotent_request permanent",
      permanent.outcome,
      "permanent_failure",
    );

    const retryable = classifyEmailSendFailureForEmailEvent({
      message: "concurrent",
      ok: false,
      providerErrorCode: "concurrent_idempotent_requests",
      reason: "concurrent_idempotent_requests",
    });
    ctx.assertEqual("concurrent retryable", retryable.outcome, "retryable_failure");

    __resetSendEmailTestDeps();
    __resetMealSelectionReminderEmailEventTestDb();
    __resetEmailOutboxCampaignTestDb();
  }

  ctx.scenario("E. Stamp déjà présent + backfill sent event");
  {
    const stampUpdates: Array<Record<string, unknown>> = [];
    const selection = {
      ...baseSelection(),
      mealSelectionReminderDeliveryDate: DELIVERY,
      mealSelectionReminderEmailSentAt: MONDAY_MORNING,
    };
    const memoryDb = createMemoryDb({ selection, stampUpdates });
    __setMealSelectionReminderEmailEventTestDb(memoryDb as never);
    __setEmailOutboxCampaignTestDb(memoryDb as never);

    let sendCalls = 0;
    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => {
              sendCalls += 1;
              return { data: { id: "re_should_not_send" }, error: null };
            },
          },
        }) as unknown as ResendClient,
    });

    const alreadyStamped = await processMealSelectionReminderEmailEvent({
      event: buildEvent({ providerId: "re_prior" }),
      now: MONDAY_MORNING,
    });
    ctx.assertEqual("stamp présent → sent sans send", alreadyStamped.outcome, "sent");
    ctx.assertEqual("aucun sendEmail", sendCalls, 0);

    const backfillSelection = baseSelection();
    const backfillDb = createMemoryDb({
      selection: backfillSelection,
      stampUpdates,
    });
    __setEmailOutboxCampaignTestDb(backfillDb as never);
    const backfilled = await backfillMealSelectionReminderStampFromSentEvent({
      deliveryDate: DELIVERY,
      event: buildEvent({
        sentAt: MONDAY_MORNING,
        status: EMAIL_EVENT_STATUS.SENT,
      }),
      selectionId: SELECTION_ID,
    });
    ctx.assertTrue("backfill stamp", backfilled);
    ctx.assertEqual(
      "backfill deliveryDate",
      backfillSelection.mealSelectionReminderDeliveryDate,
      DELIVERY,
    );

    __resetSendEmailTestDeps();
    __resetMealSelectionReminderEmailEventTestDb();
    __resetEmailOutboxCampaignTestDb();
  }

  ctx.scenario("F. Flag OFF + summary shape");
  {
    process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = "false";
    ctx.assertTrue(
      "flag OFF runner skip ensure",
      runnerSource.includes("if (!isMileyoTransactionalEmailEnabled())") &&
        runnerSource.includes("continue"),
    );

    __setMealSelectionReminderEmailEventTestDb(
      createMemoryDb({ selection: baseSelection() }) as never,
    );
    const disabled = await processMealSelectionReminderEmailEvent({
      event: buildEvent(),
      now: MONDAY_MORNING,
    });
    ctx.assertEqual("handler flag OFF cancelled", disabled.outcome, "cancelled");
    __resetMealSelectionReminderEmailEventTestDb();

    ctx.assertTrue(
      "summary conserve sent field",
      runnerSource.includes("sent: number"),
    );
    ctx.assertFalse(
      "runner n'incrémente plus sent depuis batch",
      /summary\.sent \+= batchResult\.succeeded/.test(runnerSource),
    );
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

  return finishSuite("66-email-outbox-meal-reminder", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
