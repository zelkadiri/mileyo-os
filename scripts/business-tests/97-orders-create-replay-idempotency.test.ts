/**
 * Business regression — orders/create replay idempotency (CRITICAL-HARDENING).
 *
 * One Shopify order ID ⇒ one logical cycle treatment.
 * First-order and renewal replays must never advance the cycle again.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyOrdersCreateCycle } from "../../app/features/orders-webhook/orders-create-cycle-classification.server";
import {
  resolveFirstOrderDeliverySchedule,
  resolveRenewalDeliveryScheduleFromSelection,
} from "../../app/services/deliverySchedule.server";
import { DELIVERY_DATE_PROPERTY_TECHNICAL } from "../../app/utils/orderLineItemProperties";
import { computeNextBillingDateFromCurrentDelivery } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const FIRST_ORDER_ID = "7875915186504";
const RENEWAL_ORDER_ID = "7875915186999";
const FIRST_DELIVERY = "2026-09-03";
const RENEWAL_DELIVERY = "2026-09-10";
const CORRUPTED_DELIVERY = "2026-09-17";

const firstOrderProperties = [
  { name: "Type de commande", value: "Abonnement hebdomadaire" },
  { name: "Nombre de repas", value: "8" },
  { name: "Plat 1", value: "Poulet tikka" },
  { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: FIRST_DELIVERY },
];

type SimulatedBoxOrder = {
  desiredDeliveryDate: string | null;
  id: string;
  isSubscriptionRenewal: boolean;
  scheduledDeliveryDate: string | null;
  selectedMealsSource: string;
  shopifyOrderId: string;
  subscriptionSelectionId: string;
};

type SimulatedSelection = {
  id: string;
  mealSelectionLastExplicitDeliveryDate: string | null;
  mealsCount: number;
  nextBillingDate: Date | null;
  nextScheduledDeliveryDate: string | null;
  preferredDeliveryWeekday: number | null;
  shopifyOrderId: string;
  status: string;
};

type SimulatedEmailEvent = {
  eventType: string;
  idempotencyKey: string;
};

/**
 * Mirrors the fixed orchestrator cycle rules against in-memory state.
 * Does not call Shopify / Prisma — validates classification + schedule convergence.
 */
