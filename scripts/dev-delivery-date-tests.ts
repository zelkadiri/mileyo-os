/**
 * Delivery date utilities — pure unit checks (no DB, no Shopify).
 * Usage: npx tsx scripts/dev-delivery-date-tests.ts
 */
import { DELIVERY_RESCHEDULE_REASON } from "../app/constants/deliverySchedule";
import {
  addCalendarDays,
  computeRenewalDeliveryDate,
  formatDeliveryDateLabel,
  getAvailableDeliveryDates,
  getDefaultDeliveryDate,
  getDeliveryWindowBounds,
  isSunday,
  isWithinDeliveryWindow,
  parseDeliveryDate,
  referenceDateFromInstant,
  scheduleDeliveryDate,
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

function main() {
  const refFriday = requireDate("2026-07-10");
  const { earliest, latest } = getDeliveryWindowBounds(refFriday);

  assertDate("J+3 boundary", earliest, "2026-07-13");
  assertDate("J+10 boundary", latest, "2026-07-20");
  assertEqual(
    "J+3 is within delivery window",
    isWithinDeliveryWindow(earliest, refFriday),
    true,
  );
  assertEqual(
    "J+10 is within delivery window",
    isWithinDeliveryWindow(latest, refFriday),
    true,
  );

  const available = getAvailableDeliveryDates(refFriday);
  assertEqual(
    "Sunday excluded from available dates",
    available.some((date) => isSunday(date)),
    false,
  );
  assertEqual(
    "Available dates count (Fri ref, J+3..J+10, no Sunday)",
    available.length,
    7,
  );

  const refThursday = requireDate("2026-07-09");
  const defaultWhenJ3IsSunday = getDefaultDeliveryDate(refThursday);
  assertDate(
    "Default date when J+3 is Sunday skips to Monday",
    defaultWhenJ3IsSunday,
    "2026-07-13",
  );
  assertEqual(
    "Default date equals availableDates[0] when J+3 is Sunday",
    defaultWhenJ3IsSunday,
    getAvailableDeliveryDates(refThursday)[0],
  );

  const refFridayDefault = getDefaultDeliveryDate(refFriday);
  assertDate("Default date for Friday reference", refFridayDefault, "2026-07-13");
  assertEqual(
    "Default date is availableDates[0]",
    refFridayDefault,
    getAvailableDeliveryDates(refFriday)[0],
  );

  const tooClose = scheduleDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-11"),
    fromCustomerChoice: false,
    referenceDate: refFriday,
  });
  assertDate("Too close schedules to earliest valid", tooClose.scheduledDeliveryDate, "2026-07-13");
  assertEqual(
    "Too close without customer choice",
    tooClose.deliveryRescheduleReason,
    DELIVERY_RESCHEDULE_REASON.MIN_LEAD_TIME,
  );

  const tooFar = scheduleDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-25"),
    fromCustomerChoice: false,
    referenceDate: refFriday,
  });
  assertDate("Too far schedules inside window", tooFar.scheduledDeliveryDate, "2026-07-13");
  assertEqual(
    "Too far reason",
    tooFar.deliveryRescheduleReason,
    DELIVERY_RESCHEDULE_REASON.OUT_OF_WINDOW,
  );

  const paymentTooLate = scheduleDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-16"),
    fromCustomerChoice: true,
    referenceDate: requireDate("2026-07-15"),
  });
  assertDate(
    "Payment too late reschedules to next valid date",
    paymentTooLate.scheduledDeliveryDate,
    "2026-07-18",
  );
  assertEqual(
    "Payment too late reason",
    paymentTooLate.deliveryRescheduleReason,
    DELIVERY_RESCHEDULE_REASON.PAYMENT_TOO_LATE,
  );

  const sundayDesired = scheduleDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-19"),
    fromCustomerChoice: true,
    referenceDate: refFriday,
  });
  assertEqual(
    "Sunday desired reason",
    sundayDesired.deliveryRescheduleReason,
    DELIVERY_RESCHEDULE_REASON.SUNDAY_EXCLUDED,
  );
  assertDate(
    "Sunday desired reschedules to Monday",
    sundayDesired.scheduledDeliveryDate,
    "2026-07-20",
  );

  const renewal = computeRenewalDeliveryDate({
    preferredDeliveryWeekday: 4,
    referenceDate: requireDate("2026-07-15"),
  });
  assertDate("Renewal keeps Thursday anchor", renewal.scheduledDeliveryDate, "2026-07-23");
  assertEqual("Renewal has no reschedule reason when valid", renewal.deliveryRescheduleReason, null);

  const parisLateNight = referenceDateFromInstant(new Date("2026-07-12T22:00:00.000Z"));
  assertDate(
    "Paris timezone — late UTC evening maps to next calendar day",
    parisLateNight,
    "2026-07-13",
  );

  const parisBeforeMidnight = referenceDateFromInstant(
    new Date("2026-07-12T21:30:00.000Z"),
  );
  assertDate(
    "Paris timezone — before midnight stays on same calendar day",
    parisBeforeMidnight,
    "2026-07-12",
  );

  const shortLabel = formatDeliveryDateLabel(requireDate("2026-07-16"), { short: true });
  const longLabel = formatDeliveryDateLabel(requireDate("2026-07-16"));

  if (shortLabel.includes("16") && shortLabel.toLowerCase().includes("juillet")) {
    pass("Short label format", shortLabel);
  } else {
    fail("Short label format", shortLabel);
  }

  if (
    longLabel.toLowerCase().includes("jeudi") &&
    longLabel.includes("16") &&
    longLabel.toLowerCase().includes("juillet") &&
    longLabel.includes("2026")
  ) {
    pass("Long label format", longLabel);
  } else {
    fail("Long label format", longLabel);
  }

  assertEqual("parseDeliveryDate rejects invalid day", parseDeliveryDate("2026-02-30"), null);
  assertEqual("parseDeliveryDate rejects garbage", parseDeliveryDate("not-a-date"), null);
  assertEqual("parseDeliveryDate rejects empty", parseDeliveryDate(""), null);

  const deterministicA = scheduleDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-16"),
    fromCustomerChoice: true,
    referenceDate: requireDate("2026-07-15"),
  });
  const deterministicB = scheduleDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-16"),
    fromCustomerChoice: true,
    referenceDate: requireDate("2026-07-15"),
  });
  assertEqual(
    "Deterministic scheduled date",
    deterministicA.scheduledDeliveryDate,
    deterministicB.scheduledDeliveryDate,
  );
  assertEqual(
    "Deterministic reschedule reason",
    deterministicA.deliveryRescheduleReason,
    deterministicB.deliveryRescheduleReason,
  );

  const validChoice = scheduleDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-16"),
    fromCustomerChoice: true,
    referenceDate: refFriday,
  });
  assertEqual("Valid customer choice has no reschedule reason", validChoice.deliveryRescheduleReason, null);
  assertDate("Valid customer choice keeps desired date", validChoice.scheduledDeliveryDate, "2026-07-16");

  const addDays = addCalendarDays(requireDate("2026-07-10"), 3);
  assertDate("Calendar add across month boundary", addDays, "2026-07-13");

  const failed = checks.filter((check) => !check.ok);

  console.log("\nDelivery date — pure utility tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
