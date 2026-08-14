/**
 * Delivery schedule service — unit checks (no DB, no Shopify webhooks).
 * Usage: npx tsx scripts/dev-delivery-schedule-service-tests.ts
 */
import { DELIVERY_RESCHEDULE_REASON } from "../app/constants/deliverySchedule";
import { parseDeliveryDate } from "../app/utils/deliveryDate";
import {
  DELIVERY_DATE_PROPERTY_TECHNICAL,
  DELIVERY_DATE_PROPERTY_VISIBLE,
} from "../app/utils/orderLineItemProperties";
import {
  logDeliveryScheduleEvent,
  resolveFirstOrderDeliverySchedule,
  resolveRenewalDeliverySchedule,
} from "../app/services/deliverySchedule.server";

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

function main() {
  const firstOrderOk = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
    ],
    orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
  });

  if (firstOrderOk?.scheduledDeliveryDate === "2026-07-16") {
    pass("First order with technical property", firstOrderOk.scheduledDeliveryDate);
  } else {
    fail(
      "First order with technical property",
      `got=${firstOrderOk?.scheduledDeliveryDate ?? "null"}`,
    );
  }

  const firstOrderVisible = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      {
        name: DELIVERY_DATE_PROPERTY_VISIBLE,
        value: "jeudi 16 juillet 2026 (2026-07-16)",
      },
    ],
    orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
  });

  if (firstOrderVisible?.scheduledDeliveryDate === "2026-07-16") {
    pass("First order with visible fallback", firstOrderVisible.scheduledDeliveryDate);
  } else {
    fail(
      "First order with visible fallback",
      `got=${firstOrderVisible?.scheduledDeliveryDate ?? "null"}`,
    );
  }

  assertNull(
    "First order without delivery date",
    resolveFirstOrderDeliverySchedule({
      lineItemProperties: [{ name: "Plat 1", value: "Poulet tikka" }],
      orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
    }),
  );

  assertNull(
    "First order with invalid delivery date",
    resolveFirstOrderDeliverySchedule({
      lineItemProperties: [
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-02-30" },
      ],
      orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
    }),
  );

  const paymentTooLate = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
    ],
    orderCreatedAt: new Date("2026-07-15T12:00:00.000Z"),
  });

  assertEqual(
    "Payment too late reason",
    paymentTooLate?.deliveryRescheduleReason,
    DELIVERY_RESCHEDULE_REASON.PAYMENT_TOO_LATE,
  );
  assertEqual(
    "Payment too late scheduled date",
    paymentTooLate?.scheduledDeliveryDate,
    "2026-07-23",
  );

  const sundayDesired = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-19" },
    ],
    orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
  });

  assertEqual(
    "Sunday desired reason",
    sundayDesired?.deliveryRescheduleReason,
    DELIVERY_RESCHEDULE_REASON.SUNDAY_EXCLUDED,
  );
  assertEqual(
    "Sunday desired rescheduled to Monday",
    sundayDesired?.scheduledDeliveryDate,
    "2026-07-20",
  );

  assertEqual(
    "Preferred weekday from scheduled date after payment too late",
    paymentTooLate?.preferredDeliveryWeekday,
    4,
  );
  assertEqual(
    "Preferred weekday not from desired Thursday",
    paymentTooLate?.preferredDeliveryWeekday === 4,
    true,
  );

  const renewal = resolveRenewalDeliverySchedule({
    orderCreatedAt: new Date("2026-07-15T12:00:00.000Z"),
    preferredDeliveryWeekday: 4,
  });

  assertEqual("Renewal scheduled date", renewal?.scheduledDeliveryDate, "2026-07-23");
  assertEqual("Renewal has no reschedule reason when valid", renewal?.deliveryRescheduleReason, null);

  assertNull(
    "Renewal with null weekday",
    resolveRenewalDeliverySchedule({
      orderCreatedAt: new Date("2026-07-15T12:00:00.000Z"),
      preferredDeliveryWeekday: null,
    }),
  );

  assertNull(
    "Renewal with invalid weekday",
    resolveRenewalDeliverySchedule({
      orderCreatedAt: new Date("2026-07-15T12:00:00.000Z"),
      preferredDeliveryWeekday: 7,
    }),
  );

  let threw = false;

  try {
    assertNull(
      "Undefined properties does not throw",
      resolveFirstOrderDeliverySchedule({
        lineItemProperties: undefined,
        orderCreatedAt: undefined,
      }),
    );
    assertNull(
      "Invalid orderCreatedAt does not throw",
      resolveFirstOrderDeliverySchedule({
        lineItemProperties: [
          { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
        ],
        orderCreatedAt: new Date("invalid"),
      }),
    );
    assertNull(
      "Renewal invalid createdAt does not throw",
      resolveRenewalDeliverySchedule({
        orderCreatedAt: new Date("invalid"),
        preferredDeliveryWeekday: 4,
      }),
    );
  } catch {
    threw = true;
  }

  assertEqual("No throw on empty inputs", threw, false);

  let loggerThrew = false;

  try {
    logDeliveryScheduleEvent({
      deliveryRescheduleReason: DELIVERY_RESCHEDULE_REASON.PAYMENT_TOO_LATE,
      desiredDeliveryDate: parseDeliveryDate("2026-07-16"),
      event: "rescheduled",
      isRenewal: false,
      referenceDate: parseDeliveryDate("2026-07-15"),
      scheduledDeliveryDate: parseDeliveryDate("2026-07-18"),
      shop: "test-shop.myshopify.com",
      shopifyOrderId: "12345",
    });
  } catch {
    loggerThrew = true;
  }

  assertEqual("Logger does not throw", loggerThrew, false);

  const failed = checks.filter((check) => !check.ok);

  console.log("\nDelivery schedule service — unit tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
