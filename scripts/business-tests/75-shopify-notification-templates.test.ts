/**
 * Business regression — Shopify notification templates (provisioning assist).
 *
 * Static checks only: catalog + Order Confirmation liquid integrity.
 * No Liquid parser; no Shopify Admin API writes.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ORDER_CONFIRMATION_CHECKLIST,
  ORDER_CONFIRMATION_CRITICAL_LIQUID_TOKENS,
  ORDER_CONFIRMATION_RECOMMENDED_SUBJECT,
  OUT_FOR_DELIVERY_CHECKLIST,
  OUT_FOR_DELIVERY_CRITICAL_LIQUID_TOKENS,
  OUT_FOR_DELIVERY_RECOMMENDED_SUBJECT,
  DELIVERED_CHECKLIST,
  DELIVERED_CRITICAL_LIQUID_TOKENS,
  DELIVERED_RECOMMENDED_SUBJECT,
  ORDER_CANCELLED_CHECKLIST,
  ORDER_CANCELLED_CRITICAL_LIQUID_TOKENS,
  ORDER_CANCELLED_RECOMMENDED_SUBJECT,
  REFUND_CHECKLIST,
  REFUND_CRITICAL_LIQUID_TOKENS,
  REFUND_RECOMMENDED_SUBJECT,
  PAYMENT_METHOD_UPDATE_CHECKLIST,
  PAYMENT_METHOD_UPDATE_CRITICAL_LIQUID_TOKENS,
  PAYMENT_METHOD_UPDATE_RECOMMENDED_SUBJECT,
  SHIPPING_CONFIRMATION_CHECKLIST,
  SHIPPING_CONFIRMATION_CRITICAL_LIQUID_TOKENS,
  SHIPPING_CONFIRMATION_RECOMMENDED_SUBJECT,
  SHIPPING_UPDATE_CHECKLIST,
  SHIPPING_UPDATE_CRITICAL_LIQUID_TOKENS,
  SHIPPING_UPDATE_RECOMMENDED_SUBJECT,
  SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK,
  SHOPIFY_NOTIFICATION_TEMPLATES,
  buildShopifyNotificationProgress,
  checklistForNotification,
  findShopifyNotificationById,
} from "../../app/features/shopify-notifications/shopify-notifications-catalog";
import { readShopifyNotificationLiquid } from "../../app/features/shopify-notifications/shopify-notifications-templates.server";
import { MILEYO_EMAIL_LOGO_URL } from "../../app/services/email/components/mileyoEmailLogo";
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

const MILEYO_TEMPLATE =
  "app/features/shopify-notifications/templates/order-confirmation.mileyo.liquid";
const ORIGINAL_TEMPLATE =
  "app/features/shopify-notifications/templates/order-confirmation.shopify-original.liquid";
const SHIPPING_MILEYO_TEMPLATE =
  "app/features/shopify-notifications/templates/shipping-confirmation.mileyo.liquid";
const SHIPPING_ORIGINAL_TEMPLATE =
  "app/features/shopify-notifications/templates/shipping-confirmation.shopify-original.liquid";
const SHIPPING_UPDATE_MILEYO_TEMPLATE =
  "app/features/shopify-notifications/templates/shipping-update.mileyo.liquid";
const SHIPPING_UPDATE_ORIGINAL_TEMPLATE =
  "app/features/shopify-notifications/templates/shipping-update.shopify-original.liquid";
const OUT_FOR_DELIVERY_MILEYO_TEMPLATE =
  "app/features/shopify-notifications/templates/out-for-delivery.mileyo.liquid";
const OUT_FOR_DELIVERY_ORIGINAL_TEMPLATE =
  "app/features/shopify-notifications/templates/out-for-delivery.shopify-original.liquid";
const DELIVERED_MILEYO_TEMPLATE =
  "app/features/shopify-notifications/templates/delivered.mileyo.liquid";
const DELIVERED_ORIGINAL_TEMPLATE =
  "app/features/shopify-notifications/templates/delivered.shopify-original.liquid";
const ORDER_CANCELLED_MILEYO_TEMPLATE =
  "app/features/shopify-notifications/templates/order-cancelled.mileyo.liquid";
const ORDER_CANCELLED_ORIGINAL_TEMPLATE =
  "app/features/shopify-notifications/templates/order-cancelled.shopify-original.liquid";
const REFUND_MILEYO_TEMPLATE =
  "app/features/shopify-notifications/templates/refund.mileyo.liquid";
const REFUND_ORIGINAL_TEMPLATE =
  "app/features/shopify-notifications/templates/refund.shopify-original.liquid";
const PAYMENT_METHOD_UPDATE_MILEYO_TEMPLATE =
  "app/features/shopify-notifications/templates/payment-method-update.mileyo.liquid";
const PAYMENT_METHOD_UPDATE_ORIGINAL_TEMPLATE =
  "app/features/shopify-notifications/templates/payment-method-update.shopify-original.liquid";

const FORBIDDEN = ["ngrok", "SHOPIFY_APP_URL", "localhost:3000"];

const ENGLISH_LABELS_REMOVED = [
  "Thank you for your purchase!",
  "View your order",
  "Order summary",
  "Customer information",
  "Shipping address",
  "If you have any questions, reply to this email",
];

const runSuite = async () => {
  const ctx = createBusinessTestContext("75-shopify-notification-templates");

  ctx.scenario("A. Fichiers feature / route / nav");
  const requiredFiles = [
    "app/routes/app.shopify-notifications.tsx",
    "app/features/shopify-notifications/shopify-notifications-catalog.ts",
    "app/features/shopify-notifications/shopify-notifications-render.tsx",
    "app/features/shopify-notifications/shopify-notifications-data.server.ts",
    "app/features/shopify-notifications/shopify-notifications-templates.server.ts",
    MILEYO_TEMPLATE,
    ORIGINAL_TEMPLATE,
    SHIPPING_MILEYO_TEMPLATE,
    SHIPPING_ORIGINAL_TEMPLATE,
    SHIPPING_UPDATE_MILEYO_TEMPLATE,
    SHIPPING_UPDATE_ORIGINAL_TEMPLATE,
    OUT_FOR_DELIVERY_MILEYO_TEMPLATE,
    OUT_FOR_DELIVERY_ORIGINAL_TEMPLATE,
    DELIVERED_MILEYO_TEMPLATE,
    DELIVERED_ORIGINAL_TEMPLATE,
    ORDER_CANCELLED_MILEYO_TEMPLATE,
    ORDER_CANCELLED_ORIGINAL_TEMPLATE,
    REFUND_MILEYO_TEMPLATE,
    REFUND_ORIGINAL_TEMPLATE,
    PAYMENT_METHOD_UPDATE_MILEYO_TEMPLATE,
    PAYMENT_METHOD_UPDATE_ORIGINAL_TEMPLATE,
  ];
  for (const relativePath of requiredFiles) {
    ctx.assertTrue(
      `${relativePath} existe`,
      existsSync(join(repoRoot, relativePath)),
    );
  }

  const nav = readRepoFile("app/routes/app.tsx");
  ctx.assertTrue(
    "Nav contient Notifications Shopify",
    nav.includes('href="/app/shopify-notifications"') &&
      nav.includes("Notifications Shopify"),
  );

  const runner = readRepoFile(
    "scripts/business-tests/00-run-business-regression-suite.ts",
  );
  ctx.assertEqual(
    "Suite 75 enregistrée une seule fois dans le runner",
    countOccurrences(
      runner,
      /75-shopify-notification-templates\.test\.ts/g,
    ),
    1,
  );

  ctx.scenario("B. Catalogue typé");
  const expectedIds = [
    "order-confirmation",
    "shipping-confirmation",
    "shipping-update",
    "out-for-delivery",
    "delivered",
    "order-cancelled",
    "refund",
    "abandoned-checkout",
    "payment-method-update",
  ];
  ctx.assertEqual(
    "9 notifications catalogue",
    SHOPIFY_NOTIFICATION_TEMPLATES.length,
    expectedIds.length,
  );
  for (const id of expectedIds) {
    ctx.assertTrue(`Catalogue contient ${id}`, Boolean(findShopifyNotificationById(id)));
  }

  const orderConfirmation = findShopifyNotificationById("order-confirmation");
  ctx.assertEqual(
    "Order confirmation status = ready",
    orderConfirmation?.status,
    "ready",
  );
  ctx.assertEqual(
    "Order confirmation owner = shopify",
    orderConfirmation?.owner,
    "shopify",
  );
  ctx.assertEqual(
    "Subject recommandé = Récapitulatif de votre commande Mileyo",
    orderConfirmation?.recommendedSubject,
    ORDER_CONFIRMATION_RECOMMENDED_SUBJECT,
  );
  ctx.assertEqual(
    "Constante subject exposée",
    ORDER_CONFIRMATION_RECOMMENDED_SUBJECT,
    "Récapitulatif de votre commande Mileyo",
  );
  ctx.assertTrue(
    "Subject recommandé ≠ Resend SubscriptionCreated",
    orderConfirmation?.recommendedSubject !==
      "Votre abonnement Mileyo est confirmé",
  );
  ctx.assertTrue(
    "Subject recommandé ≠ confirmation concurrente",
    !String(orderConfirmation?.recommendedSubject ?? "").includes(
      "est confirmée",
    ),
  );

  const abandoned = findShopifyNotificationById("abandoned-checkout");
  ctx.assertEqual("Abandoned checkout status = todo", abandoned?.status, "todo");
  ctx.assertEqual(
    "Abandoned checkout owner = shopify",
    abandoned?.owner,
    "shopify",
  );

  const paymentUpdate = findShopifyNotificationById("payment-method-update");
  ctx.assertEqual(
    "Payment method update status = ready",
    paymentUpdate?.status,
    "ready",
  );
  ctx.assertEqual(
    "Payment method update owner = shopify_and_mileyo",
    paymentUpdate?.owner,
    "shopify_and_mileyo",
  );

  const progress = buildShopifyNotificationProgress();
  ctx.assertEqual("Progress ready = 8", progress.ready, 8);
  ctx.assertEqual("Progress shopifySystem = 0", progress.shopifySystem, 0);
  ctx.assertTrue(
    "Pas de statut installé dans le catalogue",
    SHOPIFY_NOTIFICATION_TEMPLATES.every(
      (template) =>
        template.status !== ("installed" as never) &&
        template.status !== ("synced" as never),
    ),
  );

  const renderSource = readRepoFile(
    "app/features/shopify-notifications/shopify-notifications-render.tsx",
  );
  ctx.assertFalse(
    "UI n’affiche pas Installé / Synchronisé / À jour",
    renderSource.includes('"Installé"') ||
      renderSource.includes("Synchronisé") ||
      renderSource.includes("À jour dans Shopify"),
  );
  ctx.assertTrue(
    "UI rappelle ready ≠ installed",
    renderSource.includes("≠ installé dans Shopify") ||
      (renderSource.includes("≠") && renderSource.includes("installé")),
  );
  ctx.assertTrue(
    "UI a Copier le template",
    renderSource.includes("Copier le template"),
  );
  ctx.assertTrue(
    "UI a Copier l’objet (subject séparé)",
    renderSource.includes("Copier l’objet") ||
      renderSource.includes("Copier l'objet"),
  );
  ctx.assertTrue(
    "UI sépare Objet recommandé du template",
    renderSource.includes("Objet recommandé") &&
      renderSource.includes("ne change pas l’objet"),
  );
  ctx.assertTrue(
    "Checklist démarre par Copier l’objet",
    ORDER_CONFIRMATION_CHECKLIST[0].includes("objet") ||
      ORDER_CONFIRMATION_CHECKLIST[0].includes("Objet"),
  );
  ctx.assertTrue(
    "Checklist shipping démarre par Copier l’objet",
    SHIPPING_CONFIRMATION_CHECKLIST[0].includes("objet") ||
      SHIPPING_CONFIRMATION_CHECKLIST[0].includes("Objet"),
  );
  ctx.assertTrue(
    "checklistForNotification routing",
    checklistForNotification("shipping-confirmation")[2]?.includes(
      "template",
    ) === true &&
      checklistForNotification("shipping-update")[0]?.includes("objet") ===
        true &&
      checklistForNotification("out-for-delivery")[0]?.includes("objet") ===
        true &&
      checklistForNotification("delivered")[0]?.includes("objet") === true &&
      checklistForNotification("order-confirmation")[0]?.includes("objet") ===
        true &&
      checklistForNotification("payment-method-update")[0]?.includes("objet") ===
        true,
  );
  ctx.assertTrue(
    "Pas de mutation API notifications",
    !renderSource.includes("notificationUpdate") &&
      !renderSource.includes("emailTemplateUpdate"),
  );

  ctx.scenario("C. Template Order Confirmation Mileyo");
  const mileyo = readShopifyNotificationLiquid(
    "order-confirmation.mileyo.liquid",
  );
  const original = readShopifyNotificationLiquid(
    "order-confirmation.shopify-original.liquid",
  );

  ctx.assertTrue("Template Mileyo non vide", mileyo.trim().length > 500);
  ctx.assertTrue("Template original non vide", original.trim().length > 500);
  ctx.assertTrue("Logo CDN présent", mileyo.includes(MILEYO_EMAIL_LOGO_URL));
  ctx.assertTrue("Token cream #FCF8F6", mileyo.includes("#FCF8F6"));
  ctx.assertTrue("Token card #FFFFFF", mileyo.includes("#FFFFFF"));
  ctx.assertTrue("Token text #3A2C45", mileyo.includes("#3A2C45"));
  ctx.assertTrue("Token title/CTA #5A1B69", mileyo.includes("#5A1B69"));
  ctx.assertTrue("Token muted #6F5A7D", mileyo.includes("#6F5A7D"));
  ctx.assertTrue("Token border #E8D9F2 (usage ciblé)", mileyo.includes("#E8D9F2"));
  ctx.assertTrue("Radius card 16px", mileyo.includes("16px"));
  ctx.assertTrue("CTA pill radius 28px", mileyo.includes("28px"));
  ctx.assertTrue(
    "Stack sans serif moderne (pas Georgia)",
    mileyo.includes(SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK) &&
      !mileyo.includes("Georgia") &&
      !mileyo.includes("Times New Roman") &&
      !mileyo.includes("Times, serif"),
  );
  ctx.assertTrue(
    "Titres sans serif (même famille body)",
    mileyo.includes("letter-spacing: -0.02em") &&
      !/font-family:\s*Georgia/i.test(mileyo),
  );
  ctx.assertTrue("contact@mileyo.fr", mileyo.includes("contact@mileyo.fr"));
  ctx.assertTrue("CTA français", mileyo.includes("Voir ma commande"));
  ctx.assertTrue(
    "Shop tracking secondaire (Suivre avec)",
    mileyo.includes("Suivre avec") && mileyo.includes("button__cell--shop-app"),
  );
  ctx.assertTrue(
    "Pas de border systématique .container #E8D9F2",
    !mileyo.includes(
      ".container { background-color: #FFFFFF; border: 1px solid #E8D9F2",
    ) && mileyo.includes("table.container, .container") &&
      mileyo.includes("border: 0 !important"),
  );
  ctx.assertTrue(
    "Main card unique (mileyo-main-card)",
    mileyo.includes("mileyo-main-card") &&
      mileyo.includes("mileyo-main-card__inner") &&
      mileyo.includes("Only .mileyo-main-card is the white surface"),
  );
  ctx.assertTrue(
    "Containers = wrappers transparents (pas cards autonomes)",
    mileyo.includes("Width wrappers only") &&
      mileyo.includes("background-color: transparent !important"),
  );
  ctx.assertTrue(
    "Header/content/section sans fond blanc autonome",
    mileyo.includes(".mileyo-main-card .header__cell") &&
      mileyo.includes(".mileyo-main-card .content__cell") &&
      mileyo.includes(".mileyo-main-card .section__cell") &&
      mileyo.includes("background-color: transparent !important"),
  );
  ctx.assertTrue(
    "Dividers section via border-top #E8D9F2",
    mileyo.includes("border-top: 1px solid #E8D9F2"),
  );
  ctx.assertTrue(
    "empty-line neutralisé (whitespace)",
    mileyo.includes(".empty-line") &&
      mileyo.includes("display: none !important"),
  );
  ctx.assertTrue(
    "Shop secondaire lisible (fond violet pour logo blanc)",
    mileyo.includes("button__cell--shop-app") &&
      mileyo.includes("Suivre avec") &&
      mileyo.includes("shop_logo_img"),
  );
  ctx.assertTrue(
    "CTA même largeur partagée (200px)",
    mileyo.includes("min-width: 200px") &&
      mileyo.includes(".button__cell--shop-app") &&
      mileyo.includes(".actions-buttons") &&
      mileyo.includes("width: 200px"),
  );
  ctx.assertTrue(
    "Spacing section titres (padding-top 32 / h3 margin-bottom 20)",
    mileyo.includes("padding: 32px 24px 28px") &&
      mileyo.includes("margin: 0 0 20px"),
  );
  ctx.assertTrue(
    "Customer info cards espacement commun",
    mileyo.includes("customer-info-row") &&
      mileyo.includes("border-spacing: 14px 14px") &&
      mileyo.includes("padding: 14px 16px"),
  );
  ctx.assertTrue(
    "Footer hors main card (cream)",
    mileyo.includes("footer__cell") &&
      mileyo.indexOf("mileyo-main-card") < mileyo.indexOf('class="row footer"'),
  );
  ctx.assertTrue(
    "Logo centré (mileyo-header)",
    mileyo.includes("mileyo-header") && mileyo.includes("mileyo-logo"),
  );
  ctx.assertTrue(
    "Numéro commande secondaire (mileyo-order-ref)",
    mileyo.includes("mileyo-order-ref") &&
      mileyo.includes("Commande {{ order_name }}"),
  );
  ctx.assertTrue(
    "Copy pickup FR Mileyo",
    mileyo.includes(
      "Nous vous préviendrons dès que votre commande sera prête à être récupérée.",
    ),
  );
  ctx.assertTrue(
    "Copy local FR Mileyo",
    mileyo.includes("Nous préparons votre commande pour sa livraison."),
  );
  ctx.assertTrue(
    "Copy shipping FR Mileyo",
    mileyo.includes(
      "Nous préparons votre commande. Vous recevrez un e-mail dès qu’elle sera expédiée.",
    ),
  );
  ctx.assertTrue(
    "Intro récapitulatif",
    mileyo.includes(
      "Voici le récapitulatif de votre commande ainsi que vos informations de livraison et de paiement.",
    ),
  );
  ctx.assertTrue(
    "Titre récapitulatif",
    mileyo.includes("Récapitulatif de votre commande"),
  );
  ctx.assertTrue(
    "Enums Liquid pickup/local/shipping intacts",
    mileyo.includes("'pick-up'") &&
      mileyo.includes("'local'") &&
      mileyo.includes("'shipping'"),
  );
  ctx.assertTrue("order_status_url", mileyo.includes("order_status_url"));
  ctx.assertTrue("order_name", mileyo.includes("order_name"));
  ctx.assertTrue("transactions", mileyo.includes("transactions"));
  ctx.assertTrue("shipping_address", mileyo.includes("shipping_address"));
  ctx.assertTrue(
    "has_pending_payment préservé",
    mileyo.includes("has_pending_payment"),
  );
  ctx.assertTrue(
    "buyer_action_required préservé",
    mileyo.includes("buyer_action_required"),
  );
  ctx.assertTrue(
    "Gift card gateway comparison préservée",
    mileyo.includes('gateway_display_name == "Gift card"'),
  );

  const ifCount = countOccurrences(mileyo, /\{%\s*if\b/g);
  const endifCount = countOccurrences(mileyo, /\{%\s*endif\s*%\}/g);
  const forCount = countOccurrences(mileyo, /\{%\s*for\b/g);
  const endforCount = countOccurrences(mileyo, /\{%\s*endfor\s*%\}/g);
  const origIf = countOccurrences(original, /\{%\s*if\b/g);
  const origEndif = countOccurrences(original, /\{%\s*endif\s*%\}/g);
  const origFor = countOccurrences(original, /\{%\s*for\b/g);
  const origEndfor = countOccurrences(original, /\{%\s*endfor\s*%\}/g);

  ctx.assertEqual("if/endif Mileyo cohérents", ifCount, endifCount);
  ctx.assertEqual("for/endfor Mileyo cohérents", forCount, endforCount);
  ctx.assertEqual(
    "if count = original +1 (prénom titre)",
    ifCount,
    origIf + 1,
  );
  ctx.assertEqual(
    "endif count = original +1 (prénom titre)",
    endifCount,
    origEndif + 1,
  );
  ctx.assertEqual("for count ≈ original", forCount, origFor);
  ctx.assertEqual("endfor count ≈ original", endforCount, origEndfor);

  for (const forbidden of FORBIDDEN) {
    ctx.assertFalse(
      `Pas de ${forbidden} dans Mileyo`,
      mileyo.includes(forbidden),
    );
    ctx.assertFalse(
      `Pas de ${forbidden} dans original`,
      original.includes(forbidden),
    );
  }

  for (const label of ENGLISH_LABELS_REMOVED) {
    ctx.assertFalse(
      `Label EN retiré: ${label.slice(0, 40)}`,
      mileyo.includes(label),
    );
  }

  ctx.assertFalse(
    "Logo CDN absent de l’original",
    original.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertFalse(
    "contact@mileyo.fr absent de l’original",
    original.includes("contact@mileyo.fr"),
  );
  ctx.assertFalse(
    "Token cream Mileyo absent de l’original",
    original.includes("#FCF8F6"),
  );

  ctx.scenario("C2. Blocs Liquid critiques (store dump moderne)");
  ctx.assertEqual(
    "Snapshot original verrouillé store_dump_locked",
    orderConfirmation?.originalSnapshotProvenance,
    "store_dump_locked",
  );

  for (const token of ORDER_CONFIRMATION_CRITICAL_LIQUID_TOKENS) {
    ctx.assertTrue(
      `Original contient ${token}`,
      original.includes(token),
    );
    ctx.assertTrue(
      `Mileyo contient ${token}`,
      mileyo.includes(token),
    );
  }

  ctx.assertTrue(
    "Original: logique refund transaction",
    original.includes("transaction.kind == 'refund'") ||
      original.includes('transaction.kind == "refund"'),
  );
  ctx.assertTrue(
    "Mileyo: logique refund transaction",
    mileyo.includes("transaction.kind == 'refund'") ||
      mileyo.includes('transaction.kind == "refund"'),
  );
  ctx.assertTrue(
    "Original: Shop Cash / payment gateway branches",
    original.includes("Shop Cash") || original.includes("shop_cash"),
  );
  ctx.assertTrue(
    "Mileyo: Shop Cash / payment gateway branches",
    mileyo.includes("Shop Cash") || mileyo.includes("shop_cash"),
  );
  ctx.assertTrue(
    "Original: attach_as_pdf policies",
    original.includes("attach_as_pdf"),
  );
  ctx.assertTrue(
    "Mileyo: attach_as_pdf policies",
    mileyo.includes("attach_as_pdf"),
  );

  ctx.scenario("D. Pas de fake provisioning serveur");
  const dataSource = readRepoFile(
    "app/features/shopify-notifications/shopify-notifications-data.server.ts",
  );
  ctx.assertFalse(
    "Loader sans mutation GraphQL notifications",
    dataSource.includes("mutation") || dataSource.includes("admin.graphql"),
  );

  ctx.scenario("E. Shipping Confirmation registry + templates");
  const shippingConfirmation = findShopifyNotificationById(
    "shipping-confirmation",
  );
  ctx.assertEqual(
    "Shipping confirmation status = ready",
    shippingConfirmation?.status,
    "ready",
  );
  ctx.assertEqual(
    "Shipping confirmation owner = shopify",
    shippingConfirmation?.owner,
    "shopify",
  );
  ctx.assertEqual(
    "Shipping subject recommandé",
    shippingConfirmation?.recommendedSubject,
    SHIPPING_CONFIRMATION_RECOMMENDED_SUBJECT,
  );
  ctx.assertEqual(
    "Constante subject shipping exposée",
    SHIPPING_CONFIRMATION_RECOMMENDED_SUBJECT,
    "Votre commande {{ order_name }} est en route",
  );
  ctx.assertEqual(
    "Snapshot shipping store_dump_locked",
    shippingConfirmation?.originalSnapshotProvenance,
    "store_dump_locked",
  );
  ctx.assertEqual(
    "Fichier Mileyo shipping catalogué",
    shippingConfirmation?.mileyoTemplateFile,
    "shipping-confirmation.mileyo.liquid",
  );
  ctx.assertEqual(
    "Fichier original shipping catalogué",
    shippingConfirmation?.originalTemplateFile,
    "shipping-confirmation.shopify-original.liquid",
  );

  const shippingMileyo = readShopifyNotificationLiquid(
    "shipping-confirmation.mileyo.liquid",
  );
  const shippingOriginal = readShopifyNotificationLiquid(
    "shipping-confirmation.shopify-original.liquid",
  );

  ctx.assertTrue(
    "Shipping Mileyo non vide",
    shippingMileyo.trim().length > 500,
  );
  ctx.assertTrue(
    "Shipping original non vide",
    shippingOriginal.trim().length > 500,
  );
  ctx.assertTrue(
    "Shipping logo CDN présent",
    shippingMileyo.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertTrue(
    "Shipping stack sans serif",
    shippingMileyo.includes(SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK) &&
      !shippingMileyo.includes("Georgia") &&
      !shippingMileyo.includes("Times New Roman") &&
      !shippingMileyo.includes("Times, serif"),
  );
  ctx.assertFalse(
    "Shipping sans famille serif volontaire",
    /font-family:\s*[^;]*\bserif\b/i.test(
      shippingMileyo.replace(/sans-serif/gi, ""),
    ),
  );
  ctx.assertTrue("Shipping token cream #FCF8F6", shippingMileyo.includes("#FCF8F6"));
  ctx.assertTrue("Shipping token card #FFFFFF", shippingMileyo.includes("#FFFFFF"));
  ctx.assertTrue("Shipping token text #3A2C45", shippingMileyo.includes("#3A2C45"));
  ctx.assertTrue("Shipping token title #5A1B69", shippingMileyo.includes("#5A1B69"));
  ctx.assertTrue("Shipping token muted #6F5A7D", shippingMileyo.includes("#6F5A7D"));
  ctx.assertTrue("Shipping token border #E8D9F2", shippingMileyo.includes("#E8D9F2"));
  ctx.assertTrue("Shipping radius 16px", shippingMileyo.includes("16px"));
  ctx.assertTrue(
    "Shipping main card unique",
    shippingMileyo.includes("mileyo-main-card") &&
      shippingMileyo.includes("Only .mileyo-main-card is the white surface"),
  );
  ctx.assertTrue(
    "Shipping CTA Suivre ma livraison",
    shippingMileyo.includes("Suivre ma livraison"),
  );
  ctx.assertTrue(
    "Shipping ETA block",
    shippingMileyo.includes("Livraison estimée") &&
      shippingMileyo.includes("mileyo-eta"),
  );
  ctx.assertTrue(
    "Shipping articles section",
    shippingMileyo.includes("Articles dans cet envoi"),
  );
  ctx.assertTrue(
    "Shipping Shop secondaire",
    shippingMileyo.includes("Suivre avec") &&
      shippingMileyo.includes("button__cell--shop-app"),
  );
  ctx.assertTrue(
    "Shipping footer question FR",
    shippingMileyo.includes("Une question") &&
      shippingMileyo.includes("mailto:{{ shop.email }}"),
  );
  ctx.assertTrue(
    "Shipping footer dans continuité main card",
    shippingMileyo.indexOf("mileyo-main-card") <
      shippingMileyo.indexOf('class="row footer"') &&
      shippingMileyo.indexOf('class="row footer"') <
      shippingMileyo.indexOf("shopify-shop-marketplace-footer"),
  );
  ctx.assertFalse(
    "Logo CDN absent original shipping",
    shippingOriginal.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertFalse(
    "Cream Mileyo absent original shipping",
    shippingOriginal.includes("#FCF8F6"),
  );

  for (const token of SHIPPING_CONFIRMATION_CRITICAL_LIQUID_TOKENS) {
    ctx.assertTrue(
      `Shipping original contient ${token}`,
      shippingOriginal.includes(token),
    );
    ctx.assertTrue(
      `Shipping Mileyo contient ${token}`,
      shippingMileyo.includes(token),
    );
  }

  const shipIf = countOccurrences(shippingMileyo, /\{%\s*if\b/g);
  const shipEndif = countOccurrences(shippingMileyo, /\{%\s*endif\s*%\}/g);
  const shipFor = countOccurrences(shippingMileyo, /\{%\s*for\b/g);
  const shipEndfor = countOccurrences(shippingMileyo, /\{%\s*endfor\s*%\}/g);
  ctx.assertEqual("Shipping if/endif cohérents", shipIf, shipEndif);
  ctx.assertEqual("Shipping for/endfor cohérents", shipFor, shipEndfor);

  for (const forbidden of FORBIDDEN) {
    ctx.assertFalse(
      `Shipping Mileyo pas de ${forbidden}`,
      shippingMileyo.includes(forbidden),
    );
    ctx.assertFalse(
      `Shipping original pas de ${forbidden}`,
      shippingOriginal.includes(forbidden),
    );
  }

  ctx.scenario("F. Order Confirmation non régressée");
  const orderStill = findShopifyNotificationById("order-confirmation");
  ctx.assertEqual(
    "Order confirmation toujours ready",
    orderStill?.status,
    "ready",
  );
  ctx.assertEqual(
    "Order subject inchangé",
    orderStill?.recommendedSubject,
    ORDER_CONFIRMATION_RECOMMENDED_SUBJECT,
  );
  const orderMileyoRecheck = readShopifyNotificationLiquid(
    "order-confirmation.mileyo.liquid",
  );
  ctx.assertTrue(
    "Order Mileyo toujours présent et logo OK",
    orderMileyoRecheck.includes(MILEYO_EMAIL_LOGO_URL) &&
      orderMileyoRecheck.includes("mileyo-main-card"),
  );
  ctx.assertTrue(
    "Order critical tokens toujours présents",
    ORDER_CONFIRMATION_CRITICAL_LIQUID_TOKENS.every((token) =>
      orderMileyoRecheck.includes(token),
    ),
  );

  ctx.scenario("G. Shipping Update registry + templates");
  const shippingUpdate = findShopifyNotificationById("shipping-update");
  ctx.assertEqual(
    "Shipping update status = ready",
    shippingUpdate?.status,
    "ready",
  );
  ctx.assertEqual(
    "Shipping update owner = shopify",
    shippingUpdate?.owner,
    "shopify",
  );
  ctx.assertEqual(
    "Shipping update subject recommandé",
    shippingUpdate?.recommendedSubject,
    SHIPPING_UPDATE_RECOMMENDED_SUBJECT,
  );
  ctx.assertEqual(
    "Constante subject shipping update exposée",
    SHIPPING_UPDATE_RECOMMENDED_SUBJECT,
    "Mise à jour de l’expédition de votre commande {{ order_name }}",
  );
  ctx.assertEqual(
    "Snapshot shipping update store_dump_locked",
    shippingUpdate?.originalSnapshotProvenance,
    "store_dump_locked",
  );
  ctx.assertEqual(
    "Fichier Mileyo shipping update catalogué",
    shippingUpdate?.mileyoTemplateFile,
    "shipping-update.mileyo.liquid",
  );
  ctx.assertEqual(
    "Fichier original shipping update catalogué",
    shippingUpdate?.originalTemplateFile,
    "shipping-update.shopify-original.liquid",
  );
  ctx.assertTrue(
    "Checklist shipping update démarre par Copier l’objet",
    SHIPPING_UPDATE_CHECKLIST[0].includes("objet") ||
      SHIPPING_UPDATE_CHECKLIST[0].includes("Objet"),
  );

  const shippingUpdateMileyo = readShopifyNotificationLiquid(
    "shipping-update.mileyo.liquid",
  );
  const shippingUpdateOriginal = readShopifyNotificationLiquid(
    "shipping-update.shopify-original.liquid",
  );

  ctx.assertTrue(
    "Shipping update Mileyo non vide",
    shippingUpdateMileyo.trim().length > 500,
  );
  ctx.assertTrue(
    "Shipping update original non vide",
    shippingUpdateOriginal.trim().length > 500,
  );
  ctx.assertTrue(
    "Shipping update logo CDN présent",
    shippingUpdateMileyo.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertTrue(
    "Shipping update stack sans serif",
    shippingUpdateMileyo.includes(SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK) &&
      !shippingUpdateMileyo.includes("Georgia") &&
      !shippingUpdateMileyo.includes("Times New Roman") &&
      !shippingUpdateMileyo.includes("Times, serif"),
  );
  ctx.assertFalse(
    "Shipping update sans famille serif volontaire",
    /font-family:\s*[^;]*\bserif\b/i.test(
      shippingUpdateMileyo.replace(/sans-serif/gi, ""),
    ),
  );
  ctx.assertTrue(
    "Shipping update token cream #FCF8F6",
    shippingUpdateMileyo.includes("#FCF8F6"),
  );
  ctx.assertTrue(
    "Shipping update token card #FFFFFF",
    shippingUpdateMileyo.includes("#FFFFFF"),
  );
  ctx.assertTrue(
    "Shipping update token text #3A2C45",
    shippingUpdateMileyo.includes("#3A2C45"),
  );
  ctx.assertTrue(
    "Shipping update token title #5A1B69",
    shippingUpdateMileyo.includes("#5A1B69"),
  );
  ctx.assertTrue(
    "Shipping update token muted #6F5A7D",
    shippingUpdateMileyo.includes("#6F5A7D"),
  );
  ctx.assertTrue(
    "Shipping update token border #E8D9F2",
    shippingUpdateMileyo.includes("#E8D9F2"),
  );
  ctx.assertTrue(
    "Shipping update radius 16px",
    shippingUpdateMileyo.includes("16px"),
  );
  ctx.assertTrue(
    "Shipping update main card unique",
    shippingUpdateMileyo.includes("mileyo-main-card") &&
      shippingUpdateMileyo.includes(
        "Only .mileyo-main-card is the white surface",
      ),
  );
  ctx.assertTrue(
    "Shipping update hero title",
    shippingUpdateMileyo.includes(
      "Votre suivi de livraison a été mis à jour",
    ),
  );
  ctx.assertTrue(
    "Shipping update hero body",
    shippingUpdateMileyo.includes(
      "De nouvelles informations sont disponibles pour l’expédition de votre commande",
    ),
  );
  ctx.assertTrue(
    "Shipping update CTA Voir le suivi mis à jour",
    shippingUpdateMileyo.includes("Voir le suivi mis à jour"),
  );
  ctx.assertTrue(
    "Shipping update articles section",
    shippingUpdateMileyo.includes("Articles concernés"),
  );
  ctx.assertTrue(
    "Shipping update tracking label",
    shippingUpdateMileyo.includes("Suivi de livraison"),
  );
  ctx.assertTrue(
    "Shipping update Shop secondaire",
    shippingUpdateMileyo.includes("Suivre avec") &&
      shippingUpdateMileyo.includes("button__cell--shop-app"),
  );
  ctx.assertTrue(
    "Shipping update footer question FR",
    shippingUpdateMileyo.includes("Une question") &&
      shippingUpdateMileyo.includes("mailto:{{ shop.email }}"),
  );
  ctx.assertTrue(
    "Original shipping update conserve email_emphasis",
    shippingUpdateOriginal.includes("<p>{{ email_emphasis }}</p>") &&
      !shippingUpdateOriginal.includes("{% capture email_emphasis"),
  );
  ctx.assertFalse(
    "Mileyo shipping update ne rend pas email_emphasis vide",
    shippingUpdateMileyo.includes("{{ email_emphasis }}"),
  );
  ctx.assertFalse(
    "Logo CDN absent original shipping update",
    shippingUpdateOriginal.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertFalse(
    "Cream Mileyo absent original shipping update",
    shippingUpdateOriginal.includes("#FCF8F6"),
  );

  for (const token of SHIPPING_UPDATE_CRITICAL_LIQUID_TOKENS) {
    ctx.assertTrue(
      `Shipping update original contient ${token}`,
      shippingUpdateOriginal.includes(token),
    );
    ctx.assertTrue(
      `Shipping update Mileyo contient ${token}`,
      shippingUpdateMileyo.includes(token),
    );
  }

  const updIf = countOccurrences(shippingUpdateMileyo, /\{%\s*if\b/g);
  const updEndif = countOccurrences(shippingUpdateMileyo, /\{%\s*endif\s*%\}/g);
  const updFor = countOccurrences(shippingUpdateMileyo, /\{%\s*for\b/g);
  const updEndfor = countOccurrences(shippingUpdateMileyo, /\{%\s*endfor\s*%\}/g);
  ctx.assertEqual("Shipping update if/endif cohérents", updIf, updEndif);
  ctx.assertEqual("Shipping update for/endfor cohérents", updFor, updEndfor);

  for (const forbidden of FORBIDDEN) {
    ctx.assertFalse(
      `Shipping update Mileyo pas de ${forbidden}`,
      shippingUpdateMileyo.includes(forbidden),
    );
    ctx.assertFalse(
      `Shipping update original pas de ${forbidden}`,
      shippingUpdateOriginal.includes(forbidden),
    );
  }

  ctx.scenario("H. Shipping Confirmation non régressée");
  const shippingStill = findShopifyNotificationById("shipping-confirmation");
  ctx.assertEqual(
    "Shipping confirmation toujours ready",
    shippingStill?.status,
    "ready",
  );
  ctx.assertEqual(
    "Shipping confirmation subject inchangé",
    shippingStill?.recommendedSubject,
    SHIPPING_CONFIRMATION_RECOMMENDED_SUBJECT,
  );
  const shippingMileyoRecheck = readShopifyNotificationLiquid(
    "shipping-confirmation.mileyo.liquid",
  );
  ctx.assertTrue(
    "Shipping confirmation Mileyo toujours présent",
    shippingMileyoRecheck.includes(MILEYO_EMAIL_LOGO_URL) &&
      shippingMileyoRecheck.includes("mileyo-main-card") &&
      shippingMileyoRecheck.includes("Suivre ma livraison"),
  );
  ctx.assertTrue(
    "Shipping confirmation critical tokens toujours présents",
    SHIPPING_CONFIRMATION_CRITICAL_LIQUID_TOKENS.every((token) =>
      shippingMileyoRecheck.includes(token),
    ),
  );

  ctx.scenario("I. Out for Delivery registry + templates");
  const outForDelivery = findShopifyNotificationById("out-for-delivery");
  ctx.assertEqual(
    "Out for delivery status = ready",
    outForDelivery?.status,
    "ready",
  );
  ctx.assertEqual(
    "Out for delivery owner = shopify",
    outForDelivery?.owner,
    "shopify",
  );
  ctx.assertEqual(
    "Out for delivery subject recommandé",
    outForDelivery?.recommendedSubject,
    OUT_FOR_DELIVERY_RECOMMENDED_SUBJECT,
  );
  ctx.assertEqual(
    "Constante subject out for delivery exposée",
    OUT_FOR_DELIVERY_RECOMMENDED_SUBJECT,
    "Votre commande {{ order_name }} est en cours de livraison",
  );
  ctx.assertEqual(
    "Snapshot out for delivery store_dump_locked",
    outForDelivery?.originalSnapshotProvenance,
    "store_dump_locked",
  );
  ctx.assertEqual(
    "Fichier Mileyo out for delivery catalogué",
    outForDelivery?.mileyoTemplateFile,
    "out-for-delivery.mileyo.liquid",
  );
  ctx.assertEqual(
    "Fichier original out for delivery catalogué",
    outForDelivery?.originalTemplateFile,
    "out-for-delivery.shopify-original.liquid",
  );
  ctx.assertTrue(
    "Checklist out for delivery démarre par Copier l’objet",
    OUT_FOR_DELIVERY_CHECKLIST[0].includes("objet") ||
      OUT_FOR_DELIVERY_CHECKLIST[0].includes("Objet"),
  );

  const outMileyo = readShopifyNotificationLiquid(
    "out-for-delivery.mileyo.liquid",
  );
  const outOriginal = readShopifyNotificationLiquid(
    "out-for-delivery.shopify-original.liquid",
  );

  ctx.assertTrue("Out for delivery Mileyo non vide", outMileyo.trim().length > 500);
  ctx.assertTrue(
    "Out for delivery original non vide",
    outOriginal.trim().length > 500,
  );
  ctx.assertTrue(
    "Out for delivery logo CDN présent",
    outMileyo.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertTrue(
    "Out for delivery stack sans serif",
    outMileyo.includes(SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK) &&
      !outMileyo.includes("Georgia") &&
      !outMileyo.includes("Times New Roman") &&
      !outMileyo.includes("Times, serif"),
  );
  ctx.assertFalse(
    "Out for delivery sans famille serif volontaire",
    /font-family:\s*[^;]*\bserif\b/i.test(
      outMileyo.replace(/sans-serif/gi, ""),
    ),
  );
  ctx.assertTrue("Out for delivery token cream #FCF8F6", outMileyo.includes("#FCF8F6"));
  ctx.assertTrue("Out for delivery token card #FFFFFF", outMileyo.includes("#FFFFFF"));
  ctx.assertTrue("Out for delivery token text #3A2C45", outMileyo.includes("#3A2C45"));
  ctx.assertTrue("Out for delivery token title #5A1B69", outMileyo.includes("#5A1B69"));
  ctx.assertTrue("Out for delivery token muted #6F5A7D", outMileyo.includes("#6F5A7D"));
  ctx.assertTrue("Out for delivery token border #E8D9F2", outMileyo.includes("#E8D9F2"));
  ctx.assertTrue("Out for delivery radius 16px", outMileyo.includes("16px"));
  ctx.assertTrue(
    "Out for delivery main card unique",
    outMileyo.includes("mileyo-main-card") &&
      outMileyo.includes("Only .mileyo-main-card is the white surface"),
  );
  ctx.assertTrue(
    "Out for delivery branches full/partial",
    outMileyo.includes("fulfillment.item_count") &&
      outMileyo.includes("item_count") &&
      outMileyo.includes("fulfillment_status") &&
      outMileyo.includes("'fulfilled'") &&
      outMileyo.includes("Votre commande est en cours de livraison") &&
      outMileyo.includes(
        "Les derniers articles de votre commande sont en cours de livraison",
      ) &&
      outMileyo.includes(
        "Certains articles de votre commande sont en cours de livraison",
      ) &&
      outMileyo.includes(
        "Le dernier article de votre commande est en cours de livraison",
      ) &&
      outMileyo.includes(
        "Un article de votre commande est en cours de livraison",
      ),
  );
  ctx.assertTrue(
    "Out for delivery ETA block",
    outMileyo.includes("Livraison estimée") &&
      outMileyo.includes("mileyo-eta") &&
      outMileyo.includes("fulfillment.estimated_delivery_at"),
  );
  ctx.assertTrue(
    "Out for delivery CTA Suivre ma livraison",
    outMileyo.includes("Suivre ma livraison") &&
      outMileyo.includes("Suivre ma commande"),
  );
  ctx.assertTrue(
    "Out for delivery articles section",
    outMileyo.includes("Articles dans cet envoi"),
  );
  ctx.assertFalse(
    "Out for delivery sans Shop App liquid",
    outMileyo.includes("shop_app_tracking_url") ||
      outMileyo.includes("shop_app_tracking_button_variant_key") ||
      outMileyo.includes("track_with_shop") ||
      outOriginal.includes("shop_app_tracking_url"),
  );
  ctx.assertTrue(
    "Out for delivery footer question FR",
    outMileyo.includes("Une question") &&
      outMileyo.includes("mailto:{{ shop.email }}"),
  );
  ctx.assertFalse(
    "Logo CDN absent original out for delivery",
    outOriginal.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertFalse(
    "Cream Mileyo absent original out for delivery",
    outOriginal.includes("#FCF8F6"),
  );

  for (const token of OUT_FOR_DELIVERY_CRITICAL_LIQUID_TOKENS) {
    ctx.assertTrue(
      `Out for delivery original contient ${token}`,
      outOriginal.includes(token),
    );
    ctx.assertTrue(
      `Out for delivery Mileyo contient ${token}`,
      outMileyo.includes(token),
    );
  }

  const outIf = countOccurrences(outMileyo, /\{%\s*if\b/g);
  const outEndif = countOccurrences(outMileyo, /\{%\s*endif\s*%\}/g);
  const outFor = countOccurrences(outMileyo, /\{%\s*for\b/g);
  const outEndfor = countOccurrences(outMileyo, /\{%\s*endfor\s*%\}/g);
  ctx.assertEqual("Out for delivery if/endif cohérents", outIf, outEndif);
  ctx.assertEqual("Out for delivery for/endfor cohérents", outFor, outEndfor);

  for (const forbidden of FORBIDDEN) {
    ctx.assertFalse(
      `Out for delivery Mileyo pas de ${forbidden}`,
      outMileyo.includes(forbidden),
    );
    ctx.assertFalse(
      `Out for delivery original pas de ${forbidden}`,
      outOriginal.includes(forbidden),
    );
  }

  ctx.scenario("J. Delivered registry + templates");
  const delivered = findShopifyNotificationById("delivered");
  ctx.assertEqual("Delivered status = ready", delivered?.status, "ready");
  ctx.assertEqual("Delivered owner = shopify", delivered?.owner, "shopify");
  ctx.assertEqual(
    "Delivered subject recommandé",
    delivered?.recommendedSubject,
    DELIVERED_RECOMMENDED_SUBJECT,
  );
  ctx.assertEqual(
    "Constante subject delivered exposée",
    DELIVERED_RECOMMENDED_SUBJECT,
    "Votre commande Mileyo a été livrée",
  );
  ctx.assertEqual(
    "Snapshot delivered store_dump_locked",
    delivered?.originalSnapshotProvenance,
    "store_dump_locked",
  );
  ctx.assertEqual(
    "Fichier Mileyo delivered catalogué",
    delivered?.mileyoTemplateFile,
    "delivered.mileyo.liquid",
  );
  ctx.assertEqual(
    "Fichier original delivered catalogué",
    delivered?.originalTemplateFile,
    "delivered.shopify-original.liquid",
  );
  ctx.assertTrue(
    "Checklist delivered démarre par Copier l’objet",
    DELIVERED_CHECKLIST[0].includes("objet") ||
      DELIVERED_CHECKLIST[0].includes("Objet"),
  );

  const deliveredMileyo = readShopifyNotificationLiquid(
    "delivered.mileyo.liquid",
  );
  const deliveredOriginal = readShopifyNotificationLiquid(
    "delivered.shopify-original.liquid",
  );

  ctx.assertTrue(
    "Delivered Mileyo non vide",
    deliveredMileyo.trim().length > 500,
  );
  ctx.assertTrue(
    "Delivered original non vide",
    deliveredOriginal.trim().length > 500,
  );
  ctx.assertTrue(
    "Delivered logo CDN présent",
    deliveredMileyo.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertTrue(
    "Delivered stack sans serif",
    deliveredMileyo.includes(SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK) &&
      !deliveredMileyo.includes("Georgia") &&
      !deliveredMileyo.includes("Times New Roman") &&
      !deliveredMileyo.includes("Times, serif"),
  );
  ctx.assertFalse(
    "Delivered sans famille serif volontaire",
    /font-family:\s*[^;]*\bserif\b/i.test(
      deliveredMileyo.replace(/sans-serif/gi, ""),
    ),
  );
  ctx.assertTrue("Delivered token cream #FCF8F6", deliveredMileyo.includes("#FCF8F6"));
  ctx.assertTrue("Delivered token card #FFFFFF", deliveredMileyo.includes("#FFFFFF"));
  ctx.assertTrue("Delivered token text #3A2C45", deliveredMileyo.includes("#3A2C45"));
  ctx.assertTrue("Delivered token title #5A1B69", deliveredMileyo.includes("#5A1B69"));
  ctx.assertTrue("Delivered token muted #6F5A7D", deliveredMileyo.includes("#6F5A7D"));
  ctx.assertTrue("Delivered token border #E8D9F2", deliveredMileyo.includes("#E8D9F2"));
  ctx.assertTrue("Delivered radius 16px", deliveredMileyo.includes("16px"));
  ctx.assertTrue(
    "Delivered main card unique",
    deliveredMileyo.includes("mileyo-main-card") &&
      deliveredMileyo.includes("Only .mileyo-main-card is the white surface"),
  );
  ctx.assertTrue(
    "Delivered branches full/partial",
    deliveredMileyo.includes("fulfillment.item_count") &&
      deliveredMileyo.includes("item_count") &&
      deliveredMileyo.includes("fulfillment_status") &&
      deliveredMileyo.includes("'fulfilled'") &&
      deliveredMileyo.includes("Votre commande a été livrée") &&
      deliveredMileyo.includes(
        "Les derniers articles de votre commande ont été livrés",
      ) &&
      deliveredMileyo.includes("Une partie de votre commande a été livrée") &&
      deliveredMileyo.includes(
        "Le dernier article de votre commande a été livré",
      ) &&
      deliveredMileyo.includes("Un article de votre commande a été livré"),
  );
  ctx.assertTrue(
    "Delivered body copy post-livraison",
    deliveredMileyo.includes(
      "Bonne nouvelle, votre commande Mileyo a bien été livrée.",
    ) &&
      deliveredMileyo.includes(
        "Une partie de votre commande vient d’être livrée",
      ),
  );
  ctx.assertTrue(
    "Delivered bloc aide colis",
    deliveredMileyo.includes("mileyo-help") &&
      deliveredMileyo.includes("Vous ne trouvez pas votre colis") &&
      deliveredMileyo.includes("mailto:contact@mileyo.fr") &&
      deliveredMileyo.includes("contact@mileyo.fr"),
  );
  ctx.assertFalse(
    "Delivered Mileyo sans Afficher votre commande",
    deliveredMileyo.includes("Afficher votre commande"),
  );
  ctx.assertFalse(
    "Delivered Mileyo sans Visitez notre boutique",
    deliveredMileyo.includes("Visitez notre boutique") ||
      deliveredMileyo.includes("Visiter la boutique"),
  );
  ctx.assertTrue(
    "Delivered original conserve Afficher votre commande",
    deliveredOriginal.includes("Afficher votre commande"),
  );
  ctx.assertTrue(
    "Delivered original conserve Visitez notre boutique",
    deliveredOriginal.includes("Visitez notre boutique"),
  );
  ctx.assertTrue(
    "Delivered original conserve bloc question Shopify",
    deliveredOriginal.includes("question.png") &&
      deliveredOriginal.includes("Veuillez nous le signaler"),
  );
  ctx.assertFalse(
    "Delivered Mileyo sans question.png Shopify",
    deliveredMileyo.includes("question.png"),
  );
  ctx.assertTrue(
    "Delivered tracking multi conservé",
    deliveredMileyo.includes("fulfillment.tracking_numbers") &&
      deliveredMileyo.includes("fulfillment.tracking_urls") &&
      deliveredMileyo.includes("fulfillment.tracking_url") &&
      deliveredMileyo.includes("mileyo-tracking") &&
      deliveredOriginal.includes("fulfillment.tracking_numbers.size") &&
      deliveredOriginal.includes("fulfillment.tracking_urls[forloop.index0]"),
  );
  ctx.assertTrue(
    "Delivered articles / bundles / nested",
    deliveredMileyo.includes("Articles dans cet envoi") &&
      deliveredMileyo.includes("fulfillment.fulfillment_line_items") &&
      deliveredMileyo.includes("nested_line_child") &&
      deliveredMileyo.includes("nested_line_parent") &&
      deliveredMileyo.includes("bundle_parent") &&
      deliveredMileyo.includes("selling_plan_allocation") &&
      deliveredMileyo.includes("discount_allocations"),
  );
  ctx.assertTrue(
    "Delivered footer contact@mileyo.fr",
    deliveredMileyo.includes("Une question") &&
      deliveredMileyo.includes("mailto:contact@mileyo.fr"),
  );
  ctx.assertFalse(
    "Logo CDN absent original delivered",
    deliveredOriginal.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertFalse(
    "Cream Mileyo absent original delivered",
    deliveredOriginal.includes("#FCF8F6"),
  );
  ctx.assertFalse(
    "Delivered sans Shop App liquid",
    deliveredMileyo.includes("shop_app_tracking_url") ||
      deliveredOriginal.includes("shop_app_tracking_url"),
  );

  for (const token of DELIVERED_CRITICAL_LIQUID_TOKENS) {
    ctx.assertTrue(
      `Delivered original contient ${token}`,
      deliveredOriginal.includes(token),
    );
    ctx.assertTrue(
      `Delivered Mileyo contient ${token}`,
      deliveredMileyo.includes(token),
    );
  }
  ctx.assertTrue(
    "Delivered original conserve order_status_url",
    deliveredOriginal.includes("order_status_url"),
  );

  const delIf = countOccurrences(deliveredMileyo, /\{%\s*if\b/g);
  const delEndif = countOccurrences(deliveredMileyo, /\{%\s*endif\s*%\}/g);
  const delFor = countOccurrences(deliveredMileyo, /\{%\s*for\b/g);
  const delEndfor = countOccurrences(deliveredMileyo, /\{%\s*endfor\s*%\}/g);
  const delUnless = countOccurrences(deliveredMileyo, /\{%\s*unless\b/g);
  const delEndunless = countOccurrences(
    deliveredMileyo,
    /\{%\s*endunless\s*%\}/g,
  );
  ctx.assertEqual("Delivered if/endif cohérents", delIf, delEndif);
  ctx.assertEqual("Delivered for/endfor cohérents", delFor, delEndfor);
  ctx.assertEqual("Delivered unless/endunless cohérents", delUnless, delEndunless);

  for (const forbidden of FORBIDDEN) {
    ctx.assertFalse(
      `Delivered Mileyo pas de ${forbidden}`,
      deliveredMileyo.includes(forbidden),
    );
    ctx.assertFalse(
      `Delivered original pas de ${forbidden}`,
      deliveredOriginal.includes(forbidden),
    );
  }

  ctx.scenario("K. Shipping Update + Out for Delivery + Delivered non régressées");
  const updateStill = findShopifyNotificationById("shipping-update");
  ctx.assertEqual(
    "Shipping update toujours ready",
    updateStill?.status,
    "ready",
  );
  ctx.assertEqual(
    "Shipping update subject inchangé",
    updateStill?.recommendedSubject,
    SHIPPING_UPDATE_RECOMMENDED_SUBJECT,
  );
  const updateMileyoRecheck = readShopifyNotificationLiquid(
    "shipping-update.mileyo.liquid",
  );
  ctx.assertTrue(
    "Shipping update Mileyo toujours présent",
    updateMileyoRecheck.includes(MILEYO_EMAIL_LOGO_URL) &&
      updateMileyoRecheck.includes("mileyo-main-card") &&
      updateMileyoRecheck.includes("Voir le suivi mis à jour"),
  );
  ctx.assertTrue(
    "Shipping update critical tokens toujours présents",
    SHIPPING_UPDATE_CRITICAL_LIQUID_TOKENS.every((token) =>
      updateMileyoRecheck.includes(token),
    ),
  );
  const outStill = findShopifyNotificationById("out-for-delivery");
  ctx.assertEqual(
    "Out for delivery toujours ready",
    outStill?.status,
    "ready",
  );
  ctx.assertEqual(
    "Out for delivery subject inchangé",
    outStill?.recommendedSubject,
    OUT_FOR_DELIVERY_RECOMMENDED_SUBJECT,
  );
  const deliveredStill = findShopifyNotificationById("delivered");
  ctx.assertEqual("Delivered toujours ready", deliveredStill?.status, "ready");
  ctx.assertEqual(
    "Delivered subject inchangé",
    deliveredStill?.recommendedSubject,
    DELIVERED_RECOMMENDED_SUBJECT,
  );

  ctx.scenario("L. Order cancelled registry + templates");
  const orderCancelled = findShopifyNotificationById("order-cancelled");
  ctx.assertEqual(
    "Order cancelled status = ready",
    orderCancelled?.status,
    "ready",
  );
  ctx.assertEqual(
    "Order cancelled owner = shopify",
    orderCancelled?.owner,
    "shopify",
  );
  ctx.assertEqual(
    "Order cancelled subject recommandé",
    orderCancelled?.recommendedSubject,
    ORDER_CANCELLED_RECOMMENDED_SUBJECT,
  );
  ctx.assertEqual(
    "Constante subject order-cancelled exposée",
    ORDER_CANCELLED_RECOMMENDED_SUBJECT,
    "Votre commande Mileyo a été annulée",
  );
  ctx.assertTrue(
    "Subject order-cancelled sans wording financier",
    !ORDER_CANCELLED_RECOMMENDED_SUBJECT.toLowerCase().includes("rembours") &&
      !ORDER_CANCELLED_RECOMMENDED_SUBJECT.toLowerCase().includes("paiement"),
  );
  ctx.assertEqual(
    "Snapshot order-cancelled store_dump_locked",
    orderCancelled?.originalSnapshotProvenance,
    "store_dump_locked",
  );
  ctx.assertEqual(
    "Fichier Mileyo order-cancelled catalogué",
    orderCancelled?.mileyoTemplateFile,
    "order-cancelled.mileyo.liquid",
  );
  ctx.assertEqual(
    "Fichier original order-cancelled catalogué",
    orderCancelled?.originalTemplateFile,
    "order-cancelled.shopify-original.liquid",
  );
  ctx.assertTrue(
    "Checklist order-cancelled démarre par Copier l’objet",
    ORDER_CANCELLED_CHECKLIST[0].includes("objet") ||
      ORDER_CANCELLED_CHECKLIST[0].includes("Objet"),
  );
  ctx.assertEqual(
    "checklistForNotification order-cancelled",
    checklistForNotification("order-cancelled"),
    ORDER_CANCELLED_CHECKLIST,
  );

  const cancelledMileyo = readShopifyNotificationLiquid(
    "order-cancelled.mileyo.liquid",
  );
  const cancelledOriginal = readShopifyNotificationLiquid(
    "order-cancelled.shopify-original.liquid",
  );

  ctx.assertTrue(
    "Order cancelled Mileyo non vide",
    cancelledMileyo.trim().length > 500,
  );
  ctx.assertTrue(
    "Order cancelled original non vide",
    cancelledOriginal.trim().length > 500,
  );
  ctx.assertTrue(
    "Order cancelled logo CDN présent",
    cancelledMileyo.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertTrue(
    "Order cancelled stack sans serif",
    cancelledMileyo.includes(SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK) &&
      !cancelledMileyo.includes("Georgia") &&
      !cancelledMileyo.includes("Times New Roman") &&
      !cancelledMileyo.includes("Times, serif"),
  );
  ctx.assertFalse(
    "Order cancelled sans famille serif volontaire",
    /font-family:\s*[^;]*\bserif\b/i.test(
      cancelledMileyo.replace(/sans-serif/gi, ""),
    ),
  );
  ctx.assertTrue(
    "Order cancelled token cream #FCF8F6",
    cancelledMileyo.includes("#FCF8F6"),
  );
  ctx.assertTrue(
    "Order cancelled token card #FFFFFF",
    cancelledMileyo.includes("#FFFFFF"),
  );
  ctx.assertTrue(
    "Order cancelled token text #3A2C45",
    cancelledMileyo.includes("#3A2C45"),
  );
  ctx.assertTrue(
    "Order cancelled token title #5A1B69",
    cancelledMileyo.includes("#5A1B69"),
  );
  ctx.assertTrue(
    "Order cancelled token muted #6F5A7D",
    cancelledMileyo.includes("#6F5A7D"),
  );
  ctx.assertTrue(
    "Order cancelled token border #E8D9F2",
    cancelledMileyo.includes("#E8D9F2"),
  );
  ctx.assertTrue("Order cancelled radius 16px", cancelledMileyo.includes("16px"));
  ctx.assertTrue(
    "Order cancelled main card unique",
    cancelledMileyo.includes("mileyo-main-card") &&
      cancelledMileyo.includes("Only .mileyo-main-card is the white surface"),
  );
  ctx.assertTrue(
    "Order cancelled titre conservé",
    cancelledMileyo.includes("Votre commande a été annulée"),
  );
  ctx.assertTrue(
    "Order cancelled financial_status branches",
    cancelledMileyo.includes("financial_status == 'voided'") &&
      cancelledMileyo.includes("financial_status == 'refunded'") &&
      cancelledMileyo.includes("financial_status == 'paid'") &&
      cancelledOriginal.includes("financial_status == 'voided'") &&
      cancelledOriginal.includes("financial_status == 'refunded'") &&
      cancelledOriginal.includes("financial_status == 'paid'"),
  );
  ctx.assertTrue(
    "Order cancelled cancel_reason branches",
    cancelledMileyo.includes("cancel_reason") &&
      ["customer", "inventory", "fraud", "declined", "staff", "other"].every(
        (reason) =>
          cancelledMileyo.includes(`{% when '${reason}' %}`) &&
          cancelledOriginal.includes(`{% when '${reason}' %}`),
      ),
  );
  ctx.assertTrue(
    "Order cancelled copy voided customer",
    cancelledMileyo.includes(
      "Votre commande {{ name }} a été annulée à votre demande. Aucun paiement ne sera prélevé.",
    ),
  );
  ctx.assertTrue(
    "Order cancelled copy refunded inventory",
    cancelledMileyo.includes(
      "Nous avons dû annuler votre commande {{ name }} en raison d’un problème de disponibilité. Votre paiement a été remboursé.",
    ),
  );
  ctx.assertTrue(
    "Order cancelled copy paid staff",
    cancelledMileyo.includes(
      "Votre commande {{ name }} a été annulée à la suite d’une erreur de traitement. Le remboursement de votre paiement n’a pas encore été effectué.",
    ),
  );
  ctx.assertTrue(
    "Order cancelled statut paiement visuel",
    cancelledMileyo.includes("mileyo-payment-status") &&
      cancelledMileyo.includes("Statut du paiement") &&
      cancelledMileyo.includes("Paiement annulé") &&
      cancelledMileyo.includes("Paiement remboursé") &&
      cancelledMileyo.includes("Remboursement à venir"),
  );
  ctx.assertFalse(
    "Order cancelled Mileyo sans Afficher votre commande",
    cancelledMileyo.includes("Afficher votre commande"),
  );
  ctx.assertFalse(
    "Order cancelled Mileyo sans Visitez notre boutique",
    cancelledMileyo.includes("Visitez notre boutique") ||
      cancelledMileyo.includes("Visiter la boutique"),
  );
  ctx.assertFalse(
    "Order cancelled Mileyo sans Voir ma commande",
    cancelledMileyo.includes("Voir ma commande"),
  );
  ctx.assertFalse(
    "Order cancelled Mileyo sans CTA abonnement",
    cancelledMileyo.includes("Gérer mon abonnement") ||
      cancelledMileyo.includes("Gérer mon abonnement"),
  );
  ctx.assertTrue(
    "Order cancelled Articles annulés",
    cancelledMileyo.includes("Articles annulés") &&
      !cancelledMileyo.includes("Articles supprimés"),
  );
  ctx.assertTrue(
    "Order cancelled original conserve Articles supprimés",
    cancelledOriginal.includes("Articles supprimés"),
  );
  ctx.assertTrue(
    "Order cancelled logique financière",
    cancelledMileyo.includes("subtotal_line_items") &&
      cancelledMileyo.includes("discount_applications") &&
      cancelledMileyo.includes("shipping_methods") &&
      cancelledMileyo.includes("pickup_methods") &&
      cancelledMileyo.includes("payment_terms") &&
      cancelledMileyo.includes("total_duties") &&
      cancelledMileyo.includes("total_tip") &&
      cancelledMileyo.includes("transactions") &&
      cancelledMileyo.includes("Sous-total"),
  );
  ctx.assertTrue(
    "Order cancelled Tip → Pourboire",
    cancelledMileyo.includes("<span>Pourboire</span>") &&
      !cancelledMileyo.includes("<span>Tip</span>") &&
      cancelledOriginal.includes("<span>Tip</span>"),
  );
  ctx.assertTrue(
    "Order cancelled Rembourser → Remboursement",
    cancelledMileyo.includes("<span>Remboursement</span>") &&
      !cancelledMileyo.includes("<span>Rembourser</span>") &&
      cancelledOriginal.includes("<span>Rembourser</span>"),
  );
  ctx.assertTrue(
    "Order cancelled footer contact@mileyo.fr",
    cancelledMileyo.includes("Une question sur cette annulation") &&
      cancelledMileyo.includes("mailto:contact@mileyo.fr") &&
      cancelledMileyo.includes("contact@mileyo.fr"),
  );
  ctx.assertFalse(
    "Logo CDN absent original order-cancelled",
    cancelledOriginal.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertFalse(
    "Cream Mileyo absent original order-cancelled",
    cancelledOriginal.includes("#FCF8F6"),
  );

  for (const token of ORDER_CANCELLED_CRITICAL_LIQUID_TOKENS) {
    ctx.assertTrue(
      `Order cancelled original contient ${token}`,
      cancelledOriginal.includes(token),
    );
    ctx.assertTrue(
      `Order cancelled Mileyo contient ${token}`,
      cancelledMileyo.includes(token),
    );
  }

  const canIf = countOccurrences(cancelledMileyo, /\{%\s*if\b/g);
  const canEndif = countOccurrences(cancelledMileyo, /\{%\s*endif\s*%\}/g);
  const canFor = countOccurrences(cancelledMileyo, /\{%\s*for\b/g);
  const canEndfor = countOccurrences(cancelledMileyo, /\{%\s*endfor\s*%\}/g);
  const canUnless = countOccurrences(cancelledMileyo, /\{%\s*unless\b/g);
  const canEndunless = countOccurrences(
    cancelledMileyo,
    /\{%\s*endunless\s*%\}/g,
  );
  const canCase = countOccurrences(cancelledMileyo, /\{%\s*case\b/g);
  const canEndcase = countOccurrences(cancelledMileyo, /\{%\s*endcase\s*%\}/g);
  ctx.assertEqual("Order cancelled if/endif cohérents", canIf, canEndif);
  ctx.assertEqual("Order cancelled for/endfor cohérents", canFor, canEndfor);
  ctx.assertEqual(
    "Order cancelled unless/endunless cohérents",
    canUnless,
    canEndunless,
  );
  ctx.assertEqual("Order cancelled case/endcase cohérents", canCase, canEndcase);
  ctx.assertEqual(
    "Order cancelled case count = original",
    canCase,
    countOccurrences(cancelledOriginal, /\{%\s*case\b/g),
  );
  ctx.assertEqual(
    "Order cancelled when count = original",
    countOccurrences(cancelledMileyo, /\{%\s*when\b/g),
    countOccurrences(cancelledOriginal, /\{%\s*when\b/g),
  );

  for (const forbidden of FORBIDDEN) {
    ctx.assertFalse(
      `Order cancelled Mileyo pas de ${forbidden}`,
      cancelledMileyo.includes(forbidden),
    );
    ctx.assertFalse(
      `Order cancelled original pas de ${forbidden}`,
      cancelledOriginal.includes(forbidden),
    );
  }

  ctx.scenario("M. Refund registry + templates");
  const refund = findShopifyNotificationById("refund");
  ctx.assertEqual("Refund status = ready", refund?.status, "ready");
  ctx.assertEqual("Refund owner = shopify", refund?.owner, "shopify");
  ctx.assertEqual(
    "Refund subject recommandé",
    refund?.recommendedSubject,
    REFUND_RECOMMENDED_SUBJECT,
  );
  ctx.assertEqual(
    "Constante subject refund exposée",
    REFUND_RECOMMENDED_SUBJECT,
    "Votre remboursement Mileyo a été effectué",
  );
  ctx.assertEqual(
    "Snapshot refund store_dump_locked",
    refund?.originalSnapshotProvenance,
    "store_dump_locked",
  );
  ctx.assertEqual(
    "Fichier Mileyo refund catalogué",
    refund?.mileyoTemplateFile,
    "refund.mileyo.liquid",
  );
  ctx.assertEqual(
    "Fichier original refund catalogué",
    refund?.originalTemplateFile,
    "refund.shopify-original.liquid",
  );
  ctx.assertTrue(
    "Checklist refund démarre par Copier l’objet",
    REFUND_CHECKLIST[0].includes("objet") ||
      REFUND_CHECKLIST[0].includes("Objet"),
  );
  ctx.assertEqual(
    "checklistForNotification refund",
    checklistForNotification("refund"),
    REFUND_CHECKLIST,
  );

  const refundMileyo = readShopifyNotificationLiquid("refund.mileyo.liquid");
  const refundOriginal = readShopifyNotificationLiquid(
    "refund.shopify-original.liquid",
  );

  ctx.assertTrue("Refund Mileyo non vide", refundMileyo.trim().length > 500);
  ctx.assertTrue(
    "Refund original non vide",
    refundOriginal.trim().length > 500,
  );
  ctx.assertTrue(
    "Refund logo CDN présent",
    refundMileyo.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertTrue(
    "Refund stack sans serif",
    refundMileyo.includes(SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK) &&
      !refundMileyo.includes("Georgia") &&
      !refundMileyo.includes("Times New Roman") &&
      !refundMileyo.includes("Times, serif"),
  );
  ctx.assertFalse(
    "Refund sans famille serif volontaire",
    /font-family:\s*[^;]*\bserif\b/i.test(
      refundMileyo.replace(/sans-serif/gi, ""),
    ),
  );
  ctx.assertTrue("Refund token cream #FCF8F6", refundMileyo.includes("#FCF8F6"));
  ctx.assertTrue(
    "Refund token card #FFFFFF",
    refundMileyo.includes("#FFFFFF"),
  );
  ctx.assertTrue(
    "Refund token text #3A2C45",
    refundMileyo.includes("#3A2C45"),
  );
  ctx.assertTrue(
    "Refund token title #5A1B69",
    refundMileyo.includes("#5A1B69"),
  );
  ctx.assertTrue(
    "Refund token muted #6F5A7D",
    refundMileyo.includes("#6F5A7D"),
  );
  ctx.assertTrue(
    "Refund token border #E8D9F2",
    refundMileyo.includes("#E8D9F2"),
  );
  ctx.assertTrue("Refund radius 16px", refundMileyo.includes("16px"));
  ctx.assertTrue(
    "Refund main card unique",
    refundMileyo.includes("mileyo-main-card") &&
      refundMileyo.includes("Only .mileyo-main-card is the white surface"),
  );

  ctx.assertTrue(
    "Refund 3 branches titre conservées (Mileyo)",
    refundMileyo.includes("refund_line_items.size == item_count") &&
      refundMileyo.includes("refund_line_items.size == 0") &&
      refundMileyo.includes("Votre commande a été remboursée") &&
      refundMileyo.includes("Vous avez reçu un remboursement") &&
      refundMileyo.includes(
        "Certains articles de votre commande ont été remboursés",
      ),
  );
  ctx.assertTrue(
    "Refund 3 branches titre conservées (original)",
    refundOriginal.includes("refund_line_items.size == item_count") &&
      refundOriginal.includes("refund_line_items.size == 0") &&
      refundOriginal.includes("Votre commande a été remboursée") &&
      refundOriginal.includes("Vous avez reçu un remboursement") &&
      refundOriginal.includes(
        "Certains articles de votre commande ont été remboursés",
      ),
  );
  ctx.assertTrue(
    "Refund amount Liquid conservé",
    refundMileyo.includes("{{ amount | money_with_currency }}") &&
      refundOriginal.includes("{{ amount | money_with_currency }}"),
  );
  ctx.assertTrue(
    "Refund délai jusqu’à 10 jours",
    refundMileyo.includes("jusqu’à 10") &&
      refundMileyo.includes("Selon votre banque") &&
      refundOriginal.includes("jusqu’à 10"),
  );
  ctx.assertTrue(
    "Refund bloc montant",
    refundMileyo.includes("mileyo-refund-amount") &&
      refundMileyo.includes("Montant remboursé"),
  );
  ctx.assertTrue(
    "Refund line_items_including_zero_quantity",
    refundMileyo.includes("line_items_including_zero_quantity") &&
      refundOriginal.includes("line_items_including_zero_quantity"),
  );
  ctx.assertTrue(
    "Refund subtotal_line_items",
    refundMileyo.includes("subtotal_line_items") &&
      refundOriginal.includes("subtotal_line_items"),
  );
  ctx.assertTrue(
    "Refund transactions / refunds",
    (refundMileyo.includes("transaction.kind == 'refund'") ||
      refundMileyo.includes('transaction.kind == "refund"')) &&
      (refundOriginal.includes("transaction.kind == 'refund'") ||
        refundOriginal.includes('transaction.kind == "refund"')),
  );
  ctx.assertTrue(
    "Refund store credit conservé",
    refundMileyo.includes("shopify_store_credit") &&
      refundMileyo.includes("routes.account_profile_url") &&
      refundMileyo.includes("{% capture link_text %}Afficher{% endcapture %}") &&
      refundOriginal.includes("shopify_store_credit"),
  );
  ctx.assertTrue(
    "Refund payment terms conservés",
    refundMileyo.includes("payment_terms") &&
      refundOriginal.includes("payment_terms"),
  );
  ctx.assertTrue(
    "Refund recap commande",
    refundMileyo.includes("Récapitulatif de votre commande") &&
      refundOriginal.includes("Résumé de la commande"),
  );
  ctx.assertTrue(
    "Refund Tip → Pourboire",
    refundMileyo.includes("<span>Pourboire</span>") &&
      !refundMileyo.includes("<span>Tip</span>") &&
      refundOriginal.includes("<span>Tip</span>"),
  );
  ctx.assertTrue(
    "Refund Rembourser → Remboursement",
    refundMileyo.includes("<span>Remboursement</span>") &&
      !refundMileyo.includes("<span>Rembourser</span>") &&
      refundOriginal.includes("<span>Rembourser</span>"),
  );
  ctx.assertFalse(
    "Refund Mileyo sans Afficher votre commande",
    refundMileyo.includes("Afficher votre commande"),
  );
  ctx.assertFalse(
    "Refund Mileyo sans Visitez notre boutique",
    refundMileyo.includes("Visitez notre boutique") ||
      refundMileyo.includes("Visiter la boutique"),
  );
  ctx.assertFalse(
    "Refund Mileyo sans Voir ma commande",
    refundMileyo.includes("Voir ma commande"),
  );
  ctx.assertFalse(
    "Refund Mileyo sans CTA abonnement",
    refundMileyo.includes("Gérer mon abonnement"),
  );
  ctx.assertTrue(
    "Refund footer contact@mileyo.fr",
    refundMileyo.includes("Une question concernant votre remboursement") &&
      refundMileyo.includes("mailto:contact@mileyo.fr") &&
      refundMileyo.includes("contact@mileyo.fr"),
  );
  ctx.assertFalse(
    "Logo CDN absent original refund",
    refundOriginal.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertFalse(
    "Cream Mileyo absent original refund",
    refundOriginal.includes("#FCF8F6"),
  );

  for (const token of REFUND_CRITICAL_LIQUID_TOKENS) {
    ctx.assertTrue(
      `Refund original contient ${token}`,
      refundOriginal.includes(token),
    );
    ctx.assertTrue(
      `Refund Mileyo contient ${token}`,
      refundMileyo.includes(token),
    );
  }

  const refIf = countOccurrences(refundMileyo, /\{%\s*if\b/g);
  const refEndif = countOccurrences(refundMileyo, /\{%\s*endif\s*%\}/g);
  const refFor = countOccurrences(refundMileyo, /\{%\s*for\b/g);
  const refEndfor = countOccurrences(refundMileyo, /\{%\s*endfor\s*%\}/g);
  const refUnless = countOccurrences(refundMileyo, /\{%\s*unless\b/g);
  const refEndunless = countOccurrences(
    refundMileyo,
    /\{%\s*endunless\s*%\}/g,
  );
  const refElsif = countOccurrences(refundMileyo, /\{%\s*elsif\b/g);
  ctx.assertEqual("Refund if/endif cohérents", refIf, refEndif);
  ctx.assertEqual("Refund for/endfor cohérents", refFor, refEndfor);
  ctx.assertEqual(
    "Refund unless/endunless cohérents",
    refUnless,
    refEndunless,
  );
  ctx.assertTrue("Refund elsif présent", refElsif >= 1);
  ctx.assertEqual(
    "Refund if count ≈ original",
    refIf,
    countOccurrences(refundOriginal, /\{%\s*if\b/g),
  );
  ctx.assertEqual(
    "Refund for count = original",
    refFor,
    countOccurrences(refundOriginal, /\{%\s*for\b/g),
  );
  ctx.assertEqual(
    "Refund elsif count = original",
    refElsif,
    countOccurrences(refundOriginal, /\{%\s*elsif\b/g),
  );

  for (const forbidden of FORBIDDEN) {
    ctx.assertFalse(
      `Refund Mileyo pas de ${forbidden}`,
      refundMileyo.includes(forbidden),
    );
    ctx.assertFalse(
      `Refund original pas de ${forbidden}`,
      refundOriginal.includes(forbidden),
    );
  }

  const orderCancelledStill = findShopifyNotificationById("order-cancelled");
  ctx.assertEqual(
    "Order cancelled toujours ready",
    orderCancelledStill?.status,
    "ready",
  );

  ctx.scenario("N. Payment method update registry + templates");
  const paymentMethodUpdate = findShopifyNotificationById(
    "payment-method-update",
  );
  ctx.assertEqual(
    "Payment method update status = ready (scenario N)",
    paymentMethodUpdate?.status,
    "ready",
  );
  ctx.assertEqual(
    "Payment method update owner = shopify_and_mileyo (scenario N)",
    paymentMethodUpdate?.owner,
    "shopify_and_mileyo",
  );
  ctx.assertEqual(
    "Payment method update subject recommandé",
    paymentMethodUpdate?.recommendedSubject,
    PAYMENT_METHOD_UPDATE_RECOMMENDED_SUBJECT,
  );
  ctx.assertEqual(
    "Constante subject payment method update exposée",
    PAYMENT_METHOD_UPDATE_RECOMMENDED_SUBJECT,
    "Mettez à jour votre moyen de paiement Mileyo",
  );
  ctx.assertTrue(
    "Subject payment method update ≠ Paiement échoué",
    !PAYMENT_METHOD_UPDATE_RECOMMENDED_SUBJECT.toLowerCase().includes(
      "échoué",
    ) &&
      !PAYMENT_METHOD_UPDATE_RECOMMENDED_SUBJECT.toLowerCase().includes(
        "echoue",
      ),
  );
  ctx.assertEqual(
    "Snapshot payment method update store_dump_locked",
    paymentMethodUpdate?.originalSnapshotProvenance,
    "store_dump_locked",
  );
  ctx.assertEqual(
    "Fichier Mileyo payment method update catalogué",
    paymentMethodUpdate?.mileyoTemplateFile,
    "payment-method-update.mileyo.liquid",
  );
  ctx.assertEqual(
    "Fichier original payment method update catalogué",
    paymentMethodUpdate?.originalTemplateFile,
    "payment-method-update.shopify-original.liquid",
  );
  ctx.assertTrue(
    "Checklist payment method update démarre par Copier l’objet",
    PAYMENT_METHOD_UPDATE_CHECKLIST[0].includes("objet") ||
      PAYMENT_METHOD_UPDATE_CHECKLIST[0].includes("Objet"),
  );
  ctx.assertEqual(
    "checklistForNotification payment-method-update",
    checklistForNotification("payment-method-update"),
    PAYMENT_METHOD_UPDATE_CHECKLIST,
  );

  const paymentMileyo = readShopifyNotificationLiquid(
    "payment-method-update.mileyo.liquid",
  );
  const paymentOriginal = readShopifyNotificationLiquid(
    "payment-method-update.shopify-original.liquid",
  );

  ctx.assertTrue(
    "Payment method update Mileyo non vide",
    paymentMileyo.trim().length > 200,
  );
  ctx.assertTrue(
    "Payment method update original non vide",
    paymentOriginal.trim().length > 200,
  );
  ctx.assertTrue(
    "Payment method update logo CDN présent",
    paymentMileyo.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertTrue(
    "Payment method update stack sans serif",
    paymentMileyo.includes(SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK) &&
      !paymentMileyo.includes("Georgia") &&
      !paymentMileyo.includes("Times New Roman") &&
      !paymentMileyo.includes("Times, serif"),
  );
  ctx.assertFalse(
    "Payment method update sans famille serif volontaire",
    /font-family:\s*[^;]*\bserif\b/i.test(
      paymentMileyo.replace(/sans-serif/gi, ""),
    ),
  );
  ctx.assertTrue(
    "Payment method update token cream #FCF8F6",
    paymentMileyo.includes("#FCF8F6"),
  );
  ctx.assertTrue(
    "Payment method update token card #FFFFFF",
    paymentMileyo.includes("#FFFFFF"),
  );
  ctx.assertTrue(
    "Payment method update token text #3A2C45",
    paymentMileyo.includes("#3A2C45"),
  );
  ctx.assertTrue(
    "Payment method update token title #5A1B69",
    paymentMileyo.includes("#5A1B69"),
  );
  ctx.assertTrue(
    "Payment method update token muted #6F5A7D",
    paymentMileyo.includes("#6F5A7D"),
  );
  ctx.assertTrue(
    "Payment method update token border #E8D9F2",
    paymentMileyo.includes("#E8D9F2"),
  );
  ctx.assertTrue(
    "Payment method update radius 16px",
    paymentMileyo.includes("16px"),
  );
  ctx.assertTrue(
    "Payment method update main card unique",
    paymentMileyo.includes("mileyo-main-card") &&
      paymentMileyo.includes("Only .mileyo-main-card is the white surface"),
  );

  ctx.assertTrue(
    "Payment method update titre Mileyo",
    paymentMileyo.includes("Mettez à jour votre moyen de paiement"),
  );
  ctx.assertTrue(
    "Payment method update greeting display_name",
    paymentMileyo.includes("display_name") &&
      paymentOriginal.includes("display_name"),
  );
  ctx.assertTrue(
    "Payment method update body Mileyo",
    paymentMileyo.includes(
      "Pour continuer à utiliser votre moyen de paiement avec Mileyo",
    ),
  );
  ctx.assertTrue(
    "Payment method update CTA label",
    paymentMileyo.includes("Mettre à jour mon moyen de paiement"),
  );
  ctx.assertTrue(
    "Payment method update email_confirmation_url CTA href",
    /href="\{\{\s*email_confirmation_url\s*\}\}"/.test(paymentMileyo) &&
      /href="\{\{\s*email_confirmation_url\s*\}\}"/.test(paymentOriginal),
  );
  ctx.assertEqual(
    "Payment method update email_confirmation_url count Mileyo = 1",
    countOccurrences(paymentMileyo, /email_confirmation_url/g),
    1,
  );
  ctx.assertEqual(
    "Payment method update email_confirmation_url count original = 1",
    countOccurrences(paymentOriginal, /email_confirmation_url/g),
    1,
  );
  ctx.assertFalse(
    "Payment method update Mileyo sans order_status_url",
    paymentMileyo.includes("order_status_url"),
  );
  ctx.assertFalse(
    "Payment method update Mileyo sans shop.url CTA",
    /href="\{\{\s*shop\.url\s*\}\}"/.test(paymentMileyo) ||
      paymentMileyo.includes("Visitez notre boutique") ||
      paymentMileyo.includes("Visiter la boutique"),
  );
  ctx.assertFalse(
    "Payment method update Mileyo sans Afficher votre commande",
    paymentMileyo.includes("Afficher votre commande") ||
      paymentMileyo.includes("Voir ma commande"),
  );
  ctx.assertFalse(
    "Payment method update Mileyo sans CTA abonnement",
    paymentMileyo.includes("Gérer mon abonnement"),
  );
  ctx.assertTrue(
    "Payment method update footer contact@mileyo.fr",
    paymentMileyo.includes("Une question") &&
      paymentMileyo.includes("mailto:contact@mileyo.fr") &&
      paymentMileyo.includes("contact@mileyo.fr"),
  );
  ctx.assertTrue(
    "Payment method update marqueur marketplace footer",
    paymentMileyo.includes("shopify-shop-marketplace-footer") &&
      paymentOriginal.includes("shopify-shop-marketplace-footer"),
  );
  ctx.assertFalse(
    "Logo CDN absent original payment method update",
    paymentOriginal.includes(MILEYO_EMAIL_LOGO_URL),
  );
  ctx.assertFalse(
    "Cream Mileyo absent original payment method update",
    paymentOriginal.includes("#FCF8F6"),
  );
  ctx.assertTrue(
    "Original payment method update conserve shop.name",
    paymentOriginal.includes("shop.name"),
  );
  ctx.assertTrue(
    "Mileyo payment method update conserve shop.name (alt logo)",
    paymentMileyo.includes("shop.name"),
  );

  for (const token of PAYMENT_METHOD_UPDATE_CRITICAL_LIQUID_TOKENS) {
    ctx.assertTrue(
      `Payment method update original contient ${token}`,
      paymentOriginal.includes(token),
    );
    ctx.assertTrue(
      `Payment method update Mileyo contient ${token}`,
      paymentMileyo.includes(token),
    );
  }

  const pmIf = countOccurrences(paymentMileyo, /\{%\s*if\b/g);
  const pmEndif = countOccurrences(paymentMileyo, /\{%\s*endif\s*%\}/g);
  const pmFor = countOccurrences(paymentMileyo, /\{%\s*for\b/g);
  const pmEndfor = countOccurrences(paymentMileyo, /\{%\s*endfor\s*%\}/g);
  ctx.assertEqual(
    "Payment method update if/endif cohérents",
    pmIf,
    pmEndif,
  );
  ctx.assertEqual(
    "Payment method update for/endfor cohérents",
    pmFor,
    pmEndfor,
  );

  for (const forbidden of FORBIDDEN) {
    ctx.assertFalse(
      `Payment method update Mileyo pas de ${forbidden}`,
      paymentMileyo.includes(forbidden),
    );
    ctx.assertFalse(
      `Payment method update original pas de ${forbidden}`,
      paymentOriginal.includes(forbidden),
    );
  }

  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  ctx.assertTrue(
    "Flag ENABLE_SHOPIFY_PAYMENT_UPDATE_EMAIL inchangé dans recovery",
    recoverySource.includes("ENABLE_SHOPIFY_PAYMENT_UPDATE_EMAIL"),
  );
  ctx.assertTrue(
    "Mutation customerPaymentMethodSendUpdateEmail inchangée",
    recoverySource.includes("customerPaymentMethodSendUpdateEmail"),
  );

  const refundStill = findShopifyNotificationById("refund");
  ctx.assertEqual("Refund toujours ready", refundStill?.status, "ready");

  const exitCode = finishSuite("75-shopify-notification-templates", ctx);
  process.exit(exitCode);
};

runSuite().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
