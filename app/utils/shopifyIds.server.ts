export const normalizeShopifyId = (value: unknown) => {
  if (value == null) {
    return null;
  }

  const stringValue = String(value);

  if (stringValue.includes("/")) {
    return stringValue.split("/").pop() ?? stringValue;
  }

  return stringValue;
};
