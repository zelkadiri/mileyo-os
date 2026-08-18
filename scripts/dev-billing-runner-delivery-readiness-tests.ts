/**
 * Billing runner delivery readiness — pure unit checks (no DB, no Shopify).
 * Usage: npx tsx scripts/dev-billing-runner-delivery-readiness-tests.ts
 */
import { DELIVERY_TIMEZONE } from "../app/constants/deliverySchedule";
import { getBillingRunnerDeliveryGate } from "../app/services/subscriptionBillingWorker.server";
import {
  evaluateDeliveryBillingReadiness,
  parseDeliveryDate,
  shouldRealignLegacyNextBillingDate,
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

const assertNull = (name: string, actual: unknown) => assertEqual(name, actual, null);

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid test fixture date: ${value}`);
  }

  return parsed;
};

const splitDeliveryDate = (date: DeliveryDateString) => {
  const [year, month, day] = date.split("-").map(Number);

  return { day, month, year };
};

const parisWallClockToInstant = ({
  date,
  hour,
  minute,
  second = 0,
}: {
  date: DeliveryDateString;
  hour: number;
  minute: number;
  second?: number;
}) => {
  const { day, month, year } = splitDeliveryDate(date);
  const target = { day, hour, minute, month, second, year };

  const readParis = (instant: Date) => {
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

  const compare = (
    left: typeof target,
    right: typeof target,
  ) => {
    for (const key of ["year", "month", "day", "hour", "minute", "second"] as const) {
      if (left[key] !== right[key]) {
        return left[key] - right[key];
      }
    }

    return 0;
  };

  const base = Date.UTC(year, month - 1, day);
  let lo = base - 24 * 60 * 60 * 1000;
  let hi = base + 48 * 60 * 60 * 1000;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const paris = readParis(new Date(mid));

    if (compare(paris, target) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return new Date(lo);
};

const BILLING_READY_FOR_JULY_23 = "2026-07-20T22:05:00.000Z";
const LEGACY_JULY_13 = new Date("2026-07-13T10:00:00.000Z");

const baseSelection = () => ({
  nextBillingDate: LEGACY_JULY_13,
  nextScheduledDeliveryDate: "2026-07-16" as string | null,
  preferredDeliveryWeekday: 4,
});

function main() {
  const mondayJuly20Evening = parisWallClockToInstant({
    date: requireDate("2026-07-20"),
    hour: 22,
    minute: 0,
  });

  const gateBeforeCutoff = getBillingRunnerDeliveryGate({
    now: mondayJuly20Evening,
    selection: {
      ...baseSelection(),
      nextScheduledDeliveryDate: "2026-07-23",
      nextBillingDate: new Date("2026-07-20T20:00:00.000Z"),
    },
  });

  assertNull(
    "1. cron before J-2 no longer skips billing",
    gateBeforeCutoff.skipReason,
  );
  assertEqual(
    "1. delivery context still reports not ready before J-2",
    gateBeforeCutoff.readiness.isReady,
    false,
  );
  assertEqual(
    "1. cron before J-2 does not realign nextBillingDate",
    gateBeforeCutoff.shouldRealignLegacyBillingDate,
    false,
  );

  const tuesdayJuly21AfterBillingReady = parisWallClockToInstant({
    date: requireDate("2026-07-21"),
    hour: 0,
    minute: 10,
  });

  const gateAfterBillingReady = getBillingRunnerDeliveryGate({
    now: tuesdayJuly21AfterBillingReady,
    selection: {
      ...baseSelection(),
      nextScheduledDeliveryDate: "2026-07-23",
      nextBillingDate: new Date(BILLING_READY_FOR_JULY_23),
    },
  });

  assertNull("2. cron after billingReadyAt allows billing", gateAfterBillingReady.skipReason);
  assertEqual(
    "2. cron after billingReadyAt marks ready",
    gateAfterBillingReady.readiness.isReady,
    true,
  );

  const mondayJuly13 = parisWallClockToInstant({
    date: requireDate("2026-07-13"),
    hour: 12,
    minute: 0,
  });

  const legacyGate = getBillingRunnerDeliveryGate({
    now: mondayJuly13,
    selection: baseSelection(),
  });

  assertNull(
    "3. legacy Shopify J+7 is not skipped by delivery J-2",
    legacyGate.skipReason,
  );
  assertEqual(
    "3. legacy gate still exposes second weekly delivery context",
    legacyGate.readiness.billingTargetDeliveryDate,
    "2026-07-23",
  );
  assertEqual(
    "4. gate never requests legacy realignment",
    legacyGate.shouldRealignLegacyBillingDate,
    false,
  );
  assertEqual(
    "4. delivery context still reports J-2 billing instant",
    legacyGate.readiness.billingReadyAt?.toISOString(),
    BILLING_READY_FOR_JULY_23,
  );

  const weekdayOnlyReadiness = evaluateDeliveryBillingReadiness({
    nextScheduledDeliveryDate: null,
    now: mondayJuly13,
    preferredDeliveryWeekday: 4,
  });

  assertEqual(
    "5. weekday-only projection does not crash",
    weekdayOnlyReadiness.reason === "unknown_delivery",
    false,
  );
  assertEqual(
    "5. weekday-only projection finds billing target",
    weekdayOnlyReadiness.billingTargetDeliveryDate,
    "2026-07-23",
  );

  const invalidReadiness = evaluateDeliveryBillingReadiness({
    nextScheduledDeliveryDate: "2026-99-99",
    preferredDeliveryWeekday: null,
  });

  assertEqual(
    "6. invalid delivery data fails open without ready state",
    invalidReadiness.isReady,
    false,
  );
  assertEqual(
    "6. invalid delivery data returns unknown delivery",
    invalidReadiness.reason,
    "unknown_delivery",
  );

  const unknownGate = getBillingRunnerDeliveryGate({
    selection: {
      nextBillingDate: LEGACY_JULY_13,
      nextScheduledDeliveryDate: "2026-99-99",
      preferredDeliveryWeekday: null,
    },
  });

  assertNull(
    "6. billing gate does not skip unknown delivery schedule",
    unknownGate.skipReason,
  );

  assertEqual(
    "7. shouldRealignLegacyNextBillingDate true when stored date too early",
    shouldRealignLegacyNextBillingDate({
      billingReadyAt: new Date(BILLING_READY_FOR_JULY_23),
      nextBillingDate: LEGACY_JULY_13,
    }),
    true,
  );
  assertEqual(
    "7. shouldRealignLegacyNextBillingDate false when already aligned",
    shouldRealignLegacyNextBillingDate({
      billingReadyAt: new Date(BILLING_READY_FOR_JULY_23),
      nextBillingDate: new Date(BILLING_READY_FOR_JULY_23),
    }),
    false,
  );

  const failed = checks.filter((check) => !check.ok);

  console.log("\nBilling runner delivery readiness — tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
