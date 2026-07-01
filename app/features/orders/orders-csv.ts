import type { AdminOrderDto } from "./orders-types";
import { formatCsvDateTime, getSelectedMealsFromJson } from "./orders-formatters";

export const ORDERS_CSV_FILENAME = "mileyo-box-orders.csv";

export const ORDERS_CSV_HEADERS = [
  "Order",
  "Customer",
  "Email",
  "Type",
  "Box",
  "Meals count",
  "Selected meals",
  "Selected meals source",
  "Subscription renewal",
  "Simulated",
  "Financial status",
  "Fulfillment status",
  "Created at",
] as const;

export const escapeCsvValue = (value: unknown) => {
  const stringValue = value == null ? "" : String(value);

  return `"${stringValue.replace(/"/g, '""')}"`;
};

export const buildOrdersCsvRow = (order: AdminOrderDto) => [
  order.shopifyOrderName,
  order.customerName,
  order.customerEmail,
  order.orderType,
  order.boxTitle,
  order.mealsCount,
  getSelectedMealsFromJson(order.selectedMeals).join(" | "),
  order.selectedMealsSource,
  order.isSubscriptionRenewal ? "yes" : "no",
  order.simulated ? "yes" : "no",
  order.financialStatus,
  order.fulfillmentStatus,
  formatCsvDateTime(order.createdAt),
];

export const buildOrdersCsvContent = (orders: AdminOrderDto[]) => {
  const rows = [ORDERS_CSV_HEADERS, ...orders.map(buildOrdersCsvRow)];

  return rows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\n");
};

export const downloadOrdersCsv = (orders: AdminOrderDto[]) => {
  const csv = buildOrdersCsvContent(orders);
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");

  link.href = url;
  link.download = ORDERS_CSV_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
};
