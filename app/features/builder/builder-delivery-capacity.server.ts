import db from "../../db.server";
import { KITCHEN_PREPARATION_BOX_ORDER_WHERE } from "../../constants/boxOrder";
import {
  BUILDER_DELIVERY_FIRST_ORDER_CAPACITY,
  isUnavailableBuilderDeliveryThursday,
  resolveBuilderDeliveryWindowCapacityFields,
  type BuilderDeliveryWindowOption,
  type DeliveryDateString,
} from "../../utils/deliveryDate";

/** First-order capacity count — same kitchen filters + exclude renewals. */
export const BUILDER_FIRST_ORDER_CAPACITY_WHERE = {
  ...KITCHEN_PREPARATION_BOX_ORDER_WHERE,
  isSubscriptionRenewal: false,
} as const;

type CapacityBoxOrderDb = {
  boxOrder: {
    count: (args: {
      where: Record<string, unknown>;
    }) => Promise<number>;
    groupBy: (args: {
      _count: { _all: true };
      by: ["scheduledDeliveryDate"];
      where: Record<string, unknown>;
    }) => Promise<Array<{ _count: { _all: number }; scheduledDeliveryDate: string | null }>>;
  };
};

let capacityTestDb: CapacityBoxOrderDb | null = null;

/** @internal Mileyo business regression tests only. */
export const __setBuilderDeliveryCapacityTestDb = (
  client: CapacityBoxOrderDb | null,
): void => {
  capacityTestDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetBuilderDeliveryCapacityTestDb = (): void => {
  capacityTestDb = null;
};

const resolveDb = (): CapacityBoxOrderDb => capacityTestDb ?? db;

/**
 * One groupBy for all requested Thursdays — first orders only.
 * Renewals / simulated / cancelled never appear in the result.
 */
export const countFirstOrdersByScheduledDeliveryDates = async ({
  scheduledDeliveryDates,
  shop,
}: {
  scheduledDeliveryDates: readonly string[];
  shop: string;
}): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const date of scheduledDeliveryDates) {
    counts.set(date, 0);
  }

  if (scheduledDeliveryDates.length === 0) {
    return counts;
  }

  const grouped = await resolveDb().boxOrder.groupBy({
    _count: { _all: true },
    by: ["scheduledDeliveryDate"],
    where: {
      scheduledDeliveryDate: { in: [...scheduledDeliveryDates] },
      shop,
      ...BUILDER_FIRST_ORDER_CAPACITY_WHERE,
    },
  });

  for (const row of grouped) {
    if (!row.scheduledDeliveryDate) {
      continue;
    }
    counts.set(row.scheduledDeliveryDate, row._count._all);
  }

  return counts;
};

export const enrichBuilderDeliveryWindowOptionsWithCapacity = async ({
  options,
  shop,
}: {
  options: readonly BuilderDeliveryWindowOption[];
  shop: string;
}): Promise<BuilderDeliveryWindowOption[]> => {
  const thursdayDates = options.map((option) => option.scheduledDeliveryDate);
  const counts = await countFirstOrdersByScheduledDeliveryDates({
    scheduledDeliveryDates: thursdayDates,
    shop,
  });

  return options.map((option) => {
    const firstOrderCount = counts.get(option.scheduledDeliveryDate) ?? 0;
    const capacityFields = resolveBuilderDeliveryWindowCapacityFields({
      capacity: BUILDER_DELIVERY_FIRST_ORDER_CAPACITY,
      firstOrderCount,
      manualUnavailable: isUnavailableBuilderDeliveryThursday(
        option.thursdayDate,
      ),
    });

    return {
      ...option,
      ...capacityFields,
    };
  });
};

/**
 * Soft gate for builder acquisition: manual block OR first-order capacity full.
 * Never call from renewal / billing / portal paths.
 */
export const isBuilderDeliveryThursdayAcceptingFirstOrders = async ({
  excludeShopifyOrderId,
  shop,
  thursdayDate,
}: {
  excludeShopifyOrderId?: string | null;
  shop: string;
  thursdayDate: string;
}): Promise<boolean> => {
  if (isUnavailableBuilderDeliveryThursday(thursdayDate)) {
    return false;
  }

  const where: Record<string, unknown> = {
    scheduledDeliveryDate: thursdayDate,
    shop,
    ...BUILDER_FIRST_ORDER_CAPACITY_WHERE,
  };

  if (excludeShopifyOrderId) {
    where.NOT = { shopifyOrderId: excludeShopifyOrderId };
  }

  const firstOrderCount = await resolveDb().boxOrder.count({ where });

  return (
    firstOrderCount < BUILDER_DELIVERY_FIRST_ORDER_CAPACITY
  );
};

export const applyCapacityToBuilderDeliveryDate = async ({
  shop,
  scheduledDeliveryDate,
}: {
  shop: string;
  scheduledDeliveryDate: DeliveryDateString | string | null;
}): Promise<DeliveryDateString | string | null> => {
  if (!scheduledDeliveryDate) {
    return null;
  }

  const accepting = await isBuilderDeliveryThursdayAcceptingFirstOrders({
    shop,
    thursdayDate: scheduledDeliveryDate,
  });

  return accepting ? scheduledDeliveryDate : null;
};
