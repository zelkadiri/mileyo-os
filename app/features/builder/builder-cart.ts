/**
 * Targeted Ajax-cart helpers for replacing a Mileyo builder Box
 * without clearing unrelated one-time extras.
 */

import { DELIVERY_DATE_PROPERTY_TECHNICAL } from "../../utils/orderLineItemProperties";

export const BUILDER_CART_ORDER_TYPE_PROPERTY = "Type de commande";
export const BUILDER_CART_ORDER_TYPE_SUBSCRIPTION = "Abonnement hebdomadaire";
export const BUILDER_CART_MEAL_COUNT_PROPERTY = "Nombre de repas";
export const BUILDER_CART_PREPARE_ERROR =
  "Impossible de préparer votre panier. Réessayez.";

export type CartLineLike = {
  id?: unknown;
  key?: unknown;
  properties?: unknown;
  selling_plan?: unknown;
  selling_plan_allocation?: unknown;
  variant_id?: unknown;
};

/** Normalize GID or numeric Shopify ids to the trailing numeric token. */
export const getShopifyNumericId = (value: unknown): string => {
  if (value == null) {
    return "";
  }

  const raw = String(value).trim();
  if (!raw) {
    return "";
  }

  const parts = raw.split("/");
  return parts[parts.length - 1] || "";
};

export const getCartLineProperty = (
  properties: unknown,
  name: string,
): string | null => {
  if (!properties) {
    return null;
  }

  if (Array.isArray(properties)) {
    for (const entry of properties) {
      if (!entry || typeof entry !== "object" || !("name" in entry)) {
        continue;
      }
      const item = entry as { name?: unknown; value?: unknown };
      if (item.name !== name || item.value == null) {
        continue;
      }
      const text = String(item.value).trim();
      return text || null;
    }
    return null;
  }

  if (typeof properties === "object") {
    const value = (properties as Record<string, unknown>)[name];
    if (value == null) {
      return null;
    }
    const text = String(value).trim();
    return text || null;
  }

  return null;
};

const hasSellingPlanOnLine = (item: CartLineLike): boolean =>
  Boolean(item.selling_plan_allocation || item.selling_plan);

export const isMileyoBuilderBoxCatalogLine = (
  item: CartLineLike,
  catalogNumericIds: readonly string[],
): boolean => {
  const numericId = getShopifyNumericId(
    item.variant_id != null ? item.variant_id : item.id,
  );
  if (!numericId || catalogNumericIds.length === 0) {
    return false;
  }
  return catalogNumericIds.includes(numericId);
};

export const isMileyoBuilderBoxLegacyLine = (item: CartLineLike): boolean => {
  if (!hasSellingPlanOnLine(item)) {
    return false;
  }

  return (
    getCartLineProperty(item.properties, BUILDER_CART_ORDER_TYPE_PROPERTY) ===
      BUILDER_CART_ORDER_TYPE_SUBSCRIPTION &&
    Boolean(
      getCartLineProperty(item.properties, DELIVERY_DATE_PROPERTY_TECHNICAL),
    ) &&
    Boolean(
      getCartLineProperty(item.properties, BUILDER_CART_MEAL_COUNT_PROPERTY),
    )
  );
};

export const isMileyoBuilderBoxLine = (
  item: CartLineLike,
  catalogNumericIds: readonly string[],
): boolean =>
  isMileyoBuilderBoxCatalogLine(item, catalogNumericIds) ||
  isMileyoBuilderBoxLegacyLine(item);

export const getCartLineKey = (item: CartLineLike): string | null => {
  if (item.key == null) {
    return null;
  }
  const key = String(item.key).trim();
  return key || null;
};

export const collectMileyoBuilderBoxLineKeys = (
  items: readonly CartLineLike[] | null | undefined,
  catalogNumericIds: readonly string[],
): string[] => {
  if (!items) {
    return [];
  }

  const keys: string[] = [];
  for (const item of items) {
    if (!isMileyoBuilderBoxLine(item, catalogNumericIds)) {
      continue;
    }
    const key = getCartLineKey(item);
    if (key) {
      keys.push(key);
    }
  }
  return keys;
};

export const toCatalogNumericIds = (
  boxes: readonly { variantId?: unknown }[] | null | undefined,
): string[] => {
  if (!boxes) {
    return [];
  }

  const ids: string[] = [];
  for (const box of boxes) {
    const numericId = getShopifyNumericId(box.variantId);
    if (numericId) {
      ids.push(numericId);
    }
  }
  return ids;
};

/** Browser runtime — keep in sync with the typed helpers above. */
export const builderCartRuntimeScript = `
  function getShopifyNumericId(value) {
    if (value == null) return "";
    var raw = String(value).trim();
    if (!raw) return "";
    var parts = raw.split("/");
    return parts[parts.length - 1] || "";
  }

  function getCartLineProperty(properties, name) {
    if (!properties) return "";
    if (Object.prototype.toString.call(properties) === "[object Array]") {
      for (var index = 0; index < properties.length; index += 1) {
        var entry = properties[index];
        if (!entry || entry.name !== name || entry.value == null) continue;
        var text = String(entry.value).trim();
        if (text) return text;
      }
      return "";
    }
    if (typeof properties === "object") {
      var value = properties[name];
      if (value == null) return "";
      return String(value).trim();
    }
    return "";
  }

  function hasSellingPlanOnLine(item) {
    return Boolean(item && (item.selling_plan_allocation || item.selling_plan));
  }

  function isMileyoBuilderBoxCatalogLine(item, catalogNumericIds) {
    if (!item || !catalogNumericIds || !catalogNumericIds.length) return false;
    var numericId = getShopifyNumericId(
      item.variant_id != null ? item.variant_id : item.id
    );
    if (!numericId) return false;
    return catalogNumericIds.indexOf(numericId) !== -1;
  }

  function isMileyoBuilderBoxLegacyLine(item) {
    if (!item || !hasSellingPlanOnLine(item)) return false;
    return (
      getCartLineProperty(item.properties, "Type de commande") === "Abonnement hebdomadaire" &&
      Boolean(getCartLineProperty(item.properties, "_mileyo_delivery_date")) &&
      Boolean(getCartLineProperty(item.properties, "Nombre de repas"))
    );
  }

  function isMileyoBuilderBoxLine(item, catalogNumericIds) {
    return (
      isMileyoBuilderBoxCatalogLine(item, catalogNumericIds) ||
      isMileyoBuilderBoxLegacyLine(item)
    );
  }

  function getCartLineKey(item) {
    if (!item || item.key == null) return "";
    return String(item.key).trim();
  }

  function collectMileyoBuilderBoxLineKeys(items, catalogNumericIds) {
    var keys = [];
    if (!items) return keys;
    for (var index = 0; index < items.length; index += 1) {
      var item = items[index];
      if (!isMileyoBuilderBoxLine(item, catalogNumericIds)) continue;
      var key = getCartLineKey(item);
      if (key) keys.push(key);
    }
    return keys;
  }

  function toCatalogNumericIds(boxes) {
    var ids = [];
    if (!boxes) return ids;
    for (var index = 0; index < boxes.length; index += 1) {
      var numericId = getShopifyNumericId(boxes[index] && boxes[index].variantId);
      if (numericId) ids.push(numericId);
    }
    return ids;
  }
`;
