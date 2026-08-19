/**
 * Business regression — DEV portal cutoff clock (13L-B QA).
 *
 * Does not call Shopify, cron, billing, or write to the database.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CUTOFF_DEV_CLOCK_ENV,
  getCutoffNow,
  getDeliveryCutoffBlockReason,
  isCutoffDevClockEnabled,
} from "../../app/services/deliveryCutoff.server";
import { getPortalModificationBlockReason } from "../../app/services/subscriptionModificationBlock.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const baseSelection = () => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  nextScheduledDeliveryDate: "2026-08-27" as string | null,
  preferredDeliveryWeekday: 4,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStatus: null as string | null,
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

const runSuite = () => {
  const ctx = createBusinessTestContext("37-cutoff-dev-clock");
  const previousNodeEnv = process.env.NODE_ENV;
  const previousClock = process.env[CUTOFF_DEV_CLOCK_ENV];

  const cutoffSource = readRepoFile("app/services/deliveryCutoff.server.ts");
  const portalDataSource = readRepoFile(
    "app/features/portal/portal-data.server.ts",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const deliveryDateSource = readRepoFile("app/utils/deliveryDate.ts");
  const billingWorkerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );

  ctx.scenario("Override gated strictly to non-production");
  ctx.assertTrue(
    "env var name is MILEYO_DEV_CUTOFF_NOW",
    CUTOFF_DEV_CLOCK_ENV === "MILEYO_DEV_CUTOFF_NOW",
  );
  ctx.assertTrue(
    "production check uses NODE_ENV !== production",
    cutoffSource.includes('process.env.NODE_ENV !== "production"'),
  );

  try {
    process.env.NODE_ENV = "development";
    process.env[CUTOFF_DEV_CLOCK_ENV] = "2026-08-25T00:00:00+02:00";
    ctx.assertTrue("DEV enables cutoff clock", isCutoffDevClockEnabled());
    ctx.assertEqual(
      "DEV override returns Tuesday 00:00 Paris",
      getCutoffNow().toISOString(),
      "2026-08-24T22:00:00.000Z",
    );

    process.env[CUTOFF_DEV_CLOCK_ENV] = "2026-08-24T23:59:00+02:00";
    ctx.assertEqual(
      "DEV override returns Monday 23:59 Paris",
      getCutoffNow().toISOString(),
      "2026-08-24T21:59:00.000Z",
    );

    process.env[CUTOFF_DEV_CLOCK_ENV] = "not-a-date";
    ctx.assertTrue(
      "invalid override falls back to wall clock, not 2026-08-25",
      Math.abs(getCutoffNow().getTime() - Date.now()) < 1000,
    );

    process.env.NODE_ENV = "production";
    process.env[CUTOFF_DEV_CLOCK_ENV] = "2026-08-25T00:00:00+02:00";
    ctx.assertFalse(
      "production disables cutoff clock even with env set",
      isCutoffDevClockEnabled(),
    );
    const productionNow = getCutoffNow();
    ctx.assertTrue(
      "production getCutoffNow ignores env override",
      Math.abs(productionNow.getTime() - Date.now()) < 1000,
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousClock === undefined) {
      delete process.env[CUTOFF_DEV_CLOCK_ENV];
    } else {
      process.env[CUTOFF_DEV_CLOCK_ENV] = previousClock;
    }
  }

  ctx.scenario("Portal loader and action inject getCutoffNow");
  ctx.assertTrue(
    "portal loader imports getCutoffNow",
    portalDataSource.includes("getCutoffNow"),
  );
  ctx.assertTrue(
    "portal loader passes cutoffNow to modification block",
    portalDataSource.includes("getPortalModificationBlockReason(") &&
      portalDataSource.includes("cutoffNow"),
  );
  ctx.assertTrue(
    "portal loader passes cutoffNow to getDeliveryCutoffStatus",
    portalDataSource.includes("getDeliveryCutoffStatus(") &&
      portalDataSource.includes("cutoffNow"),
  );
  const projectionCall = portalDataSource.slice(
    portalDataSource.indexOf("projectActiveScheduledDeliveryDate({"),
    portalDataSource.indexOf("}).effectiveDeliveryDate"),
  );
  ctx.assertTrue(
    "portal loader does not pass cutoffNow to delivery projection",
    projectionCall.includes("projectActiveScheduledDeliveryDate({") &&
      !projectionCall.includes("cutoffNow"),
  );
  ctx.assertTrue(
    "portal actions inject getCutoffNow into modification guard",
    portalActionsSource.includes("getCutoffNow()") &&
      portalActionsSource.includes("getPortalModificationBlockReason("),
  );

  ctx.scenario("Shared helpers keep real new Date() defaults");
  ctx.assertTrue(
    "getDeliveryCutoffStatus default now is new Date()",
    deliveryDateSource.includes(
      "export const getDeliveryCutoffStatus = (",
    ) && deliveryDateSource.includes("now: Date = new Date()"),
  );
  ctx.assertTrue(
    "getDeliveryCutoffBlockReason default now is new Date()",
    cutoffSource.includes("now: Date = new Date()"),
  );
  ctx.assertFalse(
    "billing worker does not import getCutoffNow",
    billingWorkerSource.includes("getCutoffNow"),
  );
  ctx.assertFalse(
    "recovery worker does not import getCutoffNow",
    recoverySource.includes("getCutoffNow"),
  );

  ctx.scenario("Injected now blocks Friday-week Thursday after Monday cutoff");
  ctx.assertNull(
    "meal change allowed at Monday 23:59 Paris",
    getPortalModificationBlockReason(
      baseSelection(),
      null,
      new Date("2026-08-24T21:59:00.000Z"),
    ),
  );
  ctx.assertEqual(
    "meal change blocked at Tuesday 00:00 Paris",
    getPortalModificationBlockReason(
      baseSelection(),
      null,
      new Date("2026-08-24T22:00:00.000Z"),
    ),
    "cutoff_passed",
  );
  ctx.assertEqual(
    "block reason uses injected now",
    getDeliveryCutoffBlockReason(
      {
        nextScheduledDeliveryDate: "2026-08-27",
        preferredDeliveryWeekday: 4,
      },
      new Date("2026-08-24T22:00:00.000Z"),
    ),
    "cutoff_passed",
  );

  return finishSuite("37-cutoff-dev-clock", ctx);
};

process.exitCode = runSuite();
