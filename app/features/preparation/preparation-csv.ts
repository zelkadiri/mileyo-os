import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";
import { UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL } from "../../utils/subscriptionObjective";
import { escapeCsvValue } from "../orders/orders-csv";
import { formatBulkPortionGramsCsvCell } from "./preparation-bulk-portion";
import { formatSelectedMealsForCsv } from "./preparation-formatters";
import type {
  PreparationDayData,
  PreparationMealTotal,
  PreparationObjectiveQuantities,
} from "./preparation-types";

export const PREPARATION_PRODUCTION_CSV_FILENAME =
  "mileyo-preparation-production.csv";

export const PREPARATION_DELIVERY_ORDERS_CSV_FILENAME =
  "mileyo-preparation-delivery-orders.csv";

/** Kitchen-facing production CSV: one row per meal, objectives as columns. */
export const PREPARATION_PRODUCTION_CSV_HEADERS = [
  "Date livraison",
  "Plat",
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS],
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[SUBSCRIPTION_OBJECTIVE.BALANCED],
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[SUBSCRIPTION_OBJECTIVE.BULK],
  "Grammage prise de masse (g)",
  UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL,
  "Total",
] as const;

export const PREPARATION_DELIVERY_ORDERS_CSV_HEADERS = [
  "scheduledDeliveryDate",
  "orderName",
  "customerName",
  "customerEmail",
  "orderType",
  "boxTitle",
  "mealsCount",
  "selectedMeals",
  "desiredDeliveryDate",
  "deliveryRescheduleReason",
] as const;

export const PREPARATION_UNKNOWN_OBJECTIVE_LABEL =
  UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL;

export const getPreparationObjectiveLabel = (
  objective: SubscriptionObjective | "unknown",
): string => {
  if (objective === "unknown") {
    return PREPARATION_UNKNOWN_OBJECTIVE_LABEL;
  }

  return SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[objective];
};

/** Stable display / CSV order: weight_loss → balanced → bulk → unknown. */
export const PREPARATION_OBJECTIVE_ROW_ORDER = [
  SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  SUBSCRIPTION_OBJECTIVE.BALANCED,
  SUBSCRIPTION_OBJECTIVE.BULK,
  "unknown",
] as const satisfies ReadonlyArray<keyof PreparationObjectiveQuantities>;

export const buildPreparationProductionCsvRow = (
  mealTotal: PreparationMealTotal,
  scheduledDeliveryDate: string,
): [
  string,
  string,
  number,
  number,
  number,
  number | "",
  number,
  number,
] => [
  scheduledDeliveryDate,
  mealTotal.mealTitle,
  mealTotal.objectiveQuantities.weight_loss,
  mealTotal.objectiveQuantities.balanced,
  mealTotal.objectiveQuantities.bulk,
  formatBulkPortionGramsCsvCell(mealTotal),
  mealTotal.objectiveQuantities.unknown,
  mealTotal.totalQuantity,
];

export const buildPreparationDeliveryOrdersCsvRow = (
  order: PreparationDayData["orders"][number],
) => [
  order.scheduledDeliveryDate,
  order.orderName,
  order.customerName,
  order.customerEmail,
  order.orderType,
  order.boxTitle,
  order.mealsCount,
  formatSelectedMealsForCsv(order.selectedMeals),
  order.desiredDeliveryDate,
  order.deliveryRescheduleReason,
];

export const buildPreparationProductionCsvContent = (data: PreparationDayData) => {
  const rows = [
    PREPARATION_PRODUCTION_CSV_HEADERS,
    ...data.mealTotals.map((mealTotal) =>
      buildPreparationProductionCsvRow(
        mealTotal,
        data.summary.scheduledDeliveryDate,
      ),
    ),
  ];

  return rows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\n");
};

export const buildPreparationDeliveryOrdersCsvContent = (
  data: PreparationDayData,
) => {
  const rows = [
    PREPARATION_DELIVERY_ORDERS_CSV_HEADERS,
    ...data.orders.map(buildPreparationDeliveryOrdersCsvRow),
  ];

  return rows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\n");
};

export const getPreparationProductionExportFilename = (
  scheduledDeliveryDate: string,
) => `preparation-production-${scheduledDeliveryDate}.csv`;

export const getPreparationOrdersExportFilename = (scheduledDeliveryDate: string) =>
  `preparation-orders-${scheduledDeliveryDate}.csv`;

const downloadPreparationCsv = (csv: string, filename: string) => {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const downloadPreparationProductionCsv = (data: PreparationDayData) => {
  downloadPreparationCsv(
    buildPreparationProductionCsvContent(data),
    getPreparationProductionExportFilename(data.summary.scheduledDeliveryDate),
  );
};

export const downloadPreparationDeliveryOrdersCsv = (data: PreparationDayData) => {
  downloadPreparationCsv(
    buildPreparationDeliveryOrdersCsvContent(data),
    getPreparationOrdersExportFilename(data.summary.scheduledDeliveryDate),
  );
};
