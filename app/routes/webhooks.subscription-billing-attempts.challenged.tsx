import type { ActionFunctionArgs } from "react-router";

import {
  handleSubscriptionBillingAttemptChallengedWebhook,
  type SubscriptionBillingAttemptWebhookPayload,
} from "../services/subscriptionBillingAttemptWebhook.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  await handleSubscriptionBillingAttemptChallengedWebhook({
    payload: payload as SubscriptionBillingAttemptWebhookPayload,
    shop,
    topic,
  });

  return new Response();
};
