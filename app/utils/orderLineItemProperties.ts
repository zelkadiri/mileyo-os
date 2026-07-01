export type LineItemProperty = {
  name?: string;
  value?: unknown;
};

export const getPropertyValue = (
  properties: LineItemProperty[] | undefined,
  name: string,
) => {
  const property = properties?.find((item) => item.name === name);

  return property?.value == null ? null : String(property.value);
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
