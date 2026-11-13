/**
 * Temporary P0 billing holds — contract stays ACTIVE; all charge entry points skip.
 * Clear an id only after deliveries / refunds / NBD are reconciled by ops.
 * Never auto-schedule the next renewal for held contracts.
 *
 * 2026-11-10: 26652508488 (Hossam) cleared after Shopify A3 Saturday realign +
 * calendar sync (NBD 2026-11-13T23:05:00Z / NSDD 2026-11-19). List empty until
 * the next incident — re-add numeric contract ids here to re-enable a hold.
 */
export const SUBSCRIPTION_BILLING_INCIDENT_HOLD_CONTRACT_IDS = [] as const;

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
