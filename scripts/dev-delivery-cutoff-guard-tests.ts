/**
 * Delivery cutoff portal guard — unit checks (no DB, no Shopify).
 * Usage: npx tsx scripts/dev-delivery-cutoff-guard-tests.ts
 */
import { RECOVERY_STATUS } from "../app/constants/subscriptionPaymentRecovery";
import { DELIVERY_TIMEZONE } from "../app/constants/deliverySchedule";
import {
  DELIVERY_CUTOFF_LIFECYCLE_BLOCK_MESSAGE,
  DELIVERY_CUTOFF_MODIFICATION_BLOCK_MESSAGE,
  getDeliveryCutoffBlockReason,
} from "../app/services/deliveryCutoff.server";
import {
  getPortalModificationBlockMessage,
  getPortalModificationBlockReason,
} from "../app/services/subscriptionModificationBlock.server";
import { RESUME_LOCK_STATUS } from "../app/services/subscriptionBillingWorker.server";
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

const baseSelection = () => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  nextScheduledDeliveryDate: "2026-07-16" as string | null,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStatus: null as string | null,
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

const expectPortalBlock = (
  name: string,
  reason: ReturnType<typeof getPortalModificationBlockReason>,
  expected: ReturnType<typeof getPortalModificationBlockReason>,
) => {
  if (reason === expected) {
    pass(name, `reason=${reason ?? "null"}`);
  } else {
    fail(name, `expected=${expected ?? "null"}, got=${reason ?? "null"}`);
  }
};

const assertGuardDoesNotThrow = (name: string, run: () => void) => {
  try {
    run();
    pass(name, "no throw");
  } catch (error) {
    fail(
      name,
      error instanceof Error ? error.message : "unexpected throw",
    );
  }
};

function main() {
  const deliveryThursday = requireDate("2026-07-16");
  const cutoffMonday = requireDate("2026-07-13");
  const monday20Paris = parisWallClockToInstant({
    date: cutoffMonday,
    hour: 20,
    minute: 0,
  });
  const tuesdayMidnightParis = parisWallClockToInstant({
    date: requireDate("2026-07-14"),
    hour: 0,
    minute: 0,
  });

  expectPortalBlock(
    "updateFutureMealSelection allowed before cutoff",
    getPortalModificationBlockReason(baseSelection(), null, monday20Paris),
    null,
  );

  expectPortalBlock(
    "updateFutureMealSelection blocked after cutoff",
    getPortalModificationBlockReason(baseSelection(), null, tuesdayMidnightParis),
    "cutoff_passed",
  );

  expectPortalBlock(
    "changeSubscriptionBox blocked after cutoff",
    getPortalModificationBlockReason(baseSelection(), null, tuesdayMidnightParis),
    "cutoff_passed",
  );

  expectPortalBlock(
    "pause blocked after cutoff",
    getPortalModificationBlockReason(baseSelection(), null, tuesdayMidnightParis),
    "cutoff_passed",
  );

  expectPortalBlock(
    "resume blocked after cutoff",
    getPortalModificationBlockReason(
      { ...baseSelection(), status: "paused", active: false },
      null,
      tuesdayMidnightParis,
    ),
    "cutoff_passed",
  );

  expectPortalBlock(
    "nextScheduledDeliveryDate null is not blocked",
    getPortalModificationBlockReason(
      { ...baseSelection(), nextScheduledDeliveryDate: null },
      null,
      tuesdayMidnightParis,
    ),
    null,
  );

  expectPortalBlock(
    "invalid nextScheduledDeliveryDate is not blocked",
    getPortalModificationBlockReason(
      { ...baseSelection(), nextScheduledDeliveryDate: "2026-99-99" },
      null,
      tuesdayMidnightParis,
    ),
    null,
  );

  const billingAndCutoff = {
    ...baseSelection(),
    lastBillingAttemptAt: new Date(),
    lastBillingAttemptStatus: "submitted",
  };
  expectPortalBlock(
    "billing block is priority over cutoff",
    getPortalModificationBlockReason(billingAndCutoff, null, tuesdayMidnightParis),
    "billing_processing",
  );

  expectPortalBlock(
    "cutoff_passed only when no billing block",
    getDeliveryCutoffBlockReason(baseSelection(), tuesdayMidnightParis),
    "cutoff_passed",
  );

  assertEqual(
    "modification message for cutoff",
    getPortalModificationBlockMessage("cutoff_passed", "modification"),
    DELIVERY_CUTOFF_MODIFICATION_BLOCK_MESSAGE,
  );
  assertEqual(
    "lifecycle message for cutoff pause/resume",
    getPortalModificationBlockMessage("cutoff_passed", "subscription_control"),
    DELIVERY_CUTOFF_LIFECYCLE_BLOCK_MESSAGE,
  );

  assertGuardDoesNotThrow("null delivery date guard does not throw", () => {
    getPortalModificationBlockReason(
      { ...baseSelection(), nextScheduledDeliveryDate: null },
      null,
      tuesdayMidnightParis,
    );
  });

  assertGuardDoesNotThrow("invalid delivery date guard does not throw", () => {
    getPortalModificationBlockReason(
      { ...baseSelection(), nextScheduledDeliveryDate: "not-a-date" },
      null,
      tuesdayMidnightParis,
    );
  });

  assertGuardDoesNotThrow("recovery processing still handled without throw", () => {
    getPortalModificationBlockReason(baseSelection(), {
      status: RECOVERY_STATUS.PROCESSING,
    }, monday20Paris);
  });

  assertGuardDoesNotThrow("resume processing still handled without throw", () => {
    getPortalModificationBlockReason(
      {
        ...baseSelection(),
        resumeAttemptStatus: RESUME_LOCK_STATUS.PROCESSING,
      },
      null,
      monday20Paris,
    );
  });

  assertEqual(
    "delivery cutoff block reason uses scheduled delivery date only",
    getDeliveryCutoffBlockReason(
      {
        nextScheduledDeliveryDate: deliveryThursday,
      },
      tuesdayMidnightParis,
    ),
    "cutoff_passed",
  );

  const failed = checks.filter((check) => !check.ok);

  console.log("\nDelivery cutoff guard — portal server tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
