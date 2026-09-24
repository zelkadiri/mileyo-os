import {
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "../constants/subscriptionObjective";

const SUBSCRIPTION_OBJECTIVE_SET = new Set<string>(SUBSCRIPTION_OBJECTIVES);

export const isSubscriptionObjective = (
  value: unknown,
): value is SubscriptionObjective =>
  typeof value === "string" && SUBSCRIPTION_OBJECTIVE_SET.has(value);

export const parseSubscriptionObjective = (
  value: string | null | undefined,
): SubscriptionObjective | null => {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  return isSubscriptionObjective(trimmed) ? trimmed : null;
};

/** Backoffice display when objective is missing or unresolved. */
export const UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL = "Objectif inconnu";

/** FR label for a canonical objective, or « Objectif inconnu » when null. */
export const formatSubscriptionObjectiveLabel = (
  objective: SubscriptionObjective | null | undefined,
): string => {
  if (!objective) {
    return UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL;
  }

  return SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[objective];
};
