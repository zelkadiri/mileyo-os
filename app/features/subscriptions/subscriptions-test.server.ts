export const isSubscriptionTestActionsEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_SHOPIFY_BILLING_TEST_BUTTON === "true";
