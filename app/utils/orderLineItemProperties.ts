import {
  parseDeliveryDate,
  type DeliveryDateString,
} from "./deliveryDate";

export type LineItemProperty = {
  name?: string;
  value?: unknown;
};

export const DELIVERY_DATE_PROPERTY_TECHNICAL = "_mileyo_delivery_date";
export const DELIVERY_DATE_PROPERTY_VISIBLE = "Date de livraison souhaitée";

const ISO_DATE_IN_PARENS_PATTERN = /\((\d{4}-\d{2}-\d{2})\)/;
const ISO_DATE_PATTERN = /\d{4}-\d{2}-\d{2}/;

const parseVisibleDeliveryDateValue = (
  value: string | null | undefined,
): DeliveryDateString | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const direct = parseDeliveryDate(trimmed);

  if (direct) {
    return direct;
  }

  const parenMatch = trimmed.match(ISO_DATE_IN_PARENS_PATTERN);

  if (parenMatch) {
    return parseDeliveryDate(parenMatch[1]);
  }

  const isoMatch = trimmed.match(ISO_DATE_PATTERN);

  if (isoMatch) {
    return parseDeliveryDate(isoMatch[0]);
  }

  return null;
};

export const getPropertyValue = (
  properties: LineItemProperty[] | undefined,
  name: string,
) => {
  const property = properties?.find((item) => item.name === name);

  return property?.value == null ? null : String(property.value);
};

export const getDeliveryDateFromLineItemProperties = (
  properties: LineItemProperty[] | undefined,
): DeliveryDateString | null => {
  const technicalDate = parseDeliveryDate(
    getPropertyValue(properties, DELIVERY_DATE_PROPERTY_TECHNICAL),
  );

  if (technicalDate) {
    return technicalDate;
  }

  return parseVisibleDeliveryDateValue(
    getPropertyValue(properties, DELIVERY_DATE_PROPERTY_VISIBLE),
  );
};

export const getSelectedMealsFromLineItemProperties = (
  properties: LineItemProperty[] | undefined,
) => {
  const jsonValue = getPropertyValue(properties, "_mileyo_selected_meals_json");

  if (jsonValue) {
    try {
      const parsed = JSON.parse(jsonValue) as unknown;

      if (Array.isArray(parsed)) {
        return parsed.map((meal) => String(meal));
      }
    } catch {
      // Fall back to Plat 1, Plat 2, ...
    }
  }

  return (properties ?? [])
    .filter((property) => property.name?.match(/^Plat \d+$/) && property.value)
    .sort((left, right) => {
      const leftIndex = Number.parseInt(
        left.name?.replace("Plat ", "") ?? "0",
        10,
      );
      const rightIndex = Number.parseInt(
        right.name?.replace("Plat ", "") ?? "0",
        10,
      );

      return leftIndex - rightIndex;
    })
    .map((property) => String(property.value));
};
