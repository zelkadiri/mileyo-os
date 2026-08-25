/**
 * Business regression — EMAIL-6F subscription paused outbox cutover.
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
  backfillSubscriptionPausedStampFromSentEvent,
  buildSubscriptionPausedEmailEventIdempotencyKey,
  buildSubscriptionPausedEmailEventMetaJson,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  ensureSubscriptionPauseEmailEpisode,
} from "../../app/services/email/email-outbox-event-driven.server";
import {
  __resetSubscriptionPausedEmailEventTestDb,
  __setSubscriptionPausedEmailEventTestDb,
  processSubscriptionPausedEmailEvent,
  subscriptionPausedEmailEventHandler,
} from "../../app/services/email/subscription-paused-email-event-handler.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const SELECTION_ID = "sel_sp_1";
const EPISODE_ID = "cepisode_test_1";
const NOW = new Date("2026-08-25T12:00:00.000Z");

const baseSelection = () => ({
  active: false,
  customerEmail: "client@example.com",
  id: SELECTION_ID,
  shop: SHOP,
  shopifyOrderId: "order_1",
  status: "paused",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  subscriptionPauseEmailEpisodeId: EPISODE_ID as string | null,
  subscriptionPausedEmailSentAt: null as Date | null,
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
    findUnique: async ({
      select,
      where,
    }: {
      select?: Record<string, boolean>;
      where: { id: string };
    }) => {
      if (!selection || selection.id !== where.id) {
        return null;
      }
      if (select) {
        const picked: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          picked[key] = (selection as Record<string, unknown>)[key];
        }
        return picked;
      }
      return selection;
    },
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
        where.subscriptionPauseEmailEpisodeId === null &&
        selection.subscriptionPauseEmailEpisodeId !== null
      ) {
        return { count: 0 };
      }
      if (
        where.subscriptionPausedEmailSentAt === null &&
        selection.subscriptionPausedEmailSentAt !== null
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
  eventType: EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED,
  id: "evt_sp_1",
  idempotencyKey: buildSubscriptionPausedEmailEventIdempotencyKey(
    SELECTION_ID,
    EPISODE_ID,
  ),
  lastAttemptAt: NOW,
  lastErrorCode: null,
  lastErrorMessage: null,
  metaJson: buildSubscriptionPausedEmailEventMetaJson({
    cause: "user_voluntary",
    episodeId: EPISODE_ID,
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
  const ctx = createBusinessTestContext("71-email-outbox-subscription-paused");
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const subscriptionEmailSource = readRepoFile(
    "app/services/email/subscription-email.server.ts",
  );
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const migrationSource = readRepoFile(
    "prisma/migrations/20260825100000_add_subscription_pause_email_episode_id/migration.sql",
  );

  const handlePauseBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handlePauseSubscriptionAction"),
    portalActionsSource.indexOf("const handleSendPaymentUpdateEmailAction"),
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

  ctx.scenario("A. Portal + recovery cutover + schema");
  {
    ctx.assertTrue(
      "portal ensureSubscriptionPauseEmailEpisode",
      handlePauseBlock.includes("ensureSubscriptionPauseEmailEpisode"),
    );
    ctx.assertTrue(
      "portal ensureAndProcessEmailEventImmediately",
      handlePauseBlock.includes("ensureAndProcessEmailEventImmediately"),
    );
    ctx.assertTrue(
      "recovery final failure ensureSubscriptionPauseEmailEpisode",
      scheduleRecoverySource.includes("ensureSubscriptionPauseEmailEpisode"),
    );
    ctx.assertTrue(
      "recovery final failure ensureAndProcess",
      scheduleRecoverySource.includes("ensureAndProcessEmailEventImmediately"),
    );
    ctx.assertTrue(
      "schema subscriptionPauseEmailEpisodeId",
      schemaSource.includes("subscriptionPauseEmailEpisodeId"),
    );
    ctx.assertTrue(
      "migration ajoute la colonne",
      migrationSource.includes(
        'ADD COLUMN "subscriptionPauseEmailEpisodeId" TEXT',
      ),
    );
    ctx.assertFalse(
      "migration sans autre colonne",
      /ADD COLUMN (?!"subscriptionPauseEmailEpisodeId")/.test(migrationSource),
    );
    ctx.assertTrue(
      "reset clear episode id",
      subscriptionEmailSource.includes("subscriptionPauseEmailEpisodeId: null"),
    );
    ctx.assertTrue(
      "handler registered",
      EMAIL_EVENT_HANDLER_REGISTRY[EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED] ===
        subscriptionPausedEmailEventHandler,
    );
  }

  ctx.scenario("B. Key + episode ensure");
  {
    ctx.assertEqual(
      "clé subscription_paused:{selectionId}:{episodeId}",
      buildSubscriptionPausedEmailEventIdempotencyKey(SELECTION_ID, EPISODE_ID),
      `subscription_paused:${SELECTION_ID}:${EPISODE_ID}`,
    );

    const selection = {
      ...baseSelection(),
      subscriptionPauseEmailEpisodeId: null,
    };
    const memoryDb = createMemoryDb({ selection });
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);
    const episodeId = await ensureSubscriptionPauseEmailEpisode(SELECTION_ID);
    ctx.assertTrue("episode généré", Boolean(episodeId));
    ctx.assertEqual(
      "episode persisté",
      selection.subscriptionPauseEmailEpisodeId,
      episodeId,
    );
    const again = await ensureSubscriptionPauseEmailEpisode(SELECTION_ID);
    ctx.assertEqual("replay même episode", again, episodeId);
    __resetEmailOutboxEventDrivenTestDb();
  }

  ctx.scenario("C. Handler — episode mismatch → cancelled");
  {
    const memoryDb = createMemoryDb({
      selection: {
        ...baseSelection(),
        subscriptionPauseEmailEpisodeId: "other_episode",
      },
    });
    __setSubscriptionPausedEmailEventTestDb(memoryDb as never);

    const result = await processSubscriptionPausedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("episode mismatch cancelled", result.outcome, "cancelled");
    if (result.outcome === "cancelled") {
      ctx.assertEqual("reason", result.reason, "episode_mismatch");
    }

    __resetSubscriptionPausedEmailEventTestDb();
  }

  ctx.scenario("D. Handler send + stamp + already stamped");
  {
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection });
    __setSubscriptionPausedEmailEventTestDb(memoryDb as never);
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    __setSendEmailTestDeps({
      createClient: () =>
        ({
          emails: {
            send: async () => ({ data: { id: "re_sp_1" }, error: null }),
          },
        }) as unknown as ResendClient,
    });

    const sent = await processSubscriptionPausedEmailEvent({
      event: buildEvent(),
      now: NOW,
    });
    ctx.assertEqual("sent", sent.outcome, "sent");
    ctx.assertTrue(
      "stamp posé",
      selection.subscriptionPausedEmailSentAt instanceof Date,
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
    selection.subscriptionPausedEmailSentAt = NOW;
    const already = await processSubscriptionPausedEmailEvent({
      event: buildEvent({ providerId: "re_prior" }),
      now: NOW,
    });
    ctx.assertEqual("already → sent", already.outcome, "sent");
    ctx.assertEqual("aucun send", sendCalls, 0);

    __resetSendEmailTestDeps();
    __resetSubscriptionPausedEmailEventTestDb();
    __resetEmailOutboxEventDrivenTestDb();
  }

  ctx.scenario("E. Backfill respects episode");
  {
    const selection = baseSelection();
    const memoryDb = createMemoryDb({ selection });
    __setEmailOutboxEventDrivenTestDb(memoryDb as never);

    const ok = await backfillSubscriptionPausedStampFromSentEvent({
      episodeId: EPISODE_ID,
      event: buildEvent({
        sentAt: NOW,
        status: EMAIL_EVENT_STATUS.SENT,
      }),
      selectionId: SELECTION_ID,
    });
    ctx.assertTrue("backfill matching episode", ok);

    selection.subscriptionPausedEmailSentAt = null;
    const mismatch = await backfillSubscriptionPausedStampFromSentEvent({
      episodeId: "wrong",
      event: buildEvent({
        sentAt: NOW,
        status: EMAIL_EVENT_STATUS.SENT,
      }),
      selectionId: SELECTION_ID,
    });
    ctx.assertFalse("backfill episode mismatch", mismatch);

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

  return finishSuite("71-email-outbox-subscription-paused", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
