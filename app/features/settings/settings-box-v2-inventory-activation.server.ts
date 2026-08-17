/**
 * Activate Box V2 InventoryItems at eligible Shopify locations.
 *
 * Makes untracked CONTINUE variants storefront-available without
 * enabling tracking or writing artificial quantities.
 */

import {
  BOX_V2_MEAL_COUNTS,
} from "../../constants/subscriptionBoxCatalogV2";
import { SUBSCRIPTION_OBJECTIVES } from "../../constants/subscriptionObjective";

export const BOX_V2_EXPECTED_INVENTORY_ITEM_COUNT =
  BOX_V2_MEAL_COUNTS.length * SUBSCRIPTION_OBJECTIVES.length;

export const BOX_V2_LOCATIONS_PAGE_SIZE = 50;
export const BOX_V2_LOCATIONS_MAX_PAGES = 20;

type SettingsAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ShopifyLocationNode = {
  id?: string | null;
  name?: string | null;
  isActive?: boolean | null;
  fulfillsOnlineOrders?: boolean | null;
  isFulfillmentService?: boolean | null;
};

export type InventoryActivationUserError = {
  code?: string | null;
  field?: string[] | null;
  message: string;
};

type GraphqlErrorResponse = {
  data?: {
    product?: {
      variants?: {
        nodes: {
          id: string;
          inventoryItem?: { id?: string | null } | null;
        }[];
      };
    } | null;
    locations?: {
      nodes: ShopifyLocationNode[];
      pageInfo?: {
        hasNextPage?: boolean | null;
        endCursor?: string | null;
      } | null;
    };
    inventoryBulkToggleActivation?: {
      inventoryItem?: { id?: string | null } | null;
      userErrors?: InventoryActivationUserError[];
    };
  };
  errors?: { message?: string | null }[];
};

