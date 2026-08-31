import type { Prisma } from "@prisma/client";

import db from "../../db.server";
import type { OrdersCancelledWebhookPayload } from "./orders-cancelled-types";

const resolveDb = () => testDb ?? db;

/** @internal Mileyo business regression tests only. */
export const __setOrdersCancelledWebhookTestDb = (
  client: typeof db | null,
): void => {
  testDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetOrdersCancelledWebhookTestDb = (): void => {
  testDb = null;
};

let testDb: typeof db | null = null;

const resolveCancelledAt = ({
  existingCancelledAt,
  payloadCancelledAt,
}: {
  existingCancelledAt: Date | null;
  payloadCancelledAt: string | null | undefined;
}) => {
  if (existingCancelledAt) {
    return existingCancelledAt;
  }

  if (payloadCancelledAt) {
    const parsed = new Date(payloadCancelledAt);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
};

export const handleOrdersCancelledWebhook = async ({
  payload,
  shop,
  topic,
}: {
  payload: OrdersCancelledWebhookPayload;
  shop: string;
  topic: string;
}) => {
  const order = payload;

  console.log(`[ORDERS_CANCELLED] Received ${topic} webhook for ${shop}`);

  if (!order.id) {
    return { outcome: "skipped" as const, reason: "missing_order_id" };
  }

  const shopifyOrderId = String(order.id);
  const existing = await resolveDb().boxOrder.findUnique({
    where: {
      shop_shopifyOrderId: {
        shop,
        shopifyOrderId,
      },
    },
  });

  if (!existing) {
    console.log("[ORDERS_CANCELLED] no matching BoxOrder — no-op", {
      shop,
      shopifyOrderId,
    });
    return { outcome: "skipped" as const, reason: "box_order_not_found" };
  }

  const cancelledAt = resolveCancelledAt({
    existingCancelledAt: existing.cancelledAt,
    payloadCancelledAt: order.cancelled_at,
  });
  const rawOrder = JSON.parse(JSON.stringify(order)) as Prisma.InputJsonValue;

  await resolveDb().boxOrder.update({
    data: {
      cancelledAt,
      ...(order.financial_status != null
        ? { financialStatus: order.financial_status }
        : {}),
      ...(order.fulfillment_status != null
        ? { fulfillmentStatus: order.fulfillment_status }
        : {}),
      rawOrder,
    },
    where: {
      shop_shopifyOrderId: {
        shop,
        shopifyOrderId,
      },
    },
  });

  console.log("[ORDERS_CANCELLED] BoxOrder marked cancelled", {
    boxOrderId: existing.id,
    cancelledAt: cancelledAt.toISOString(),
    preservedExistingTimestamp: Boolean(existing.cancelledAt),
    shop,
    shopifyOrderId,
  });

  return { outcome: "updated" as const, boxOrderId: existing.id };
};
