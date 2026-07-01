import type { ActionFunctionArgs } from "react-router";

import { handleOrdersCreateWebhook } from "../features/orders-webhook/orders-create-orchestrator.server";
import type { OrdersCreateWebhookPayload } from "../features/orders-webhook/orders-create-types";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  await handleOrdersCreateWebhook({
    payload: payload as OrdersCreateWebhookPayload,
    shop,
    topic,
  });

  return new Response();
};
