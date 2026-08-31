import type { ActionFunctionArgs } from "react-router";

import { handleOrdersCancelledWebhook } from "../features/orders-webhook/orders-cancelled-orchestrator.server";
import type { OrdersCancelledWebhookPayload } from "../features/orders-webhook/orders-cancelled-types";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  await handleOrdersCancelledWebhook({
    payload: payload as OrdersCancelledWebhookPayload,
    shop,
    topic,
  });

  return new Response();
};