export const BOX_V2_PRODUCT_INVENTORY_ITEMS_QUERY = `#graphql
  query BoxV2ProductInventoryItems($id: ID!) {
    product(id: $id) {
      variants(first: 50) {
        nodes {
          id
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

export const BOX_V2_ELIGIBLE_LOCATIONS_QUERY = `#graphql
  query BoxV2EligibleLocations($first: Int!, $after: String) {
    locations(first: $first, after: $after) {
      nodes {
        id
        name
        isActive
        fulfillsOnlineOrders
        isFulfillmentService
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const BOX_V2_INVENTORY_BULK_TOGGLE_ACTIVATION_MUTATION = `#graphql
  mutation BoxV2InventoryBulkToggleActivation(
    $inventoryItemId: ID!
    $inventoryItemUpdates: [InventoryBulkToggleActivationInput!]!
  ) {
    inventoryBulkToggleActivation(
      inventoryItemId: $inventoryItemId
      inventoryItemUpdates: $inventoryItemUpdates
    ) {
      inventoryItem {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const graphqlErrorMessages = (json: GraphqlErrorResponse) =>
  (json.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

export const isEligibleFulfillmentLocation = (
  location: ShopifyLocationNode,
): boolean => {
  const id = location.id?.trim();
  if (!id) {
    return false;
  }

  if (location.isActive !== true) {
    return false;
  }

  if (location.fulfillsOnlineOrders !== true) {
    return false;
  }

  if (location.isFulfillmentService === true) {
    return false;
  }

  return true;
};

export const collectEligibleLocationIds = (
  locations: ShopifyLocationNode[],
): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const location of locations) {
    if (!isEligibleFulfillmentLocation(location)) {
      continue;
    }

    const id = location.id?.trim() ?? "";
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
};

export const collectInventoryItemIds = (
  variants: {
    inventoryItem?: { id?: string | null } | null;
  }[],
): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const variant of variants) {
    const id = variant.inventoryItem?.id?.trim() ?? "";
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
};

export const buildInventoryActivationUpdates = (locationIds: string[]) =>
  locationIds.map((locationId) => ({
    activate: true as const,
    locationId,
  }));

export const fetchBoxV2InventoryItemIds = async (
  admin: SettingsAdmin,
  productId: string,
): Promise<{ errors: string[]; inventoryItemIds: string[] }> => {
  const response = await admin.graphql(BOX_V2_PRODUCT_INVENTORY_ITEMS_QUERY, {
    variables: { id: productId },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const errors = graphqlErrorMessages(json);
  if (errors.length > 0) {
    return { errors, inventoryItemIds: [] };
  }

  const variants = json.data?.product?.variants?.nodes ?? [];
  const inventoryItemIds = collectInventoryItemIds(variants);

  if (inventoryItemIds.length !== BOX_V2_EXPECTED_INVENTORY_ITEM_COUNT) {
    return {
      errors: [
        `Nombre d’articles d’inventaire Box V2 inattendu (${inventoryItemIds.length}, attendu ${BOX_V2_EXPECTED_INVENTORY_ITEM_COUNT}).`,
      ],
      inventoryItemIds,
    };
  }

  return { errors: [], inventoryItemIds };
};

export const fetchEligibleLocationIds = async (
  admin: SettingsAdmin,
): Promise<{ errors: string[]; locationIds: string[] }> => {
  const nodes: ShopifyLocationNode[] = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();

  for (let page = 1; page <= BOX_V2_LOCATIONS_MAX_PAGES; page += 1) {
    const response = await admin.graphql(BOX_V2_ELIGIBLE_LOCATIONS_QUERY, {
      variables: {
        first: BOX_V2_LOCATIONS_PAGE_SIZE,
        after,
      },
    });
    const json = (await response.json()) as GraphqlErrorResponse;
    const errors = graphqlErrorMessages(json);
    if (errors.length > 0) {
      return { errors, locationIds: [] };
    }

    const connection = json.data?.locations;
    nodes.push(...(connection?.nodes ?? []));

    const hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    if (!hasNextPage) {
      break;
    }

    const endCursor = connection?.pageInfo?.endCursor?.trim() ?? "";
    if (!endCursor) {
      return {
        errors: [
          "Pagination Shopify des emplacements incomplète (curseur manquant).",
        ],
        locationIds: [],
      };
    }

    if (seenCursors.has(endCursor) || endCursor === after) {
      return {
        errors: [
          "Pagination Shopify des emplacements incohérente (curseur répété).",
        ],
        locationIds: [],
      };
    }

    if (page === BOX_V2_LOCATIONS_MAX_PAGES) {
      return {
        errors: [
          `Pagination des emplacements Shopify interrompue après ${BOX_V2_LOCATIONS_MAX_PAGES} pages.`,
        ],
        locationIds: [],
      };
    }

    seenCursors.add(endCursor);
    after = endCursor;
  }

  const locationIds = collectEligibleLocationIds(nodes);

  if (locationIds.length === 0) {
    return {
      errors: [
        "Aucun emplacement Shopify éligible pour rendre Box Mileyo V2 disponible.",
      ],
      locationIds: [],
    };
  }

  return { errors: [], locationIds };
};

const activateInventoryItemAtLocations = async (
  admin: SettingsAdmin,
  inventoryItemId: string,
  locationIds: string[],
): Promise<{ errors: string[] }> => {
  const response = await admin.graphql(
    BOX_V2_INVENTORY_BULK_TOGGLE_ACTIVATION_MUTATION,
    {
      variables: {
        inventoryItemId,
        inventoryItemUpdates: buildInventoryActivationUpdates(locationIds),
      },
    },
  );
  const json = (await response.json()) as GraphqlErrorResponse;
  const graphQLErrors = graphqlErrorMessages(json);
  const userErrors = (
    json.data?.inventoryBulkToggleActivation?.userErrors ?? []
  ).map((error) => error.message);
  const errors = [...graphQLErrors, ...userErrors];

  if (errors.length > 0) {
    return { errors };
  }

  return { errors: [] };
};

export const ensureInventoryItemsActivatedAtEligibleLocations = async (
  admin: SettingsAdmin,
  productId: string,
): Promise<{ errors: string[]; ok: boolean }> => {
  const inventory = await fetchBoxV2InventoryItemIds(admin, productId);
  if (inventory.errors.length > 0) {
    return { errors: inventory.errors, ok: false };
  }

  const locations = await fetchEligibleLocationIds(admin);
  if (locations.errors.length > 0) {
    return { errors: locations.errors, ok: false };
  }

  console.info(
    `[box-v2-inventory] activating ${inventory.inventoryItemIds.length} inventory items at ${locations.locationIds.length} eligible location(s)`,
  );

  const errors: string[] = [];
  for (const inventoryItemId of inventory.inventoryItemIds) {
    const result = await activateInventoryItemAtLocations(
      admin,
      inventoryItemId,
      locations.locationIds,
    );
    errors.push(...result.errors);
  }

  if (errors.length > 0) {
    return {
      errors: [
        "Impossible d’activer Box Mileyo V2 sur les emplacements de stock.",
        ...errors,
      ],
      ok: false,
    };
  }

  return { errors: [], ok: true };
};
