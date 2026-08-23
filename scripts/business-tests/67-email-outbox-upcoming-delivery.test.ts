/**
 * Business regression — EMAIL-6E upcoming delivery outbox migration.
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
  UPCOMING_DELIVERY_EMAIL_WINDOW_START_HOUR,
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
  ensureEmailEvent,
  type EmailEventDb,
  type EnsureEmailEventInput,
} from "../../app/services/email/email-event.server";
import {
  __resetEmailOutboxCampaignTestDb,
  __setEmailOutboxCampaignTestDb,
  backfillUpcomingDeliveryStampFromSentEvent,
  buildCampaignEmailEventMetaJson,
  buildUpcomingDeliveryEmailEventIdempotencyKey,
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
} from "../../app/services/email/email-outbox-campaign.server";
import {
  __resetUpcomingDeliveryEmailEventTestDb,
  __setUpcomingDeliveryEmailEventTestDb,
  processUpcomingDeliveryEmailEvent,
  upcomingDeliveryEmailEventHandler,
} from "../../app/services/email/upcoming-delivery-email-event-handler.server";
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
const SELECTION_ID = "sel_upcoming_outbox_1";
const DELIVERY = "2026-08-27";
const J_MINUS_2 = parisWallClockToInstant({
  date: parseDeliveryDate("2026-08-25")!,
  hour: UPCOMING_DELIVERY_EMAIL_WINDOW_START_HOUR,
  minute: 0,
  timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
});
const DELIVERY_DAY = parisWallClockToInstant({
  date: parseDeliveryDate(DELIVERY)!,
  hour: 9,
  minute: 0,
  timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
});

const baseSelection = () => ({
  active: true,
  customerEmail: "client@example.com",
  id: SELECTION_ID,
  lastBillingAttemptAt: null,
  lastBillingAttemptStatus: null,
  mealsCount: 8,
  nextScheduledDeliveryDate: DELIVERY,
  preferredDeliveryWeekday: 4,
  resumeAttemptOrderId: null,
  resumeAttemptStatus: null,
  selectedMeals: ["A", "A", "B", "B", "C", "C", "D", "D"],
  shop: SHOP,
  shopifyOrderId: "order_1",
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  upcomingDeliveryEmailDeliveryDate: null as string | null,
  upcomingDeliveryEmailSentAt: null as Date | null,
});

const matchingBoxOrder = () => ({
  scheduledDeliveryDate: DELIVERY,
  simulated: false,
  subscriptionSelectionId: SELECTION_ID,
});

const createMemoryDb = ({
  boxOrderProof = matchingBoxOrder(),
  selection = baseSelection(),
}: {
  boxOrderProof?: ReturnType<typeof matchingBoxOrder> | null;
  selection?: ReturnType<typeof baseSelection> | null;
} = {}) => ({
  boxOrder: {
    findFirst: async () => boxOrderProof,
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
    findMany: async () => [],
  },
});

const buildEvent = (overrides: Partial<EmailEvent> = {}): EmailEvent => ({
  attemptCount: 1,
  cancelledAt: null,
  createdAt: J_MINUS_2,
  eventType: EMAIL_EVENT_TYPE.UPCOMING_DELIVERY,
  id: "evt_upcoming_1",
  idempotencyKey: buildUpcomingDeliveryEmailEventIdempotencyKey(
    SELECTION_ID,
    DELIVERY,
  ),
  lastAttemptAt: J_MINUS_2,
  lastErrorCode: null,
  lastErrorMessage: null,
  metaJson: buildCampaignEmailEventMetaJson(DELIVERY),
  nextAttemptAt: null,
  processingStartedAt: J_MINUS_2,
  providerId: null,
  recipientEmail: "client@example.com",
  referenceId: SELECTION_ID,
  referenceType: EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  sentAt: null,
  shop: SHOP,
  status: EMAIL_EVENT_STATUS.PROCESSING,
  updatedAt: J_MINUS_2,
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
  const ctx = createBusinessTestContext("67-email-outbox-upcoming-delivery");
  const runnerSource = readRepoFile(
    "app/services/email/upcoming-delivery-runner.server.ts",
  );
  const previousFlag = process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];
  const previousApiKey = process.env[RESEND_API_KEY_ENV];
  const previousEmailFrom = process.env[EMAIL_FROM_ENV];
  process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = "true";
  process.env[RESEND_API_KEY_ENV] = "re_test_key_not_used";
  process.env[EMAIL_FROM_ENV] = "Mileyo <hello@mileyo.test>";

  ctx.scenario("A. Runner cutover + registry");
  {
    const key = buildUpcomingDeliveryEmailEventIdempotencyKey(
      SELECTION_ID,
      DELIVERY,
    );
    ctx.assertEqual(
      "clé exacte",
      key,
      `upcoming_delivery:${SELECTION_ID}:${DELIVERY}`,
    );
    ctx.assertFalse(
      "runner sans trySendUpcomingDeliveryEmail",
      runnerSource.includes("trySendUpcomingDeliveryEmail"),
    );
    ctx.assertFalse("runner sans sendEmail", /sendEmail/.test(runnerSource));
    ctx.assertTrue("runner ensureEmailEvent", runnerSource.includes("ensureEmailEvent({"));
    ctx.assertTrue(
      "classify no_box_order avant ensure",
      runnerSource.includes('"no_box_order"'),
    );
    ctx.assertTrue(
      "handler registered",
      EMAIL_EVENT_HANDLER_REGISTRY[EMAIL_EVENT_TYPE.UPCOMING_DELIVERY] ===
        upcomingDeliveryEmailEventHandler,
    );
  }

  ctx.scenario("B. ensure contract + same delivery same key");
  {
    const client = createEmailEventStore();
    const input: EnsureEmailEventInput = {
      eventType: EMAIL_EVENT_TYPE.UPCOMING_DELIVERY,
      idempotencyKey: buildUpcomingDeliveryEmailEventIdempotencyKey(
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
    ctx.assertTrue("created", first.created);
    ctx.assertFalse("existing", second.created);
    ctx.assertEqual("same id", second.event.id, first.event.id);
  }

  ctx.scenario("C. Handler success + stamp + idempotencyKey");
  {
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection });
    __setUpcomingDeliveryEmailEventTestDb(memoryDb as never);
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
              return { data: { id: "re_upcoming_1" }, error: null };
            },
          },
        }) as unknown as ResendClient,
    });

    const result = await processUpcomingDeliveryEmailEvent({
      event: buildEvent(),
      now: J_MINUS_2,
    });

    ctx.assertEqual("sent", result.outcome, "sent");
    if (result.outcome === "sent") {
      ctx.assertEqual("providerId", result.providerId, "re_upcoming_1");
    }
    ctx.assertEqual(
      "idempotencyKey",
      calls[0]?.options?.idempotencyKey,
      buildEvent().idempotencyKey,
    );
    ctx.assertEqual(
      "stamp deliveryDate",
      selection.upcomingDeliveryEmailDeliveryDate,
      DELIVERY,
    );

    __resetSendEmailTestDeps();
    __resetUpcomingDeliveryEmailEventTestDb();
    __resetEmailOutboxCampaignTestDb();
  }

  ctx.scenario("D. Handler cancelled paths");
  {
    __setUpcomingDeliveryEmailEventTestDb(
      createMemoryDb({ boxOrderProof: null, selection: baseSelection() }) as never,
    );
    const noBox = await processUpcomingDeliveryEmailEvent({
      event: buildEvent(),
      now: J_MINUS_2,
    });
    ctx.assertEqual("BoxOrder absente cancelled", noBox.outcome, "cancelled");

    __setUpcomingDeliveryEmailEventTestDb(
      createMemoryDb({
        boxOrderProof: {
          scheduledDeliveryDate: DELIVERY,
          simulated: true,
          subscriptionSelectionId: SELECTION_ID,
        },
        selection: baseSelection(),
      }) as never,
    );
    const simulated = await processUpcomingDeliveryEmailEvent({
      event: buildEvent(),
      now: J_MINUS_2,
    });
    ctx.assertEqual("simulated cancelled", simulated.outcome, "cancelled");

    __setUpcomingDeliveryEmailEventTestDb(
      createMemoryDb({ selection: baseSelection() }) as never,
    );
    const dayJ = await processUpcomingDeliveryEmailEvent({
      event: buildEvent(),
      now: DELIVERY_DAY,
    });
    ctx.assertEqual("jour J cancelled", dayJ.outcome, "cancelled");

    __setUpcomingDeliveryEmailEventTestDb(
      createMemoryDb({
        selection: { ...baseSelection(), mealsCount: 0, selectedMeals: [] },
      }) as never,
    );
    const noMeals = await processUpcomingDeliveryEmailEvent({
      event: buildEvent(),
      now: J_MINUS_2,
    });
    ctx.assertEqual("no meals cancelled", noMeals.outcome, "cancelled");

    __resetUpcomingDeliveryEmailEventTestDb();
  }

  ctx.scenario("E. Transport mapping + failed send no stamp");
  {
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection });
    __setUpcomingDeliveryEmailEventTestDb(memoryDb as never);
    __setEmailOutboxCampaignTestDb(memoryDb as never);

    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => ({
              data: null,
              error: {
                message: "validation",
                name: "validation_error",
                statusCode: 422,
              },
            }),
          },
        }) as unknown as ResendClient,
    });
    const validation = await processUpcomingDeliveryEmailEvent({
      event: buildEvent(),
      now: J_MINUS_2,
    });
    ctx.assertEqual("validation permanent", validation.outcome, "permanent_failure");
    ctx.assertNull("pas de stamp", selection.upcomingDeliveryEmailDeliveryDate);

    const retryable = classifyEmailSendFailureForEmailEvent({
      message: "busy",
      ok: false,
      reason: "send_error",
    });
    ctx.assertEqual("send_error retryable", retryable.outcome, "retryable_failure");

    __resetSendEmailTestDeps();
    __resetUpcomingDeliveryEmailEventTestDb();
    __resetEmailOutboxCampaignTestDb();
  }

  ctx.scenario("F. Stamp présent + backfill + summary");
  {
    const selection = {
      ...baseSelection(),
      upcomingDeliveryEmailDeliveryDate: DELIVERY,
      upcomingDeliveryEmailSentAt: J_MINUS_2,
    };
    __setUpcomingDeliveryEmailEventTestDb(
      createMemoryDb({ selection }) as never,
    );

    let sendCalls = 0;
    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => {
              sendCalls += 1;
              return { data: { id: "re_skip" }, error: null };
            },
          },
        }) as unknown as ResendClient,
    });
    const already = await processUpcomingDeliveryEmailEvent({
      event: buildEvent({ providerId: "re_old" }),
      now: J_MINUS_2,
    });
    ctx.assertEqual("stamp déjà présent sent", already.outcome, "sent");
    ctx.assertEqual("pas double send", sendCalls, 0);

    const backfillSelection = baseSelection();
    __setEmailOutboxCampaignTestDb(
      createMemoryDb({ selection: backfillSelection }) as never,
    );
    const backfilled = await backfillUpcomingDeliveryStampFromSentEvent({
      deliveryDate: DELIVERY,
      event: buildEvent({
        sentAt: J_MINUS_2,
        status: EMAIL_EVENT_STATUS.SENT,
      }),
      selectionId: SELECTION_ID,
    });
    ctx.assertTrue("backfill", backfilled);
    ctx.assertEqual(
      "backfill deliveryDate",
      backfillSelection.upcomingDeliveryEmailDeliveryDate,
      DELIVERY,
    );

    ctx.assertTrue(
      "summary enqueuedCreated",
      runnerSource.includes("enqueuedCreated"),
    );
    ctx.assertFalse(
      "runner sent reste 0",
      /summary\.sent \+= batchResult\.succeeded/.test(runnerSource),
    );

    __resetSendEmailTestDeps();
    __resetUpcomingDeliveryEmailEventTestDb();
    __resetEmailOutboxCampaignTestDb();
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

  return finishSuite("67-email-outbox-upcoming-delivery", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
