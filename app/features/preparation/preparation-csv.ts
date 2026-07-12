import { escapeCsvValue } from "../orders/orders-csv";
import { formatSelectedMealsForCsv } from "./preparation-formatters";
import type { PreparationDayData } from "./preparation-types";

export const PREPARATION_PRODUCTION_CSV_FILENAME =
  "mileyo-preparation-production.csv";

export const PREPARATION_DELIVERY_ORDERS_CSV_FILENAME =
  "mileyo-preparation-delivery-orders.csv";

export const PREPARATION_PRODUCTION_CSV_HEADERS = [
  "scheduledDeliveryDate",
  "mealTitle",
  "totalQuantity",
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

export const buildPreparationProductionCsvRow = ({
  mealTitle,
  scheduledDeliveryDate,
  totalQuantity,
}: {
  mealTitle: string;
  scheduledDeliveryDate: string;
  totalQuantity: number;
}) => [scheduledDeliveryDate, mealTitle, totalQuantity];

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
      buildPreparationProductionCsvRow({
        mealTitle: mealTotal.mealTitle,
        scheduledDeliveryDate: data.summary.scheduledDeliveryDate,
        totalQuantity: mealTotal.totalQuantity,
      }),
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
