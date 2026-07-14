/**
 * Delivery date persistence — orders/create integration checks.
 * Usage: npx tsx scripts/dev-delivery-order-integration-tests.ts
 */
import { DELIVERY_RESCHEDULE_REASON } from "../app/constants/deliverySchedule";
import db from "../app/db.server";
import {
  alignFirstOrderBillingWithDeliverySchedule,
  resolveFirstOrderBillingAlignment,
  resolveFirstOrderDeliverySchedule,
  resolveRenewalDeliverySchedule,
  type FirstOrderDeliveryScheduleResolution,
  type RenewalDeliveryScheduleResolution,
} from "../app/services/deliverySchedule.server";
import type { ShopifyAdminGraphql } from "../app/services/subscriptionBillingWorker.server";
import {
  DELIVERY_DATE_PROPERTY_TECHNICAL,
  getSelectedMealsFromLineItemProperties,
} from "../app/utils/orderLineItemProperties";

type Check = { detail: string; name: string; ok: boolean };

const checks: Check[] = [];
const TEST_SHOP = "delivery-integration-test.myshopify.com";

const pass = (name: string, detail: string) => checks.push({ detail, name, ok: true });
const fail = (name: string, detail: string) => checks.push({ detail, name, ok: false });

const assertEqual = (name: string, actual: unknown, expected: unknown) => {
  if (actual === expected) {
    pass(name, `expected=${String(expected)}`);
  } else {
    fail(name, `expected=${String(expected)}, got=${String(actual)}`);
  }
};

const assertNull = (name: string, actual: unknown) => assertEqual(name, actual, null);

const buildBoxOrderDeliveryData = (
  schedule:
    | FirstOrderDeliveryScheduleResolution
    | RenewalDeliveryScheduleResolution
    | null,
) => {
  if (!schedule) {
    return {};
  }

  return {
    deliveryRescheduleReason: schedule.deliveryRescheduleReason,
    desiredDeliveryDate: schedule.desiredDeliveryDate,
    scheduledDeliveryDate: schedule.scheduledDeliveryDate,
  };
};

const sampleMealProperties = [
  { name: "Type de commande", value: "Abonnement hebdomadaire" },
  { name: "Nombre de repas", value: "8" },
  { name: "Plat 1", value: "Poulet tikka" },
  { name: "Plat 2", value: "Bœuf bourguignon" },
];

const cleanupTestRecords = async (shopifyOrderId: string) => {
  await db.boxOrder.deleteMany({
    where: { shop: TEST_SHOP, shopifyOrderId },
  });
  await db.subscriptionMealSelection.deleteMany({
    where: { shop: TEST_SHOP, shopifyOrderId },
  });
};

const persistFirstOrderDelivery = async ({
  lineItemProperties,
  orderCreatedAt,
  shopifyOrderId,
}: {
  lineItemProperties: { name: string; value: string }[];
  orderCreatedAt: Date;
  shopifyOrderId: string;
}) => {
  const schedule = resolveFirstOrderDeliverySchedule({
    lineItemProperties,
    orderCreatedAt,
  });
  const deliveryData = buildBoxOrderDeliveryData(schedule);

  const boxOrder = await db.boxOrder.upsert({
    create: {
      boxTitle: "Box 8 repas",
      mealsCount: 8,
      orderType: "Abonnement hebdomadaire",
      selectedMeals: ["Poulet tikka", "Bœuf bourguignon"],
      selectedMealsSource: "order_properties",
      shop: TEST_SHOP,
      shopifyOrderId,
      ...deliveryData,
    },
    update: {
      ...deliveryData,
    },
    where: {
      shop_shopifyOrderId: {
        shop: TEST_SHOP,
        shopifyOrderId,
      },
    },
  });

  let selection = null;

  if (schedule) {
    selection = await db.subscriptionMealSelection.upsert({
      create: {
        boxTitle: "Box 8 repas",
        mealsCount: 8,
        nextScheduledDeliveryDate: schedule.scheduledDeliveryDate,
        preferredDeliveryWeekday: schedule.preferredDeliveryWeekday,
        selectedMeals: ["Poulet tikka", "Bœuf bourguignon"],
        shop: TEST_SHOP,
        shopifyOrderId,
        status: "active",
      },
      update: {
        nextScheduledDeliveryDate: schedule.scheduledDeliveryDate,
        preferredDeliveryWeekday: schedule.preferredDeliveryWeekday,
      },
      where: {
        shop_shopifyOrderId: {
          shop: TEST_SHOP,
          shopifyOrderId,
        },
      },
    });
  } else {
    selection = await db.subscriptionMealSelection.upsert({
      create: {
        boxTitle: "Box 8 repas",
        mealsCount: 8,
        selectedMeals: ["Poulet tikka", "Bœuf bourguignon"],
        shop: TEST_SHOP,
        shopifyOrderId,
        status: "active",
      },
      update: {},
      where: {
        shop_shopifyOrderId: {
          shop: TEST_SHOP,
          shopifyOrderId,
        },
      },
    });
  }

  return { boxOrder, schedule, selection };
};

