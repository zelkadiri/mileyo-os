/**
 * Business regression — Mileyo portal URL helper + login return_to safety.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMileyoPortalLoginUrl,
  getMileyoPortalUrl,
  isAllowedMileyoPortalReturnPath,
  MILEYO_CUSTOMER_LOGIN_PATH,
  MILEYO_CUSTOMER_LOGOUT_PATH,
  MILEYO_PORTAL_CTA_LABEL,
  MILEYO_PORTAL_LIQUID_HREF,
  MILEYO_PORTAL_PATH,
} from "../../app/constants/mileyoPortal";
import { renderMessage } from "../../app/features/portal/portal-render";
import { buildSubscriptionPortalUrl } from "../../app/services/email/subscription-email.server";
import { createBusinessTestContext, finishSuite } from "./_framework";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const constantsSource = readSource("app/constants/mileyoPortal.ts");
const portalRenderSource = readSource("app/features/portal/portal-render.ts");
const portalRouteSource = readSource("app/routes/apps.box-builder.portal.tsx");

const runSuite = async () => {
  const ctx = createBusinessTestContext("79-mileyo-portal-url-auth");

  ctx.scenario("A. Canonical portal path");
  ctx.assertEqual(
    "MILEYO_PORTAL_PATH",
    MILEYO_PORTAL_PATH,
    "/apps/box-builder/portal",
  );
  ctx.assertEqual(
    "Liquid href contract",
    MILEYO_PORTAL_LIQUID_HREF,
    "{{ shop.url }}/apps/box-builder/portal",
  );
  ctx.assertEqual(
    "CTA label générique",
    MILEYO_PORTAL_CTA_LABEL,
    "Accéder à mon espace Mileyo",
  );

  ctx.scenario("B. Absolute URL helper — shop domain");
  ctx.assertEqual(
    "getMileyoPortalUrl depuis shop",
    getMileyoPortalUrl({ shop: "mileyo-dev.myshopify.com" }),
    "https://mileyo-dev.myshopify.com/apps/box-builder/portal",
  );
  ctx.assertEqual(
    "strip protocol + trailing slash",
    getMileyoPortalUrl({ shop: "https://shop.example.com/" }),
    "https://shop.example.com/apps/box-builder/portal",
  );
  ctx.assertEqual(
    "override portalUrl",
    getMileyoPortalUrl({
      shop: "ignored.myshopify.com",
      portalUrl: "https://custom.example/portal",
    }),
    "https://custom.example/portal",
  );
  ctx.assertNull("null sans shop ni override", getMileyoPortalUrl({}));
  ctx.assertEqual(
    "alias buildSubscriptionPortalUrl",
    buildSubscriptionPortalUrl({ shop: "mileyo-dev.myshopify.com" }),
    getMileyoPortalUrl({ shop: "mileyo-dev.myshopify.com" }),
  );

  ctx.scenario("C. Pas de hardcodes tunnels / localhost dans constants");
  ctx.assertFalse("pas ngrok dans constants", /ngrok/i.test(constantsSource));
  ctx.assertFalse(
    "pas localhost dans constants",
    /localhost/i.test(constantsSource),
  );
  ctx.assertFalse(
    "pas mileyo-dev hardcodé dans path constant",
    MILEYO_PORTAL_PATH.includes("mileyo-dev"),
  );

  ctx.scenario("D. Login return_to → portal");
  const loginUrl = buildMileyoPortalLoginUrl();
  ctx.assertTrue(
    "utilise customer_authentication/login",
    loginUrl.startsWith(`${MILEYO_CUSTOMER_LOGIN_PATH}?return_to=`),
  );
  ctx.assertTrue(
    "return_to encodé vers portal",
    loginUrl.includes(`return_to=${encodeURIComponent(MILEYO_PORTAL_PATH)}`),
  );
  ctx.assertFalse(
    "pas /account/login nu",
    loginUrl.startsWith("/account/login"),
  );

  ctx.scenario("E. Open-redirect protection");
  ctx.assertTrue(
    "portal path allowlist",
    isAllowedMileyoPortalReturnPath(MILEYO_PORTAL_PATH),
  );
  ctx.assertTrue(
    "portal path avec query acceptée (path only)",
    isAllowedMileyoPortalReturnPath("/apps/box-builder/portal?tab=upcoming"),
  );
  ctx.assertFalse(
    "refuse //evil",
    isAllowedMileyoPortalReturnPath("//evil.example"),
  );
  ctx.assertFalse(
    "refuse absolute https",
    isAllowedMileyoPortalReturnPath("https://evil.example"),
  );
  ctx.assertFalse(
    "refuse path escape",
    isAllowedMileyoPortalReturnPath("/account"),
  );
  ctx.assertEqual(
    "login force portal si path non allowlist",
    buildMileyoPortalLoginUrl("https://evil.example/phish"),
    buildMileyoPortalLoginUrl(MILEYO_PORTAL_PATH),
  );

  ctx.scenario("F. Portal déconnecté — CTA Se connecter → return_to portal");
  ctx.assertTrue(
    "route affiche loginLink si customer absent",
    /loginLink:\s*true/.test(portalRouteSource),
  );
  ctx.assertTrue(
    "portal-render importe buildMileyoPortalLoginUrl",
    portalRenderSource.includes("buildMileyoPortalLoginUrl"),
  );
  ctx.assertTrue(
    "CTA utilise le helper central",
    /buildMileyoPortalLoginUrl\s*\(\s*MILEYO_PORTAL_PATH\s*\)/.test(
      portalRenderSource,
    ),
  );
  ctx.assertFalse(
    "pas de href /account/login nu dans portal-render",
    /href=["']\/account\/login["']/.test(portalRenderSource),
  );
  ctx.assertFalse(
    "pas de reconstruction manuelle customer_authentication dans portal-render",
    portalRenderSource.includes("/customer_authentication/login"),
  );
  ctx.assertFalse(
    "pas ngrok hardcodé dans portal-render",
    /ngrok/i.test(portalRenderSource),
  );
  ctx.assertFalse(
    "pas localhost hardcodé dans portal-render",
    /localhost/i.test(portalRenderSource),
  );

  const expectedLoginHref = buildMileyoPortalLoginUrl(MILEYO_PORTAL_PATH);
  ctx.assertEqual(
    "URL finale login",
    expectedLoginHref,
    `${MILEYO_CUSTOMER_LOGIN_PATH}?return_to=${encodeURIComponent(MILEYO_PORTAL_PATH)}`,
  );

  const disconnectedHtml = await renderMessage(
    "Connecte-toi à ton compte pour modifier tes prochaines box.",
    { loginLink: true },
  ).text();
  ctx.assertTrue(
    "HTML CTA Se connecter",
    disconnectedHtml.includes(">Se connecter</a>"),
  );
  ctx.assertTrue(
    "HTML href Customer Accounts + return_to portal",
    disconnectedHtml.includes(`href="${expectedLoginHref}"`),
  );
  ctx.assertFalse(
    "HTML sans /account/login nu",
    /href=["']\/account\/login["']/.test(disconnectedHtml),
  );

  ctx.scenario("G. Logout Customer Accounts");
  ctx.assertEqual(
    "MILEYO_CUSTOMER_LOGOUT_PATH",
    MILEYO_CUSTOMER_LOGOUT_PATH,
    "/account/logout",
  );
  ctx.assertTrue(
    "portal-render importe logout path",
    portalRenderSource.includes("MILEYO_CUSTOMER_LOGOUT_PATH"),
  );
  ctx.assertTrue(
    "lien Se déconnecter présent",
    portalRenderSource.includes("Se déconnecter") &&
      portalRenderSource.includes("settings-logout-link"),
  );
  ctx.assertFalse(
    "logout sans return_to",
    /account\/logout[^"'<\s]*return_to/.test(portalRenderSource),
  );
  ctx.assertFalse(
    "logout ne pointe pas vers portal",
    /account\/logout[^"'<\s]*box-builder\/portal/.test(portalRenderSource),
  );

  return finishSuite("79-mileyo-portal-url-auth", ctx);
};

void runSuite();
