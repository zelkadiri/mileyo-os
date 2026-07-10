import type { DeliveryRescheduleReason } from "../constants/deliverySchedule";
import {
  computeRenewalDeliveryDate,
  getWeekday,
  referenceDateFromInstant,
  scheduleDeliveryDate,
  type DeliveryDateString,
} from "../utils/deliveryDate";
import {
  getDeliveryDateFromLineItemProperties,
  type LineItemProperty,
} from "../utils/orderLineItemProperties";

export type FirstOrderDeliveryScheduleResolution = {
  deliveryRescheduleReason: DeliveryRescheduleReason | null;
  desiredDeliveryDate: DeliveryDateString;
  preferredDeliveryWeekday: number;
  referenceDate: DeliveryDateString;
  scheduledDeliveryDate: DeliveryDateString;
};

export type RenewalDeliveryScheduleResolution = {
  deliveryRescheduleReason: DeliveryRescheduleReason | null;
  desiredDeliveryDate: DeliveryDateString;
  referenceDate: DeliveryDateString;
  scheduledDeliveryDate: DeliveryDateString;
};

export type DeliveryScheduleLogEvent = "scheduled" | "rescheduled" | "skipped";

const toReferenceDate = (
  orderCreatedAt: Date | null | undefined,
): DeliveryDateString | null => {
  if (!orderCreatedAt || Number.isNaN(orderCreatedAt.getTime())) {
    return null;
  }

  try {
    return referenceDateFromInstant(orderCreatedAt);
  } catch {
    return null;
  }
};

const isValidPreferredDeliveryWeekday = (
  value: number | null | undefined,
): value is number =>
  value != null &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 6;

export const resolveFirstOrderDeliverySchedule = ({
  lineItemProperties,
  orderCreatedAt,
}: {
  lineItemProperties: LineItemProperty[] | undefined;
  orderCreatedAt: Date | null | undefined;
}): FirstOrderDeliveryScheduleResolution | null => {
  const desiredDeliveryDate =
    getDeliveryDateFromLineItemProperties(lineItemProperties);

  if (!desiredDeliveryDate) {
    return null;
  }

  const referenceDate = toReferenceDate(orderCreatedAt);

  if (!referenceDate) {
    return null;
  }

  const schedule = scheduleDeliveryDate({
    desiredDeliveryDate,
    fromCustomerChoice: true,
    referenceDate,
  });

  return {
    deliveryRescheduleReason: schedule.deliveryRescheduleReason,
    desiredDeliveryDate: schedule.desiredDeliveryDate,
    preferredDeliveryWeekday: getWeekday(schedule.scheduledDeliveryDate),
    referenceDate,
    scheduledDeliveryDate: schedule.scheduledDeliveryDate,
  };
};

export const resolveRenewalDeliverySchedule = ({
  orderCreatedAt,
  preferredDeliveryWeekday,
}: {
  orderCreatedAt: Date | null | undefined;
  preferredDeliveryWeekday: number | null | undefined;
}): RenewalDeliveryScheduleResolution | null => {
  if (!isValidPreferredDeliveryWeekday(preferredDeliveryWeekday)) {
    return null;
  }

  const referenceDate = toReferenceDate(orderCreatedAt);

  if (!referenceDate) {
    return null;
  }

  const schedule = computeRenewalDeliveryDate({
    preferredDeliveryWeekday,
    referenceDate,
  });

  return {
    deliveryRescheduleReason: schedule.deliveryRescheduleReason,
    desiredDeliveryDate: schedule.desiredDeliveryDate,
    referenceDate,
    scheduledDeliveryDate: schedule.scheduledDeliveryDate,
  };
};

export const logDeliveryScheduleEvent = ({
  deliveryRescheduleReason = null,
  desiredDeliveryDate = null,
  event,
  isRenewal,
  referenceDate = null,
  scheduledDeliveryDate = null,
  shop,
  shopifyOrderId,
}: {
  deliveryRescheduleReason?: DeliveryRescheduleReason | null;
  desiredDeliveryDate?: DeliveryDateString | null;
  event: DeliveryScheduleLogEvent;
  isRenewal: boolean;
  referenceDate?: DeliveryDateString | null;
  scheduledDeliveryDate?: DeliveryDateString | null;
  shop: string;
  shopifyOrderId: string;
}) => {
  try {
    console.log("[DELIVERY]", {
      deliveryRescheduleReason,
      desiredDeliveryDate,
      event,
      isRenewal,
      referenceDate,
      scheduledDeliveryDate,
      shop,
      shopifyOrderId,
    });
  } catch {
    // Logger must never throw.
  }
};
