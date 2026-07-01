/** Numeric Shopify resource ID (e.g. `25391857804`), never a GID path. */
export const normalizeShopifyId = (value: unknown) => {
  if (value == null) {
    return null;
  }

  const stringValue = String(value).trim();

  if (!stringValue) {
    return null;
  }

  if (stringValue.includes("/")) {
    return stringValue.split("/").pop() ?? stringValue;
  }

  return stringValue;
};

export const toShopifyOrderGid = (shopifyOrderId: string) =>
  shopifyOrderId.includes("/")
    ? shopifyOrderId
    : `gid://shopify/Order/${normalizeShopifyId(shopifyOrderId) ?? shopifyOrderId}`;

export const toSubscriptionContractGid = (subscriptionContractId: string) => {
  const normalized =
    normalizeShopifyId(subscriptionContractId) ?? subscriptionContractId;

  return subscriptionContractId.includes("/")
    ? subscriptionContractId
    : `gid://shopify/SubscriptionContract/${normalized}`;
};

export const shopifyIdsMatch = (
  storedId: string | null | undefined,
  incomingId: string | null | undefined,
) => {
  if (!storedId || !incomingId) {
    return false;
  }

  return normalizeShopifyId(storedId) === normalizeShopifyId(incomingId);
};

/** Prisma `where` clause matching either numeric or GID contract storage. */
export const subscriptionContractIdOrFilter = (contractId: string) => {
  const normalized = normalizeShopifyId(contractId) ?? contractId;

  return {
    OR: [
      { subscriptionContractId: normalized },
      { subscriptionContractId: `gid://shopify/SubscriptionContract/${normalized}` },
    ],
  };
};