const ALIGNED_NEXT_BILLING_ISO = "2026-07-20T22:05:00.000Z";

const createBillingAlignmentMockAdmin = ({
  confirmedNextBillingDate = ALIGNED_NEXT_BILLING_ISO,
  previousNextBillingDate = "2026-07-13T00:00:00.000Z",
}: {
  confirmedNextBillingDate?: string;
  previousNextBillingDate?: string | null;
} = {}) => {
  let setBillingDateCalledWith: string | null = null;

  const admin: ShopifyAdminGraphql = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      if (query.includes("subscriptionContractSetNextBillingDate")) {
        setBillingDateCalledWith = String(options?.variables?.date ?? "");

        return {
          json: async () => ({
            data: {
              subscriptionContractSetNextBillingDate: {
                contract: { nextBillingDate: confirmedNextBillingDate },
                userErrors: [],
              },
            },
          }),
        } as Response;
      }

      if (query.includes("subscriptionContract(")) {
        return {
          json: async () => ({
            data: {
              subscriptionContract: {
                nextBillingDate: previousNextBillingDate,
              },
            },
          }),
        } as Response;
      }

      throw new Error(`Unexpected GraphQL query in billing alignment mock`);
    },
  };

  return {
    admin,
    getSetBillingDateCalledWith: () => setBillingDateCalledWith,
  };
};

const persistRenewalDelivery = async ({
  orderCreatedAt,
  preferredDeliveryWeekday,
  shopifyOrderId,
}: {
  orderCreatedAt: Date;
  preferredDeliveryWeekday: number | null;
  shopifyOrderId: string;
}) => {
  const schedule = resolveRenewalDeliverySchedule({
    orderCreatedAt,
    preferredDeliveryWeekday,
  });
  const deliveryData = buildBoxOrderDeliveryData(schedule);

  const boxOrder = await db.boxOrder.upsert({
    create: {
      boxTitle: "Box 8 repas",
      isSubscriptionRenewal: true,
      mealsCount: 8,
      orderType: "Abonnement hebdomadaire",
      selectedMeals: ["Poulet tikka", "Bœuf bourguignon"],
      selectedMealsSource: "saved_selection",
      shop: TEST_SHOP,
      shopifyOrderId,
      ...deliveryData,
    },
    update: {
      ...deliveryData,
    },
    where: {
      shop_shopifyOrderId: {
        shop: TEST_SHOP,
        shopifyOrderId,
      },
    },
  });

  const selection = await db.subscriptionMealSelection.findFirst({
    where: { shop: TEST_SHOP, shopifyOrderId: `${shopifyOrderId}_first` },
  });

  if (schedule && selection) {
    await db.subscriptionMealSelection.update({
      data: {
        nextScheduledDeliveryDate: schedule.scheduledDeliveryDate,
      },
      where: { id: selection.id },
    });
  }

  return { boxOrder, schedule, selection };
};

