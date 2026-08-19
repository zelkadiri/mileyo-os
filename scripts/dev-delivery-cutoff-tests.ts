/**
 * Delivery cutoff utilities — pure unit checks (no DB, no Shopify).
 * Usage: npx tsx scripts/dev-delivery-cutoff-tests.ts
 */
import { DELIVERY_TIMEZONE } from "../app/constants/deliverySchedule";
import {
  formatDeliveryCutoffDeadlineLabel,
  getDeliveryCutoffCalendarDate,
  getDeliveryCutoffStatus,
  getMealSelectionCutoffCalendarDate,
  isDeliveryCutoffPassed,
  parseDeliveryDate,
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

function main() {
  const deliveryThursday = requireDate("2026-07-16");
  const cutoffMonday = requireDate("2026-07-13");

  assertDate(
    "Thursday delivery maps to Monday cutoff date",
    getDeliveryCutoffCalendarDate(deliveryThursday),
    cutoffMonday,
  );

  const sundayDelivery = requireDate("2026-07-19");
  assertDate(
    "Sunday delivery still uses calendar J-3 cutoff",
    getDeliveryCutoffCalendarDate(sundayDelivery),
    requireDate("2026-07-16"),
  );

  const monday20Paris = parisWallClockToInstant({
    date: cutoffMonday,
    hour: 20,
    minute: 0,
  });
  assertEqual(
    "Monday 20:00 Paris is before cutoff",
    isDeliveryCutoffPassed(deliveryThursday, monday20Paris),
    false,
  );
  assertEqual(
    "Monday 20:00 Paris status is open",
    getDeliveryCutoffStatus(deliveryThursday, monday20Paris).isPassed,
    false,
  );

  const monday2359Paris = parisWallClockToInstant({
    date: cutoffMonday,
    hour: 23,
    minute: 59,
  });
  assertEqual(
    "Monday 23:59 Paris is still before cutoff",
    isDeliveryCutoffPassed(deliveryThursday, monday2359Paris),
    false,
  );
  assertEqual(
    "Monday 23:59 Paris status is open",
    getDeliveryCutoffStatus(deliveryThursday, monday2359Paris).isPassed,
    false,
  );

  const tuesdayMidnightParis = parisWallClockToInstant({
    date: requireDate("2026-07-14"),
    hour: 0,
    minute: 0,
  });
  assertEqual(
    "Tuesday 00:00 Paris is after cutoff",
    isDeliveryCutoffPassed(deliveryThursday, tuesdayMidnightParis),
    true,
  );
  assertEqual(
    "Tuesday 00:00 Paris status is closed",
    getDeliveryCutoffStatus(deliveryThursday, tuesdayMidnightParis).isPassed,
    true,
  );

  const nullStatus = getDeliveryCutoffStatus(null);
  assertEqual("Null delivery date is unknown", nullStatus.isKnown, false);
  assertEqual("Null delivery date is not blocked", nullStatus.isPassed, false);
  assertEqual("Null delivery date has no cutoff date", nullStatus.cutoffDate, null);
  assertEqual("Null delivery date has no deadline label", nullStatus.deadlineLabel, null);
  assertEqual(
    "Null delivery date isDeliveryCutoffPassed false",
    isDeliveryCutoffPassed(null),
    false,
  );

  const invalidStatus = getDeliveryCutoffStatus("2026-13-40");
  assertEqual("Invalid delivery date is unknown", invalidStatus.isKnown, false);
  assertEqual("Invalid delivery date is not blocked", invalidStatus.isPassed, false);
  assertEqual("Invalid delivery date has no cutoff date", invalidStatus.cutoffDate, null);

  const knownStatus = getDeliveryCutoffStatus(deliveryThursday, monday20Paris);
  assertEqual("Known delivery date exposes cutoff date", knownStatus.isKnown, true);
  assertDate("Known delivery date cutoff date", knownStatus.cutoffDate ?? "", cutoffMonday);
  assertEqual(
    "Known open status deadline label is set",
    knownStatus.deadlineLabel,
    formatDeliveryCutoffDeadlineLabel(deliveryThursday),
  );

  const deadlineLabel = formatDeliveryCutoffDeadlineLabel(deliveryThursday);
  if (deadlineLabel === "lundi 13 juillet à 23h59") {
    pass("Deadline label in French", deadlineLabel);
  } else {
    fail("Deadline label in French", `got=${deadlineLabel ?? "null"}`);
  }

  assertEqual(
    "Invalid delivery date deadline label is null",
    formatDeliveryCutoffDeadlineLabel("not-a-date"),
    null,
  );

  assertEqual(
    "Paris reference date stays on cutoff day at 23:59",
    referenceDateFromInstant(monday2359Paris, DELIVERY_TIMEZONE),
    cutoffMonday,
  );
  assertEqual(
    "Paris reference date moves to next day at 00:00",
    referenceDateFromInstant(tuesdayMidnightParis, DELIVERY_TIMEZONE),
    requireDate("2026-07-14"),
  );

  const augustThursday = requireDate("2026-08-20");
  const augustFriday = requireDate("2026-08-21");
  const augustMondayCutoff = requireDate("2026-08-17");
  const augustTuesday = requireDate("2026-08-18");

  assertDate(
    "Thursday 2026-08-20 meal cutoff is Monday 2026-08-17",
    getMealSelectionCutoffCalendarDate(augustThursday),
    augustMondayCutoff,
  );
  assertDate(
    "Friday 2026-08-21 meal cutoff is Monday 2026-08-17, not Tuesday",
    getMealSelectionCutoffCalendarDate(augustFriday),
    augustMondayCutoff,
  );
  assertDate(
    "Friday 2026-08-21 billing-ready J-3 cutoff stays Tuesday 2026-08-18",
    getDeliveryCutoffCalendarDate(augustFriday),
    augustTuesday,
  );

  const augustMondayLastMs = new Date(
    parisWallClockToInstant({
      date: augustTuesday,
      hour: 0,
      minute: 0,
    }).getTime() - 1,
  );
  assertEqual(
    "Thursday delivery still open at Monday 23:59:59.999 Paris",
    isDeliveryCutoffPassed(augustThursday, augustMondayLastMs),
    false,
  );
  assertEqual(
    "Friday delivery still open at Monday 23:59:59.999 Paris",
    isDeliveryCutoffPassed(augustFriday, augustMondayLastMs),
    false,
  );

  const augustTuesdayMidnight = parisWallClockToInstant({
    date: augustTuesday,
    hour: 0,
    minute: 0,
  });
  assertEqual(
    "Thursday delivery closed at Tuesday 00:00 Paris",
    isDeliveryCutoffPassed(augustThursday, augustTuesdayMidnight),
    true,
  );
  assertEqual(
    "Friday delivery closed at Tuesday 00:00 Paris, not Wednesday",
    isDeliveryCutoffPassed(augustFriday, augustTuesdayMidnight),
    true,
  );

  assertDate(
    "Next-week Thursday 2026-08-27 meal cutoff is Monday 2026-08-24",
    getMealSelectionCutoffCalendarDate(requireDate("2026-08-27")),
    requireDate("2026-08-24"),
  );
  assertDate(
    "Next-week Friday 2026-08-28 meal cutoff is Monday 2026-08-24",
    getMealSelectionCutoffCalendarDate(requireDate("2026-08-28")),
    requireDate("2026-08-24"),
  );

  const winterThursday = requireDate("2026-01-22");
  const winterMonday = requireDate("2026-01-19");
  assertDate(
    "Winter CET Thursday meal cutoff is Monday of that week",
    getMealSelectionCutoffCalendarDate(winterThursday),
    winterMonday,
  );
  const winterTuesdayMidnight = parisWallClockToInstant({
    date: requireDate("2026-01-20"),
    hour: 0,
    minute: 0,
  });
  assertEqual(
    "Winter CET Tuesday 00:00 Paris is after cutoff",
    isDeliveryCutoffPassed(winterThursday, winterTuesdayMidnight),
    true,
  );
  assertEqual(
    "Summer CEST Tuesday 00:00 Paris is after cutoff",
    isDeliveryCutoffPassed(deliveryThursday, tuesdayMidnightParis),
    true,
  );

  const failed = checks.filter((check) => !check.ok);

  console.log("\nDelivery cutoff — pure utility tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
