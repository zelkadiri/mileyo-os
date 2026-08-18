import type { SubscriptionObjective } from "../../constants/subscriptionObjective";
import { SUBSCRIPTION_OBJECTIVE_OPTION_LABEL } from "../../constants/subscriptionObjective";
import { fetchBuilderMealOptions } from "../builder/builder-catalog.server";
import { getMealsForObjective } from "../builder/builder-meal-selection";
import type { BuilderMealOption } from "../builder/builder-types";
import type { PortalMeal } from "./portal-types";

export const fetchPortalMealOptions = fetchBuilderMealOptions;

export const toPortalMealsFromBuilder = (
  meals: readonly BuilderMealOption[],
): PortalMeal[] =>
  meals.map((meal) => ({
    id: meal.variantId,
    imageAlt: meal.imageAlt,
    imageUrl: meal.imageUrl,
    objective: meal.objective,
    title: meal.title,
    variantId: meal.variantId,
    variantTitle: SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[meal.objective],
  }));

export const getPortalMealsForObjective = (
  meals: readonly BuilderMealOption[],
  objective: SubscriptionObjective | null | undefined,
): PortalMeal[] =>
  toPortalMealsFromBuilder(getMealsForObjective(meals, objective));
