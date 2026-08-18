/**
 * Resume delivery schedule — pure unit checks (no DB, no Shopify).
 * Usage: npx tsx scripts/dev-resume-delivery-schedule-tests.ts
 */
import { DELIVERY_TIMEZONE } from "../app/constants/deliverySchedule";
import { calculateNextBillingDateFromPolicy } from "../app/services/subscriptionBillingWorker.server";
import { resolveResumeDeliverySchedule } from "../app/utils/deliveryDate";
import {
  parseDeliveryDate,
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

const SCHEDULE_ONLY_BILLING_FOR_JULY_23 = "2026-07-24T22:05:00.000Z";
const IMMEDIATE_BILLING_AFTER_JULY_23 = "2026-07-24T22:05:00.000Z";
const SCHEDULE_ONLY_BILLING_FOR_JULY_30 = "2026-07-24T22:05:00.000Z";
const IMMEDIATE_BILLING_AFTER_JULY_30 = "2026-07-31T22:05:00.000Z";

const baseSelection = () => ({
  nextScheduledDeliveryDate: "2026-07-16" as string | null,
  preferredDeliveryWeekday: 4,
});

function main() {
  const mondayJuly20Morning = parisWallClockToInstant({
    date: requireDate("2026-07-20"),
    hour: 10,
    minute: 0,
  });

  const scheduleOnlyBeforeCutoff = resolveResumeDeliverySchedule({
    mode: "schedule_only",
    now: mondayJuly20Morning,
    selection: baseSelection(),
  });

  assertEqual(
    "1. schedule_only before cutoff targets current week delivery",
    scheduleOnlyBeforeCutoff?.resumeTargetDeliveryDate,
    "2026-07-23",
  );
  assertEqual(
    "1. schedule_only before cutoff billing instant",
    scheduleOnlyBeforeCutoff?.alignedNextBillingDate.toISOString(),
    SCHEDULE_ONLY_BILLING_FOR_JULY_23,
  );

  const immediateBeforeCutoff = resolveResumeDeliverySchedule({
    mode: "immediate_payment",
    now: mondayJuly20Morning,
    selection: baseSelection(),
  });

  assertEqual(
    "2. immediate_payment before cutoff covers current week delivery",
    immediateBeforeCutoff?.resumeTargetDeliveryDate,
    "2026-07-23",
  );
  assertEqual(
    "2. immediate_payment before cutoff bills following week",
    immediateBeforeCutoff?.alignedNextBillingDate.toISOString(),
    IMMEDIATE_BILLING_AFTER_JULY_23,
  );

  const tuesdayJuly21 = parisWallClockToInstant({
    date: requireDate("2026-07-21"),
    hour: 12,
    minute: 0,
  });

  const scheduleOnlyAfterCutoff = resolveResumeDeliverySchedule({
    mode: "schedule_only",
    now: tuesdayJuly21,
    selection: baseSelection(),
  });

  assertEqual(
    "3. schedule_only after cutoff skips passed delivery",
    scheduleOnlyAfterCutoff?.resumeTargetDeliveryDate,
    "2026-07-30",
  );
  assertEqual(
    "3. schedule_only after cutoff billing instant",
    scheduleOnlyAfterCutoff?.alignedNextBillingDate.toISOString(),
    SCHEDULE_ONLY_BILLING_FOR_JULY_30,
  );

  const immediateAfterCutoff = resolveResumeDeliverySchedule({
    mode: "immediate_payment",
    now: tuesdayJuly21,
    selection: baseSelection(),
  });

  assertEqual(
    "4. immediate_payment after cutoff covers next week delivery",
    immediateAfterCutoff?.resumeTargetDeliveryDate,
    "2026-07-30",
  );
  assertEqual(
    "4. immediate_payment after cutoff bills week after target",
    immediateAfterCutoff?.alignedNextBillingDate.toISOString(),
    IMMEDIATE_BILLING_AFTER_JULY_30,
  );

  const legacyPolicyBilling = calculateNextBillingDateFromPolicy(tuesdayJuly21, {
    interval: "WEEK",
    intervalCount: 1,
  });

  assertEqual(
    "5. legacy paymentAt + 7 differs from delivery-aligned immediate resume",
    immediateAfterCutoff?.alignedNextBillingDate.toISOString() ===
      legacyPolicyBilling.toISOString(),
    false,
  );

  assertEqual(
    "6. resume keeps preferred weekday projection path",
    resolveResumeDeliverySchedule({
      mode: "schedule_only",
      now: mondayJuly20Morning,
      selection: {
        nextScheduledDeliveryDate: null,
        preferredDeliveryWeekday: 4,
      },
    })?.resumeTargetDeliveryDate,
    "2026-07-23",
  );

  assertNull(
    "7. invalid resume inputs fail open",
    resolveResumeDeliverySchedule({
      mode: "schedule_only",
      selection: {
        nextScheduledDeliveryDate: "2026-99-99",
        preferredDeliveryWeekday: null,
      },
    }),
  );

  assertEqual(
    "8. next delivery after resume is weekly",
    scheduleOnlyBeforeCutoff?.nextDeliveryAfterResume,
    "2026-07-30",
  );

  const failed = checks.filter((check) => !check.ok);

  console.log("\nResume delivery schedule — tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
