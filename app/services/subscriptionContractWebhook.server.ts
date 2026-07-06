import { unauthenticated } from "../shopify.server";
import {
  extractSubscriptionContractIdFromWebhookPayload,
  syncSubscriptionContractState,
  type SubscriptionContractWebhookPayload,
} from "./subscriptionContractSync.server";

export const handleSubscriptionContractLifecycleWebhook = async ({
  payload,
  shop,
  topic,
}: {
  payload: SubscriptionContractWebhookPayload;
  shop: string;
  topic: string;
}) => {
  const subscriptionContractId =
    extractSubscriptionContractIdFromWebhookPayload(payload);

  console.log("[SUBSCRIPTION_CONTRACT_SYNC] webhook received", {
    contractId: subscriptionContractId,
    payloadStatus: payload.status ?? null,
    shop,
    topic,
  });

  if (!subscriptionContractId) {
    console.log("[SUBSCRIPTION_CONTRACT_SYNC] webhook ignored — missing contract id", {
      shop,
      topic,
    });
    return;
  }

  const { admin } = await unauthenticated.admin(shop);

  await syncSubscriptionContractState({
    admin,
    shop,
    source: "webhook",
    subscriptionContractId,
    webhookTopic: topic,
  });
};
