import {
  BOX_V2_MEAL_COUNT_OPTION_LABEL,
  BOX_V2_MEAL_COUNTS,
  type BoxV2MealCount,
} from "../../constants/subscriptionBoxCatalogV2";
import {
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";
import { filterBuilderBoxesByObjective } from "../builder/builder-box-selection";
import type { BuilderBoxOption } from "../builder/builder-types";
import type { PortalBoxProduct } from "./portal-types";

const BOX_V2_MEAL_COUNT_SET = new Set<number>(BOX_V2_MEAL_COUNTS);

export const isPortalV2MealCount = (
  value: number,
): value is BoxV2MealCount => BOX_V2_MEAL_COUNT_SET.has(value);

export const getPortalV2BoxTitle = (mealCount: number): string => {
  if (!isPortalV2MealCount(mealCount)) {
    return `${mealCount} repas`;
  }

  return `Box ${BOX_V2_MEAL_COUNT_OPTION_LABEL[mealCount]}`;
};

export const getPortalObjectiveLabel = (
  objective: SubscriptionObjective | null | undefined,
): string | null => {
  if (!objective) {
    return null;
  }

  return SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[objective];
};

export const toPortalV2BoxProduct = (
  box: BuilderBoxOption,
): PortalBoxProduct => ({
  imageAlt: box.productTitle,
  imageUrl: null,
  mealCount: box.mealCount,
  objective: box.objective,
  price: box.price,
  title: getPortalV2BoxTitle(box.mealCount),
  variantId: box.variantId,
});

export const toPortalV2BoxProducts = (
  boxes: readonly BuilderBoxOption[],
): PortalBoxProduct[] =>
  boxes
    .filter((box) => isPortalV2MealCount(box.mealCount))
    .slice()
    .sort((left, right) => left.mealCount - right.mealCount)
    .map(toPortalV2BoxProduct);

export const getPortalPickerBoxesForObjective = (
  boxes: readonly BuilderBoxOption[],
  objective: SubscriptionObjective | null | undefined,
): PortalBoxProduct[] =>
  toPortalV2BoxProducts(filterBuilderBoxesByObjective(boxes, objective));
