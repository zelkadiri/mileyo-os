import type { SubscriptionObjective } from "../../constants/subscriptionObjective";
import {
  fetchTrustedBoxCatalogOptionsByHandleV2,
  type TrustedBoxCatalogOptionV2,
} from "../../services/subscriptionBoxCatalog.server";
import { toShopifyResourceGid } from "../builder/builder-checkout.server";
import { normalizeShopifyId } from "../../utils/shopifyIds.server";
import { parseSubscriptionObjective } from "../../utils/subscriptionObjective";
import { findBoxLineItem } from "./orders-create-parsers";
import type { OrdersCreateWebhookPayload } from "./orders-create-types";

export type BoxOrderObjectiveSnapshot = {
  boxVariantShopifyId: string;
  objective: SubscriptionObjective;
};

type BoxLineWithVariantId = {
  variant_id?: unknown;
};

type CatalogObjectiveEntry = {
  objective: SubscriptionObjective;
  variantId: string;
};

/** Normalize REST numeric / GID variant ids to a ProductVariant GID. */
export const toBoxVariantShopifyGid = (value: unknown): string | null => {
  if (value == null || value === "") {
    return null;
  }

  // Shopify REST webhooks send variant_id as a number — coerce before GID helper.
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }

    return toShopifyResourceGid("ProductVariant", String(Math.trunc(value)));
  }

  return toShopifyResourceGid("ProductVariant", value);
};

export const extractBoxLineVariantShopifyId = (
  lineItem: BoxLineWithVariantId | null | undefined,
): string | null => {
  if (!lineItem || lineItem.variant_id == null || lineItem.variant_id === "") {
    return null;
  }

  return toBoxVariantShopifyGid(lineItem.variant_id);
};

export const findCatalogOptionByVariantId = (
  catalog: readonly CatalogObjectiveEntry[],
  boxVariantShopifyId: string | null | undefined,
): CatalogObjectiveEntry | null => {
  if (!boxVariantShopifyId) {
    return null;
  }

  const targetNumeric = normalizeShopifyId(boxVariantShopifyId);

  if (!targetNumeric) {
    return null;
  }

  return (
    catalog.find(
      (option) =>
        option.variantId === boxVariantShopifyId ||
        normalizeShopifyId(option.variantId) === targetNumeric,
    ) ?? null
  );
};

export const resolveObjectiveSnapshotFromCatalog = (
  catalog: readonly CatalogObjectiveEntry[],
  boxVariantShopifyId: string | null | undefined,
): BoxOrderObjectiveSnapshot | null => {
  const match = findCatalogOptionByVariantId(catalog, boxVariantShopifyId);

  if (!match) {
    return null;
  }

  const objective = parseSubscriptionObjective(match.objective);

  if (!objective) {
    return null;
  }

  const normalizedVariantId =
    toBoxVariantShopifyGid(match.variantId) ?? match.variantId.trim();

  if (!normalizedVariantId) {
    return null;
  }

  return {
    boxVariantShopifyId: normalizedVariantId,
    objective,
  };
};

/**
 * Resolve historical objective from the paid box line on an orders/create payload.
 * Never uses portal/contract live objective or CheckoutLead.
 */
export const resolveBoxOrderObjectiveSnapshotFromOrder = async ({
  admin,
  fetchCatalog = fetchTrustedBoxCatalogOptionsByHandleV2,
  order,
}: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, string> },
    ) => Promise<Response>;
  };
  fetchCatalog?: (
    admin: {
      graphql: (
        query: string,
        options?: { variables?: Record<string, string> },
      ) => Promise<Response>;
    },
  ) => Promise<TrustedBoxCatalogOptionV2[]>;
  order: OrdersCreateWebhookPayload;
}): Promise<BoxOrderObjectiveSnapshot | null> => {
  const boxLineItem = findBoxLineItem(order);
  const boxVariantShopifyId = extractBoxLineVariantShopifyId(
    boxLineItem as BoxLineWithVariantId | null,
  );

  if (!boxVariantShopifyId) {
    return null;
  }

  const catalog = await fetchCatalog(admin);

  return resolveObjectiveSnapshotFromCatalog(catalog, boxVariantShopifyId);
};

/**
 * Prisma write fragment: only set fields when resolved.
 * Never spreads null — preserves existing snapshots on failed replay resolution.
 */
export const boxOrderObjectiveSnapshotWriteData = (
  snapshot: BoxOrderObjectiveSnapshot | null,
): BoxOrderObjectiveSnapshot | Record<string, never> => {
  if (!snapshot) {
    return {};
  }

  return {
    boxVariantShopifyId: snapshot.boxVariantShopifyId,
    objective: snapshot.objective,
  };
};

/** Resolve from a stored rawOrder JSON (backfill). */
export const resolveBoxOrderObjectiveSnapshotFromRawOrder = async ({
  admin,
  fetchCatalog = fetchTrustedBoxCatalogOptionsByHandleV2,
  rawOrder,
}: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, string> },
    ) => Promise<Response>;
  };
  fetchCatalog?: (
    admin: {
      graphql: (
        query: string,
        options?: { variables?: Record<string, string> },
      ) => Promise<Response>;
    },
  ) => Promise<TrustedBoxCatalogOptionV2[]>;
  rawOrder: unknown;
}): Promise<
  | { ok: true; snapshot: BoxOrderObjectiveSnapshot }
  | {
      ok: false;
      reason:
        | "missingRawOrder"
        | "missingBoxLine"
        | "missingVariantId"
        | "variantNotFound"
        | "invalidObjective";
    }
> => {
  if (rawOrder == null || typeof rawOrder !== "object") {
    return { ok: false, reason: "missingRawOrder" };
  }

  const order = rawOrder as OrdersCreateWebhookPayload;
  const boxLineItem = findBoxLineItem(order);

  if (!boxLineItem) {
    return { ok: false, reason: "missingBoxLine" };
  }

  const boxVariantShopifyId = extractBoxLineVariantShopifyId(
    boxLineItem as BoxLineWithVariantId,
  );

  if (!boxVariantShopifyId) {
    return { ok: false, reason: "missingVariantId" };
  }

  const catalog = await fetchCatalog(admin);
  const match = findCatalogOptionByVariantId(catalog, boxVariantShopifyId);

  if (!match) {
    return { ok: false, reason: "variantNotFound" };
  }

  const objective = parseSubscriptionObjective(match.objective);

  if (!objective) {
    return { ok: false, reason: "invalidObjective" };
  }

  const normalizedVariantId =
    toBoxVariantShopifyGid(match.variantId) ?? match.variantId.trim();

  if (!normalizedVariantId) {
    return { ok: false, reason: "missingVariantId" };
  }

  return {
    ok: true,
    snapshot: {
      boxVariantShopifyId: normalizedVariantId,
      objective,
    },
  };
};