async function main() {
  const firstOrderId = `delivery_test_first_${Date.now()}`;
  const noDateOrderId = `delivery_test_no_date_${Date.now()}`;
  const renewalOrderId = `delivery_test_renewal_${Date.now()}`;
  const renewalSkipOrderId = `delivery_test_renewal_skip_${Date.now()}`;
  const billingAlignmentOrderId = `delivery_test_billing_align_${Date.now()}`;

  try {
    const validFirst = resolveFirstOrderDeliverySchedule({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
      ],
      orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
    });

    assertEqual(
      "1. Valid first order scheduled date",
      validFirst?.scheduledDeliveryDate,
      "2026-07-16",
    );
    assertEqual(
      "1. Valid first order desired date",
      validFirst?.desiredDeliveryDate,
      "2026-07-16",
    );

    const paymentTooLate = resolveFirstOrderDeliverySchedule({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
      ],
      orderCreatedAt: new Date("2026-07-15T12:00:00.000Z"),
    });

    assertEqual(
      "2. Payment too late reason",
      paymentTooLate?.deliveryRescheduleReason,
      DELIVERY_RESCHEDULE_REASON.PAYMENT_TOO_LATE,
    );
    assertEqual(
      "2. Payment too late scheduled date",
      paymentTooLate?.scheduledDeliveryDate,
      "2026-07-18",
    );

    assertNull(
      "3. First order without date does not throw",
      resolveFirstOrderDeliverySchedule({
        lineItemProperties: sampleMealProperties,
        orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
      }),
    );

    const persistedValid = await persistFirstOrderDelivery({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
      ],
      orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
      shopifyOrderId: firstOrderId,
    });

    assertEqual(
      "1. BoxOrder desiredDeliveryDate persisted",
      persistedValid.boxOrder.desiredDeliveryDate,
      "2026-07-16",
    );
    assertEqual(
      "1. BoxOrder scheduledDeliveryDate persisted",
      persistedValid.boxOrder.scheduledDeliveryDate,
      "2026-07-16",
    );
    assertEqual(
      "4. Selection preferredDeliveryWeekday persisted",
      persistedValid.selection?.preferredDeliveryWeekday,
      4,
    );
    assertEqual(
      "4. Selection nextScheduledDeliveryDate persisted",
      persistedValid.selection?.nextScheduledDeliveryDate,
      "2026-07-16",
    );

    assertEqual(
      "5. preferredDeliveryWeekday from scheduled date after payment too late",
      paymentTooLate?.preferredDeliveryWeekday,
      6,
    );
    assertEqual(
      "5. preferredDeliveryWeekday not from desired Thursday",
      paymentTooLate?.preferredDeliveryWeekday === 4,
      false,
    );

    const persistedNoDate = await persistFirstOrderDelivery({
      lineItemProperties: sampleMealProperties,
      orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
      shopifyOrderId: noDateOrderId,
    });

    assertNull(
      "3. BoxOrder desiredDeliveryDate stays null",
      persistedNoDate.boxOrder.desiredDeliveryDate,
    );
    assertNull(
      "3. BoxOrder scheduledDeliveryDate stays null",
      persistedNoDate.boxOrder.scheduledDeliveryDate,
    );
    assertNull(
      "3. Selection preferredDeliveryWeekday stays null",
      persistedNoDate.selection?.preferredDeliveryWeekday,
    );

    await db.subscriptionMealSelection.create({
      data: {
        boxTitle: "Box 8 repas",
        mealsCount: 8,
        nextBillingDate: new Date("2026-08-01T10:00:00.000Z"),
        preferredDeliveryWeekday: 4,
        selectedMeals: ["Poulet tikka", "Bœuf bourguignon"],
        shop: TEST_SHOP,
        shopifyOrderId: `${renewalOrderId}_first`,
        status: "active",
      },
    });

    const persistedRenewal = await persistRenewalDelivery({
      orderCreatedAt: new Date("2026-07-15T12:00:00.000Z"),
      preferredDeliveryWeekday: 4,
      shopifyOrderId: renewalOrderId,
    });

    assertEqual(
      "6. Renewal BoxOrder scheduledDeliveryDate persisted",
      persistedRenewal.boxOrder.scheduledDeliveryDate,
      "2026-07-23",
    );
    assertEqual(
      "6. Renewal selection nextScheduledDeliveryDate updated",
      (
        await db.subscriptionMealSelection.findFirst({
          where: { shop: TEST_SHOP, shopifyOrderId: `${renewalOrderId}_first` },
        })
      )?.nextScheduledDeliveryDate,
      "2026-07-23",
    );

    const persistedRenewalSkip = await persistRenewalDelivery({
      orderCreatedAt: new Date("2026-07-15T12:00:00.000Z"),
      preferredDeliveryWeekday: null,
      shopifyOrderId: renewalSkipOrderId,
    });

    assertNull(
      "7. Renewal without weekday keeps BoxOrder scheduled null",
      persistedRenewalSkip.boxOrder.scheduledDeliveryDate,
    );

    assertEqual(
      "8. selectedMealsSource first order",
      persistedValid.boxOrder.selectedMealsSource,
      "order_properties",
    );
    assertEqual(
      "8. selectedMealsSource renewal",
      persistedRenewal.boxOrder.selectedMealsSource,
      "saved_selection",
    );

    assertEqual(
      "9. Plat N parsing unchanged",
      getSelectedMealsFromLineItemProperties(sampleMealProperties).join(" | "),
      "Poulet tikka | Bœuf bourguignon",
    );

    const selectionBeforeRenewal = await db.subscriptionMealSelection.findFirst({
      where: { shop: TEST_SHOP, shopifyOrderId: `${renewalOrderId}_first` },
    });

    assertEqual(
      "10. nextBillingDate unchanged after renewal delivery update",
      selectionBeforeRenewal?.nextBillingDate?.toISOString(),
      "2026-08-01T10:00:00.000Z",
    );

    const replayed = await persistFirstOrderDelivery({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
      ],
      orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
      shopifyOrderId: firstOrderId,
    });

    assertEqual(
      "Idempotent replay keeps scheduled date",
      replayed.boxOrder.scheduledDeliveryDate,
      "2026-07-16",
    );
    assertEqual(
      "Idempotent replay keeps preferred weekday",
      replayed.selection?.preferredDeliveryWeekday,
      4,
    );

    const jPlus3Schedule = resolveFirstOrderDeliverySchedule({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
      ],
      orderCreatedAt: new Date("2026-07-13T12:00:00.000Z"),
    });
    const jPlus3Alignment = resolveFirstOrderBillingAlignment(jPlus3Schedule);

    assertEqual(
      "11. J+3 first delivery date",
      jPlus3Alignment?.firstDeliveryDate,
      "2026-07-16",
    );
    assertEqual(
      "11. J+3 aligned next billing instant",
      jPlus3Alignment?.alignedNextBillingDate.toISOString(),
      ALIGNED_NEXT_BILLING_ISO,
    );
    assertEqual(
      "11. J+3 next delivery date",
      jPlus3Alignment?.nextDeliveryDate,
      "2026-07-23",
    );

    const jPlus10Schedule = resolveFirstOrderDeliverySchedule({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
      ],
      orderCreatedAt: new Date("2026-07-06T12:00:00.000Z"),
    });
    const jPlus10Alignment = resolveFirstOrderBillingAlignment(jPlus10Schedule);

    assertEqual(
      "12. J+10 first delivery date",
      jPlus10Alignment?.firstDeliveryDate,
      "2026-07-16",
    );
    assertEqual(
      "12. J+10 aligned billing uses second delivery cutoff",
      jPlus10Alignment?.alignedNextBillingDate.toISOString(),
      ALIGNED_NEXT_BILLING_ISO,
    );
    assertEqual(
      "12. J+10 aligned billing is not checkout + 7",
      jPlus10Alignment?.alignedNextBillingDate.toISOString().startsWith("2026-07-13"),
      false,
    );

    const persistedBillingAlignment = await persistFirstOrderDelivery({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
      ],
      orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
      shopifyOrderId: billingAlignmentOrderId,
    });

    await db.subscriptionMealSelection.update({
      data: { subscriptionContractId: "gid://shopify/SubscriptionContract/12345" },
      where: { id: persistedBillingAlignment.selection!.id },
    });

    const billingMock = createBillingAlignmentMockAdmin();
    const alignedResult = await alignFirstOrderBillingWithDeliverySchedule({
      admin: billingMock.admin,
      firstDeliverySchedule: persistedBillingAlignment.schedule,
      selectionId: persistedBillingAlignment.selection!.id,
      shopifyOrderId: billingAlignmentOrderId,
      subscriptionContractId: "12345",
    });

    assertEqual("13. billing alignment status", alignedResult.status, "aligned");
    assertEqual(
      "13. setSubscriptionContractNextBillingDate called with aligned date",
      billingMock.getSetBillingDateCalledWith(),
      ALIGNED_NEXT_BILLING_ISO,
    );

    const alignedSelection = await db.subscriptionMealSelection.findUnique({
      where: { id: persistedBillingAlignment.selection!.id },
    });
    assertEqual(
      "14. selection nextBillingDate persisted after alignment",
      alignedSelection?.nextBillingDate?.toISOString(),
      ALIGNED_NEXT_BILLING_ISO,
    );
    assertEqual(
      "14. nextScheduledDeliveryDate stays first delivery",
      alignedSelection?.nextScheduledDeliveryDate,
      "2026-07-16",
    );
    assertEqual(
      "14. preferredDeliveryWeekday stays on scheduled date",
      alignedSelection?.preferredDeliveryWeekday,
      4,
    );

    const skippedNoContract = await alignFirstOrderBillingWithDeliverySchedule({
      admin: billingMock.admin,
      firstDeliverySchedule: persistedBillingAlignment.schedule,
      selectionId: persistedBillingAlignment.selection!.id,
      shopifyOrderId: billingAlignmentOrderId,
      subscriptionContractId: null,
    });
    assertEqual(
      "15. missing subscriptionContractId skips alignment",
      skippedNoContract.status,
      "skipped",
    );

    const skippedNoSchedule = await alignFirstOrderBillingWithDeliverySchedule({
      admin: billingMock.admin,
      firstDeliverySchedule: null,
      selectionId: persistedBillingAlignment.selection!.id,
      shopifyOrderId: billingAlignmentOrderId,
      subscriptionContractId: "12345",
    });
    assertEqual(
      "16. missing delivery schedule skips alignment",
      skippedNoSchedule.status,
      "skipped",
    );

    assertEqual(
      "17. selectedMealsSource unchanged after billing alignment",
      persistedBillingAlignment.boxOrder.selectedMealsSource,
      "order_properties",
    );

    const replayBillingMock = createBillingAlignmentMockAdmin();
    const replayAligned = await alignFirstOrderBillingWithDeliverySchedule({
      admin: replayBillingMock.admin,
      firstDeliverySchedule: persistedBillingAlignment.schedule,
      selectionId: persistedBillingAlignment.selection!.id,
      shopifyOrderId: billingAlignmentOrderId,
      subscriptionContractId: "12345",
    });
    assertEqual("18. replay alignment stays aligned", replayAligned.status, "aligned");
    assertEqual(
      "18. replay alignment keeps same billing instant",
      replayBillingMock.getSetBillingDateCalledWith(),
      ALIGNED_NEXT_BILLING_ISO,
    );
  } finally {
    await cleanupTestRecords(firstOrderId);
    await cleanupTestRecords(noDateOrderId);
    await cleanupTestRecords(renewalOrderId);
    await cleanupTestRecords(`${renewalOrderId}_first`);
    await cleanupTestRecords(renewalSkipOrderId);
    await cleanupTestRecords(billingAlignmentOrderId);
  }

  const failed = checks.filter((check) => !check.ok);

  console.log("\nDelivery order integration — tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
