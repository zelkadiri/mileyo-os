import type { SubscriptionObjective } from "../constants/subscriptionObjective";
import { findBuilderBoxByVariantId } from "../features/builder/builder-box-selection";
import type { BuilderBoxOption } from "../features/builder/builder-types";
import type { ShopifyAdminGraphql } from "./subscriptionBillingWorker.server";
import { fetchSubscriptionContractCurrentVariantId } from "./subscriptionContractBoxChange.server";

/**
 * Resolve objective from a box catalog entry already keyed by variant id.
 * Pure — no Shopify I/O.
 */
export const resolveSubscriptionObjectiveFromVariantId = (
  catalog: readonly BuilderBoxOption[],
  variantId: string | null | undefined,
): SubscriptionObjective | null =>
  findBuilderBoxByVariantId(catalog, variantId)?.objective ?? null;

/**
 * Current / next-cycle subscription objective:
 * 1. live Shopify contract variant
 * 2. fallback selection.boxVariantShopifyId
 * 3. catalog objective
 *
 * Never uses BoxOrder.objective or CheckoutLead.
 */
export const resolveCurrentSubscriptionObjective = async ({
  admin,
  boxVariantShopifyId,
  catalog,
  fetchContractVariantId = fetchSubscriptionContractCurrentVariantId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  boxVariantShopifyId: string | null | undefined;
  catalog: readonly BuilderBoxOption[];
  fetchContractVariantId?: (
    admin: ShopifyAdminGraphql,
    subscriptionContractId: string,
  ) => Promise<string | null>;
  subscriptionContractId: string | null | undefined;
}): Promise<SubscriptionObjective | null> => {
  let currentVariantId: string | null = null;

  if (subscriptionContractId) {
    try {
      currentVariantId = await fetchContractVariantId(
        admin,
        subscriptionContractId,
      );
    } catch {
      currentVariantId = null;
    }
  }

  if (!currentVariantId) {
    currentVariantId = boxVariantShopifyId?.trim() || null;
  }

  return resolveSubscriptionObjectiveFromVariantId(catalog, currentVariantId);
};
