export const isSubscriptionTestActionsEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_SHOPIFY_BILLING_TEST_BUTTON === "true";

/** DEV-only recovery retry trigger. Never enabled in production, even with billing test buttons. */
export const isRecoveryDevRetryEnabled = () =>
  process.env.NODE_ENV !== "production";
