/**
 * Temporary P0 billing holds — contract stays ACTIVE; all charge entry points skip.
 * Clear an id only after deliveries / refunds / NBD are reconciled by ops.
 * Never auto-schedule the next renewal for held contracts.
 */
export const SUBSCRIPTION_BILLING_INCIDENT_HOLD_CONTRACT_IDS = [
  /** Contract 26652508488 — daily double-charge incident; do not bill until ops clears. */
  "26652508488",
] as const;

export const isSubscriptionBillingIncidentHeld = (
  subscriptionContractId: string | null | undefined,
): boolean => {
  if (!subscriptionContractId) {
    return false;
  }
  const normalized = subscriptionContractId.replace(
    /^gid:\/\/shopify\/SubscriptionContract\//,
    "",
  );
  return (SUBSCRIPTION_BILLING_INCIDENT_HOLD_CONTRACT_IDS as readonly string[]).includes(
    normalized,
  );
};
