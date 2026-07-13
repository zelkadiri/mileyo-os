import db from "../../db.server";
import { authenticate } from "../../shopify.server";
import {
  getTodayDeliveryDate,
  getDeliveryCutoffStatus,
  parseDeliveryDate,
  type DeliveryDateString,
} from "../../utils/deliveryDate";
import {
  isSubscriptionPreparationOrder,
  normalizeSelectedMealsForPreparation,
} from "./preparation-formatters";
import type {
  PreparationBoxOrderRecord,
  PreparationDayData,
  PreparationDaySummary,
  PreparationMealTotal,
  PreparationOrder,
  PreparationPageData,
  UpcomingPreparationDate,
} from "./preparation-types";

const compareMealTotals = (
  left: PreparationMealTotal,
  right: PreparationMealTotal,
) => {
  if (right.totalQuantity !== left.totalQuantity) {
    return right.totalQuantity - left.totalQuantity;
  }

  return left.mealTitle.localeCompare(right.mealTitle, "fr");
};

export const aggregateMealTotals = (
  orders: PreparationOrder[],
): PreparationMealTotal[] => {
  const counts = new Map<string, number>();

  for (const order of orders) {
    for (const mealTitle of order.selectedMeals) {
      counts.set(mealTitle, (counts.get(mealTitle) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([mealTitle, totalQuantity]) => ({ mealTitle, totalQuantity }))
    .sort(compareMealTotals);
};

export const mapBoxOrderToPreparationOrder = (
  order: PreparationBoxOrderRecord,
  scheduledDeliveryDate: DeliveryDateString,
): PreparationOrder => ({
  boxTitle: order.boxTitle,
  createdAt: order.createdAt,
  customerEmail: order.customerEmail,
  customerName: order.customerName,
  deliveryRescheduleReason: order.deliveryRescheduleReason,
  desiredDeliveryDate: order.desiredDeliveryDate,
  id: order.id,
  mealsCount: order.mealsCount,
  orderName: order.shopifyOrderName,
  orderType: order.orderType,
  scheduledDeliveryDate,
  selectedMeals: normalizeSelectedMealsForPreparation(order.selectedMeals),
});

export const buildPreparationDaySummary = ({
  boxOrders,
  orders,
  scheduledDeliveryDate,
}: {
  boxOrders: PreparationBoxOrderRecord[];
  orders: PreparationOrder[];
  scheduledDeliveryDate: DeliveryDateString;
}): PreparationDaySummary => {
  let subscriptionOrders = 0;
  let oneTimeOrders = 0;
  let rescheduledOrders = 0;
  let totalMeals = 0;

  for (const order of orders) {
    totalMeals += order.selectedMeals.length;

    if (order.deliveryRescheduleReason) {
      rescheduledOrders += 1;
    }
  }

  for (const order of boxOrders) {
    if (order.scheduledDeliveryDate !== scheduledDeliveryDate) {
      continue;
    }

    if (
      isSubscriptionPreparationOrder({
        isSubscriptionRenewal: order.isSubscriptionRenewal,
        orderType: order.orderType,
      })
    ) {
      subscriptionOrders += 1;
    } else {
      oneTimeOrders += 1;
    }
  }

  return {
    oneTimeOrders,
    rescheduledOrders,
    scheduledDeliveryDate,
    subscriptionOrders,
    totalMeals,
    totalOrders: orders.length,
  };
};

export const buildPreparationDayDataFromBoxOrders = (
  boxOrders: PreparationBoxOrderRecord[],
  scheduledDeliveryDate: DeliveryDateString,
): PreparationDayData => {
  const orders = boxOrders
    .filter((order) => order.scheduledDeliveryDate === scheduledDeliveryDate)
    .map((order) => mapBoxOrderToPreparationOrder(order, scheduledDeliveryDate))
    .sort((left, right) =>
      (left.orderName ?? "").localeCompare(right.orderName ?? "", "fr"),
    );

  return {
    mealTotals: aggregateMealTotals(orders),
    orders,
    summary: buildPreparationDaySummary({
      boxOrders,
      orders,
      scheduledDeliveryDate,
    }),
  };
};

export const getPreparationDayData = async (
  shop: string,
  scheduledDeliveryDateInput: string,
): Promise<PreparationDayData | null> => {
  const scheduledDeliveryDate = parseDeliveryDate(scheduledDeliveryDateInput);

  if (!scheduledDeliveryDate) {
    return null;
  }

  const boxOrders = await db.boxOrder.findMany({
    orderBy: { shopifyOrderName: "asc" },
    where: {
      scheduledDeliveryDate,
      shop,
    },
  });

  return buildPreparationDayDataFromBoxOrders(boxOrders, scheduledDeliveryDate);
};

export const getUpcomingPreparationDates = async (
  shop: string,
): Promise<UpcomingPreparationDate[]> => {
  const grouped = await db.boxOrder.groupBy({
    _count: { _all: true },
    by: ["scheduledDeliveryDate"],
    orderBy: { scheduledDeliveryDate: "asc" },
    where: {
      scheduledDeliveryDate: { not: null },
      shop,
    },
  });

  const dates: UpcomingPreparationDate[] = [];

  for (const row of grouped) {
    const scheduledDeliveryDate = parseDeliveryDate(row.scheduledDeliveryDate);

    if (!scheduledDeliveryDate) {
      continue;
    }

    dates.push({
      cutoff: (() => {
        const cutoff = getDeliveryCutoffStatus(scheduledDeliveryDate);

        return {
          deadlineLabel: cutoff.deadlineLabel,
          isKnown: cutoff.isKnown,
          isPassed: cutoff.isPassed,
        };
      })(),
      orderCount: row._count._all,
      scheduledDeliveryDate,
    });
  }

  return dates;
};

export const loadPreparationPageData = async (
  request: Request,
): Promise<PreparationPageData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const upcomingDates = await getUpcomingPreparationDates(shop);

  let selectedDate: DeliveryDateString | null = null;
  let dateQueryInvalid = false;

  if (dateParam) {
    const parsedDate = parseDeliveryDate(dateParam);

    if (parsedDate) {
      selectedDate = parsedDate;
    } else {
      dateQueryInvalid = true;
    }
  }

  if (!selectedDate && !dateQueryInvalid) {
    selectedDate =
      upcomingDates[0]?.scheduledDeliveryDate ?? getTodayDeliveryDate();
  }

  const dayData =
    selectedDate && !dateQueryInvalid
      ? await getPreparationDayData(shop, selectedDate)
      : null;

  return {
    dateQueryInvalid,
    dayData,
    selectedDate: dateQueryInvalid ? null : selectedDate,
    selectedCutoff:
      selectedDate && !dateQueryInvalid
        ? (() => {
            const cutoff = getDeliveryCutoffStatus(selectedDate);

            return {
              deadlineLabel: cutoff.deadlineLabel,
              isKnown: cutoff.isKnown,
              isPassed: cutoff.isPassed,
            };
          })()
        : null,
    upcomingDates,
  };
};
