/**
 * Business regression — BOX-CHANGE-7E forecast « À venir » × pending box.
 *
 * Read-only: buildForecastCycles switches to pending target meals/title/price
 * when estimatedBillingDate >= effectiveBillingDate. No DB/Shopify mutation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getPortalV2BoxTitle } from "../../app/features/portal/portal-boxes";
import { buildForecastCycles } from "../../app/features/portal/portal-data.server";
import type { PortalPendingBoxChange } from "../../app/features/portal/portal-types";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const WEEKLY = { interval: "WEEK", intervalCount: 1 } as const;

/** nextBillingDate = X (pending applies here). Forecast pushes X+1w, X+2w, X+3w. */
const NEXT_BILLING = new Date("2026-08-29T22:05:00.000Z");
const CURRENT_PRICE = "96.33";
const PENDING_12_PRICE = "112.00";
const PENDING_16_PRICE = "140.00";
const PENDING_8_PRICE = "80.00";

const pendingDto = (
  overrides: Partial<PortalPendingBoxChange> & {
    mealsCount: number;
    boxSubscriptionPrice: string;
  },
): Pick<
  PortalPendingBoxChange,
  "boxSubscriptionPrice" | "boxTitle" | "effectiveBillingDate" | "mealsCount"
> => ({
  boxSubscriptionPrice: overrides.boxSubscriptionPrice,
  boxTitle: overrides.boxTitle ?? getPortalV2BoxTitle(overrides.mealsCount),
  effectiveBillingDate:
    overrides.effectiveBillingDate ?? NEXT_BILLING.toISOString(),
  mealsCount: overrides.mealsCount,
});

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "86-subscription-box-change-forecast",
  );

  const portalDataSource = readRepoFile(
    "app/features/portal/portal-data.server.ts",
  );
  const portalRenderSource = readRepoFile(
    "app/features/portal/portal-render.ts",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const boxChangeServiceSource = readRepoFile(
    "app/services/subscriptionBoxChange.server.ts",
  );

  ctx.scenario("0. Source — pending wired into forecast, read-only");
  ctx.assertTrue(
    "buildForecastCycles exported",
    portalDataSource.includes("export const buildForecastCycles"),
  );
  ctx.assertTrue(
    "call site passes pendingBoxChange",
    portalDataSource.includes("pendingBoxChange,"),
  );
  ctx.assertTrue(
    "switch uses estimatedBillingDate >= effectiveBillingDate",
    portalDataSource.includes(
      "estimatedBillingDate >= pendingBoxChange.effectiveBillingDate",
    ),
  );
  ctx.assertTrue(
    "uses pending runtime price field",
    portalDataSource.includes("pendingBoxChange.boxSubscriptionPrice"),
  );
  ctx.assertTrue(
    "Prévisionnel badge retained",
    portalRenderSource.includes("Prévisionnel"),
  );
  ctx.assertFalse(
    "forecast does not branch toSelectedMeals",
    /buildForecastCycles[\s\S]{0,1200}toSelectedMeals/.test(portalDataSource),
  );
  ctx.assertFalse(
    "portal-data forecast path does not mutate pending service",
    portalDataSource.includes("requestSubscriptionBoxChange") ||
      portalDataSource.includes("markSubscriptionBoxChangeApplying"),
  );
  ctx.assertFalse(
    "actions unchanged by 7E",
    portalActionsSource.includes("buildForecastCycles"),
  );

  ctx.scenario("1. current 10 sans pending → forecast 10");
  {
    const cycles = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: null,
    });
    ctx.assertEqual("3 cycles", cycles.length, 3);
    ctx.assertTrue(
      "all mealsCount 10",
      cycles.every((c) => c.mealsCount === 10),
    );
    ctx.assertTrue(
      "all current price",
      cycles.every((c) => c.boxSubscriptionPrice === CURRENT_PRICE),
    );
    ctx.assertTrue(
      "all current title",
      cycles.every((c) => c.boxTitle === getPortalV2BoxTitle(10)),
    );
  }

  ctx.scenario("2 / 4 / 5 / 6 / 7. pending 12 at X → all À venir cycles = 12");
  {
    // Forecast dates are after nextBillingDate (= X). All >= X → pending.
    const pending = pendingDto({
      boxSubscriptionPrice: PENDING_12_PRICE,
      mealsCount: 12,
    });
    const cycles = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: pending,
    });
    ctx.assertTrue(
      "all cycles use pending 12",
      cycles.every((c) => c.mealsCount === 12),
    );
    ctx.assertTrue(
      "all cycles use runtime pending price",
      cycles.every((c) => c.boxSubscriptionPrice === PENDING_12_PRICE),
    );
    ctx.assertTrue(
      "all cycles use target title",
      cycles.every((c) => c.boxTitle === getPortalV2BoxTitle(12)),
    );
    ctx.assertTrue(
      "first cycle after X",
      cycles[0]!.estimatedBillingDate > pending.effectiveBillingDate,
    );
  }

  ctx.scenario("3. cycle avant X → current 10 ; à X et après → 12");
  {
    // Pending applies mid-forecast: first cycle before switch, rest after.
    const midPendingDate = new Date("2026-09-12T22:05:00.000Z");
    const pending = pendingDto({
      boxSubscriptionPrice: PENDING_12_PRICE,
      effectiveBillingDate: midPendingDate.toISOString(),
      mealsCount: 12,
    });
    const cycles = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: pending,
    });
    // X+1w ≈ Sep 5, X+2w ≈ Sep 12, X+3w ≈ Sep 19
    ctx.assertEqual("cycle0 before X → 10", cycles[0]!.mealsCount, 10);
    ctx.assertEqual(
      "cycle0 price current",
      cycles[0]!.boxSubscriptionPrice,
      CURRENT_PRICE,
    );
    ctx.assertTrue(
      "cycle0 date < pending",
      cycles[0]!.estimatedBillingDate < pending.effectiveBillingDate,
    );
    ctx.assertEqual("cycle1 at/after X → 12", cycles[1]!.mealsCount, 12);
    ctx.assertEqual("cycle2 after X → 12", cycles[2]!.mealsCount, 12);
    ctx.assertEqual(
      "cycle1 runtime price",
      cycles[1]!.boxSubscriptionPrice,
      PENDING_12_PRICE,
    );
    ctx.assertEqual(
      "cycle1 title target",
      cycles[1]!.boxTitle,
      getPortalV2BoxTitle(12),
    );
  }

  ctx.scenario("8. pending 12 remplacé par 16 → forecast 16");
  {
    const cycles = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: pendingDto({
        boxSubscriptionPrice: PENDING_16_PRICE,
        mealsCount: 16,
      }),
    });
    ctx.assertTrue(
      "active pending 16 only (not stale 12)",
      cycles.every((c) => c.mealsCount === 16),
    );
    ctx.assertTrue(
      "price 16 runtime",
      cycles.every((c) => c.boxSubscriptionPrice === PENDING_16_PRICE),
    );
  }

  ctx.scenario("9. downgrade 12 → 8 → forecast 8 + prix runtime");
  {
    const cycles = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: "112.00",
      boxTitle: getPortalV2BoxTitle(12),
      mealsCount: 12,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: pendingDto({
        boxSubscriptionPrice: PENDING_8_PRICE,
        mealsCount: 8,
      }),
    });
    ctx.assertTrue(
      "downgrade meals 8",
      cycles.every((c) => c.mealsCount === 8),
    );
    ctx.assertTrue(
      "downgrade price runtime 8",
      cycles.every((c) => c.boxSubscriptionPrice === PENDING_8_PRICE),
    );
    ctx.assertTrue(
      "downgrade title 8",
      cycles.every((c) => c.boxTitle === getPortalV2BoxTitle(8)),
    );
  }

  ctx.scenario("10. aucune mutation — helper pur + services inchangés dans 7E");
  {
    const start = portalDataSource.indexOf("export const buildForecastCycles");
    const end = portalDataSource.indexOf("const mapBoxOrdersToPortalHistory");
    const body = portalDataSource.slice(start, end);
    ctx.assertTrue("helper body located", body.length > 100);
    ctx.assertFalse("no prisma in buildForecastCycles", body.includes("prisma"));
    ctx.assertFalse(
      "no selection/boxOrder writes in helper",
      body.includes("boxOrder") || body.includes("subscriptionMealSelection"),
    );
    ctx.assertFalse(
      "pending apply not called from forecast helper",
      body.includes("applyPending") || body.includes("requestSubscription"),
    );
  }
  ctx.assertTrue(
    "pending apply still owned by box-change service (untouched ownership)",
    boxChangeServiceSource.includes(
      "applyPendingSubscriptionBoxChangeForBilling",
    ),
  );

  ctx.scenario("11–12. multi-selection isolation (per-call pending only)");
  {
    const cyclesA = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: pendingDto({
        boxSubscriptionPrice: PENDING_12_PRICE,
        mealsCount: 12,
      }),
    });
    const cyclesB = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: null,
    });
    ctx.assertTrue(
      "selection A with pending → 12",
      cyclesA.every((c) => c.mealsCount === 12),
    );
    ctx.assertTrue(
      "selection B without pending → 10 (no leak)",
      cyclesB.every((c) => c.mealsCount === 10),
    );
  }

  ctx.scenario("13. no pending DTO → comportement historique inchangé");
  {
    const withUndefined = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
    });
    const withNull = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: null,
    });
    ctx.assertEqual(
      "same length",
      withUndefined.length,
      withNull.length,
    );
    ctx.assertEqual(
      "same first date",
      withUndefined[0]!.estimatedBillingDate,
      withNull[0]!.estimatedBillingDate,
    );
    ctx.assertTrue(
      "historical current box",
      withUndefined.every((c) => c.mealsCount === 10),
    );
  }

  ctx.scenario("14. failed/stale non exposé → current (null pending)");
  {
    // Portal only loads status=pending into pendingBoxChange; failed → null.
    const cycles = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: CURRENT_PRICE,
      boxTitle: getPortalV2BoxTitle(10),
      mealsCount: 10,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: null,
    });
    ctx.assertTrue(
      "failed not shown as target",
      cycles.every((c) => c.mealsCount === 10),
    );
  }

  ctx.scenario("15. applied → current reconciled target (no pending DTO)");
  {
    // After apply, selection is already 12; pending gone.
    const cycles = buildForecastCycles({
      billingPolicy: WEEKLY,
      boxSubscriptionPrice: PENDING_12_PRICE,
      boxTitle: getPortalV2BoxTitle(12),
      mealsCount: 12,
      nextBillingDate: NEXT_BILLING,
      pendingBoxChange: null,
    });
    ctx.assertTrue(
      "applied reflected via current args",
      cycles.every(
        (c) =>
          c.mealsCount === 12 &&
          c.boxSubscriptionPrice === PENDING_12_PRICE,
      ),
    );
  }

  ctx.scenario("Call site — pending from same selection mapping only");
  ctx.assertTrue(
    "getPending scoped by subscriptionMealSelectionId",
    portalDataSource.includes(
      "subscriptionMealSelectionId: reconciled.id",
    ),
  );
  ctx.assertTrue(
    "forecast built inside per-record map (not shared)",
    portalDataSource.indexOf("visibleManageable") <
      portalDataSource.indexOf("pendingBoxChange,") ||
      portalDataSource.includes("map(async (record)"),
  );

  return finishSuite("86-subscription-box-change-forecast", ctx);
};

runSuite();
