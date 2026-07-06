import type { ActionFunctionArgs } from "react-router";

import {
  handleSubscriptionContractLifecycleWebhook,
} from "../services/subscriptionContractWebhook.server";
import type { SubscriptionContractWebhookPayload } from "../services/subscriptionContractSync.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  await handleSubscriptionContractLifecycleWebhook({
    payload: payload as SubscriptionContractWebhookPayload,
    shop,
    topic,
  });

  return new Response();
};
