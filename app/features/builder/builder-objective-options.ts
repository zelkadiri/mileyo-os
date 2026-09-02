import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";

export type BuilderObjectiveOption = {
  description: string;
  label: string;
  value: SubscriptionObjective;
};

/**
 * UX copy keyed by the shared subscription objective constants.
 * Values are never declared separately from SUBSCRIPTION_OBJECTIVE.
 */
const BUILDER_OBJECTIVE_UX: Record<
  SubscriptionObjective,
  { description: string; label: string }
> = {
  [SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]: {
    description: "Moins de calories, plus de satiété",
    label: "Perte de poids",
  },
  [SUBSCRIPTION_OBJECTIVE.BALANCED]: {
    description: "Un rythme alimentaire équilibré",
    label: "Équilibré",
  },
  [SUBSCRIPTION_OBJECTIVE.BULK]: {
    description: "Plus de protéines et d’énergie",
    label: "Prise de masse",
  },
};

/** Builder objective cards — order and values from SUBSCRIPTION_OBJECTIVES. */
export const BUILDER_OBJECTIVE_OPTIONS: BuilderObjectiveOption[] =
  SUBSCRIPTION_OBJECTIVES.map((value) => ({
    value,
    ...BUILDER_OBJECTIVE_UX[value],
  }));

export const BUILDER_STEPS = [
  "objectif",
  "formule",
  "livraison",
  "repas",
  "email",
] as const;

export type BuilderStep = (typeof BUILDER_STEPS)[number];

export const BUILDER_STEP_COUNT = BUILDER_STEPS.length;

export const isBuilderStep = (value: string): value is BuilderStep =>
  (BUILDER_STEPS as readonly string[]).includes(value);

export const canContinueFromObjective = (
  selected: string | null | undefined,
  options: readonly { value: string }[] = BUILDER_OBJECTIVE_OPTIONS,
): boolean =>
  typeof selected === "string" &&
  options.some((option) => option.value === selected);

export const getBuilderStepIndex = (step: BuilderStep): number =>
  BUILDER_STEPS.indexOf(step);

/** 1-based progress label, e.g. "Étape 1 sur 5". */
export const getBuilderStepLabel = (step: BuilderStep): string =>
  `Étape ${getBuilderStepIndex(step) + 1} sur ${BUILDER_STEP_COUNT}`;

/** Progress fill percent from step index / step count (rounded). */
export const getBuilderStepProgressPercent = (step: BuilderStep): number =>
  Math.round(((getBuilderStepIndex(step) + 1) / BUILDER_STEP_COUNT) * 100);
