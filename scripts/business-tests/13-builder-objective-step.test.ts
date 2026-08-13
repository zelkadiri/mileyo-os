/**
 * Business regression — builder objective step (13D).
 */
import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVES,
} from "../../app/constants/subscriptionObjective";
import {
  BUILDER_OBJECTIVE_OPTIONS,
  BUILDER_STEP_COUNT,
  BUILDER_STEPS,
  canContinueFromObjective,
  getBuilderStepIndex,
  getBuilderStepLabel,
  getBuilderStepProgressPercent,
} from "../../app/features/builder/builder-objective-options";
import { createBusinessTestContext, finishSuite } from "./_framework";

const runSuite = () => {
  const ctx = createBusinessTestContext("13-builder-objective-step");

  ctx.scenario("A. Objective options — exact métier values");
  ctx.given("les options builder dérivées de SUBSCRIPTION_OBJECTIVES");
  ctx.assertEqual("exactly 3 options", BUILDER_OBJECTIVE_OPTIONS.length, 3);
  ctx.assertEqual(
    "option values match SUBSCRIPTION_OBJECTIVES",
    BUILDER_OBJECTIVE_OPTIONS.map((option) => option.value).join("|"),
    [...SUBSCRIPTION_OBJECTIVES].join("|"),
  );
  ctx.assertEqual(
    "weight_loss present",
    BUILDER_OBJECTIVE_OPTIONS.some(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
    true,
  );
  ctx.assertEqual(
    "balanced present",
    BUILDER_OBJECTIVE_OPTIONS.some(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.BALANCED,
    ),
    true,
  );
  ctx.assertEqual(
    "bulk present",
    BUILDER_OBJECTIVE_OPTIONS.some(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.BULK,
    ),
    true,
  );
  ctx.assertEqual(
    "no fourth métier value",
    BUILDER_OBJECTIVE_OPTIONS.some(
      (option) =>
        option.value !== SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS &&
        option.value !== SUBSCRIPTION_OBJECTIVE.BALANCED &&
        option.value !== SUBSCRIPTION_OBJECTIVE.BULK,
    ),
    false,
  );

  ctx.scenario("B. Labels and descriptions");
  for (const option of BUILDER_OBJECTIVE_OPTIONS) {
    ctx.assertTrue(
      `${option.value} label non-empty`,
      option.label.trim().length > 0,
    );
    ctx.assertTrue(
      `${option.value} description non-empty`,
      option.description.trim().length > 0,
    );
    ctx.assertEqual(
      `${option.value} is in SUBSCRIPTION_OBJECTIVES`,
      (SUBSCRIPTION_OBJECTIVES as readonly string[]).includes(option.value),
      true,
    );
  }
  ctx.assertEqual(
    "weight_loss label",
    BUILDER_OBJECTIVE_OPTIONS.find(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    )?.label,
    "Perte de poids",
  );
  ctx.assertEqual(
    "balanced label",
    BUILDER_OBJECTIVE_OPTIONS.find(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.BALANCED,
    )?.label,
    "Équilibré",
  );
  ctx.assertEqual(
    "bulk label",
    BUILDER_OBJECTIVE_OPTIONS.find(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.BULK,
    )?.label,
    "Prise de masse",
  );

  ctx.scenario("C. Step order — objectif first");
  ctx.assertEqual("step count is 4", BUILDER_STEP_COUNT, 4);
  ctx.assertEqual("first step is objectif", BUILDER_STEPS[0], "objectif");
  ctx.assertEqual(
    "full step order",
    BUILDER_STEPS.join("→"),
    "objectif→formule→livraison→repas",
  );
  ctx.assertEqual("objectif index", getBuilderStepIndex("objectif"), 0);
  ctx.assertEqual("formule index", getBuilderStepIndex("formule"), 1);
  ctx.assertEqual("livraison index", getBuilderStepIndex("livraison"), 2);
  ctx.assertEqual("repas index", getBuilderStepIndex("repas"), 3);
  ctx.assertEqual(
    "internal formule id preserved (UX copy is Box)",
    BUILDER_STEPS[1],
    "formule",
  );

  ctx.scenario("D. Objective continue validation");
  ctx.assertFalse("null cannot continue", canContinueFromObjective(null));
  ctx.assertFalse(
    "undefined cannot continue",
    canContinueFromObjective(undefined),
  );
  ctx.assertFalse("empty cannot continue", canContinueFromObjective(""));
  ctx.assertTrue(
    "weight_loss can continue",
    canContinueFromObjective(SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
  );
  ctx.assertTrue(
    "balanced can continue",
    canContinueFromObjective(SUBSCRIPTION_OBJECTIVE.BALANCED),
  );
  ctx.assertTrue(
    "bulk can continue",
    canContinueFromObjective(SUBSCRIPTION_OBJECTIVE.BULK),
  );
  ctx.assertFalse(
    "unknown value cannot continue",
    canContinueFromObjective("lose_weight"),
  );

  ctx.scenario("E. Serialization / single source of truth");
  ctx.assertEqual(
    "options length equals SUBSCRIPTION_OBJECTIVES length",
    BUILDER_OBJECTIVE_OPTIONS.length,
    SUBSCRIPTION_OBJECTIVES.length,
  );
  for (let index = 0; index < SUBSCRIPTION_OBJECTIVES.length; index += 1) {
    ctx.assertEqual(
      `option[${index}] value from SUBSCRIPTION_OBJECTIVES`,
      BUILDER_OBJECTIVE_OPTIONS[index]?.value,
      SUBSCRIPTION_OBJECTIVES[index],
    );
  }

  ctx.scenario("Progress labels for 4 steps");
  ctx.assertEqual(
    "objectif label",
    getBuilderStepLabel("objectif"),
    "Étape 1 sur 4",
  );
  ctx.assertEqual(
    "formule label",
    getBuilderStepLabel("formule"),
    "Étape 2 sur 4",
  );
  ctx.assertEqual(
    "livraison label",
    getBuilderStepLabel("livraison"),
    "Étape 3 sur 4",
  );
  ctx.assertEqual("repas label", getBuilderStepLabel("repas"), "Étape 4 sur 4");
  ctx.assertEqual(
    "objectif progress",
    getBuilderStepProgressPercent("objectif"),
    25,
  );
  ctx.assertEqual(
    "formule progress",
    getBuilderStepProgressPercent("formule"),
    50,
  );
  ctx.assertEqual(
    "livraison progress",
    getBuilderStepProgressPercent("livraison"),
    75,
  );
  ctx.assertEqual("repas progress", getBuilderStepProgressPercent("repas"), 100);

  return finishSuite("13-builder-objective-step", ctx);
};

process.exitCode = runSuite();
