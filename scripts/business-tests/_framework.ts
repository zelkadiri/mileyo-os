import type { PortalMeal } from "../../app/features/portal/portal-types";
import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";

export type BusinessCheck = {
  detail: string;
  name: string;
  ok: boolean;
  scenario: string | null;
};

export const samplePortalMeals = (count: number): PortalMeal[] =>
  Array.from({ length: count }, (_, index) => ({
    allergenes: [],
    badges: [],
    calories: null,
    carbs: null,
    fat: null,
    id: `meal-${index + 1}`,
    imageAlt: `Plat ${index + 1}`,
    imageUrl: null,
    ingredients: [],
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    portionGrams: null,
    proteins: null,
    title: `Plat ${index + 1}`,
    variantId: `meal-${index + 1}`,
    variantTitle: "Perte de poids",
  }));

export type BusinessSuiteResult = {
  checks: BusinessCheck[];
  failed: number;
  passed: number;
  suite: string;
};

export const createBusinessTestContext = (suiteName: string) => {
  const checks: BusinessCheck[] = [];
  let currentScenario: string | null = null;

  const pass = (name: string, detail: string) => {
    checks.push({ detail, name, ok: true, scenario: currentScenario });
  };

  const fail = (name: string, detail: string) => {
    checks.push({ detail, name, ok: false, scenario: currentScenario });
  };

  return {
    assertEqual(name: string, actual: unknown, expected: unknown) {
      if (actual === expected) {
        pass(name, `expected=${String(expected)}`);
      } else {
        fail(name, `expected=${String(expected)}, got=${String(actual)}`);
      }
    },
    assertFalse(name: string, actual: unknown) {
      this.assertEqual(name, actual, false);
    },
    assertNull(name: string, actual: unknown) {
      this.assertEqual(name, actual, null);
    },
    assertTrue(name: string, actual: unknown) {
      this.assertEqual(name, actual, true);
    },
    checks,
    finish(): BusinessSuiteResult {
      const failed = checks.filter((check) => !check.ok).length;

      return {
        checks,
        failed,
        passed: checks.length - failed,
        suite: suiteName,
      };
    },
    given(description: string) {
      currentScenario = `Given ${description}`;
    },
    scenario(title: string) {
      currentScenario = title;
    },
    then(description: string) {
      currentScenario = currentScenario
        ? `${currentScenario} → Then ${description}`
        : `Then ${description}`;
    },
    when(description: string) {
      currentScenario = currentScenario
        ? `${currentScenario} → When ${description}`
        : `When ${description}`;
    },
  };
};

export const printSuiteResult = (result: BusinessSuiteResult) => {
  console.log(`\n=== ${result.suite} ===\n`);

  let lastScenario: string | null = null;

  for (const check of result.checks) {
    if (check.scenario && check.scenario !== lastScenario) {
      console.log(`\nScenario: ${check.scenario}`);
      lastScenario = check.scenario;
    }

    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(
    `\n${result.suite}: ${result.passed}/${result.checks.length} passed`,
  );
};

export const finishSuite = (
  suiteName: string,
  ctx: ReturnType<typeof createBusinessTestContext>,
) => {
  const result = ctx.finish();
  printSuiteResult(result);
  return result.failed > 0 ? 1 : 0;
};
