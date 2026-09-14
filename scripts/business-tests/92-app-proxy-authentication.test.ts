/**
 * Business regression — App Proxy authentication for builder + portal.
 *
 * Source-based: verifies authenticate.public.appProxy / authenticateMileyoAppProxy
 * gates shop + logged_in_customer_id before any business use. Unsigned direct
 * Vercel hits are rejected by the Shopify SDK (Response 400).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createBusinessTestContext, finishSuite } from "./_framework";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const helperSource = readSource("app/utils/appProxyAuth.server.ts");
const builderRoute = readSource("app/routes/apps.box-builder.tsx");
const portalRoute = readSource("app/routes/apps.box-builder.portal.tsx");
const portalActions = readSource(
  "app/features/portal/portal-actions.server.ts",
);
const sdkAuthSource = readSource(
  "node_modules/@shopify/shopify-app-react-router/dist/esm/server/authenticate/public/appProxy/authenticate.mjs",
);

const handlePortalActionBody = (() => {
  const start = portalActions.indexOf("export const handlePortalAction");
  if (start < 0) {
    return "";
  }
  return portalActions.slice(start);
})();

const sensitiveIntents = [
  "pauseSubscription",
  "resumeSubscription",
  "resumeSubscriptionAndPay",
  "updateFutureMealSelection",
  "changeSubscriptionBox",
  "updateDeliveryAddress",
  "sendPaymentUpdateEmail",
] as const;

const runSuite = () => {
  const ctx = createBusinessTestContext("92-app-proxy-authentication");

  ctx.scenario("A. Helper uses official Shopify App Proxy auth");
  ctx.assertTrue(
    "helper calls authenticate.public.appProxy",
    /authenticate\.public\.appProxy\s*\(\s*request\s*\)/.test(helperSource),
  );
  ctx.assertTrue(
    "helper exports authenticateMileyoAppProxy",
    helperSource.includes("export const authenticateMileyoAppProxy"),
  );
  ctx.assertTrue(
    "helper returns shop after auth",
    /shop:/.test(helperSource) && helperSource.includes("session?.shop"),
  );
  ctx.assertTrue(
    "helper surfaces admin from appProxy context",
    helperSource.includes("admin: context.admin") ||
      /admin:\s*context\.admin/.test(helperSource),
  );
  ctx.assertTrue(
    "helper reads logged_in_customer_id only after appProxy",
    helperSource.indexOf("authenticate.public.appProxy") <
      helperSource.indexOf('searchParams.get("logged_in_customer_id")'),
  );
  ctx.assertFalse(
    "helper does not reimplement HMAC",
    /createHmac|validateHmac|signator/.test(helperSource),
  );

  ctx.scenario("B. SDK rejects invalid App Proxy signature");
  ctx.assertTrue(
    "SDK throws Response on invalid signature",
    sdkAuthSource.includes("App proxy request has invalid signature") &&
      /throw new Response\([\s\S]*status:\s*400/.test(sdkAuthSource),
  );

  ctx.scenario("C. Builder — valid proxy + anonymous visitor allowed");
  ctx.assertTrue(
    "builder loader authenticates App Proxy",
    /authenticateMileyoAppProxy\s*\(\s*request\s*\)/.test(builderRoute),
  );
  ctx.assertTrue(
    "builder action authenticates App Proxy",
    builderRoute.includes("export const action") &&
      builderRoute.indexOf("export const action") <
        builderRoute.lastIndexOf("authenticateMileyoAppProxy"),
  );
  ctx.assertFalse(
    "builder does not gate on loggedInCustomerId",
    /loggedInCustomerId/.test(builderRoute),
  );
  const builderLoaderBody = (() => {
    const start = builderRoute.indexOf("export const loader");
    const end = builderRoute.indexOf("export const action");
    if (start < 0 || end < 0 || end <= start) {
      return "";
    }
    return builderRoute.slice(start, end);
  })();
  ctx.assertTrue(
    "builder loader auth before prisma/catalog",
    builderLoaderBody.indexOf("authenticateMileyoAppProxy") >= 0 &&
      builderLoaderBody.indexOf("authenticateMileyoAppProxy") <
        builderLoaderBody.indexOf("prisma.appSettings") &&
      builderLoaderBody.indexOf("authenticateMileyoAppProxy") <
        builderLoaderBody.indexOf("fetchCachedBuilderBoxOptions"),
  );
  ctx.assertFalse(
    "builder loader does not re-load admin via unauthenticated.admin",
    /unauthenticated\.admin\s*\(/.test(builderLoaderBody),
  );
  ctx.assertTrue(
    "builder loader reuses admin from authenticateMileyoAppProxy",
    /const\s*\{\s*admin,\s*shop\s*\}/.test(builderLoaderBody) ||
      /const\s*\{\s*shop,\s*admin\s*\}/.test(builderLoaderBody),
  );
  ctx.assertTrue(
    "boxesPromise rejection handled before early return (no unhandled rejection)",
    /boxesPromise\.catch\s*\(/.test(builderLoaderBody) &&
      builderLoaderBody.indexOf("boxesPromise.catch") <
        builderLoaderBody.indexOf("await settingsPromise"),
  );

  ctx.scenario("D. Builder — unsigned / forged shop blocked before business");
  ctx.assertFalse(
    "builder loader no longer trusts raw shop before auth",
    /loader[\s\S]*?searchParams\.get\(["']shop["']\)/.test(builderRoute),
  );
  ctx.assertFalse(
    "builder action no longer uses getBuilderShopFromRequest alone",
    builderRoute.includes("getBuilderShopFromRequest"),
  );

  ctx.scenario("E. Portal loader — customer only after proxy auth");
  ctx.assertTrue(
    "portal loader authenticates App Proxy",
    /authenticateMileyoAppProxy\s*\(\s*request\s*\)/.test(portalRoute),
  );
  ctx.assertTrue(
    "portal loader auth before loadPortalData",
    portalRoute.indexOf("await authenticateMileyoAppProxy") <
      portalRoute.indexOf("await loadPortalData") &&
      portalRoute.indexOf("await authenticateMileyoAppProxy") >= 0,
  );
  ctx.assertTrue(
    "portal keeps login CTA when customer absent after auth",
    /loginLink:\s*true/.test(portalRoute),
  );
  ctx.assertFalse(
    "portal loader does not use raw getCustomerIdFromRequest",
    portalRoute.includes("getCustomerIdFromRequest"),
  );
  ctx.assertFalse(
    "portal loader does not use raw getShopFromRequest",
    portalRoute.includes("getShopFromRequest"),
  );

  ctx.scenario("F. Forged logged_in_customer_id / shop without proxy → blocked");
  ctx.assertTrue(
    "portal identity comes from authenticateMileyoAppProxy",
    portalRoute.includes("loggedInCustomerId") &&
      portalRoute.includes("authenticateMileyoAppProxy"),
  );
  ctx.assertTrue(
    "unsigned requests hit SDK 400 path (via helper)",
    helperSource.includes("authenticate.public.appProxy"),
  );

  ctx.scenario("G. Portal POST/action — auth before mutations");
  ctx.assertTrue(
    "handlePortalAction authenticates App Proxy first",
    /authenticateMileyoAppProxy\s*\(\s*request\s*\)/.test(handlePortalActionBody),
  );
  ctx.assertTrue(
    "auth before formData / intent dispatch",
    handlePortalActionBody.indexOf("authenticateMileyoAppProxy") <
      handlePortalActionBody.indexOf("request.formData()") &&
      handlePortalActionBody.indexOf("authenticateMileyoAppProxy") <
        handlePortalActionBody.indexOf('intent === "pauseSubscription"'),
  );
  ctx.assertFalse(
    "handlePortalAction no longer uses getShopFromRequest",
    handlePortalActionBody.includes("getShopFromRequest"),
  );
  ctx.assertFalse(
    "handlePortalAction no longer uses getCustomerIdFromRequest",
    handlePortalActionBody.includes("getCustomerIdFromRequest"),
  );

  ctx.scenario("H. All sensitive portal intents behind App Proxy auth");
  for (const intent of sensitiveIntents) {
    ctx.assertTrue(
      `intent ${intent} still dispatched`,
      handlePortalActionBody.includes(`"${intent}"`),
    );
    ctx.assertTrue(
      `intent ${intent} after App Proxy auth`,
      handlePortalActionBody.indexOf("authenticateMileyoAppProxy") <
        handlePortalActionBody.indexOf(`"${intent}"`),
    );
  }

  ctx.scenario("I. Portal client still strips signed params from fetch URL");
  const portalClient = readSource("app/features/portal/portal-client.ts");
  ctx.assertTrue(
    "getPortalFetchUrl strips Shopify signed params",
    portalClient.includes("Never POST with Shopify App Proxy signed query params") &&
      portalClient.includes("getPortalFetchUrl"),
  );
  ctx.assertTrue(
    "fetch uses pathname (shop domain re-signs via App Proxy)",
    portalClient.includes("window.location.pathname"),
  );

  ctx.scenario("J. Builder loader Server-Timing — auth/session sub-metrics");
  const shopifyServer = readSource("app/shopify.server.ts");
  const sessionWrap = readSource(
    "app/utils/instrumentedSessionStorage.server.ts",
  );
  const perfTimings = readSource("app/utils/perfTimings.server.ts");
  const dbServer = readSource("app/db.server.ts");
  ctx.assertTrue(
    "loader wraps with builder perf ALS",
    builderRoute.includes("runWithBuilderPerfTimings"),
  );
  ctx.assertTrue(
    "loader emits sessionLoad / authOther / settingsQuery metrics helpers",
    builderRoute.includes("sessionLoad") &&
      builderRoute.includes("authOther") &&
      builderRoute.includes("settingsQuery") &&
      builderRoute.includes("mergeAuthAndSettingsPerf"),
  );
  ctx.assertTrue(
    "Server-Timing still set via withServerTiming",
    builderRoute.includes('response.headers.set("Server-Timing"'),
  );
  ctx.assertTrue(
    "shopify session storage is instrumented wrapper",
    shopifyServer.includes("instrumentSessionStorage") &&
      shopifyServer.includes("PrismaSessionStorage"),
  );
  ctx.assertTrue(
    "session wrapper times loadSession/storeSession only",
    sessionWrap.includes("recordSessionLoadMs") &&
      sessionWrap.includes("recordSessionStoreMs") &&
      !/console\.(log|info|debug)/.test(sessionWrap),
  );
  ctx.assertTrue(
    "perf timings ALS never stores tokens",
    !perfTimings.includes("accessToken") &&
      !perfTimings.includes("refreshToken") &&
      !/console\.(log|info|debug)/.test(perfTimings),
  );
  ctx.assertTrue(
    "Prisma model-op extension attribution without query-event logging",
    dbServer.includes("recordPrismaModelOpMs") &&
      dbServer.includes("$extends") &&
      !dbServer.includes('emit: "event"') &&
      !/console\.(log|info|debug)/.test(dbServer),
  );
  ctx.assertFalse(
    "Server-Timing path does not embed accessToken",
    /Server-Timing[\s\S]{0,400}accessToken/.test(builderRoute),
  );
  ctx.assertFalse(
    "Server-Timing path does not embed refreshToken",
    /Server-Timing[\s\S]{0,400}refreshToken/.test(builderRoute),
  );
  const actionBody = (() => {
    const start = builderRoute.indexOf("export const action");
    return start >= 0 ? builderRoute.slice(start) : "";
  })();
  ctx.assertFalse(
    "builder action has no Server-Timing instrumentation change",
    actionBody.includes("Server-Timing") ||
      actionBody.includes("runWithBuilderPerfTimings"),
  );
  ctx.assertTrue(
    "sessionQuery attribution uses Session.findUnique only",
    perfTimings.includes("recordPrismaModelOpMs") &&
      perfTimings.includes('model === "Session"') &&
      perfTimings.includes('operation === "findUnique"'),
  );
  ctx.assertTrue(
    "authOther omitted unless sessionLoadCount > 0",
    /sessionLoadCount\s*>\s*0/.test(builderRoute),
  );

  return finishSuite("92-app-proxy-authentication", ctx);
};

process.exitCode = runSuite();
