/**
 * Business regression — delivery cutoff guards and billing readiness.
 */
import { DELIVERY_TIMEZONE } from "../../app/constants/deliverySchedule";
import {
  getDeliveryCutoffBlockReason,
} from "../../app/services/deliveryCutoff.server";
import {
  getPortalModificationBlockReason,
} from "../../app/services/subscriptionModificationBlock.server";
import { getBillingRunnerDeliveryGate } from "../../app/services/subscriptionBillingWorker.server";
import {
  getDeliveryCutoffStatus,
  parseDeliveryDate,
  projectActiveScheduledDeliveryDate,
  type DeliveryDateString,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const parisWallClockToInstant = ({
  date,
  hour,
  minute,
}: {
  date: DeliveryDateString;
  hour: number;
  minute: number;
}) => {
  const [year, month, day] = date.split("-").map(Number);
  const target = { day, hour, minute, month, second: 0, year };

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

const baseSelection = () => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  nextScheduledDeliveryDate: "2026-07-16" as string | null,
  preferredDeliveryWeekday: 4,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStatus: null as string | null,
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid fixture date: ${value}`);
  }

  return parsed;
};

const runSuite = () => {
  const ctx = createBusinessTestContext("04-cutoff-guards");
  const mondayBeforeCutoff = parisWallClockToInstant({
    date: requireDate("2026-07-13"),
    hour: 20,
    minute: 0,
  });
  const tuesdayAfterCutoff = parisWallClockToInstant({
    date: requireDate("2026-07-14"),
    hour: 0,
    minute: 0,
  });

  ctx.scenario("Avant cutoff — modifications autorisées");
  ctx.given("livraison jeudi 16 juillet, lundi 13 juillet 20h Paris");
  ctx.assertNull(
    "meal change allowed before cutoff",
    getPortalModificationBlockReason(baseSelection(), null, mondayBeforeCutoff),
  );
  ctx.assertNull(
    "pause allowed before cutoff",
    getPortalModificationBlockReason(baseSelection(), null, mondayBeforeCutoff),
  );

  ctx.scenario("Après cutoff — modifications bloquées");
  ctx.given("cutoff lundi 13 juillet 23h59 passé");
  ctx.when("on tente une modification mardi 00h00");
  ctx.assertEqual(
    "meal change blocked after cutoff",
    getPortalModificationBlockReason(baseSelection(), null, tuesdayAfterCutoff),
    "cutoff_passed",
  );
  ctx.assertEqual(
    "pause blocked after cutoff",
    getPortalModificationBlockReason(baseSelection(), null, tuesdayAfterCutoff),
    "cutoff_passed",
  );

  ctx.scenario("Cutoff calculé sur date projetée");
  ctx.given("DB stocke encore jeudi 16 alors qu'on est après le 16");
  const projected = projectActiveScheduledDeliveryDate({
    nextScheduledDeliveryDate: "2026-07-16",
    now: new Date("2026-07-17T12:00:00.000Z"),
    preferredDeliveryWeekday: 4,
  });
  ctx.when("le portail projette jeudi 23");
  ctx.assertEqual(
    "projected delivery advances weekly",
    projected.effectiveDeliveryDate,
    "2026-07-23",
  );
  ctx.assertNull(
    "projected delivery keeps portal open before cutoff",
    getPortalModificationBlockReason(
      baseSelection(),
      null,
      new Date("2026-07-17T12:00:00.000Z"),
    ),
  );

  ctx.scenario("Billing ne part jamais avant cutoff");
  ctx.given("livraison jeudi 23, cron lundi 20 juillet 22h");
  const gateBefore = getBillingRunnerDeliveryGate({
    now: parisWallClockToInstant({
      date: requireDate("2026-07-20"),
      hour: 22,
      minute: 0,
    }),
    selection: {
      nextBillingDate: new Date("2026-07-20T20:00:00.000Z"),
      nextScheduledDeliveryDate: "2026-07-23",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertEqual(
    "cron before billingReadyAt skips",
    gateBefore.skipReason,
    "delivery_billing_not_ready",
  );
  ctx.when("cron passe mardi 21 juillet 00h10 Paris");
  const gateAfter = getBillingRunnerDeliveryGate({
    now: parisWallClockToInstant({
      date: requireDate("2026-07-21"),
      hour: 0,
      minute: 10,
    }),
    selection: {
      nextBillingDate: new Date("2026-07-20T22:05:00.000Z"),
      nextScheduledDeliveryDate: "2026-07-23",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertNull("cron after billingReadyAt allows billing", gateAfter.skipReason);

  ctx.scenario("Cutoff status exposé pour UI");
  ctx.given("livraison jeudi 16 juillet");
  const cutoff = getDeliveryCutoffStatus("2026-07-16", mondayBeforeCutoff);
  ctx.assertTrue("cutoff known before deadline", cutoff.isKnown);
  ctx.assertFalse("cutoff open before deadline", cutoff.isPassed);

  ctx.scenario("Cutoff guard fail-safe");
  ctx.given("date livraison invalide");
  ctx.assertNull(
    "invalid delivery date does not block",
    getDeliveryCutoffBlockReason(
      { nextScheduledDeliveryDate: "2026-99-99" },
      tuesdayAfterCutoff,
    ),
  );

  return finishSuite("04-cutoff-guards", ctx);
};

process.exitCode = runSuite();
