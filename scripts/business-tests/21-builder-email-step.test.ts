/**
 * Business regression — builder email step + checkout lead capture (13H).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FIRST_BOX_LAUNCH_DISCOUNT_EUR } from "../../app/constants/firstBoxLaunchDiscount";
import {
  BUILDER_STEP_COUNT,
  BUILDER_STEPS,
} from "../../app/features/builder/builder-objective-options";
import {
  CAPTURE_CHECKOUT_LEAD_INTENT,
  normalizeBuilderEmail,
} from "../../app/features/builder/builder-email";
import { parseCheckoutLeadContext } from "../../app/features/builder/builder-lead.server";
import { getV2WeeklySellingPlanGroupInput } from "../../app/features/settings/settings-selling-plans-v2.server";
import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = () => {
  const ctx = createBusinessTestContext("21-builder-email-step");
  const clientSource = readRepoFile("app/features/builder/builder-client.ts");
  const renderSource = readRepoFile("app/features/builder/builder-render.ts");
  const routeSource = readRepoFile("app/routes/apps.box-builder.tsx");
  const leadSource = readRepoFile(
    "app/features/builder/builder-lead.server.ts",
  );
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const discountSource = readRepoFile(
    "app/constants/firstBoxLaunchDiscount.ts",
  );

  ctx.scenario("A. Email validation");
  ctx.assertEqual(
    "test@example.com valid",
    normalizeBuilderEmail("test@example.com").valid,
    true,
  );
  ctx.assertEqual(
    "QA email test@exemple.com valid",
    normalizeBuilderEmail("test@exemple.com").valid,
    true,
  );
  const trimmed = normalizeBuilderEmail(" test@example.com ");
  ctx.assertEqual("trimmed whitespace valid", trimmed.valid, true);
  if (trimmed.valid) {
    ctx.assertEqual("trimmed value", trimmed.value, "test@example.com");
  }
  ctx.assertEqual("a@b.co valid", normalizeBuilderEmail("a@b.co").valid, true);
  ctx.assertEqual("empty invalid", normalizeBuilderEmail("").valid, false);
  ctx.assertEqual("blank invalid", normalizeBuilderEmail("   ").valid, false);
  ctx.assertEqual(
    "missing @ invalid",
    normalizeBuilderEmail("test.example.com").valid,
    false,
  );
  ctx.assertEqual(
    "missing local invalid",
    normalizeBuilderEmail("@example.com").valid,
    false,
  );
  ctx.assertEqual(
    "missing domain invalid",
    normalizeBuilderEmail("test@").valid,
    false,
  );
  ctx.assertEqual(
    "domain without dot invalid",
    normalizeBuilderEmail("test@localhost").valid,
    false,
  );
  ctx.assertEqual(
    "internal whitespace invalid",
    normalizeBuilderEmail("test @example.com").valid,
    false,
  );
  ctx.assertEqual(
    ">254 chars invalid",
    normalizeBuilderEmail(`${"a".repeat(64)}@${"b".repeat(190)}.com`).valid,
    false,
  );
  const cased = normalizeBuilderEmail("Test.User@Example.com");
  ctx.assertEqual("preserves local-part case", cased.valid, true);
  if (cased.valid) {
    ctx.assertEqual(
      "does not force lowercase",
      cased.value,
      "Test.User@Example.com",
    );
  }

  ctx.scenario("B. Step system");
  ctx.assertEqual("step count is 6", BUILDER_STEP_COUNT, 6);
  ctx.assertEqual(
    "exact step order",
    BUILDER_STEPS.join("→"),
    "objectif→formule→livraison→repas→email→recap",
  );
  ctx.assertEqual("email remains fifth", BUILDER_STEPS[4], "email");
  ctx.assertEqual("recap is last", BUILDER_STEPS[5], "recap");
  ctx.assertTrue("hash #email in client", clientSource.includes('"#email"'));
  ctx.assertTrue("hash #recap in client", clientSource.includes('"#recap"'));
  ctx.assertTrue("hash #repas preserved", clientSource.includes('"#repas"'));
  ctx.assertTrue(
    "hash #livraison preserved",
    clientSource.includes('"#livraison"'),
  );
  ctx.assertTrue(
    "hash #formule preserved",
    clientSource.includes('"#formule"'),
  );
  ctx.assertTrue(
    "formule id preserved",
    BUILDER_STEPS[1] === "formule" && renderSource.includes('id="step-formula"'),
  );

  ctx.scenario("C. Repas CTA goes to email, not cart");
  ctx.assertTrue(
    "meals complete CTA is Continuer",
    clientSource.includes('addToCart.textContent = "Continuer"'),
  );
  const mealsClickMatch = clientSource.match(
    /addToCart\.addEventListener\("click", function \(\) \{[\s\S]*?\n {2}\}\);/,
  );
  ctx.assertTrue("meals click listener exists", Boolean(mealsClickMatch));
  ctx.assertTrue(
    "meals click shows email step",
    Boolean(mealsClickMatch?.[0].includes('showStep("email")')),
  );
  ctx.assertFalse(
    "meals click does not call cart/add.js",
    Boolean(mealsClickMatch?.[0].includes("/cart/add.js")),
  );
  ctx.assertTrue(
    "storefront checkout exists for recap",
    clientSource.includes("createBuilderCheckout") &&
      clientSource.includes("CREATE_CHECKOUT_INTENT"),
  );
  ctx.assertFalse(
    "ajax cart add removed from checkout path",
    clientSource.includes('fetch("/cart/add.js"'),
  );

  ctx.scenario("D. Email UI copy");
  ctx.assertTrue(
    "title Votre e-mail",
    renderSource.includes("Votre e-mail"),
  );
  ctx.assertFalse(
    "stale plus qu une etape title removed",
    renderSource.includes("Plus qu’une étape"),
  );
  ctx.assertTrue(
    "email field label",
    renderSource.includes("Votre adresse e-mail"),
  );
  ctx.assertTrue(
    "offre de lancement",
    renderSource.includes("Offre de lancement"),
  );
  ctx.assertTrue("nouveaux clients", renderSource.includes("Nouveaux clients"));
  ctx.assertTrue(
    "20 € from constant",
    renderSource.includes("${FIRST_BOX_LAUNCH_DISCOUNT_EUR} €") ||
      renderSource.includes(`${FIRST_BOX_LAUNCH_DISCOUNT_EUR} €`),
  );
  ctx.assertTrue("première box", renderSource.includes("première box"));
  ctx.assertTrue(
    "eligibility nuance",
    renderSource.includes("si vous êtes éligible"),
  );
  ctx.assertFalse(
    "email weekly price element removed from render",
    renderSource.includes('id="email-weekly-price"') ||
      renderSource.includes("email-weekly-price"),
  );
  ctx.assertFalse(
    "updateEmailWeeklyPrice removed from client",
    clientSource.includes("updateEmailWeeklyPrice"),
  );
  ctx.assertFalse(
    "email step Puis/semaine copy removed from client",
    clientSource.includes('"Puis " + formatEuros(selectedBox.price) + "/semaine."'),
  );
  ctx.assertTrue(
    "recap weekly pricing preserved elsewhere",
    renderSource.includes('id="recap-weekly-price"') &&
      clientSource.includes("function getBuilderLaunchPricing"),
  );
  ctx.assertTrue(
    "privacy note",
    renderSource.includes(
      "Nous utilisons votre e-mail pour vous accompagner dans votre commande",
    ),
  );
  ctx.assertTrue(
    "email input attributes",
    renderSource.includes('type="email"') &&
      renderSource.includes('autocomplete="email"') &&
      renderSource.includes('maxlength="254"'),
  );
  ctx.assertTrue(
    "email CTA label",
    clientSource.includes('emailContinue.textContent = "Continuer"'),
  );
  ctx.assertFalse(
    "email CTA is no longer add to cart",
    clientSource.includes('"Ajouter ma box au panier"') ||
      renderSource.includes("Ajouter ma box au panier"),
  );

  ctx.scenario("E. Launch offer display math — no guaranteed checkout price");
  ctx.assertFalse(
    "no FIRST_WEEK_DISCOUNT_EUR",
    clientSource.includes("FIRST_WEEK_DISCOUNT_EUR"),
  );
  ctx.assertFalse(
    "no firstBoxPrice identifier",
    clientSource.includes("firstBoxPrice") ||
      renderSource.includes("firstBoxPrice"),
  );
  ctx.assertFalse(
    "no fragile selectedBox.price - 20 float math",
    clientSource.includes("selectedBox.price - 20") ||
      clientSource.includes("price - FIRST_BOX_LAUNCH_DISCOUNT"),
  );
  ctx.assertTrue(
    "display math uses getBuilderLaunchPricing / cents",
    clientSource.includes("function getBuilderLaunchPricing") &&
      clientSource.includes("Math.round(LAUNCH_DISCOUNT_EUR * 100)"),
  );
  ctx.assertFalse(
    "no guaranteed you get 20",
    renderSource.includes("Vous bénéficiez de 20") ||
      clientSource.includes("Vous bénéficiez de 20"),
  );
  const promoBlock =
    renderSource.match(/class="tunnel-promo"[\s\S]*?<\/div>/)?.[0] ?? "";
  ctx.assertTrue(
    "tunnel promo banner present",
    renderSource.includes('class="tunnel-promo"'),
  );
  ctx.assertTrue(
    "promo before tunnel header",
    /tunnel-promo[\s\S]*tunnel-header/.test(renderSource),
  );
  ctx.assertEqual(
    "promo appears once in builder render",
    (renderSource.match(/class="tunnel-promo"/g) ?? []).length,
    1,
  );
  ctx.assertTrue(
    "promo uses FIRST_BOX_LAUNCH_DISCOUNT_EUR",
    renderSource.includes("${FIRST_BOX_LAUNCH_DISCOUNT_EUR} € offerts") ||
      promoBlock.includes(`${FIRST_BOX_LAUNCH_DISCOUNT_EUR} € offerts`),
  );
  ctx.assertTrue(
    "promo mentions première box",
    promoBlock.includes("première box"),
  );
  ctx.assertTrue(
    "promo subtitle present",
    promoBlock.includes("Appliqués automatiquement au paiement"),
  );
  ctx.assertFalse(
    "checkout has no promo discount logic added",
    /tunnel-promo|20 € offerts/.test(
      clientSource.match(/function createBuilderCheckout[\s\S]*?\n {2}function /)?.[0] ??
        "",
    ),
  );
  ctx.assertEqual(
    "UI constant is 20",
    FIRST_BOX_LAUNCH_DISCOUNT_EUR,
    20,
  );
  ctx.assertTrue(
    "constant documents Shopify alignment",
    discountSource.includes(
      "Must stay aligned with the automatic Shopify LANCEMENT discount",
    ),
  );
  ctx.assertTrue(
    "constant documents eligibility is not guaranteed",
    discountSource.includes("Does not determine visitor eligibility") ||
      discountSource.includes("eligibility"),
  );
  ctx.assertFalse(
    "constant does not configure selling plans",
    discountSource.includes("pricingPolicies"),
  );
  ctx.assertFalse(
    "does not reuse subscriptionDiscountPercent",
    clientSource.includes("subscriptionDiscountPercent") ||
      renderSource.includes("subscriptionDiscountPercent") ||
      leadSource.includes("subscriptionDiscountPercent"),
  );

  ctx.scenario("F. Cart payload unchanged — no email/promo properties");
  ctx.assertTrue(
    "sellingPlanId sent to storefront checkout",
    clientSource.includes("sellingPlanId: selectedBox.sellingPlanId"),
  );
  ctx.assertTrue(
    "delivery date sent to storefront checkout",
    clientSource.includes(
      "scheduledDeliveryDate: selectedScheduledDeliveryDate",
    ),
  );
  ctx.assertTrue(
    "meals payload built from meal.title",
    clientSource.includes("title: meal.title") &&
      clientSource.includes("quantity: quantity"),
  );
  ctx.assertFalse(
    "ajax cart properties block removed",
    /var properties = \{/.test(clientSource),
  );

  ctx.scenario("G. App Proxy lead capture");
  ctx.assertEqual(
    "intent name",
    CAPTURE_CHECKOUT_LEAD_INTENT,
    "capture_checkout_lead",
  );
  ctx.assertTrue(
    "route has action",
    routeSource.includes("export const action"),
  );
  ctx.assertTrue(
    "App Proxy POST uses pathname+search",
    clientSource.includes(
      "fetch(window.location.pathname + window.location.search",
    ),
  );
  ctx.assertFalse(
    "lead fetch does not use an internal app route",
    /fetch\(["']\/app\//.test(clientSource),
  );
  ctx.assertTrue(
    "lead fetch sends JSON",
    clientSource.includes('"Content-Type": "application/json"'),
  );
  ctx.assertTrue(
    "action parses JSON body",
    routeSource.includes("await request.json()"),
  );
  ctx.assertTrue(
    "upsert uses generated shop_email unique",
    /where:\s*\{[\s\S]*shop_email:/.test(leadSource),
  );
  const generatedClient = readRepoFile(
    "node_modules/.prisma/client/index.d.ts",
  );
  ctx.assertTrue(
    "generated Prisma client knows CheckoutLead",
    generatedClient.includes("export type CheckoutLead ="),
  );
  ctx.assertTrue(
    "generated Prisma client has shop_email compound unique",
    generatedClient.includes(
      "shop_email?: CheckoutLeadShopEmailCompoundUniqueInput",
    ),
  );
  ctx.assertTrue(
    "shop from App Proxy auth not body",
    routeSource.includes("authenticateMileyoAppProxy") &&
      !/body\.shop/.test(routeSource),
  );
  ctx.assertFalse(
    "client does not send shop",
    /JSON\.stringify\(\{[\s\S]*shop:/.test(clientSource),
  );
  const emailSubmitMatch = clientSource.match(
    /function handleEmailSubmit\(\) \{[\s\S]*?\n {2}function handleRecapSubmit/,
  );
  ctx.assertTrue("email submit handler exists", Boolean(emailSubmitMatch));
  ctx.assertTrue(
    "lead then recap",
    Boolean(
      emailSubmitMatch?.[0].includes("captureCheckoutLead") &&
        emailSubmitMatch?.[0].includes('showStep("recap")'),
    ),
  );
  ctx.assertFalse(
    "email submit does not add to cart",
    Boolean(emailSubmitMatch?.[0].includes("addSelectedBoxToCart")),
  );
  ctx.assertFalse(
    "email submit does not call cart/add.js",
    Boolean(emailSubmitMatch?.[0].includes("/cart/add.js")),
  );
  ctx.assertTrue(
    "lead failure copy",
    clientSource.includes(
      "Impossible de continuer pour le moment. Réessayez.",
    ),
  );
  ctx.assertTrue(
    "upsert does not touch convertedAt",
    /update:\s*\{[\s\S]*lastSeenAt[\s\S]*\}/.test(leadSource) &&
      !/update:\s*\{[\s\S]*convertedAt/.test(leadSource),
  );
  ctx.assertTrue(
    "CheckoutLead model exists",
    schemaSource.includes("model CheckoutLead"),
  );
  ctx.assertTrue(
    "unique shop+email",
    schemaSource.includes("@@unique([shop, email])"),
  );

  ctx.scenario("H. Optional context parsing");
  ctx.assertEqual(
    "valid objective kept",
    parseCheckoutLeadContext({
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    }).objective,
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  ctx.assertNull(
    "invalid objective skipped",
    parseCheckoutLeadContext({ objective: "lose_weight" }).objective,
  );
  ctx.assertNull(
    "missing optionals are null",
    parseCheckoutLeadContext({}).boxVariantId,
  );
  ctx.assertEqual(
    "mealCount parsed",
    parseCheckoutLeadContext({ mealCount: "12" }).mealCount,
    12,
  );
  ctx.assertNull(
    "invalid mealCount skipped",
    parseCheckoutLeadContext({ mealCount: "abc" }).mealCount,
  );
  ctx.assertEqual(
    "valid delivery date kept",
    parseCheckoutLeadContext({ scheduledDeliveryDate: "2026-08-20" })
      .scheduledDeliveryDate,
    "2026-08-20",
  );
  ctx.assertNull(
    "invalid delivery date skipped",
    parseCheckoutLeadContext({ scheduledDeliveryDate: "20/08/2026" })
      .scheduledDeliveryDate,
  );

  ctx.scenario("I. No Shopify discount/selling-plan mutation in 13H");
  const v2PlanInput = getV2WeeklySellingPlanGroupInput().sellingPlansToCreate[0];
  ctx.assertFalse(
    "V2 create input omits pricingPolicies",
    Object.prototype.hasOwnProperty.call(v2PlanInput, "pricingPolicies"),
  );
  ctx.assertFalse(
    "13H route has no selling plan mutation",
    routeSource.includes("sellingPlanGroupUpdate") ||
      routeSource.includes("pricingPolicies"),
  );
  ctx.assertFalse(
    "no customerCreate",
    leadSource.includes("customerCreate") ||
      routeSource.includes("customerCreate"),
  );
  ctx.assertFalse(
    "no newsletter checkbox",
    renderSource.includes("newsletter") || renderSource.includes("checkbox"),
  );
  ctx.assertTrue(
    "email state preserved — selectedEmail not reset on box change",
    clientSource.includes("var selectedEmail = \"\"") &&
      !/resetBoxSelectionState[\s\S]*selectedEmail = ""/.test(clientSource),
  );
  ctx.assertTrue(
    "hash email requires complete meals",
    clientSource.includes("isMealsSelectionComplete()"),
  );
  ctx.assertTrue(
    "no convertedAt wiring in 13H capture",
    !leadSource.includes("convertedAt:"),
  );
  ctx.assertFalse(
    "no email console.log",
    /console\.(log|error|info|warn)\([^)]*email/.test(leadSource),
  );

  return finishSuite("21-builder-email-step", ctx);
};

process.exitCode = runSuite();
