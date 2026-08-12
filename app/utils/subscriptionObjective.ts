import {
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
