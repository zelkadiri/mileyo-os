/**
 * Business regression — DEV recovery retry trigger (13L-A).
 *
 * Covers simulated now + selectionId filtering and the DEV admin action
 * guard. Does not call Shopify, cron, or mutate recoveries.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../../app/constants/deliverySchedule";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  MAX_RECOVERY_FAILURES,
  RECOVERY_STATUS,
} from "../../app/constants/subscriptionPaymentRecovery";
import {
  isRecoveryDevRetryEnabled,
  isSubscriptionTestActionsEnabled,
} from "../../app/features/subscriptions/subscriptions-test.server";
import {
  buildDueRecoveryRetriesWhere,
  isRecoveryDueForNewAttempt,
  resolveRecoveryWorkerNow,
} from "../../app/services/subscriptionPaymentRecovery.server";
import {
  parseDeliveryDate,
  parisWallClockToInstant,
  type DeliveryDateString,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));

const recoverySource = readFileSync(
  join(__dirname, "../../app/services/subscriptionPaymentRecovery.server.ts"),
  "utf8",
);
const actionsSource = readFileSync(
  join(
    __dirname,
    "../../app/features/subscriptions/subscriptions-actions.server.ts",
  ),
  "utf8",
);
const renderSource = readFileSync(
  join(__dirname, "../../app/features/subscriptions/subscriptions-render.tsx"),
  "utf8",
);
const workerSource = readFileSync(
  join(__dirname, "../../app/services/subscriptionBillingWorker.server.ts"),
  "utf8",
);

const processDueRecoverySource = recoverySource.slice(
  recoverySource.indexOf("export const processDueRecoveryRetries"),
);
const scheduleRecoverySource = recoverySource.slice(
  recoverySource.indexOf("const scheduleRecoveryAfterFailure"),
  recoverySource.indexOf("export type ProcessBillingAttemptFailureResult"),
);
const triggerRecoveryRetrySource = actionsSource.slice(
  actionsSource.indexOf('if (intent === "triggerRecoveryRetry")'),
  actionsSource.indexOf('if (intent !== "simulateNextSubscriptionOrder")'),
);
const processDueBillingsSource = workerSource.slice(
  workerSource.indexOf("export const processDueSubscriptionBillings"),
);

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid fixture date: ${value}`);
  }

  return parsed;
};

const cycleSlot = (date: DeliveryDateString) =>
  parisWallClockToInstant({
    date,
    hour: DELIVERY_BILLING_READY_HOUR,
    minute: DELIVERY_BILLING_READY_MINUTE,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });

type RecoveryFixture = {
  failureCount: number;
  nextRetryAt: Date | null;
  shop: string;
  status: string;
  subscriptionMealSelectionId: string;
};

const matchesDueWhere = (
  recovery: RecoveryFixture,
  where: ReturnType<typeof buildDueRecoveryRetriesWhere>,
) => {
  if (recovery.shop !== where.shop) {
    return false;
  }

  if (
    where.subscriptionMealSelectionId &&
    recovery.subscriptionMealSelectionId !== where.subscriptionMealSelectionId
  ) {
    return false;
  }

  const processingBranch = where.OR[0];
  const dueBranch = where.OR[1];

  if (recovery.status === processingBranch.status) {
    return true;
  }

  const dueRetryAt =
    dueBranch && "nextRetryAt" in dueBranch
      ? dueBranch.nextRetryAt?.lte
      : undefined;
  const dueStatuses =
    dueBranch && "status" in dueBranch && typeof dueBranch.status !== "string"
      ? dueBranch.status.in
      : [];

  if (!dueRetryAt) {
    return false;
  }

  return (
    recovery.failureCount < MAX_RECOVERY_FAILURES &&
    recovery.nextRetryAt !== null &&
    recovery.nextRetryAt.getTime() <= dueRetryAt.getTime() &&
    dueStatuses.includes(
      recovery.status as (typeof dueStatuses)[number],
    )
  );
};

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "36-subscription-recovery-dev-retry-trigger",
  );
  const shop = "mileyo-ok1bszwz.myshopify.com";
  const targetSelectionId = "sel_contract_28400681100";
  const otherSelectionId = "sel_other_shop_recovery";
  const fridayAugust21 = cycleSlot(requireDate("2026-08-21"));
  const sundayAugust23 = cycleSlot(requireDate("2026-08-23"));
  const targetRecovery: RecoveryFixture = {
    failureCount: 1,
    nextRetryAt: sundayAugust23,
    shop,
    status: RECOVERY_STATUS.RETRY_SCHEDULED,
    subscriptionMealSelectionId: targetSelectionId,
  };
  const otherRecovery: RecoveryFixture = {
    failureCount: 1,
    nextRetryAt: sundayAugust23,
    shop,
    status: RECOVERY_STATUS.RETRY_SCHEDULED,
    subscriptionMealSelectionId: otherSelectionId,
  };

  ctx.scenario("A — options absentes, comportement worker inchangé");
  ctx.given("aucun options.now / selectionId");
  const defaultNow = resolveRecoveryWorkerNow();
  const shopWideWhere = buildDueRecoveryRetriesWhere({
    now: defaultNow,
    shop,
  });
  ctx.assertTrue(
    "default now is a Date",
    defaultNow instanceof Date && !Number.isNaN(defaultNow.getTime()),
  );
  ctx.assertTrue(
    "shop-wide where has no selectionId filter",
    shopWideWhere.subscriptionMealSelectionId === undefined,
  );
  ctx.assertTrue(
    "cron still calls recovery worker with two args only",
    processDueBillingsSource.includes(
      "processDueRecoveryRetries(shop, admin)",
    ) &&
      !processDueBillingsSource.includes(
        "processDueRecoveryRetries(shop, admin, {",
      ),
  );
  ctx.assertTrue(
    "worker defaults now via resolveRecoveryWorkerNow(options)",
    processDueRecoverySource.includes("resolveRecoveryWorkerNow(options)"),
  );

  ctx.scenario("B — now simulé, recovery future considéré due");
  ctx.given("nextRetryAt dimanche 23 août 00:05, now simulé au même instant");
  ctx.assertFalse(
    "Friday 00:05 does not open the Sunday retry window",
    isRecoveryDueForNewAttempt(targetRecovery, fridayAugust21),
  );
  ctx.assertTrue(
    "Sunday 00:05 opens the retry window",
    isRecoveryDueForNewAttempt(targetRecovery, sundayAugust23),
  );
  ctx.assertFalse(
    "query with real Friday now does not select Sunday recovery",
    matchesDueWhere(
      targetRecovery,
      buildDueRecoveryRetriesWhere({ now: fridayAugust21, shop }),
    ),
  );
  ctx.assertTrue(
    "query with simulated Sunday now selects the Sunday recovery",
    matchesDueWhere(
      targetRecovery,
      buildDueRecoveryRetriesWhere({ now: sundayAugust23, shop }),
    ),
  );

  ctx.scenario("C — selectionId, seul le recovery ciblé est sélectionné");
  ctx.given("filtre selectionId du contrat 28400681100");
  const targetedWhere = buildDueRecoveryRetriesWhere({
    now: sundayAugust23,
    selectionId: targetSelectionId,
    shop,
  });
  ctx.assertEqual(
    "where pins subscriptionMealSelectionId",
    targetedWhere.subscriptionMealSelectionId,
    targetSelectionId,
  );
  ctx.assertTrue(
    "targeted query matches the selected recovery",
    matchesDueWhere(targetRecovery, targetedWhere),
  );

  ctx.scenario("D — autre recovery du shop non traité");
  ctx.given("un second recovery dû le même dimanche sur une autre sélection");
  ctx.assertFalse(
    "other shop recovery is excluded by selectionId",
    matchesDueWhere(otherRecovery, targetedWhere),
  );
  ctx.assertTrue(
    "other shop recovery would still match a shop-wide Sunday query",
    matchesDueWhere(
      otherRecovery,
      buildDueRecoveryRetriesWhere({ now: sundayAugust23, shop }),
    ),
  );

  ctx.scenario("E — garde NODE_ENV stricte, indépendante du flag billing test");
  ctx.given("intent triggerRecoveryRetry");
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBillingFlag = process.env.ENABLE_SHOPIFY_BILLING_TEST_BUTTON;
  ctx.assertTrue(
    "DEV intent is gated by isRecoveryDevRetryEnabled, not billing test flags",
    triggerRecoveryRetrySource.includes("isRecoveryDevRetryEnabled()") &&
      !triggerRecoveryRetrySource.includes("isSubscriptionTestActionsEnabled()"),
  );
  ctx.assertTrue(
    "disabled recovery DEV redirects with production message",
    triggerRecoveryRetrySource.includes(
      "Déclenchement recovery DEV désactivé en production.",
    ),
  );

  try {
    process.env.NODE_ENV = "development";
    delete process.env.ENABLE_SHOPIFY_BILLING_TEST_BUTTON;
    ctx.assertTrue(
      "NODE_ENV=development authorizes recovery DEV retry",
      isRecoveryDevRetryEnabled(),
    );

    process.env.NODE_ENV = "production";
    ctx.assertFalse(
      "NODE_ENV=production refuses recovery DEV retry",
      isRecoveryDevRetryEnabled(),
    );

    process.env.ENABLE_SHOPIFY_BILLING_TEST_BUTTON = "true";
    ctx.assertFalse(
      "production + ENABLE_SHOPIFY_BILLING_TEST_BUTTON still refuses recovery DEV retry",
      isRecoveryDevRetryEnabled(),
    );
    ctx.assertTrue(
      "historical billing test buttons remain enabled by the existing flag in production",
      isSubscriptionTestActionsEnabled(),
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousBillingFlag === undefined) {
      delete process.env.ENABLE_SHOPIFY_BILLING_TEST_BUTTON;
    } else {
      process.env.ENABLE_SHOPIFY_BILLING_TEST_BUTTON = previousBillingFlag;
    }
  }

  ctx.assertTrue(
    "UI recovery DEV is gated by showRecoveryDevRetry, not billing test actions",
    renderSource.includes("showRecoveryDevRetry") &&
      /showRecoveryDevRetry &&\s*recovery\.status !== "final_failed"/.test(
        renderSource,
      ),
  );
  ctx.assertFalse(
    "recovery DEV form is not gated by showSubscriptionTestActions",
    /showSubscriptionTestActions &&\s*recovery\.status !== "final_failed"/.test(
      renderSource,
    ),
  );
  ctx.assertTrue(
    "historical test buttons stay on showSubscriptionTestActions",
    renderSource.includes("showSubscriptionTestActions ? ("),
  );
  ctx.assertTrue(
    "isRecoveryDevRetryEnabled ignores ENABLE_SHOPIFY_BILLING_TEST_BUTTON",
    isRecoveryDevRetryEnabled.toString().includes("production") &&
      !isRecoveryDevRetryEnabled
        .toString()
        .includes("ENABLE_SHOPIFY_BILLING_TEST_BUTTON"),
  );
  ctx.assertTrue(
    "historical test-actions helper still uses NODE_ENV plus existing env override",
    isSubscriptionTestActionsEnabled.toString().includes("production") &&
      isSubscriptionTestActionsEnabled
        .toString()
        .includes("ENABLE_SHOPIFY_BILLING_TEST_BUTTON"),
  );

  ctx.scenario("F — action DEV appelle uniquement le worker recovery");
  ctx.when("l’intent triggerRecoveryRetry est exécuté");
  ctx.assertTrue(
    "action calls processDueRecoveryRetries with now + selectionId",
    triggerRecoveryRetrySource.includes("processDueRecoveryRetries(shop, admin, {") &&
      triggerRecoveryRetrySource.includes("now: simulatedNow") &&
      triggerRecoveryRetrySource.includes("selectionId"),
  );
  ctx.assertFalse(
    "action does not call processDueSubscriptionBillings",
    triggerRecoveryRetrySource.includes("processDueSubscriptionBillings"),
  );
  ctx.assertFalse(
    "action does not call triggerSubscriptionBillingAttempt",
    triggerRecoveryRetrySource.includes("triggerSubscriptionBillingAttempt"),
  );
  ctx.assertFalse(
    "action does not mint an admin idempotency key",
    triggerRecoveryRetrySource.includes("mileyo_admin_"),
  );
  ctx.assertTrue(
    "UI exposes the DEV recovery retry button",
    renderSource.includes("Déclencher retry recovery DEV") &&
      renderSource.includes('value="triggerRecoveryRetry"'),
  );

  ctx.scenario("G — now non injecté dans scheduleRecoveryAfterFailure");
  ctx.given("échec persisté après retry");
  ctx.assertTrue(
    "scheduleRecoveryAfterFailure still uses real new Date()",
    scheduleRecoverySource.includes("const now = new Date()"),
  );
  ctx.assertFalse(
    "scheduleRecoveryAfterFailure does not read options.now",
    scheduleRecoverySource.includes("options?.now") ||
      scheduleRecoverySource.includes("resolveRecoveryWorkerNow"),
  );
  ctx.assertFalse(
    "processDueRecoveryRetries does not pass now into scheduleRecoveryAfterFailure",
    /scheduleRecoveryAfterFailure\(\{[\s\S]*now:/.test(processDueRecoverySource),
  );

  return finishSuite("36-subscription-recovery-dev-retry-trigger", ctx);
};

process.exitCode = runSuite();
