import type { ActionFunctionArgs } from "react-router";

import {
  handleSubscriptionBillingAttemptSuccessWebhook,
  type SubscriptionBillingAttemptWebhookPayload,
} from "../services/subscriptionBillingAttemptWebhook.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  await handleSubscriptionBillingAttemptSuccessWebhook({
    payload: payload as SubscriptionBillingAttemptWebhookPayload,
    shop,
    topic,
  });

  return new Response();
};
