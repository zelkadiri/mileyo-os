#!/usr/bin/env npx tsx
/**
 * Mileyo business regression suite runner.
 *
 * Usage:
 *   npm run test:business
 *   npx tsx scripts/business-tests/00-run-business-regression-suite.ts
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type SuiteRun = {
  exitCode: number | null;
  kind: "business" | "legacy";
  name: string;
  output: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const BUSINESS_SUITES = [
  "01-builder-cart-payload.test.ts",
  "02-first-order-delivery-billing.test.ts",
  "03-renewal-cycle.test.ts",
  "04-cutoff-guards.test.ts",
  "05-pause-resume.test.ts",
  "06-portal-state.test.ts",
  "07-preparation-backoffice.test.ts",
  "08-legacy-alignment-backfill.test.ts",
  "09-edge-cases.test.ts",
  "10-subscription-cycle-constants.test.ts",
  "11-subscription-objective-meal-catalog.test.ts",
  "12-subscription-box-catalog.test.ts",
  "13-builder-objective-step.test.ts",
  "14-settings-variant-metafield-definitions.test.ts",
  "15-settings-v2-selling-plans.test.ts",
  "16-settings-v2-box-catalog-provisioning.test.ts",
  "17-builder-v2-box-step.test.ts",
  "18-settings-v2-meal-catalog-provisioning.test.ts",
  "19-builder-v2-meal-step.test.ts",
  "20-builder-weekly-delivery-step.test.ts",
  "21-builder-email-step.test.ts",
  "22-builder-recap-checkout-step.test.ts",
  "23-settings-v2-box-inventory-activation.test.ts",
  "24-checkout-lead-conversion.test.ts",
  "25-subscription-cycle-billing.test.ts",
  "26-subscription-billing-schedule-resolver.test.ts",
  "27-first-order-renewal-cycle-alignment.test.ts",
  "28-billing-runner-cycle-gate.test.ts",
  "29-subscription-payment-recovery-cycle.test.ts",
  "30-portal-resume-cycle-billing.test.ts",
  "31-subscription-delivery-billing-alignment-cycle.test.ts",
  "32-portal-v2-box-catalog.test.ts",
  "33-portal-v2-meal-catalog.test.ts",
];

const LEGACY_SUITES = [
  "dev-delivery-order-integration-tests.ts",
  "dev-delivery-billing-schedule-tests.ts",
  "dev-delivery-cutoff-tests.ts",
  "dev-delivery-date-tests.ts",
  "dev-delivery-cutoff-guard-tests.ts",
  "dev-resume-delivery-schedule-tests.ts",
  "dev-billing-runner-delivery-readiness-tests.ts",
  "dev-delivery-billing-alignment-audit-tests.ts",
  "dev-delivery-property-parsing-tests.ts",
  "dev-preparation-data-tests.ts",
];

const runScript = ({
  kind,
  name,
  scriptPath,
}: {
  kind: "business" | "legacy";
  name: string;
  scriptPath: string;
}): SuiteRun => {
  const startedAt = Date.now();
  const result = spawnSync("npx", ["tsx", scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Date.now() - startedAt;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

  console.log(`\n--- ${name} (${durationMs}ms) ---`);
  if (output) {
    console.log(output);
  }

  return {
    exitCode: result.status,
    kind,
    name,
    output,
  };
};

const main = () => {
  console.log("Mileyo business regression suite\n");
  console.log(`Repo: ${repoRoot}`);
  console.log(
    `Suites: ${BUSINESS_SUITES.length} business + ${LEGACY_SUITES.length} legacy\n`,
  );

  const runs: SuiteRun[] = [
    ...BUSINESS_SUITES.map((file) =>
      runScript({
        kind: "business",
        name: file.replace(".test.ts", ""),
        scriptPath: join(__dirname, file),
      }),
    ),
    ...LEGACY_SUITES.map((file) =>
      runScript({
        kind: "legacy",
        name: file.replace(".ts", ""),
        scriptPath: join(repoRoot, "scripts", file),
      }),
    ),
  ];

  const failed = runs.filter((run) => run.exitCode !== 0);
  const passed = runs.length - failed.length;

  console.log("\n=== Business regression summary ===\n");
  console.log(`Suites launched: ${runs.length}`);
  console.log(`Passed suites:   ${passed}`);
  console.log(`Failed suites:   ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed:");
    for (const run of failed) {
      console.log(`- [${run.kind}] ${run.name} (exit ${run.exitCode ?? "null"})`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nAll business regression suites passed.");
};

main();
