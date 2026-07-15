/**
 * Delivery billing alignment audit — pure calculation checks (no DB, no Shopify).
 * Usage: npx tsx scripts/dev-delivery-billing-alignment-audit-tests.ts
 */
import { SUBSCRIPTION_SELECTION_STATUS } from "../app/constants/subscriptionMealSelection";
import {
  areBillingDatesAligned,
  BILLING_DATE_ALIGNMENT_TOLERANCE_MS,
  computeDeliveryBillingAlignmentAudit,
  resolveProjectedActiveDeliveryDate,
  resolveRecommendedNextBillingDate,
} from "../app/services/subscriptionDeliveryBillingAlignment.server";
import { parseDeliveryDate } from "../app/utils/deliveryDate";

type Check = { detail: string; name: string; ok: boolean };

const checks: Check[] = [];

const pass = (name: string, detail: string) => checks.push({ detail, name, ok: true });
const fail = (name: string, detail: string) => checks.push({ detail, name, ok: false });

const assertEqual = (name: string, actual: unknown, expected: unknown) => {
  if (actual === expected) {
    pass(name, `expected=${String(expected)}`);
  } else {
    fail(name, `expected=${String(expected)}, got=${String(actual)}`);
  }
};

const BILLING_FOR_JULY_23 = "2026-07-20T22:05:00.000Z";
const BILLING_FOR_JULY_30 = "2026-07-27T22:05:00.000Z";

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid test fixture date: ${value}`);
  }

  return parsed;
};

const activeSelection = () => ({
  active: true,
  nextBillingDate: new Date("2026-07-13T10:00:00.000Z"),
  nextScheduledDeliveryDate: "2026-07-16" as string | null,
  preferredDeliveryWeekday: 4,
  status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

function main() {
  assertEqual(
    "1. paid active delivery bills following week",
    resolveRecommendedNextBillingDate({
      activeDeliveryDate: requireDate("2026-07-16"),
      hasBoxOrderForActiveDelivery: true,
    })?.toISOString(),
    BILLING_FOR_JULY_23,
  );

  assertEqual(
    "2. unpaid active delivery bills current delivery",
    resolveRecommendedNextBillingDate({
      activeDeliveryDate: requireDate("2026-07-23"),
      hasBoxOrderForActiveDelivery: false,
    })?.toISOString(),
    BILLING_FOR_JULY_23,
  );

  assertEqual(
    "3. J+10 paid first delivery recommends second box billing",
    resolveRecommendedNextBillingDate({
      activeDeliveryDate: requireDate("2026-07-16"),
      hasBoxOrderForActiveDelivery: true,
    })?.toISOString(),
    BILLING_FOR_JULY_23,
  );

  assertEqual(
    "4. stale stored date projects to next weekly delivery",
    resolveProjectedActiveDeliveryDate({
      nextScheduledDeliveryDate: "2026-07-16",
      now: new Date("2026-07-17T12:00:00.000Z"),
      preferredDeliveryWeekday: 4,
    }),
    "2026-07-23",
  );

  assertEqual(
    "5. weekday-only projection finds next Thursday",
    resolveProjectedActiveDeliveryDate({
      nextScheduledDeliveryDate: null,
      now: new Date("2026-07-15T12:00:00.000Z"),
      preferredDeliveryWeekday: 4,
    }),
    "2026-07-16",
  );

  const invalidAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: null,
    selection: {
      ...activeSelection(),
      nextScheduledDeliveryDate: "2026-99-99",
      preferredDeliveryWeekday: null,
    },
  });

  assertEqual(
    "6. invalid delivery data skips safely",
    invalidAudit.action,
    "skipped_missing_delivery_context",
  );

  const pausedAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: requireDate("2026-07-23"),
    selection: {
      ...activeSelection(),
      active: false,
      status: SUBSCRIPTION_SELECTION_STATUS.PAUSED,
    },
  });

  assertEqual(
    "7. paused contract skipped",
    pausedAudit.action,
    "skipped_inactive_contract",
  );

  const cancelledAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: requireDate("2026-07-23"),
    selection: {
      ...activeSelection(),
      status: SUBSCRIPTION_SELECTION_STATUS.CANCELLED,
    },
  });

  assertEqual(
    "7. cancelled contract skipped",
    cancelledAudit.action,
    "skipped_inactive_contract",
  );

  const dryRunAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: true,
    projectedActiveDeliveryDate: requireDate("2026-07-16"),
    selection: activeSelection(),
    shopifyNextBillingDate: new Date("2026-07-13T10:00:00.000Z"),
  });

  assertEqual(
    "8. dry-run candidate marks Shopify+DB update",
    dryRunAudit.action,
    "would_update_shopify_and_db",
  );
  assertEqual(
    "8. dry-run does not mutate anything by itself",
    dryRunAudit.recommendedNextBillingDate?.toISOString(),
    BILLING_FOR_JULY_23,
  );

  const alignedAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: requireDate("2026-07-30"),
    selection: {
      ...activeSelection(),
      nextBillingDate: new Date(BILLING_FOR_JULY_30),
      nextScheduledDeliveryDate: "2026-07-30",
    },
    shopifyNextBillingDate: new Date(BILLING_FOR_JULY_30),
  });

  assertEqual(
    "9. aligned DB and Shopify stay untouched",
    alignedAudit.action,
    "ok_already_aligned",
  );

  assertEqual(
    "10. billing date tolerance accepts 30 second drift",
    areBillingDatesAligned(
      new Date("2026-07-20T22:05:30.000Z"),
      new Date(BILLING_FOR_JULY_23),
      BILLING_DATE_ALIGNMENT_TOLERANCE_MS,
    ),
    true,
  );

  const failed = checks.filter((check) => !check.ok);

  console.log("\nDelivery billing alignment audit — tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
