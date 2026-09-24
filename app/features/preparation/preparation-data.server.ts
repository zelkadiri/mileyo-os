import db from "../../db.server";
import { KITCHEN_PREPARATION_BOX_ORDER_WHERE } from "../../constants/boxOrder";
import type { SubscriptionObjective } from "../../constants/subscriptionObjective";
import { fetchMealCatalogProducts } from "../../services/subscriptionMealCatalog.server";
import { authenticate } from "../../shopify.server";
import {
  getTodayDeliveryDate,
  getDeliveryCutoffStatus,
  parseDeliveryDate,
  type DeliveryDateString,
} from "../../utils/deliveryDate";
import { parseSubscriptionObjective } from "../../utils/subscriptionObjective";
import {
  buildBulkPortionGramsByMealTitle,
  enrichMealTotalsWithBulkPortionGrams,
} from "./preparation-bulk-portion";
import {
  isKitchenPreparationBoxOrder,
  isSubscriptionPreparationOrder,
  normalizeSelectedMealsForPreparation,
} from "./preparation-formatters";
import type {
  PreparationBoxOrderRecord,
  PreparationDayData,
  PreparationDaySummary,
  PreparationMealTotal,
  PreparationObjectiveQuantities,
  PreparationOrder,
  PreparationPageData,
  UpcomingPreparationDate,
} from "./preparation-types";

const emptyObjectiveQuantities = (): PreparationObjectiveQuantities => ({
  balanced: 0,
  bulk: 0,
  unknown: 0,
  weight_loss: 0,
});

const compareMealTotals = (
  left: PreparationMealTotal,
  right: PreparationMealTotal,
) => {
  if (right.totalQuantity !== left.totalQuantity) {
    return right.totalQuantity - left.totalQuantity;
  }

  return left.mealTitle.localeCompare(right.mealTitle, "fr");
};

const objectiveBucket = (
  objective: SubscriptionObjective | null,
): keyof PreparationObjectiveQuantities => objective ?? "unknown";

export const aggregateMealTotals = (
  orders: PreparationOrder[],
): PreparationMealTotal[] => {
  const byTitle = new Map<
    string,
    {
      objectiveQuantities: PreparationObjectiveQuantities;
      totalQuantity: number;
    }
  >();

  for (const order of orders) {
    const bucket = objectiveBucket(order.objective);

    for (const mealTitle of order.selectedMeals) {
      const entry = byTitle.get(mealTitle) ?? {
        objectiveQuantities: emptyObjectiveQuantities(),
        totalQuantity: 0,
      };

      entry.totalQuantity += 1;
      entry.objectiveQuantities[bucket] += 1;
      byTitle.set(mealTitle, entry);
    }
  }

  return [...byTitle.entries()]
    .map(([mealTitle, entry]) => ({
      bulkPortionGrams: null,
      mealTitle,
      objectiveQuantities: entry.objectiveQuantities,
      totalQuantity: entry.totalQuantity,
    }))
    .sort(compareMealTotals);
};

/**
 * Fail-soft: one meal-collection GraphQL fetch per page.
 * On any error / missing collection → empty map (all bulk grams stay null).
 */
export const loadBulkPortionGramsByMealTitleFailSoft = async (
  admin: {
    graphql: (
      query: string,
      options?: {
        variables?: { id: string; sortKey?: "TITLE" | "COLLECTION_DEFAULT" };
      },
    ) => Promise<Response>;
  },
  shop: string,
): Promise<Map<string, number | null>> => {
  try {
    const settings = await db.appSettings.findUnique({
      select: { mealCollectionId: true },
      where: { shop },
    });
    const mealCollectionId = settings?.mealCollectionId?.trim() ?? "";

    if (!mealCollectionId) {
      return new Map();
    }

    const products = await fetchMealCatalogProducts(admin, mealCollectionId);
    return buildBulkPortionGramsByMealTitle(products);
  } catch {
    return new Map();
  }
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
  objective: parseSubscriptionObjective(order.objective ?? null),
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
  const kitchenBoxOrders = boxOrders.filter(isKitchenPreparationBoxOrder);
  const orders = kitchenBoxOrders
    .filter((order) => order.scheduledDeliveryDate === scheduledDeliveryDate)
    .map((order) => mapBoxOrderToPreparationOrder(order, scheduledDeliveryDate))
    .sort((left, right) =>
      (left.orderName ?? "").localeCompare(right.orderName ?? "", "fr"),
    );

  return {
    mealTotals: aggregateMealTotals(orders),
    orders,
    summary: buildPreparationDaySummary({
      boxOrders: kitchenBoxOrders,
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
      ...KITCHEN_PREPARATION_BOX_ORDER_WHERE,
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
      ...KITCHEN_PREPARATION_BOX_ORDER_WHERE,
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
  const { admin, session } = await authenticate.admin(request);
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

  let dayData =
    selectedDate && !dateQueryInvalid
      ? await getPreparationDayData(shop, selectedDate)
      : null;

  // One catalog load per page — never N calls per meal/order. Fail-soft on errors.
  if (dayData) {
    const bulkPortionGramsByTitle =
      await loadBulkPortionGramsByMealTitleFailSoft(admin, shop);
    dayData = {
      ...dayData,
      mealTotals: enrichMealTotalsWithBulkPortionGrams(
        dayData.mealTotals,
        bulkPortionGramsByTitle,
      ),
    };
  }

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
