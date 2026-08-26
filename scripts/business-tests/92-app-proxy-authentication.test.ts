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
  ctx.assertTrue(
    "builder loader auth before prisma/admin",
    builderRoute.indexOf("authenticateMileyoAppProxy") <
      builderRoute.indexOf("prisma.appSettings") &&
      builderRoute.indexOf("authenticateMileyoAppProxy") <
        builderRoute.indexOf("unauthenticated.admin"),
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

  return finishSuite("92-app-proxy-authentication", ctx);
};

process.exitCode = runSuite();
