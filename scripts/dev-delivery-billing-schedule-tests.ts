/**
 * Delivery billing schedule utilities — pure unit checks (no DB, no Shopify).
 * Usage: npx tsx scripts/dev-delivery-billing-schedule-tests.ts
 */
import {
  DELIVERY_BILLING_READY_MINUTE,
  DELIVERY_TIMEZONE,
} from "../app/constants/deliverySchedule";
import {
  computeBillingReadyAtForDelivery,
  computeNextBillingDateFromCurrentDelivery,
  computeNextWeeklyDeliveryDate,
  getBillingReadyCalendarDate,
  getDeliveryCutoffCalendarDate,
  isDeliveryCutoffPassed,
  parseDeliveryDate,
  parisWallClockToInstant,
  referenceDateFromInstant,
  type DeliveryDateString,
} from "../app/utils/deliveryDate";

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

const assertDate = (name: string, actual: string, expected: string) =>
  assertEqual(name, actual, expected);

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid test fixture date: ${value}`);
  }

  return parsed;
};

const readParisWallClock = (instant: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: DELIVERY_TIMEZONE,
    year: "numeric",
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    month: read("month"),
    second: read("second"),
    year: read("year"),
  };
};

const assertParisInstant = (
  name: string,
  instant: Date | null,
  expected: {
    date: DeliveryDateString;
    hour: number;
    minute: number;
  },
) => {
  if (!instant) {
    fail(name, "expected instant, got null");
    return;
  }

  const paris = readParisWallClock(instant);
  const expectedYear = Number(expected.date.slice(0, 4));
  const expectedMonth = Number(expected.date.slice(5, 7));
  const expectedDay = Number(expected.date.slice(8, 10));

  if (
    paris.year === expectedYear &&
    paris.month === expectedMonth &&
    paris.day === expectedDay &&
    paris.hour === expected.hour &&
    paris.minute === expected.minute
  ) {
    pass(
      name,
      `${expected.date} ${String(expected.hour).padStart(2, "0")}:${String(expected.minute).padStart(2, "0")} Paris`,
    );
  } else {
    fail(
      name,
      `expected=${expected.date} ${expected.hour}:${expected.minute}, got=${paris.year}-${paris.month}-${paris.day} ${paris.hour}:${paris.minute}`,
    );
  }
};

function main() {
  const firstDelivery = requireDate("2026-07-16");
  const secondDelivery = requireDate("2026-07-23");
  const cutoffSecondDelivery = requireDate("2026-07-20");
  const billingReadyDate = requireDate("2026-07-21");

  assertDate(
    "currentDeliveryDate 2026-07-16 → nextDeliveryDate 2026-07-23",
    computeNextWeeklyDeliveryDate(firstDelivery),
    secondDelivery,
  );

  assertDate(
    "nextDeliveryDate 2026-07-23 → cutoff calendar date 2026-07-20",
    getDeliveryCutoffCalendarDate(secondDelivery),
    cutoffSecondDelivery,
  );

  const cutoffDeadline = parisWallClockToInstant({
    date: cutoffSecondDelivery,
    hour: 23,
    minute: 59,
  });
  assertEqual(
    "cutoff still open at 2026-07-20 23:59 Paris",
    isDeliveryCutoffPassed(secondDelivery, cutoffDeadline),
    false,
  );

  const billingReadyAt = computeBillingReadyAtForDelivery(secondDelivery);
  assertParisInstant("billingReadyAt for 2026-07-23 delivery", billingReadyAt, {
    date: billingReadyDate,
    hour: 0,
    minute: DELIVERY_BILLING_READY_MINUTE,
  });

  if (billingReadyAt) {
    assertEqual(
      "billingReadyAt is after cutoff for the delivery",
      isDeliveryCutoffPassed(secondDelivery, billingReadyAt),
      true,
    );
  } else {
    fail("billingReadyAt is after cutoff for the delivery", "billingReadyAt is null");
  }

  const jPlus3FirstDelivery = requireDate("2026-07-16");
  const jPlus3NextBilling = computeNextBillingDateFromCurrentDelivery(jPlus3FirstDelivery);
  assertParisInstant(
    "J+3 first delivery → next billing prepares following week",
    jPlus3NextBilling,
    {
      date: billingReadyDate,
      hour: 0,
      minute: DELIVERY_BILLING_READY_MINUTE,
    },
  );

  const jPlus10FirstDelivery = requireDate("2026-07-16");
  const jPlus10NextBilling = computeNextBillingDateFromCurrentDelivery(jPlus10FirstDelivery);
  const sellingPlanStyleBilling = parisWallClockToInstant({
    date: requireDate("2026-07-13"),
    hour: 0,
    minute: 5,
  });

  assertParisInstant(
    "J+10 first delivery → billing aligned on delivery cutoff, not payment J+7",
    jPlus10NextBilling,
    {
      date: billingReadyDate,
      hour: 0,
      minute: DELIVERY_BILLING_READY_MINUTE,
    },
  );

  if (jPlus10NextBilling) {
    assertEqual(
      "J+10 next billing is not payment-date J+7",
      jPlus10NextBilling.getTime() === sellingPlanStyleBilling.getTime(),
      false,
    );
  }

  assertDate(
    "billing ready calendar date is cutoff + 1 day",
    getBillingReadyCalendarDate(secondDelivery),
    billingReadyDate,
  );

  assertEqual(
    "Paris reference date matches billing ready calendar day",
    referenceDateFromInstant(billingReadyAt!, DELIVERY_TIMEZONE),
    billingReadyDate,
  );

  const winterDelivery = requireDate("2026-01-22");
  const winterBillingReady = computeBillingReadyAtForDelivery(winterDelivery);
  assertParisInstant("winter DST billingReadyAt stays on Paris wall clock", winterBillingReady, {
    date: requireDate("2026-01-20"),
    hour: 0,
    minute: DELIVERY_BILLING_READY_MINUTE,
  });

  assertEqual(
    "invalid delivery date → computeBillingReadyAtForDelivery null",
    computeBillingReadyAtForDelivery("2026-99-40"),
    null,
  );
  assertEqual(
    "null delivery date → computeNextBillingDateFromCurrentDelivery null",
    computeNextBillingDateFromCurrentDelivery(null),
    null,
  );

  assertEqual(
    "computeNextBillingDateFromCurrentDelivery chains weekly + billing ready",
    computeNextBillingDateFromCurrentDelivery(firstDelivery)?.toISOString(),
    computeBillingReadyAtForDelivery(secondDelivery)?.toISOString(),
  );

  const failed = checks.filter((check) => !check.ok);

  console.log("\nDelivery billing schedule — pure utility tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
