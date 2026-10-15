/**
 * Fail-closed confirmation for portal subscriptionContractPause responses.
 * Local DB must only be marked paused when Shopify returns status PAUSED.
 */
export const confirmShopifyPauseContract = (
  contract?: { id?: string | null; status?: string | null } | null,
): { ok: true } | { error: string } => {
  if (!contract?.id) {
    return { error: "Shopify n’a pas confirmé la mise en pause." };
  }

  if (contract.status !== "PAUSED") {
    return {
      error: "Shopify n’a pas confirmé la mise en pause de l’abonnement.",
    };
  }

  return { ok: true };
};