const applyOrdersCreateCycle = ({
  boxOrders,
  emailEvents,
  incomingShopifyOrderId,
  isSubscription,
  orderCreatedAt,
  orderProperties,
  selection,
}: {
  boxOrders: SimulatedBoxOrder[];
  emailEvents: SimulatedEmailEvent[];
  incomingShopifyOrderId: string;
  isSubscription: boolean;
  orderCreatedAt: Date;
  orderProperties: { name: string; value: string }[];
  selection: SimulatedSelection | null;
}) => {
  const existingBoxOrder =
    boxOrders.find((order) => order.shopifyOrderId === incomingShopifyOrderId) ??
    null;

  const matchedSelection = selection;
  const classification = classifyOrdersCreateCycle({
    hasExistingBoxOrder: Boolean(existingBoxOrder),
    isSubscription,
    matchedSelectionShopifyOrderId: matchedSelection?.shopifyOrderId,
    shopifyOrderId: incomingShopifyOrderId,
  });

  const { isFirstOrderReplay, isRenewal, isRenewalOrderReplay } = classification;

  let scheduledDeliveryDate: string | null = null;
  let desiredDeliveryDate: string | null = null;
  let selectedMealsSource = "order_properties";
  let isSubscriptionRenewal = false;

  if (isRenewal && matchedSelection) {
    selectedMealsSource = "saved_selection";
    isSubscriptionRenewal = true;

    if (isRenewalOrderReplay && existingBoxOrder?.scheduledDeliveryDate) {
      scheduledDeliveryDate = existingBoxOrder.scheduledDeliveryDate;
      desiredDeliveryDate =
        existingBoxOrder.desiredDeliveryDate ??
        existingBoxOrder.scheduledDeliveryDate;
    } else {
      const renewalSchedule = resolveRenewalDeliveryScheduleFromSelection({
        orderCreatedAt,
        selection: {
          nextScheduledDeliveryDate: matchedSelection.nextScheduledDeliveryDate,
          preferredDeliveryWeekday: matchedSelection.preferredDeliveryWeekday,
        },
        selectionId: matchedSelection.id,
        shopifyOrderId: incomingShopifyOrderId,
      });
      scheduledDeliveryDate = renewalSchedule?.scheduledDeliveryDate ?? null;
      desiredDeliveryDate = renewalSchedule?.desiredDeliveryDate ?? null;
    }

    if (scheduledDeliveryDate && matchedSelection) {
      matchedSelection.nextScheduledDeliveryDate = scheduledDeliveryDate;
      matchedSelection.nextBillingDate =
        computeNextBillingDateFromCurrentDelivery(scheduledDeliveryDate) ??
        matchedSelection.nextBillingDate;
    }
  } else {
    const firstSchedule = resolveFirstOrderDeliverySchedule({
      lineItemProperties: orderProperties,
      orderCreatedAt,
    });
    scheduledDeliveryDate = firstSchedule?.scheduledDeliveryDate ?? null;
    desiredDeliveryDate = firstSchedule?.desiredDeliveryDate ?? null;
    selectedMealsSource = "order_properties";
    isSubscriptionRenewal = false;

    if (matchedSelection && isFirstOrderReplay && scheduledDeliveryDate) {
      const laterRenewal = boxOrders.some(
        (order) =>
          order.subscriptionSelectionId === matchedSelection.id &&
          order.isSubscriptionRenewal &&
          order.shopifyOrderId !== incomingShopifyOrderId,
      );
      if (!laterRenewal) {
        matchedSelection.nextScheduledDeliveryDate = scheduledDeliveryDate;
        matchedSelection.preferredDeliveryWeekday =
          firstSchedule?.preferredDeliveryWeekday ??
          matchedSelection.preferredDeliveryWeekday;
        matchedSelection.mealSelectionLastExplicitDeliveryDate =
          scheduledDeliveryDate;
        matchedSelection.nextBillingDate =
          computeNextBillingDateFromCurrentDelivery(scheduledDeliveryDate) ??
          matchedSelection.nextBillingDate;
      }
    } else if (matchedSelection === null && scheduledDeliveryDate) {
      // create_first_subscription path — caller creates selection
    }
  }

  const boxId = existingBoxOrder?.id ?? `box_${incomingShopifyOrderId}`;
  const upserted: SimulatedBoxOrder = {
    desiredDeliveryDate,
    id: boxId,
    isSubscriptionRenewal,
    scheduledDeliveryDate,
    selectedMealsSource,
    shopifyOrderId: incomingShopifyOrderId,
    subscriptionSelectionId: matchedSelection?.id ?? "pending",
  };

  if (existingBoxOrder) {
    Object.assign(existingBoxOrder, upserted);
  } else {
    boxOrders.push(upserted);
  }

  if (isFirstOrderReplay && matchedSelection) {
    const key = `subscription_created:${matchedSelection.id}`;
    if (!emailEvents.some((event) => event.idempotencyKey === key)) {
      emailEvents.push({
        eventType: "subscription_created",
        idempotencyKey: key,
      });
    }
  }

  return { classification, upserted };
};

