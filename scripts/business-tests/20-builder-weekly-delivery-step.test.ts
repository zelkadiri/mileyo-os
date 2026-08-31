/**
 * Business regression — builder weekly delivery windows (13G).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DELIVERY_RESCHEDULE_REASON } from "../../app/constants/deliverySchedule";
import { DELIVERY_DATE_PROPERTY_TECHNICAL } from "../../app/utils/orderLineItemProperties";
import { resolveFirstOrderDeliverySchedule } from "../../app/services/deliverySchedule.server";
import {
  addCalendarDays,
  buildBuilderDeliveryWindowOptions,
  buildBuilderDeliveryWindowOptionsFromReferenceDate,
  formatDeliveryWindowRangeLabel,
  getDeliveryWeekStartForDate,
  getFirstEligibleDeliveryThursday,
  getNextStrictThursday,
  getWeeklyFirstOrderAllowedThursdays,
  parisWallClockToInstant,
  parseDeliveryDate,
  referenceDateFromInstant,
  scheduleDeliveryDate,
  scheduleWeeklyFirstOrderDeliveryDate,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid test date: ${value}`);
  }

  return parsed;
};

const assertWindowPair = (
  ctx: ReturnType<typeof createBusinessTestContext>,
  referenceDate: string,
  expectedThursday: string,
  expectedFriday: string,
  expectedSecondThursday?: ReturnType<typeof requireDate>,
) => {
  const options = buildBuilderDeliveryWindowOptionsFromReferenceDate(
    requireDate(referenceDate),
  );
  const secondThursday =
    expectedSecondThursday ??
    addCalendarDays(requireDate(expectedThursday), 7);

  ctx.assertEqual(
    `${referenceDate} offers exactly two windows`,
    options.length,
    2,
  );
  ctx.assertEqual(
    `${referenceDate} first window thursday`,
    options[0]?.thursdayDate,
    expectedThursday,
  );
  ctx.assertEqual(
    `${referenceDate} first window friday`,
    options[0]?.fridayDate,
    expectedFriday,
  );
  ctx.assertEqual(
    `${referenceDate} second window thursday`,
    options[1]?.thursdayDate,
    secondThursday,
  );
  ctx.assertEqual(
    `${referenceDate} second window friday`,
    options[1]?.fridayDate,
    addCalendarDays(secondThursday, 1),
  );
};

const runSuite = () => {
  const ctx = createBusinessTestContext("20-builder-weekly-delivery-step");

  ctx.scenario("Matrice centrale — fenêtres jeudi/vendredi août 2026");
  assertWindowPair(ctx, "2026-08-13", "2026-08-20", "2026-08-21");
  assertWindowPair(ctx, "2026-08-14", "2026-08-20", "2026-08-21");
  assertWindowPair(ctx, "2026-08-15", "2026-08-20", "2026-08-21");
  assertWindowPair(ctx, "2026-08-16", "2026-08-20", "2026-08-21");
  assertWindowPair(ctx, "2026-08-17", "2026-08-20", "2026-08-21");
  assertWindowPair(ctx, "2026-08-18", "2026-08-27", "2026-08-28", requireDate("2026-09-03"));
  assertWindowPair(ctx, "2026-08-19", "2026-08-27", "2026-08-28", requireDate("2026-09-03"));
  assertWindowPair(ctx, "2026-08-20", "2026-08-27", "2026-08-28", requireDate("2026-09-03"));

  ctx.scenario("Monday 23:59 Paris reste sur 20–21 / 27–28");
  const mondayLate = parisWallClockToInstant({
    date: requireDate("2026-08-17"),
    hour: 23,
    minute: 59,
  });
  const mondayLateReference = referenceDateFromInstant(mondayLate);
  const mondayLateOptions = buildBuilderDeliveryWindowOptionsFromReferenceDate(
    mondayLateReference,
  );
  ctx.assertEqual("monday 23:59 reference date", mondayLateReference, "2026-08-17");
  ctx.assertEqual("monday 23:59 first thursday", mondayLateOptions[0]?.thursdayDate, "2026-08-20");
  ctx.assertEqual("monday 23:59 second thursday", mondayLateOptions[1]?.thursdayDate, "2026-08-27");

  ctx.scenario("Tuesday 00:00 Paris bascule vers 27–28 / 03–04");
  const tuesdayStart = parisWallClockToInstant({
    date: requireDate("2026-08-18"),
    hour: 0,
    minute: 0,
  });
  const tuesdayOptions = buildBuilderDeliveryWindowOptions(tuesdayStart);
  ctx.assertEqual("tuesday 00:00 first thursday", tuesdayOptions[0]?.thursdayDate, "2026-08-27");
  ctx.assertEqual("tuesday 00:00 second thursday", tuesdayOptions[1]?.thursdayDate, "2026-09-03");

  ctx.scenario("Toujours exactement deux options");
  for (const referenceDate of [
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
  ]) {
    const options = buildBuilderDeliveryWindowOptionsFromReferenceDate(
      requireDate(referenceDate),
    );
    ctx.assertEqual(`${referenceDate} has two options`, options.length, 2);
  }

  ctx.scenario("Thursday canonical + weekStart/key stable");
  const options = buildBuilderDeliveryWindowOptionsFromReferenceDate(
    requireDate("2026-08-13"),
  );
  for (const option of options) {
    ctx.assertEqual(
      `${option.key} scheduled is thursday`,
      option.scheduledDeliveryDate,
      option.thursdayDate,
    );
    ctx.assertEqual(
      `${option.key} friday is thursday + 1`,
      option.fridayDate,
      addCalendarDays(option.thursdayDate, 1),
    );
    ctx.assertEqual(
      `${option.key} weekStart is monday`,
      option.weekStartDate,
      getDeliveryWeekStartForDate(option.thursdayDate),
    );
    ctx.assertEqual(`${option.key} key equals weekStartDate`, option.key, option.weekStartDate);
  }

  ctx.scenario("Boundaries — fin de mois et année");
  const decemberOptions = buildBuilderDeliveryWindowOptionsFromReferenceDate(
    requireDate("2026-12-28"),
  );
  ctx.assertEqual("december cross-month first thursday", decemberOptions[0]?.thursdayDate, "2026-12-31");
  ctx.assertEqual("december cross-month first friday", decemberOptions[0]?.fridayDate, "2027-01-01");
  ctx.assertEqual("december cross-month second thursday", decemberOptions[1]?.thursdayDate, "2027-01-07");

  ctx.scenario("Boundaries — février");
  const februaryOptions = buildBuilderDeliveryWindowOptionsFromReferenceDate(
    requireDate("2026-02-26"),
  );
  ctx.assertEqual("february first thursday", februaryOptions[0]?.thursdayDate, "2026-03-05");
  ctx.assertEqual("february second thursday", februaryOptions[1]?.thursdayDate, "2026-03-12");

  ctx.scenario("Boundaries — DST Europe/Paris");
  const winterOptions = buildBuilderDeliveryWindowOptions(
    new Date("2026-01-10T12:00:00.000Z"),
  );
  const summerOptions = buildBuilderDeliveryWindowOptions(
    new Date("2026-07-10T12:00:00.000Z"),
  );
  ctx.assertEqual("winter weekly options count", winterOptions.length, 2);
  ctx.assertEqual("summer weekly options count", summerOptions.length, 2);

  ctx.scenario("First-order weekly validation — Thu 13 checkout");
  const referenceDate = requireDate("2026-08-13");
  const allowed = getWeeklyFirstOrderAllowedThursdays(referenceDate);
  ctx.assertEqual("allowed thursday 20", allowed[0], "2026-08-20");
  ctx.assertEqual("allowed thursday 27", allowed[1], "2026-08-27");

  const accepted20 = scheduleWeeklyFirstOrderDeliveryDate({
    desiredDeliveryDate: requireDate("2026-08-20"),
    referenceDate,
  });
  ctx.assertEqual("desired 20 accepted", accepted20?.scheduledDeliveryDate, "2026-08-20");
  ctx.assertNull("desired 20 no reschedule", accepted20?.deliveryRescheduleReason);

  const accepted27 = scheduleWeeklyFirstOrderDeliveryDate({
    desiredDeliveryDate: requireDate("2026-08-27"),
    referenceDate,
  });
  ctx.assertEqual("desired 27 accepted", accepted27?.scheduledDeliveryDate, "2026-08-27");

  const resolved20 = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-08-27" },
    ],
    orderCreatedAt: new Date("2026-08-13T12:00:00.000Z"),
  });
  ctx.assertEqual(
    "webhook accepts second weekly window beyond legacy J+10",
    resolved20?.scheduledDeliveryDate,
    "2026-08-27",
  );

  ctx.scenario("Stale checkout après cutoff lundi → mardi");
  const staleSchedule = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-08-20" },
    ],
    orderCreatedAt: parisWallClockToInstant({
      date: requireDate("2026-08-18"),
      hour: 0,
      minute: 1,
    }),
  });
  ctx.assertEqual(
    "stale desired 20 rescheduled to thursday 27",
    staleSchedule?.scheduledDeliveryDate,
    "2026-08-27",
  );
  ctx.assertEqual(
    "stale reason payment too late",
    staleSchedule?.deliveryRescheduleReason,
    DELIVERY_RESCHEDULE_REASON.PAYMENT_TOO_LATE,
  );
  ctx.assertEqual(
    "stale does not pick friday 21",
    staleSchedule?.scheduledDeliveryDate === "2026-08-21",
    false,
  );

  ctx.scenario("Legacy exact-date fallback preserved");
  const legacyFriday = scheduleWeeklyFirstOrderDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-17"),
    referenceDate: requireDate("2026-07-10"),
  });
  ctx.assertNull("non-weekly thursday list returns null", legacyFriday);

  const legacySchedule = scheduleDeliveryDate({
    desiredDeliveryDate: requireDate("2026-07-17"),
    fromCustomerChoice: true,
    referenceDate: requireDate("2026-07-10"),
  });
  ctx.assertEqual(
    "legacy J+3/J+10 still schedules friday",
    legacySchedule.scheduledDeliveryDate,
    "2026-07-17",
  );

  const legacyResolved = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-17" },
    ],
    orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
  });
  ctx.assertEqual(
    "webhook legacy friday preserved",
    legacyResolved?.scheduledDeliveryDate,
    "2026-07-17",
  );

  ctx.scenario("Helpers — next strict thursday and skip Tue/Wed");
  ctx.assertEqual(
    "next strict thursday from thursday 13",
    getNextStrictThursday(requireDate("2026-08-13")),
    "2026-08-20",
  );
  ctx.assertEqual(
    "first eligible from monday 17",
    getFirstEligibleDeliveryThursday(requireDate("2026-08-17")),
    "2026-08-20",
  );
  ctx.assertEqual(
    "first eligible from tuesday 18 skips 20",
    getFirstEligibleDeliveryThursday(requireDate("2026-08-18")),
    "2026-08-27",
  );

  ctx.scenario("Format FR range label");
  ctx.assertEqual(
    "same month range label",
    formatDeliveryWindowRangeLabel(
      requireDate("2026-08-20"),
      requireDate("2026-08-21"),
    ),
    "Livraison entre jeudi 20 août et vendredi 21 août",
  );
  ctx.assertEqual(
    "cross month range label",
    formatDeliveryWindowRangeLabel(
      requireDate("2026-08-27"),
      requireDate("2026-08-28"),
    ).includes("août"),
    true,
  );
  ctx.assertTrue(
    "cross month september label",
    formatDeliveryWindowRangeLabel(
      requireDate("2026-08-27"),
      requireDate("2026-09-04"),
    ).includes("septembre"),
  );

  ctx.scenario("Builder source — weekly payload and no auto-select");
  const loaderSource = readRepoFile("app/routes/apps.box-builder.tsx");
  const clientSource = readRepoFile("app/features/builder/builder-client.ts");
  const renderSource = readRepoFile("app/features/builder/builder-render.ts");

  ctx.assertTrue(
    "loader uses buildBuilderDeliveryWindowOptions",
    loaderSource.includes("buildBuilderDeliveryWindowOptions"),
  );
  ctx.assertTrue(
    "loader exposes deliveryWindowOptions",
    loaderSource.includes("deliveryWindowOptions"),
  );
  ctx.assertFalse(
    "loader no longer uses getAvailableDeliveryDates",
    loaderSource.includes("getAvailableDeliveryDates"),
  );
  ctx.assertFalse(
    "loader no longer uses defaultDate",
    loaderSource.includes("defaultDate"),
  );
  ctx.assertTrue(
    "client tracks selectedDeliveryWindowKey",
    clientSource.includes("selectedDeliveryWindowKey"),
  );
  ctx.assertTrue(
    "client tracks selectedScheduledDeliveryDate",
    clientSource.includes("selectedScheduledDeliveryDate"),
  );
  ctx.assertFalse(
    "client no longer auto-selects delivery",
    clientSource.includes("defaultDate"),
  );
  ctx.assertTrue(
    "client validates delivery window options",
    clientSource.includes("isSelectedDeliveryWindowValid"),
  );
  ctx.assertTrue(
    "render weekly step title",
    renderSource.includes("Choisissez votre semaine de livraison"),
  );
  ctx.assertTrue(
    "weekly card labels defined server-side",
    readRepoFile("app/utils/deliveryDate.ts").includes("Prochaine livraison") &&
      readRepoFile("app/utils/deliveryDate.ts").includes("Livraison suivante"),
  );
  ctx.assertFalse(
    "no legacy date picker grid in render",
    renderSource.includes("delivery-date-grid"),
  );

  ctx.scenario("Checkout payload — thursday canonical + readable range");
  const checkoutServerSource = readRepoFile(
    "app/features/builder/builder-checkout.server.ts",
  );
  ctx.assertTrue(
    "checkout uses selectedScheduledDeliveryDate",
    clientSource.includes("scheduledDeliveryDate: selectedScheduledDeliveryDate") &&
      checkoutServerSource.includes("DELIVERY_DATE_PROPERTY_TECHNICAL"),
  );
  ctx.assertTrue(
    "cart readable property uses rangeLabel",
    clientSource.includes("selectedWindow.rangeLabel"),
  );
  ctx.assertFalse(
    "no week cart property",
    clientSource.includes("_mileyo_delivery_week"),
  );

  return finishSuite("20-builder-weekly-delivery-step", ctx);
};

process.exitCode = runSuite();
