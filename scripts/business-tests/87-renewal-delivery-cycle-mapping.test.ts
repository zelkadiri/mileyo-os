/**
 * Business regression — BOX-CHANGE-7H renewal delivery cycle mapping.
 *
 * Premature renewal must target the next unpaid cycle (billing-target),
 * not duplicate the still-upcoming first-order delivery date.
 * Admin DEV billing trigger must reuse worker skip gates.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPreparationDayDataFromBoxOrders } from "../../app/features/preparation/preparation-data.server";
import type { PreparationBoxOrderRecord } from "../../app/features/preparation/preparation-types";
import {
  resolveRenewalDeliveryScheduleFromSelection,
} from "../../app/services/deliverySchedule.server";
import {
  getSelectionSkipReason,
} from "../../app/services/subscriptionBillingWorker.server";
import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import { parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const PREMATURE_NOW = new Date("2026-08-18T11:49:37.000Z");
const NORMAL_SATURDAY_BILLING = new Date("2026-09-05T00:10:00.000Z");

const prepOrder = (
  overrides: Partial<PreparationBoxOrderRecord> & { id: string },
): PreparationBoxOrderRecord => ({
  boxTitle: "Box 10 repas",
  cancelledAt: null,
  createdAt: new Date("2026-08-18T11:00:00.000Z"),
  customerEmail: "client@example.com",
  customerName: "Client Test",
  deliveryRescheduleReason: null,
  desiredDeliveryDate: "2026-09-03",
  isSubscriptionRenewal: false,
  mealsCount: 10,
  orderType: "Abonnement hebdomadaire",
  scheduledDeliveryDate: "2026-09-03",
  selectedMeals: Array.from({ length: 10 }, (_, i) => `Meal ${i + 1}`),
  shopifyOrderName: "#1001",
  simulated: false,
  ...overrides,
});

const dueSelectionBase = () => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  resumeAttemptKey: null as string | null,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStartedAt: null as Date | null,
  resumeAttemptStatus: null as string | null,
  status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
  subscriptionContractId: "28337537164",
});

const runSuite = () => {
  const ctx = createBusinessTestContext("87-renewal-delivery-cycle-mapping");

  ctx.scenario("First → premature renewal — cycle suivant, pas duplicate");
  ctx.given("first delivery 2026-09-03 encore future; renewal le 18 août");
  const premature = resolveRenewalDeliveryScheduleFromSelection({
    orderCreatedAt: PREMATURE_NOW,
    selection: {
      nextScheduledDeliveryDate: "2026-09-03",
      preferredDeliveryWeekday: 4,
    },
    selectionId: "sel_premature",
    shopifyOrderId: "6078475075724",
  });
  ctx.when("le scheduledDeliveryDate renewal est résolu");
  ctx.assertEqual(
    "premature renewal targets 2026-09-10",
    premature?.scheduledDeliveryDate,
    "2026-09-10",
  );
  ctx.assertTrue(
    "premature renewal never reuses 2026-09-03",
    premature?.scheduledDeliveryDate !== "2026-09-03",
  );

  ctx.scenario("Renewal normal — billing-target sans double +7");
  ctx.given("livraison courante 3 sept passée; billing samedi 5 sept pour 10 sept");
  const normalAfterPast = resolveRenewalDeliveryScheduleFromSelection({
    orderCreatedAt: NORMAL_SATURDAY_BILLING,
    selection: {
      nextScheduledDeliveryDate: "2026-09-03",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertEqual(
    "normal renewal after past current cycle targets 2026-09-10",
    normalAfterPast?.scheduledDeliveryDate,
    "2026-09-10",
  );
  ctx.assertTrue(
    "normal renewal does not skip to 2026-09-17",
    normalAfterPast?.scheduledDeliveryDate !== "2026-09-17",
  );

  ctx.scenario("Selection déjà alignée sur le cycle target");
  ctx.given("nextScheduledDeliveryDate = 10 sept; après cutoff lundi (mardi 8 sept)");
  const alignedTarget = resolveRenewalDeliveryScheduleFromSelection({
    orderCreatedAt: new Date("2026-09-08T10:00:00.000Z"),
    selection: {
      nextScheduledDeliveryDate: "2026-09-10",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertEqual(
    "aligned target after cutoff keeps 2026-09-10 (no extra +7)",
    alignedTarget?.scheduledDeliveryDate,
    "2026-09-10",
  );
  ctx.assertTrue(
    "aligned target does not jump to 2026-09-17",
    alignedTarget?.scheduledDeliveryDate !== "2026-09-17",
  );

  ctx.scenario("Friday preferred weekday — même sémantique billing-target");
  ctx.given("first delivery vendredi 4 sept encore future");
  const fridayPremature = resolveRenewalDeliveryScheduleFromSelection({
    orderCreatedAt: PREMATURE_NOW,
    selection: {
      nextScheduledDeliveryDate: "2026-09-04",
      preferredDeliveryWeekday: 5,
    },
  });
  ctx.assertEqual(
    "friday premature renewal targets 2026-09-11",
    fridayPremature?.scheduledDeliveryDate,
    "2026-09-11",
  );

  ctx.scenario("Collision guard — orchestrator fail-closed");
  ctx.given("source orders-create");
  const orchestratorSource = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  ctx.assertTrue(
    "orchestrator imports findRenewalDeliveryCycleCollision",
    orchestratorSource.includes("findRenewalDeliveryCycleCollision"),
  );
  ctx.assertTrue(
    "orchestrator logs renewal_cycle_collision fail-closed",
    orchestratorSource.includes("renewal_cycle_collision fail-closed"),
  );
  ctx.assertTrue(
    "collision nulls renewalDeliverySchedule (no duplicate cycle date)",
    orchestratorSource.includes("renewalDeliverySchedule = null"),
  );

  ctx.scenario("Replay — upsert reste keyed par shopifyOrderId");
  ctx.given("contrainte unique BoxOrder inchangée");
  ctx.assertTrue(
    "boxOrder upsert where shop_shopifyOrderId",
    orchestratorSource.includes("shop_shopifyOrderId"),
  );
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const boxOrderBlock = schemaSource.slice(
    schemaSource.indexOf("model BoxOrder"),
    schemaSource.indexOf("model SubscriptionMealSelection"),
  );
  ctx.assertTrue(
    "unique (shop, shopifyOrderId) still present",
    boxOrderBlock.includes("@@unique([shop, shopifyOrderId])"),
  );

  ctx.scenario("nextScheduledDeliveryDate — écrit la date renewal résolue");
  ctx.given("branche renewal de l'orchestrator");
  ctx.assertTrue(
    "renewal writes nextScheduledDeliveryDate from schedule",
    orchestratorSource.includes("nextScheduledDeliveryDate:") &&
      orchestratorSource.includes(
        "renewalDeliverySchedule.scheduledDeliveryDate",
      ),
  );

  ctx.scenario("Preparation — first + renewal sur dates distinctes");
  ctx.given("BoxOrders corrects 3 sept + 10 sept");
  const sept3 = parseDeliveryDate("2026-09-03")!;
  const sept10 = parseDeliveryDate("2026-09-10")!;
  const meals = Array.from({ length: 10 }, (_, i) => `Plat ${i + 1}`);
  const orders: PreparationBoxOrderRecord[] = [
    prepOrder({
      id: "first",
      isSubscriptionRenewal: false,
      scheduledDeliveryDate: sept3,
      selectedMeals: meals,
      shopifyOrderName: "#1032",
    }),
    prepOrder({
      id: "renewal",
      createdAt: new Date("2026-08-18T11:49:00.000Z"),
      desiredDeliveryDate: sept10,
      isSubscriptionRenewal: true,
      scheduledDeliveryDate: sept10,
      selectedMeals: meals,
      shopifyOrderName: "#1033",
    }),
  ];
  const prepSept3 = buildPreparationDayDataFromBoxOrders(orders, sept3);
  const prepSept10 = buildPreparationDayDataFromBoxOrders(orders, sept10);
  ctx.assertEqual("prep 3 sept = first only", prepSept3.orders.length, 1);
  ctx.assertEqual(
    "prep 3 sept order name #1032",
    prepSept3.orders[0]?.orderName,
    "#1032",
  );
  ctx.assertEqual("prep 3 sept meals = 10", prepSept3.summary.totalMeals, 10);
  ctx.assertEqual("prep 10 sept = renewal only", prepSept10.orders.length, 1);
  ctx.assertEqual(
    "prep 10 sept order name #1033",
    prepSept10.orders[0]?.orderName,
    "#1033",
  );
  ctx.assertEqual("prep 10 sept meals = 10", prepSept10.summary.totalMeals, 10);

  ctx.scenario("Admin DEV billing — gate avant trigger");
  ctx.given("subscriptions-actions triggerShopifyBillingAttempt");
  const adminSource = readRepoFile(
    "app/features/subscriptions/subscriptions-actions.server.ts",
  );
  const triggerStart = adminSource.indexOf(
    'intent === "triggerShopifyBillingAttempt"',
  );
  const triggerCall = adminSource.indexOf(
    "await triggerSubscriptionBillingAttempt(",
    triggerStart,
  );
  const triggerBlock = adminSource.slice(triggerStart, triggerCall);
  ctx.assertTrue(
    "admin uses getSelectionSkipReason before billing",
    triggerBlock.includes("getSelectionSkipReason"),
  );
  ctx.assertTrue(
    "admin uses getBillingRunnerDeliveryGate",
    triggerBlock.includes("getBillingRunnerDeliveryGate"),
  );
  ctx.assertTrue(
    "admin refuses with not-ready copy",
    adminSource.includes(
      "Ce cycle n’est pas encore prêt à être facturé. Utilisez le flow de billing normal ou ajustez explicitement les données DEV.",
    ),
  );
  ctx.assertTrue(
    "admin checks active recovery before billing",
    triggerBlock.includes("subscriptionPaymentRecovery"),
  );

  ctx.scenario("Admin gate — trop tôt / recovery refusés via getSelectionSkipReason");
  ctx.given("nextBillingDate future");
  const tooEarly = getSelectionSkipReason({
    ...dueSelectionBase(),
    nextBillingDate: new Date("2026-09-04T22:05:00.000Z"),
  });
  ctx.assertEqual(
    "future nextBillingDate skips",
    tooEarly,
    "next_billing_date_in_future",
  );
  const recoverySkip = getSelectionSkipReason(
    {
      ...dueSelectionBase(),
      nextBillingDate: new Date(Date.now() - 60_000),
    },
    {
      failureCount: 1,
      nextRetryAt: new Date(Date.now() + 60_000),
      status: "retry_scheduled",
    },
  );
  ctx.assertEqual(
    "active recovery skips admin billing",
    recoverySkip,
    "payment_recovery",
  );
  const ready = getSelectionSkipReason({
    ...dueSelectionBase(),
    nextBillingDate: new Date(Date.now() - 60_000),
  });
  ctx.assertNull("due cycle allows admin billing", ready);

  ctx.scenario("First order path inchangé — pas de billing-target renewal");
  ctx.given("orchestrator first-order branch");
  ctx.assertTrue(
    "first order still uses resolveFirstOrderDeliverySchedule",
    orchestratorSource.includes("resolveFirstOrderDeliverySchedule"),
  );
  ctx.assertTrue(
    "renewal billing-target helper used only via resolveRenewalDeliveryScheduleFromSelection",
    readRepoFile("app/services/deliverySchedule.server.ts").includes(
      "resolveBillingTargetDeliveryDate",
    ),
  );

  return finishSuite("87-renewal-delivery-cycle-mapping", ctx);
};

process.exitCode = runSuite();