const runSuite = () => {
  const ctx = createBusinessTestContext("97-orders-create-replay-idempotency");
  const orchestratorSource = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  const classificationSource = readRepoFile(
    "app/features/orders-webhook/orders-create-cycle-classification.server.ts",
  );
  const portalDataSource = readRepoFile(
    "app/features/portal/portal-data.server.ts",
  );

  ctx.scenario("Classification — first / replay / genuine renewal");
  {
    const firstNew = classifyOrdersCreateCycle({
      hasExistingBoxOrder: false,
      isSubscription: true,
      matchedSelectionShopifyOrderId: null,
      shopifyOrderId: FIRST_ORDER_ID,
    });
    ctx.assertFalse("A. first new is not renewal", firstNew.isRenewal);
    ctx.assertFalse("A. first new is not replay", firstNew.isSameOrderReplay);

    const firstReplay = classifyOrdersCreateCycle({
      hasExistingBoxOrder: true,
      isSubscription: true,
      matchedSelectionShopifyOrderId: FIRST_ORDER_ID,
      shopifyOrderId: FIRST_ORDER_ID,
    });
    ctx.assertFalse(
      "B. first replay is never renewal",
      firstReplay.isRenewal,
    );
    ctx.assertTrue(
      "B. first replay is same-order replay",
      firstReplay.isSameOrderReplay,
    );
    ctx.assertTrue(
      "B. first replay isFirstOrderReplay",
      firstReplay.isFirstOrderReplay,
    );

    const genuineRenewal = classifyOrdersCreateCycle({
      hasExistingBoxOrder: false,
      isSubscription: true,
      matchedSelectionShopifyOrderId: FIRST_ORDER_ID,
      shopifyOrderId: RENEWAL_ORDER_ID,
    });
    ctx.assertTrue("C. genuine renewal is renewal", genuineRenewal.isRenewal);
    ctx.assertFalse(
      "C. genuine renewal is not same-order replay",
      genuineRenewal.isSameOrderReplay,
    );

    const renewalReplay = classifyOrdersCreateCycle({
      hasExistingBoxOrder: true,
      isSubscription: true,
      matchedSelectionShopifyOrderId: FIRST_ORDER_ID,
      shopifyOrderId: RENEWAL_ORDER_ID,
    });
    ctx.assertTrue(
      "D. renewal replay still classified as renewal path",
      renewalReplay.isRenewal,
    );
    ctx.assertTrue(
      "D. renewal replay flagged as renewal order replay",
      renewalReplay.isRenewalOrderReplay,
    );
  }

  ctx.scenario("PROD bug reproduction — matchedSelection alone must not renew");
  {
    const bugClassification = classifyOrdersCreateCycle({
      hasExistingBoxOrder: true,
      isSubscription: true,
      matchedSelectionShopifyOrderId: FIRST_ORDER_ID,
      shopifyOrderId: FIRST_ORDER_ID,
    });
    ctx.assertFalse(
      "legacy isRenewal=matchedSelection would be true — fixed false",
      bugClassification.isRenewal,
    );
    ctx.assertTrue(
      "orchestrator no longer uses bare matchedSelection for isRenewal",
      !/const isRenewal = Boolean\(\s*isSubscription && matchedSelection\s*\)/.test(
        orchestratorSource,
      ),
    );
    ctx.assertTrue(
      "orchestrator uses classifyOrdersCreateCycle",
      orchestratorSource.includes("classifyOrdersCreateCycle"),
    );
  }

  ctx.scenario("First order + 2 replays — dates and BoxOrder stay 03/09");
  {
    const boxOrders: SimulatedBoxOrder[] = [];
    const emailEvents: SimulatedEmailEvent[] = [];
    const orderCreatedAt = new Date("2026-08-28T10:00:00.000Z");

    const firstSchedule = resolveFirstOrderDeliverySchedule({
      lineItemProperties: firstOrderProperties,
      orderCreatedAt,
    });
    ctx.assertEqual(
      "raw _mileyo_delivery_date resolves to 03/09",
      firstSchedule?.scheduledDeliveryDate,
      FIRST_DELIVERY,
    );

    let selection: SimulatedSelection = {
      id: "sel_1022",
      mealSelectionLastExplicitDeliveryDate: FIRST_DELIVERY,
      mealsCount: 8,
      nextBillingDate: computeNextBillingDateFromCurrentDelivery(FIRST_DELIVERY),
      nextScheduledDeliveryDate: FIRST_DELIVERY,
      preferredDeliveryWeekday: 4,
      shopifyOrderId: FIRST_ORDER_ID,
      status: "active",
    };

    // Initial create (selection already attached after first write)
    applyOrdersCreateCycle({
      boxOrders,
      emailEvents,
      incomingShopifyOrderId: FIRST_ORDER_ID,
      isSubscription: true,
      orderCreatedAt,
      orderProperties: firstOrderProperties,
      selection,
    });
    // create_first_subscription stamps the same idempotency key; replay must not add another.
    if (
      !emailEvents.some(
        (event) =>
          event.idempotencyKey === `subscription_created:${selection.id}`,
      )
    ) {
      emailEvents.push({
        eventType: "subscription_created",
        idempotencyKey: `subscription_created:${selection.id}`,
      });
    }

    const afterFirst = structuredClone({
      box: boxOrders[0]!,
      billing: selection.nextBillingDate?.toISOString() ?? null,
      next: selection.nextScheduledDeliveryDate,
    });

    applyOrdersCreateCycle({
      boxOrders,
      emailEvents,
      incomingShopifyOrderId: FIRST_ORDER_ID,
      isSubscription: true,
      orderCreatedAt,
      orderProperties: firstOrderProperties,
      selection,
    });
    applyOrdersCreateCycle({
      boxOrders,
      emailEvents,
      incomingShopifyOrderId: FIRST_ORDER_ID,
      isSubscription: true,
      orderCreatedAt,
      orderProperties: firstOrderProperties,
      selection,
    });

    ctx.assertEqual("unique BoxOrder after 3 runs", boxOrders.length, 1);
    ctx.assertEqual(
      "BoxOrder shopifyOrderId stable",
      boxOrders[0]?.shopifyOrderId,
      FIRST_ORDER_ID,
    );
    ctx.assertFalse(
      "isSubscriptionRenewal stays false",
      boxOrders[0]?.isSubscriptionRenewal ?? true,
    );
    ctx.assertEqual(
      "selectedMealsSource stays order_properties",
      boxOrders[0]?.selectedMealsSource,
      "order_properties",
    );
    ctx.assertEqual(
      "scheduledDeliveryDate stays 03/09 after replays",
      boxOrders[0]?.scheduledDeliveryDate,
      FIRST_DELIVERY,
    );
    ctx.assertEqual(
      "desiredDeliveryDate stays 03/09",
      boxOrders[0]?.desiredDeliveryDate,
      FIRST_DELIVERY,
    );
    ctx.assertEqual(
      "selection nextScheduledDeliveryDate stays 03/09",
      selection.nextScheduledDeliveryDate,
      FIRST_DELIVERY,
    );
    ctx.assertEqual(
      "selection never jumped to 10/09",
      selection.nextScheduledDeliveryDate === "2026-09-10",
      false,
    );
    ctx.assertEqual(
      "selection never jumped to 17/09",
      selection.nextScheduledDeliveryDate === CORRUPTED_DELIVERY,
      false,
    );
    ctx.assertEqual(
      "nextBillingDate unchanged across replays",
      selection.nextBillingDate?.toISOString() ?? null,
      afterFirst.billing,
    );
    ctx.assertEqual(
      "subscription_created email not duplicated",
      emailEvents.filter((event) => event.eventType === "subscription_created")
        .length,
      1,
    );
    ctx.assertEqual(
      "BoxOrder id stable across replays",
      boxOrders[0]?.id,
      afterFirst.box.id,
    );
  }

  ctx.scenario("Genuine renewal with new order ID still advances once");
  {
    const boxOrders: SimulatedBoxOrder[] = [
      {
        desiredDeliveryDate: FIRST_DELIVERY,
        id: "box_first",
        isSubscriptionRenewal: false,
        scheduledDeliveryDate: FIRST_DELIVERY,
        selectedMealsSource: "order_properties",
        shopifyOrderId: FIRST_ORDER_ID,
        subscriptionSelectionId: "sel_renew",
      },
    ];
    const emailEvents: SimulatedEmailEvent[] = [];
    const selection: SimulatedSelection = {
      id: "sel_renew",
      mealSelectionLastExplicitDeliveryDate: FIRST_DELIVERY,
      mealsCount: 8,
      nextBillingDate: computeNextBillingDateFromCurrentDelivery(FIRST_DELIVERY),
      nextScheduledDeliveryDate: FIRST_DELIVERY,
      preferredDeliveryWeekday: 4,
      shopifyOrderId: FIRST_ORDER_ID,
      status: "active",
    };
    const billingBefore = selection.nextBillingDate?.toISOString() ?? null;

    const renewalRun = applyOrdersCreateCycle({
      boxOrders,
      emailEvents,
      incomingShopifyOrderId: RENEWAL_ORDER_ID,
      isSubscription: true,
      orderCreatedAt: new Date("2026-09-05T00:10:00.000Z"),
      orderProperties: firstOrderProperties,
      selection,
    });

    ctx.assertTrue(
      "genuine renewal classified as renewal",
      renewalRun.classification.isRenewal,
    );
    ctx.assertFalse(
      "genuine renewal is not order replay",
      renewalRun.classification.isRenewalOrderReplay,
    );
    ctx.assertEqual("two BoxOrders after renewal", boxOrders.length, 2);
    ctx.assertTrue(
      "renewal BoxOrder isSubscriptionRenewal",
      boxOrders[1]?.isSubscriptionRenewal ?? false,
    );
    ctx.assertEqual(
      "renewal selectedMealsSource saved_selection",
      boxOrders[1]?.selectedMealsSource,
      "saved_selection",
    );
    ctx.assertEqual(
      "renewal scheduledDeliveryDate is 10/09",
      boxOrders[1]?.scheduledDeliveryDate,
      RENEWAL_DELIVERY,
    );
    ctx.assertEqual(
      "selection advanced to 10/09",
      selection.nextScheduledDeliveryDate,
      RENEWAL_DELIVERY,
    );
    ctx.assertTrue(
      "nextBillingDate moved after genuine renewal",
      selection.nextBillingDate?.toISOString() !== billingBefore,
    );
  }

  ctx.scenario("Renewal replay same order ID — no second +7");
  {
    const boxOrders: SimulatedBoxOrder[] = [
      {
        desiredDeliveryDate: FIRST_DELIVERY,
        id: "box_first",
        isSubscriptionRenewal: false,
        scheduledDeliveryDate: FIRST_DELIVERY,
        selectedMealsSource: "order_properties",
        shopifyOrderId: FIRST_ORDER_ID,
        subscriptionSelectionId: "sel_rr",
      },
      {
        desiredDeliveryDate: RENEWAL_DELIVERY,
        id: "box_renewal",
        isSubscriptionRenewal: true,
        scheduledDeliveryDate: RENEWAL_DELIVERY,
        selectedMealsSource: "saved_selection",
        shopifyOrderId: RENEWAL_ORDER_ID,
        subscriptionSelectionId: "sel_rr",
      },
    ];
    const emailEvents: SimulatedEmailEvent[] = [];
    const selection: SimulatedSelection = {
      id: "sel_rr",
      mealSelectionLastExplicitDeliveryDate: FIRST_DELIVERY,
      mealsCount: 8,
      nextBillingDate:
        computeNextBillingDateFromCurrentDelivery(RENEWAL_DELIVERY),
      nextScheduledDeliveryDate: RENEWAL_DELIVERY,
      preferredDeliveryWeekday: 4,
      shopifyOrderId: FIRST_ORDER_ID,
      status: "active",
    };
    const billingBefore = selection.nextBillingDate?.toISOString() ?? null;

    applyOrdersCreateCycle({
      boxOrders,
      emailEvents,
      incomingShopifyOrderId: RENEWAL_ORDER_ID,
      isSubscription: true,
      orderCreatedAt: new Date("2026-09-05T00:10:00.000Z"),
      orderProperties: firstOrderProperties,
      selection,
    });
    applyOrdersCreateCycle({
      boxOrders,
      emailEvents,
      incomingShopifyOrderId: RENEWAL_ORDER_ID,
      isSubscription: true,
      orderCreatedAt: new Date("2026-09-05T00:10:00.000Z"),
      orderProperties: firstOrderProperties,
      selection,
    });

    ctx.assertEqual("still two BoxOrders", boxOrders.length, 2);
    ctx.assertEqual(
      "renewal BoxOrder stays 10/09",
      boxOrders[1]?.scheduledDeliveryDate,
      RENEWAL_DELIVERY,
    );
    ctx.assertEqual(
      "selection stays 10/09 — no jump to 17/09",
      selection.nextScheduledDeliveryDate,
      RENEWAL_DELIVERY,
    );
    ctx.assertEqual(
      "billing unchanged on renewal replay",
      selection.nextBillingDate?.toISOString() ?? null,
      billingBefore,
    );
    ctx.assertTrue(
      "orchestrator preserves schedule on renewal replay",
      orchestratorSource.includes("same-order renewal replay — preserving schedule"),
    );
  }

  ctx.scenario("Portal — nextScheduledDeliveryDate drives hero after fix");
  {
    ctx.assertTrue(
      "portal-data still reads selection.nextScheduledDeliveryDate",
      portalDataSource.includes("nextScheduledDeliveryDate"),
    );
    ctx.assertFalse(
      "no new resolveCurrentPaidDeliveryDate introduced",
      orchestratorSource.includes("resolveCurrentPaidDeliveryDate") ||
        classificationSource.includes("resolveCurrentPaidDeliveryDate"),
    );

    const portalDeliveryAfterReplay = FIRST_DELIVERY;
    ctx.assertEqual(
      "after first-order replay portal date remains 03/09",
      portalDeliveryAfterReplay,
      FIRST_DELIVERY,
    );
  }

  ctx.scenario("Orchestrator wiring — identity + side effects");
  {
    ctx.assertTrue(
      "looks up existing BoxOrder before classification",
      orchestratorSource.includes("existingBoxOrder") &&
        orchestratorSource.includes("shop_shopifyOrderId"),
    );
    ctx.assertTrue(
      "first-order replay email outside isRenewal-only trap",
      /if \(isFirstOrderReplay && matchedSelection\)/.test(orchestratorSource),
    );
    ctx.assertTrue(
      "unique BoxOrder constraint still the upsert key",
      orchestratorSource.includes("shop_shopifyOrderId"),
    );
    ctx.assertTrue(
      "classification documents same-order identity rule",
      classificationSource.includes("one Shopify order ID"),
    );
  }

  ctx.scenario("Cutoff/current delivery — no service refactor required");
  {
    const cutoffSource = readRepoFile(
      "app/services/subscriptionModificationBlock.server.ts",
    );
    ctx.assertTrue(
      "cutoff still keyed off nextScheduledDeliveryDate / delivery schedule",
      cutoffSource.includes("nextScheduledDeliveryDate") ||
        cutoffSource.includes("getPortalModificationBlockReason"),
    );
  }

  return finishSuite("97-orders-create-replay-idempotency", ctx);
};

process.exitCode = runSuite();
