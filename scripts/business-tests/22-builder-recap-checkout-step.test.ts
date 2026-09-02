/**
 * Business regression — builder recap step + targeted cart replace + checkout (13I-A).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FIRST_BOX_LAUNCH_DISCOUNT_EUR } from "../../app/constants/firstBoxLaunchDiscount";
import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  BUILDER_CART_PREPARE_ERROR,
  collectMileyoBuilderBoxLineKeys,
  getShopifyNumericId,
  isMileyoBuilderBoxCatalogLine,
  isMileyoBuilderBoxLegacyLine,
  isMileyoBuilderBoxLine,
  type CartLineLike,
} from "../../app/features/builder/builder-cart";
import {
  buildCheckoutLeadKey,
  findObjectiveLabel,
  formatRecapMealLabel,
  getRecapMealLines,
} from "../../app/features/builder/builder-recap";
import {
  formatCentsAsEuroFr,
  getBuilderLaunchPricing,
} from "../../app/features/builder/builder-box-selection";
import {
  BUILDER_OBJECTIVE_OPTIONS,
  BUILDER_STEP_COUNT,
  BUILDER_STEPS,
  getBuilderStepLabel,
  getBuilderStepProgressPercent,
} from "../../app/features/builder/builder-objective-options";
import {
  buildBuilderCheckoutLineAttributes,
  toShopifyResourceGid,
} from "../../app/features/builder/builder-checkout.server";
import { describeBuilderCheckoutThrownError } from "../../app/features/builder/builder-checkout-errors";
import {
  CREATE_BUILDER_CHECKOUT_INTENT,
} from "../../app/features/builder/builder-email";
import { createBusinessTestContext, finishSuite } from "./_framework";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const V2_VARIANT_GID = "gid://shopify/ProductVariant/52371762380940";
const V2_VARIANT_NUMERIC = "52371762380940";
const CATALOG_IDS = [V2_VARIANT_NUMERIC];

const v2BoxLine = (): CartLineLike => ({
  key: `${V2_VARIANT_NUMERIC}:hash-v2`,
  variant_id: Number(V2_VARIANT_NUMERIC),
  selling_plan_allocation: { selling_plan: { id: 3530227852 } },
  properties: {
    "Type de commande": "Abonnement hebdomadaire",
    "_mileyo_delivery_date": "2026-08-20",
    "Nombre de repas": "10",
  },
});

const dessertLine = (): CartLineLike => ({
  key: "9001:tiramisu",
  variant_id: 9001,
  properties: { Saveur: "Tiramisu" },
});

const drinkLine = (): CartLineLike => ({
  key: "9002:jus",
  variant_id: 9002,
});

const legacyBoxLine = (): CartLineLike => ({
  key: "111:legacy-box",
  variant_id: 111,
  selling_plan_allocation: { selling_plan: { id: 99 } },
  properties: {
    "Type de commande": "Abonnement hebdomadaire",
    "_mileyo_delivery_date": "2026-08-27",
    "Nombre de repas": "8",
  },
});

const otherSubscriptionLine = (): CartLineLike => ({
  key: "222:other-sub",
  variant_id: 222,
  selling_plan_allocation: { selling_plan: { id: 77 } },
  properties: { Plan: "VIP mensuel" },
});

const extractFunction = (source: string, name: string) => {
  const start = source.indexOf(`function ${name}()`);
  if (start < 0) {
    return "";
  }

  const fromStart = source.slice(start);
  const nextFn = fromStart.search(/\n {2}function [A-Za-z]/);
  const nextTop = fromStart.search(/\n {2}if \(/);
  let end = fromStart.length;
  if (nextFn > 0) {
    end = Math.min(end, nextFn);
  }
  if (nextTop > 0) {
    end = Math.min(end, nextTop);
  }
  return fromStart.slice(0, end);
};

const runSuite = () => {
  const ctx = createBusinessTestContext("22-builder-recap-checkout-step");
  const clientSource = readRepoFile("app/features/builder/builder-client.ts");
  const renderSource = readRepoFile("app/features/builder/builder-render.ts");
  const stylesSource = readRepoFile("app/features/builder/builder-styles.ts");
  const cartSource = readRepoFile("app/features/builder/builder-cart.ts");
  const recapSource = readRepoFile("app/features/builder/builder-recap.ts");
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const sellingPlansV2 = readRepoFile(
    "app/features/settings/settings-selling-plans-v2.server.ts",
  );
  const emailSubmit = extractFunction(clientSource, "handleEmailSubmit");
  const beginCheckoutFromEmail = extractFunction(
    clientSource,
    "beginCheckoutFromEmail",
  );
  const createCheckoutFn = extractFunction(clientSource, "createBuilderCheckout");
  const checkoutServerSource = readRepoFile(
    "app/features/builder/builder-checkout.server.ts",
  );
  const checkoutErrorsSource = readRepoFile(
    "app/features/builder/builder-checkout-errors.ts",
  );
  const routeSource = readRepoFile("app/routes/apps.box-builder.tsx");
  const emailModuleSource = readRepoFile("app/features/builder/builder-email.ts");

  ctx.scenario("A. Step system — 5 steps, email last (Lot C)");
  ctx.assertEqual("step count is 5", BUILDER_STEP_COUNT, 5);
  ctx.assertEqual(
    "exact step order",
    BUILDER_STEPS.join("→"),
    "objectif→formule→livraison→repas→email",
  );
  ctx.assertEqual("email is last", BUILDER_STEPS[4], "email");
  ctx.assertEqual("formule id preserved", BUILDER_STEPS[1], "formule");
  ctx.assertFalse(
    "recap removed from BUILDER_STEPS",
    (BUILDER_STEPS as readonly string[]).includes("recap"),
  );
  ctx.assertTrue(
    "legacy #recap handled",
    clientSource.includes('location.hash === "#recap"') ||
      clientSource.includes('hash === "recap"'),
  );
  ctx.assertFalse(
    "dedicated recap step markup removed",
    renderSource.includes('id="step-recap"') ||
      renderSource.includes('id="recap-footer"') ||
      renderSource.includes('id="recap-continue"'),
  );
  ctx.assertFalse(
    "dedicated recap client APIs removed",
    clientSource.includes("function renderRecap") ||
      clientSource.includes("function handleRecapSubmit") ||
      clientSource.includes("function canEnterRecapStep") ||
      clientSource.includes("function updateRecapCta"),
  );
  ctx.assertFalse(
    "dead recap CSS removed",
    stylesSource.includes(".builder-step--recap") ||
      stylesSource.includes(".is-step-recap") ||
      stylesSource.includes(".tunnel-progress-fill.is-step-6") ||
      stylesSource.includes("--recap-step-max-width"),
  );
  ctx.assertEqual(
    "email label is step 5 of 5",
    getBuilderStepLabel("email"),
    "Étape 5 sur 5",
  );
  ctx.assertEqual("step 1 progress", getBuilderStepProgressPercent("objectif"), 20);
  ctx.assertEqual("step 2 progress", getBuilderStepProgressPercent("formule"), 40);
  ctx.assertEqual("step 3 progress", getBuilderStepProgressPercent("livraison"), 60);
  ctx.assertEqual("step 4 progress", getBuilderStepProgressPercent("repas"), 80);
  ctx.assertEqual("step 5 progress", getBuilderStepProgressPercent("email"), 100);
  ctx.assertTrue(
    "css is-step-5 is 100%",
    stylesSource.includes(".tunnel-progress-fill.is-step-5") &&
      /is-step-5 \{\s*width: 100%;/.test(stylesSource),
  );
  ctx.assertTrue(
    "css five-step widths 20/40/60/80",
    stylesSource.includes(".tunnel-progress-fill.is-step-1 {\n  width: 20%;") &&
      stylesSource.includes("width: 40%") &&
      stylesSource.includes("width: 60%") &&
      stylesSource.includes("width: 80%"),
  );
  ctx.assertFalse(
    "client no longer activates is-step-6",
    /tunnelProgressFill\.classList\.add\("is-step-6"\)/.test(clientSource),
  );
  ctx.assertTrue(
    "initial label 5 steps",
    renderSource.includes("Étape 1 sur 5"),
  );
  ctx.assertTrue(
    "legacy #recap → email without showStep(recap)",
    /hash === "recap"[\s\S]*?showStep\("email"/.test(clientSource) &&
      !/showStep\(\s*"recap"/.test(clientSource),
  );
  ctx.assertTrue(
    "showStep remaps legacy recap to email",
    /if \(step === "recap"\) \{\s*step = "email";/.test(clientSource),
  );
  ctx.assertFalse(
    "legacy hash does not auto-checkout",
    /hash === "recap"[\s\S]{0,200}createBuilderCheckout/.test(clientSource) ||
      /location\.hash === "#recap"[\s\S]{0,200}createBuilderCheckout/.test(
        clientSource,
      ),
  );
  ctx.assertTrue(
    "back email → repas",
    /currentStep === "email"[\s\S]*?showStep\("repas"/.test(clientSource),
  );

  ctx.scenario("B. Email → lead → checkout (Lot B)");
  ctx.assertTrue(
    "email CTA Passer au paiement",
    clientSource.includes('emailContinue.textContent = "Passer au paiement"'),
  );
  ctx.assertFalse(
    "email CTA no longer Continuer",
    clientSource.includes('emailContinue.textContent = "Continuer"'),
  );
  ctx.assertFalse(
    "email no longer adds to cart copy",
    clientSource.includes('"Ajouter ma box au panier"'),
  );
  ctx.assertTrue("email submit captured", Boolean(emailSubmit));
  ctx.assertTrue(
    "email captures lead then checkout",
    emailSubmit.includes("captureCheckoutLead") &&
      emailSubmit.includes("capturedLeadKey = currentLeadKey()") &&
      emailSubmit.includes("beginCheckoutFromEmail()") &&
      !emailSubmit.includes('showStep("recap")'),
  );
  ctx.assertTrue(
    "fresh lead skips captureCheckoutLead before checkout",
    /if \(isCapturedLeadFresh\(\)\) \{[\s\S]*?beginCheckoutFromEmail\(\)/.test(
      emailSubmit,
    ),
  );
  ctx.assertTrue(
    "email double-submit guard",
    emailSubmit.includes("isSubmittingLead || isSubmittingCheckout"),
  );
  const beginCheckout = extractFunction(clientSource, "beginCheckoutFromEmail");
  ctx.assertTrue(
    "beginCheckoutFromEmail uses createBuilderCheckout",
    beginCheckout.includes("createBuilderCheckout"),
  );
  ctx.assertTrue(
    "checkout failure resets submitting flag",
    beginCheckout.includes("isSubmittingCheckout = false") &&
      beginCheckout.includes("updateEmailCta()"),
  );
  ctx.assertTrue(
    "lead failure does not call checkout",
    /captureCheckoutLead\(\)[\s\S]*?\.catch\(function \(\) \{[\s\S]*?\}/.test(
      emailSubmit,
    ) &&
      !(
        emailSubmit.match(
          /captureCheckoutLead\(\)[\s\S]*?\.catch\(function \(\) \{[\s\S]*?\}/,
        )?.[0] ?? ""
      ).includes("createBuilderCheckout"),
  );
  ctx.assertFalse(
    "email submit does not add to cart",
    emailSubmit.includes("addSelectedBoxToCart") ||
      emailSubmit.includes("/cart/add.js") ||
      emailSubmit.includes('fetch("/checkout"'),
  );
  ctx.assertTrue(
    "email mini-recap still present",
    renderSource.includes('id="email-mini-recap"'),
  );

  ctx.scenario("C. Lead freshness key");
  const keyA = buildCheckoutLeadKey({
    email: "a@example.com",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    boxVariantId: V2_VARIANT_GID,
    mealCount: 10,
    scheduledDeliveryDate: "2026-08-20",
  });
  const keyBEmail = buildCheckoutLeadKey({
    email: "b@example.com",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    boxVariantId: V2_VARIANT_GID,
    mealCount: 10,
    scheduledDeliveryDate: "2026-08-20",
  });
  const keyBBox = buildCheckoutLeadKey({
    email: "a@example.com",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    boxVariantId: "gid://shopify/ProductVariant/other",
    mealCount: 10,
    scheduledDeliveryDate: "2026-08-20",
  });
  const keyBDelivery = buildCheckoutLeadKey({
    email: "a@example.com",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    boxVariantId: V2_VARIANT_GID,
    mealCount: 10,
    scheduledDeliveryDate: "2026-08-27",
  });
  const keyBMealCount = buildCheckoutLeadKey({
    email: "a@example.com",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    boxVariantId: V2_VARIANT_GID,
    mealCount: 12,
    scheduledDeliveryDate: "2026-08-20",
  });
  ctx.assertTrue("key A non-empty", keyA.length > 0);
  ctx.assertTrue("email change mismatches", keyA !== keyBEmail);
  ctx.assertTrue("box change mismatches", keyA !== keyBBox);
  ctx.assertTrue("delivery change mismatches", keyA !== keyBDelivery);
  ctx.assertTrue("mealCount change mismatches", keyA !== keyBMealCount);
  ctx.assertEqual(
    "same context matches again",
    buildCheckoutLeadKey({
      email: "a@example.com",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      boxVariantId: V2_VARIANT_GID,
      mealCount: 10,
      scheduledDeliveryDate: "2026-08-20",
    }),
    keyA,
  );
  ctx.assertTrue(
    "client currentLeadKey uses email|objective|variant|mealCount|date",
    clientSource.includes("selectedEmail") &&
      clientSource.includes("selectedObjective") &&
      clientSource.includes("selectedBox.variantId") &&
      clientSource.includes("selectedBox.mealCount") &&
      clientSource.includes("selectedScheduledDeliveryDate") &&
      clientSource.includes('.join("|")'),
  );
  ctx.assertTrue(
    "checkout requires fresh lead path",
    clientSource.includes("isCapturedLeadFresh") &&
      clientSource.includes("capturedLeadKey === key"),
  );
  ctx.assertFalse(
    "does not log capturedLeadKey",
    /console\.(log|error|info|warn)\([^)]*capturedLeadKey/.test(clientSource) ||
      /console\.(log|error|info|warn)\([^)]*currentLeadKey/.test(recapSource),
  );

  ctx.scenario("D. Email mini-recap content + shared helpers");
  ctx.assertTrue(
    "mini-recap title Votre sélection",
    renderSource.includes("Votre sélection"),
  );
  ctx.assertEqual(
    "balanced label FR",
    findObjectiveLabel(
      BUILDER_OBJECTIVE_OPTIONS,
      SUBSCRIPTION_OBJECTIVE.BALANCED,
    ),
    "Équilibré",
  );
  ctx.assertFalse(
    "builder does not show balanced key in markup",
    renderSource.includes(">balanced<"),
  );
  ctx.assertTrue(
    "mini-recap formule field",
    renderSource.includes('id="email-mini-recap-box"'),
  );
  ctx.assertTrue(
    "mini-recap uses launch pricing first box only",
    clientSource.includes("getBuilderLaunchPricing(selectedBox.price, selectedBox.mealCount)") &&
      /function renderEmailMiniRecap[\s\S]*?la première box\*/.test(clientSource),
  );
  const miniRecapFn =
    clientSource.match(
      /function renderEmailMiniRecap\(\) \{[\s\S]*?\n  function /,
    )?.[0] ?? "";
  ctx.assertFalse(
    "mini-recap does not show Puis weekly",
    miniRecapFn.includes('"Puis "'),
  );
  ctx.assertTrue(
    "mini-recap delivery uses rangeLabel",
    /function renderEmailMiniRecap[\s\S]*?selectedWindow\.rangeLabel/.test(
      clientSource,
    ),
  );
  ctx.assertFalse(
    "mini-recap delivery does not show Thursday canonical as promise",
    /emailMiniRecapDelivery\.textContent = selectedScheduledDeliveryDate/.test(
      clientSource,
    ),
  );
  const mealLines = getRecapMealLines(
    [
      {
        title: "Poulet curry",
        variantId: "v1",
        objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      },
      {
        title: "Saumon teriyaki",
        variantId: "v2",
        objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      },
      {
        title: "Bulk only",
        variantId: "v3",
        objective: SUBSCRIPTION_OBJECTIVE.BULK,
      },
    ],
    { v1: 1, v2: 2, v3: 4 },
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  ctx.assertEqual("qty 1 title only", formatRecapMealLabel("Poulet curry", 1), "Poulet curry");
  ctx.assertEqual(
    "qty 2 uses times",
    formatRecapMealLabel("Saumon teriyaki", 2),
    "Saumon teriyaki ×2",
  );
  ctx.assertEqual("two visible meals", mealLines.length, 2);
  ctx.assertEqual("first meal qty", mealLines[0]?.quantity, 1);
  ctx.assertEqual("second meal qty", mealLines[1]?.quantity, 2);
  ctx.assertTrue(
    "offer kicker on email step",
    renderSource.includes("Offre de lancement"),
  );
  ctx.assertTrue(
    "20 euro copy from constant",
    renderSource.includes("${FIRST_BOX_LAUNCH_DISCOUNT_EUR} €") ||
      renderSource.includes(`${FIRST_BOX_LAUNCH_DISCOUNT_EUR} €`),
  );
  ctx.assertTrue(
    "eligibility note",
    renderSource.includes("si vous êtes éligible"),
  );
  ctx.assertTrue(
    "CTA Passer au paiement",
    clientSource.includes('"Passer au paiement"'),
  );

  ctx.scenario("E. Launch pricing display — qualified, not guaranteed");
  {
    const pricing = getBuilderLaunchPricing({
      mealCount: 8,
      regularPrice: "76.11",
    });
    ctx.assertEqual("launch = regular - 20", pricing?.launchPriceCents, 5611);
    ctx.assertEqual("per meal from launch", pricing?.launchPricePerMealCents, 701);
    ctx.assertEqual(
      "formatted launch",
      formatCentsAsEuroFr(pricing!.launchPriceCents),
      "56,11\u00a0€",
    );
  }
  ctx.assertTrue(
    "email mini-recap shows launch price element",
    renderSource.includes('id="email-mini-recap-price"'),
  );
  ctx.assertFalse(
    "dedicated recap launch/per-meal/weekly elements removed",
    renderSource.includes('id="recap-launch-price"') ||
      renderSource.includes('id="recap-per-meal"') ||
      renderSource.includes('id="recap-weekly-price"'),
  );
  ctx.assertTrue(
    "email mini-recap renders première box launch copy",
    clientSource.includes("la première box*"),
  );
  ctx.assertTrue(
    "email offer card eligibility note present",
    renderSource.includes("si vous êtes éligible"),
  );
  ctx.assertFalse(
    "no universal guaranteed pay today wording",
    renderSource.includes("À payer aujourd’hui") ||
      clientSource.includes("À payer aujourd’hui") ||
      renderSource.includes("Vous paierez") ||
      clientSource.includes("Vous paierez"),
  );
  ctx.assertFalse(
    "no firstBoxPrice identifier",
    clientSource.includes("firstBoxPrice"),
  );
  ctx.assertFalse(
    "no discountedPrice identifier",
    clientSource.includes("discountedPrice") ||
      renderSource.includes("discountedPrice"),
  );
  ctx.assertFalse(
    "no fragile selectedBox.price - 20",
    clientSource.includes("selectedBox.price - 20") ||
      recapSource.includes("selectedBox.price - 20"),
  );
  ctx.assertEqual("UI constant remains 20", FIRST_BOX_LAUNCH_DISCOUNT_EUR, 20);

  const createCheckoutFnMatch =
    clientSource.match(/function createBuilderCheckout[\s\S]*?\n {2}function /)?.[0] ??
    "";
  ctx.assertTrue(
    "storefront checkout function present",
    createCheckoutFnMatch.includes("CREATE_CHECKOUT_INTENT") ||
      createCheckoutFn.includes("create_builder_checkout"),
  );
  ctx.assertFalse(
    "launch pricing not injected into checkout create",
    /launchPrice|launchPricePerMeal|LAUNCH_DISCOUNT|discountCents/.test(
      createCheckoutFnMatch,
    ),
  );
  ctx.assertFalse(
    "ajax cart properties block removed",
    /var properties = \{/.test(clientSource),
  );

  ctx.scenario("F. Dead recap removed + legacy hash");
  ctx.assertFalse(
    "canEnterRecapStep removed",
    clientSource.includes("function canEnterRecapStep"),
  );
  ctx.assertFalse(
    "renderRecap removed",
    clientSource.includes("function renderRecap"),
  );
  ctx.assertFalse(
    "handleRecapSubmit removed",
    clientSource.includes("function handleRecapSubmit"),
  );
  ctx.assertTrue(
    "hash recap redirects via showStep email",
    /hash === "recap"[\s\S]*?showStep\("email"/.test(clientSource),
  );
  ctx.assertFalse(
    "no recapState copy",
    clientSource.includes("recapState") || renderSource.includes("recapState"),
  );
  ctx.assertTrue(
    "builder-recap helpers kept for lead key / tests",
    recapSource.includes("buildCheckoutLeadKey") &&
      recapSource.includes("formatRecapMealLabel"),
  );

  ctx.scenario("G. Storefront Cart checkout — buyerIdentity email");
  ctx.assertEqual(
    "checkout intent constant",
    CREATE_BUILDER_CHECKOUT_INTENT,
    "create_builder_checkout",
  );
  ctx.assertEqual(
    "variant gid passthrough",
    toShopifyResourceGid("ProductVariant", V2_VARIANT_GID),
    V2_VARIANT_GID,
  );
  ctx.assertEqual(
    "variant numeric to gid",
    toShopifyResourceGid("ProductVariant", V2_VARIANT_NUMERIC),
    V2_VARIANT_GID,
  );
  ctx.assertEqual(
    "selling plan numeric to gid",
    toShopifyResourceGid("SellingPlan", "3530227852"),
    "gid://shopify/SellingPlan/3530227852",
  );
  const lineAttributes = buildBuilderCheckoutLineAttributes({
    deliveryRangeLabel: "Lun–Mer",
    mealCount: 2,
    meals: [
      { quantity: 1, title: "Poulet" },
      { quantity: 1, title: "Saumon" },
    ],
    scheduledDeliveryDate: "2026-08-20",
  });
  ctx.assertTrue(
    "attributes include order type",
    lineAttributes.some(
      (attribute) =>
        attribute.key === "Type de commande" &&
        attribute.value === "Abonnement hebdomadaire",
    ),
  );
  ctx.assertTrue(
    "attributes include delivery technical",
    lineAttributes.some(
      (attribute) =>
        attribute.key === "_mileyo_delivery_date" &&
        attribute.value === "2026-08-20",
    ),
  );
  ctx.assertTrue(
    "attributes include Plat lines",
    lineAttributes.some((attribute) => attribute.key === "Plat 1") &&
      lineAttributes.some((attribute) => attribute.key === "Plat 2"),
  );
  ctx.assertFalse(
    "attributes exclude email",
    lineAttributes.some((attribute) =>
      attribute.key.toLowerCase().includes("email"),
    ),
  );
  ctx.assertTrue(
    "create_builder_checkout intent in email module",
    emailModuleSource.includes('CREATE_BUILDER_CHECKOUT_INTENT = "create_builder_checkout"'),
  );
  ctx.assertTrue(
    "route handles create_builder_checkout",
    routeSource.includes("CREATE_BUILDER_CHECKOUT_INTENT") &&
      routeSource.includes("createBuilderStorefrontCheckout"),
  );
  ctx.assertTrue(
    "server cartCreate mutation",
    checkoutServerSource.includes("cartCreate") &&
      checkoutServerSource.includes("buyerIdentity") &&
      checkoutServerSource.includes("sellingPlanId") &&
      checkoutServerSource.includes("checkoutUrl"),
  );
  ctx.assertTrue(
    "server uses unauthenticated.storefront",
    checkoutServerSource.includes("unauthenticated.storefront"),
  );
  ctx.assertTrue(
    "threw log uses safe diagnostic helper",
    checkoutServerSource.includes("describeBuilderCheckoutThrownError") &&
      checkoutServerSource.includes("message: details.message") &&
      checkoutServerSource.includes("status: details.status") &&
      checkoutServerSource.includes("requestId: details.requestId") &&
      checkoutErrorsSource.includes(
        "export const describeBuilderCheckoutThrownError",
      ),
  );
  ctx.assertFalse(
    "threw log does not dump Authorization",
    /storefront cartCreate threw[\s\S]{0,400}Authorization/i.test(
      checkoutServerSource,
    ) || /Authorization/i.test(checkoutErrorsSource),
  );
  ctx.assertFalse(
    "threw log does not dump email payload",
    /storefront cartCreate threw[\s\S]{0,400}input\.email/.test(
      checkoutServerSource,
    ),
  );
  ctx.assertFalse(
    "error helper does not log tokens or full headers",
    checkoutErrorsSource.includes("accessToken") ||
      checkoutErrorsSource.includes("Authorization") ||
      checkoutErrorsSource.includes("privateAccessToken"),
  );
  ctx.assertTrue(
    "email checkout path uses createBuilderCheckout",
    beginCheckoutFromEmail.includes("createBuilderCheckout"),
  );
  ctx.assertFalse(
    "no ajax cart/add in client",
    clientSource.includes("/cart/add.js"),
  );
  ctx.assertFalse(
    "no cart/clear.js in client",
    clientSource.includes("/cart/clear.js"),
  );
  ctx.assertFalse(
    "no cart/clear.js in cart helper",
    cartSource.includes("/cart/clear.js"),
  );
  ctx.assertTrue(
    "prepare failure copy reused",
    cartSource.includes(BUILDER_CART_PREPARE_ERROR) &&
      clientSource.includes("CART_PREPARE_ERROR"),
  );

  ctx.scenario("G2. Safe cartCreate threw diagnostics");
  const httpLike = {
    name: "HttpResponseError",
    message: `Received an error response (401 Unauthorized) from Shopify:\n${"x".repeat(400)}`,
    response: {
      code: 401,
      statusText: "Unauthorized",
      headers: {
        "X-Request-Id": "req-test-123",
        Authorization: "Bearer secret-must-not-leak",
      },
      body: { errors: "access denied" },
    },
  };
  const httpDiag = describeBuilderCheckoutThrownError(httpLike);
  ctx.assertEqual("http name", httpDiag.name, "HttpResponseError");
  ctx.assertEqual("http status", httpDiag.status, 401);
  ctx.assertEqual("http requestId", httpDiag.requestId, "req-test-123");
  ctx.assertTrue(
    "http message truncated",
    typeof httpDiag.message === "string" &&
      httpDiag.message.length <= 301 &&
      httpDiag.message.endsWith("…"),
  );
  ctx.assertFalse(
    "http diag omits Authorization",
    JSON.stringify(httpDiag).includes("Bearer") ||
      JSON.stringify(httpDiag).includes("Authorization"),
  );

  const gqlLike = {
    name: "GraphqlQueryError",
    message: "Access denied for cartCreate field.",
    headers: { "x-request-id": "gql-req-9" },
    response: {},
  };
  const gqlDiag = describeBuilderCheckoutThrownError(gqlLike);
  ctx.assertEqual("gql status absent", gqlDiag.status, undefined);
  ctx.assertEqual("gql requestId", gqlDiag.requestId, "gql-req-9");
  ctx.assertEqual(
    "gql message kept",
    gqlDiag.message,
    "Access denied for cartCreate field.",
  );

  const plain = describeBuilderCheckoutThrownError(new Error("boom"));
  ctx.assertEqual("plain Error name", plain.name, "Error");
  ctx.assertEqual("plain Error message", plain.message, "boom");
  ctx.assertEqual("plain Error status absent", plain.status, undefined);

  ctx.scenario("H. Variant ID normalization");
  ctx.assertEqual(
    "gid to numeric",
    getShopifyNumericId(V2_VARIANT_GID),
    V2_VARIANT_NUMERIC,
  );
  ctx.assertEqual(
    "numeric string stays numeric",
    getShopifyNumericId(V2_VARIANT_NUMERIC),
    V2_VARIANT_NUMERIC,
  );
  ctx.assertEqual(
    "numeric number stays numeric",
    getShopifyNumericId(Number(V2_VARIANT_NUMERIC)),
    V2_VARIANT_NUMERIC,
  );
  ctx.assertTrue(
    "gid matches catalog numeric",
    isMileyoBuilderBoxCatalogLine(
      { id: V2_VARIANT_GID },
      CATALOG_IDS,
    ),
  );
  ctx.assertTrue(
    "cart.js numeric variant_id matches catalog GID-derived id",
    isMileyoBuilderBoxCatalogLine(v2BoxLine(), CATALOG_IDS),
  );

  ctx.scenario("I. Box identification");
  ctx.assertTrue(
    "A. known V2 variant is Mileyo box",
    isMileyoBuilderBoxLine(v2BoxLine(), CATALOG_IDS),
  );
  ctx.assertFalse(
    "B. dessert is preserved",
    isMileyoBuilderBoxLine(dessertLine(), CATALOG_IDS),
  );
  ctx.assertFalse(
    "C. drink is preserved",
    isMileyoBuilderBoxLine(drinkLine(), CATALOG_IDS),
  );
  ctx.assertTrue(
    "D. legacy builder signature identified",
    isMileyoBuilderBoxLegacyLine(legacyBoxLine()) &&
      isMileyoBuilderBoxLine(legacyBoxLine(), CATALOG_IDS),
  );
  ctx.assertFalse(
    "E. generic subscription without Mileyo signature preserved",
    isMileyoBuilderBoxLine(otherSubscriptionLine(), CATALOG_IDS),
  );
  ctx.assertFalse(
    "selling plan alone is not enough",
    isMileyoBuilderBoxLegacyLine({
      selling_plan_allocation: { selling_plan: { id: 1 } },
      properties: {},
    }),
  );

  ctx.scenario("J. Line attribute helpers still identify extras");
  const mixedCart = [v2BoxLine(), dessertLine(), drinkLine()];
  ctx.assertEqual(
    "only old box key collected",
    collectMileyoBuilderBoxLineKeys(mixedCart, CATALOG_IDS).join(","),
    `${V2_VARIANT_NUMERIC}:hash-v2`,
  );
  ctx.assertTrue(
    "cart helper still exports line key collector",
    cartSource.includes("collectMileyoBuilderBoxLineKeys"),
  );

  ctx.scenario("K. Multiple old boxes");
  const twoBoxes = [
    v2BoxLine(),
    legacyBoxLine(),
    dessertLine(),
  ];
  const removedKeys = collectMileyoBuilderBoxLineKeys(twoBoxes, CATALOG_IDS);
  ctx.assertEqual("two boxes removed", removedKeys.length, 2);
  ctx.assertTrue(
    "dessert key not removed",
    !removedKeys.includes("9001:tiramisu"),
  );

  ctx.scenario("L. Storefront checkout failure blocks redirect");
  ctx.assertTrue(
    "checkout create fail error name",
    clientSource.includes('"checkout_create_failed"'),
  );
  ctx.assertTrue(
    "email checkout catch shows prepare error on create fail",
    beginCheckoutFromEmail.includes("checkout_create_failed") &&
      beginCheckoutFromEmail.includes("CART_PREPARE_ERROR"),
  );
  ctx.assertFalse(
    "no ajax inspect/remove fail path",
    clientSource.includes('"cart_inspect_failed"') ||
      clientSource.includes('"cart_remove_failed"'),
  );

  ctx.scenario("M. Storefront payload + checkoutUrl redirect");
  ctx.assertTrue(
    "sellingPlanId included in checkout POST",
    createCheckoutFn.includes("sellingPlanId: selectedBox.sellingPlanId"),
  );
  ctx.assertTrue(
    "delivery date included in checkout POST",
    createCheckoutFn.includes(
      "scheduledDeliveryDate: selectedScheduledDeliveryDate",
    ),
  );
  ctx.assertTrue(
    "buyerIdentity email set server-side",
    checkoutServerSource.includes("buyerIdentity: {") &&
      checkoutServerSource.includes("email: input.email"),
  );
  ctx.assertTrue(
    "Plat N from meal titles on server",
    checkoutServerSource.includes("`Plat ${propertyIndex}`"),
  );
  ctx.assertTrue(
    "redirect uses checkoutUrl",
    createCheckoutFn.includes("payload.checkoutUrl") &&
      createCheckoutFn.includes("window.location.href = String(payload.checkoutUrl)"),
  );
  ctx.assertFalse(
    "no bare /checkout redirect",
    clientSource.includes('window.location.href = "/checkout"'),
  );
  ctx.assertFalse(
    "no redirect to /cart page",
    clientSource.includes('window.location.href = "/cart"'),
  );
  ctx.assertFalse(
    "no checkout email query hack",
    clientSource.includes("checkout[email]") ||
      clientSource.includes("checkout%5Bemail%5D"),
  );
  ctx.assertTrue(
    "Storefront buyer identity used",
    checkoutServerSource.includes("buyerIdentity") &&
      clientSource.includes("CREATE_CHECKOUT_INTENT"),
  );
  ctx.assertFalse(
    "no discount code in checkout URL",
    clientSource.includes("discount=") || clientSource.includes("/discount/"),
  );
  ctx.assertTrue(
    "loading copy",
    clientSource.includes("Préparation du paiement…"),
  );
  ctx.assertTrue(
    "double submit guard",
    emailSubmit.includes("isSubmittingCheckout") ||
      beginCheckoutFromEmail.includes("isSubmittingCheckout"),
  );

  ctx.scenario("N. Future extras architecture");
  const extrasCart = [legacyBoxLine(), dessertLine(), drinkLine()];
  const extrasKeys = collectMileyoBuilderBoxLineKeys(extrasCart, CATALOG_IDS);
  ctx.assertEqual("only legacy box removed from extras cart", extrasKeys.length, 1);
  ctx.assertEqual("legacy key", extrasKeys[0], "111:legacy-box");
  ctx.assertTrue(
    "cart helpers accept 0..N lines",
    collectMileyoBuilderBoxLineKeys([], CATALOG_IDS).length === 0 &&
      collectMileyoBuilderBoxLineKeys(
        [dessertLine(), drinkLine()],
        CATALOG_IDS,
      ).length === 0,
  );
  ctx.assertTrue(
    "email mini-recap sections ready for selection summary",
    renderSource.includes('id="email-mini-recap"') &&
      renderSource.includes(">Livraison<") &&
      renderSource.includes(">Plats<"),
  );

  ctx.scenario("O. Prisma / selling plans / draft untouched");
  ctx.assertFalse(
    "13I does not set convertedAt",
    clientSource.includes("convertedAt"),
  );
  ctx.assertTrue(
    "CheckoutLead model unchanged unique",
    schemaSource.includes("@@unique([shop, email])"),
  );
  ctx.assertFalse(
    "no pricingPolicies added to V2 selling plan setup",
    /pricingPolicies\s*:/.test(sellingPlansV2),
  );
  ctx.assertFalse(
    "no automaticDiscount mutation",
    clientSource.includes("automaticDiscount") ||
      clientSource.includes("discountCode"),
  );

  return finishSuite("22-builder-recap-checkout-step", ctx);
};

process.exitCode = runSuite();
