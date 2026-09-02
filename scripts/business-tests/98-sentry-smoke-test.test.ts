/**
 * Business regression — SENTRY-1 admin smoke test route (temporary).
 *
 * Static checks only. Never sends real Sentry events.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const countOccurrences = (source: string, pattern: RegExp): number =>
  (source.match(pattern) || []).length;

const runSuite = async () => {
  const ctx = createBusinessTestContext("98-sentry-smoke-test");

  ctx.scenario("A. Route temporaire — fichiers et enregistrement suite");
  {
    const routePath = "app/routes/app.sentry-smoke-test.tsx";
    ctx.assertTrue(`${routePath} existe`, existsSync(join(repoRoot, routePath)));

    const runner = readRepoFile(
      "scripts/business-tests/00-run-business-regression-suite.ts",
    );
    ctx.assertEqual(
      "Suite 98 enregistrée une seule fois dans le runner",
      countOccurrences(runner, /98-sentry-smoke-test\.test\.ts/g),
      1,
    );
  }

  ctx.scenario("B. Auth admin obligatoire");
  {
    const route = readRepoFile("app/routes/app.sentry-smoke-test.tsx");
    ctx.assertEqual(
      "loader appelle authenticate.admin",
      countOccurrences(route, /authenticate\.admin\(request\)/g),
      2,
    );
    ctx.assertTrue(
      "loader déclaré avant action",
      route.indexOf("export const loader") <
        route.indexOf("export const action"),
    );
  }

  ctx.scenario("C. captureTechnicalError — contexte technique sans PII");
  {
    const route = readRepoFile("app/routes/app.sentry-smoke-test.tsx");

    ctx.assertTrue(
      "captureTechnicalError importé et appelé",
      route.includes("captureTechnicalError") &&
        route.includes("new Error(SMOKE_TEST_ERROR_CODE)"),
    );
    ctx.assertTrue(
      "contexte source admin",
      route.includes('source: "admin"'),
    );
    ctx.assertTrue(
      "contexte route smoke test",
      route.includes('route: SMOKE_TEST_ROUTE'),
    );
    ctx.assertTrue(
      "contexte errorCode MILEYO_SENTRY_SMOKE_TEST",
      route.includes('errorCode: SMOKE_TEST_ERROR_CODE'),
    );
    ctx.assertFalse(
      "pas de shop dans le contexte capture",
      /captureTechnicalError\([\s\S]*shop:/.test(route),
    );
    ctx.assertFalse(
      "pas de session.shop transmis",
      route.includes("session.shop"),
    );
    ctx.assertFalse(
      "action ne throw pas après capture",
      /captureTechnicalError[\s\S]{0,120}throw/.test(route),
    );
    ctx.assertTrue(
      "message de confirmation POST",
      route.includes("Événement Sentry envoyé."),
    );
  }

  ctx.scenario("D. Aucune donnée métier / DB / webhook");
  {
    const route = readRepoFile("app/routes/app.sentry-smoke-test.tsx");
    const forbidden = [
      "prisma",
      "db.",
      "checkout",
      "webhook",
      "billing",
      "customer",
      "email",
      "session.shop",
      "admin.graphql",
    ];
    for (const token of forbidden) {
      ctx.assertFalse(`route sans ${token}`, route.includes(token));
    }
  }

  ctx.scenario("E. Absent de la navigation");
  {
    const nav = readRepoFile("app/routes/app.tsx");
    ctx.assertFalse(
      "nav sans lien sentry-smoke-test",
      nav.includes("sentry-smoke-test"),
    );
    ctx.assertFalse(
      "nav sans libellé Sentry smoke test",
      nav.includes("Sentry smoke test"),
    );
  }

  return finishSuite("98-sentry-smoke-test", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
