/**
 * Business regression — CheckoutLead conversion on first Mileyo order (13J).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  convertCheckoutLead,
  shouldConvertCheckoutLead,
  type CheckoutLeadConversionWriter,
} from "../../app/services/checkoutLeadConversion.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

type MemoryLead = {
  convertedAt: Date | null;
  email: string;
  shop: string;
};

type OrdersCreateDecision =
  | "attach_existing"
  | "create_first_subscription"
  | "not_subscription"
  | "orphan_renewal";

const SHOP = "mileyo-dev.myshopify.com";
const OTHER_SHOP = "other-shop.myshopify.com";
const EMAIL = "client@example.com";
const FIRST_CONVERTED_AT = new Date("2026-08-18T08:00:00.000Z");
const REPLAY_CONVERTED_AT = new Date("2026-08-18T09:00:00.000Z");

const createMemoryWriter = (
  leads: MemoryLead[],
): CheckoutLeadConversionWriter => ({
  markConvertedIfUnconverted: async ({ convertedAt, email, shop }) => {
    const matches = leads.filter(
      (lead) =>
        lead.convertedAt === null &&
        lead.email === email &&
        lead.shop === shop,
    );

    for (const lead of matches) {
      lead.convertedAt = convertedAt;
    }

    return { updatedCount: matches.length };
  },
});

const applyOrdersCreateConversion = async ({
  convertedAt = FIRST_CONVERTED_AT,
  decision,
  email,
  isFirstOrderReplay,
  isResumeRenewal = false,
  leads,
  shop = SHOP,
}: {
  convertedAt?: Date;
  decision: OrdersCreateDecision;
  email: unknown;
  isFirstOrderReplay: boolean;
  isResumeRenewal?: boolean;
  leads: MemoryLead[];
  shop?: string;
}) => {
  if (
    !shouldConvertCheckoutLead({
      isCreateFirstSubscription: decision === "create_first_subscription",
      isFirstOrderReplay,
      isResumeRenewal,
    })
  ) {
    return;
  }

  await convertCheckoutLead({
    convertedAt,
    email,
    shop,
    writer: createMemoryWriter(leads),
  });
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("24-checkout-lead-conversion");
  const conversionSource = readRepoFile(
    "app/services/checkoutLeadConversion.server.ts",
  );
  const orchestratorSource = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  const captureSource = readRepoFile(
    "app/features/builder/builder-lead.server.ts",
  );
  const schemaSource = readRepoFile("prisma/schema.prisma");

  ctx.scenario("Première commande Mileyo — convertedAt renseigné");
  ctx.given("un CheckoutLead existant et une first order abonnement");
  const firstOrderLeads: MemoryLead[] = [
    { convertedAt: null, email: EMAIL, shop: SHOP },
  ];
  ctx.when("orders/create décide create_first_subscription");
  await applyOrdersCreateConversion({
    decision: "create_first_subscription",
    email: EMAIL,
    isFirstOrderReplay: false,
    leads: firstOrderLeads,
  });
  ctx.then("le lead est converti une seule fois");
  ctx.assertEqual(
    "first order Mileyo fills convertedAt",
    firstOrderLeads[0]?.convertedAt?.toISOString() ?? null,
    FIRST_CONVERTED_AT.toISOString(),
  );
  ctx.assertEqual(
    "first order does not create a second lead",
    firstOrderLeads.length,
    1,
  );

  ctx.scenario("Webhook rejoué — convertedAt inchangé");
  ctx.given("une first order déjà convertie, rejouée via shopifyOrderId");
  const replayLeads: MemoryLead[] = [
    { convertedAt: FIRST_CONVERTED_AT, email: EMAIL, shop: SHOP },
  ];
  ctx.when("le replay first order rappelle la conversion");
  await applyOrdersCreateConversion({
    convertedAt: REPLAY_CONVERTED_AT,
    decision: "attach_existing",
    email: EMAIL,
    isFirstOrderReplay: true,
    leads: replayLeads,
  });
  ctx.then("convertedAt n'est pas écrasé");
  ctx.assertEqual(
    "replay keeps original convertedAt",
    replayLeads[0]?.convertedAt?.toISOString() ?? null,
    FIRST_CONVERTED_AT.toISOString(),
  );

  ctx.scenario("Renouvellement — convertedAt reste null");
  ctx.given("un lead non converti et un renouvellement attach_existing");
  const renewalLeads: MemoryLead[] = [
    { convertedAt: null, email: EMAIL, shop: SHOP },
  ];
  ctx.when("orders/create attache une sélection existante d'un autre order");
  await applyOrdersCreateConversion({
    decision: "attach_existing",
    email: EMAIL,
    isFirstOrderReplay: false,
    leads: renewalLeads,
  });
  ctx.then("aucune conversion");
  ctx.assertNull(
    "renewal leaves convertedAt null",
    renewalLeads[0]?.convertedAt ?? null,
  );

  ctx.scenario("Commande non Mileyo — convertedAt reste null");
  ctx.given("un lead non converti et une commande hors abonnement builder");
  const nonMileyoLeads: MemoryLead[] = [
    { convertedAt: null, email: EMAIL, shop: SHOP },
  ];
  ctx.when("la décision est not_subscription");
  await applyOrdersCreateConversion({
    decision: "not_subscription",
    email: EMAIL,
    isFirstOrderReplay: false,
    leads: nonMileyoLeads,
  });
  ctx.then("aucune conversion");
  ctx.assertNull(
    "non-Mileyo order leaves convertedAt null",
    nonMileyoLeads[0]?.convertedAt ?? null,
  );

  ctx.scenario("Email absent — aucune conversion");
  ctx.given("une first order Mileyo sans email Shopify");
  const missingEmailLeads: MemoryLead[] = [
    { convertedAt: null, email: EMAIL, shop: SHOP },
  ];
  ctx.when("order.email, contact_email et customer.email sont vides");
  await applyOrdersCreateConversion({
    decision: "create_first_subscription",
    email: null,
    isFirstOrderReplay: false,
    leads: missingEmailLeads,
  });
  ctx.then("le lead n'est pas converti");
  ctx.assertNull(
    "missing email does not convert",
    missingEmailLeads[0]?.convertedAt ?? null,
  );

  ctx.scenario("Orphan renewal et resume — jamais convertis");
  const orphanLeads: MemoryLead[] = [
    { convertedAt: null, email: EMAIL, shop: SHOP },
  ];
  await applyOrdersCreateConversion({
    decision: "orphan_renewal",
    email: EMAIL,
    isFirstOrderReplay: false,
    leads: orphanLeads,
  });
  ctx.assertNull(
    "orphan renewal leaves convertedAt null",
    orphanLeads[0]?.convertedAt ?? null,
  );

  const resumeLeads: MemoryLead[] = [
    { convertedAt: null, email: EMAIL, shop: SHOP },
  ];
  await applyOrdersCreateConversion({
    decision: "attach_existing",
    email: EMAIL,
    isFirstOrderReplay: true,
    isResumeRenewal: true,
    leads: resumeLeads,
  });
  ctx.assertNull(
    "resume renewal never converts even on order-id match",
    resumeLeads[0]?.convertedAt ?? null,
  );

  ctx.scenario("Lookup scoped shop + email normalisé, sans création");
  const scopedLeads: MemoryLead[] = [
    { convertedAt: null, email: EMAIL, shop: SHOP },
  ];
  await convertCheckoutLead({
    convertedAt: FIRST_CONVERTED_AT,
    email: EMAIL,
    shop: OTHER_SHOP,
    writer: createMemoryWriter(scopedLeads),
  });
  ctx.assertNull(
    "other shop does not convert",
    scopedLeads[0]?.convertedAt ?? null,
  );

  await convertCheckoutLead({
    convertedAt: FIRST_CONVERTED_AT,
    email: "  client@example.com  ",
    shop: SHOP,
    writer: createMemoryWriter(scopedLeads),
  });
  ctx.assertEqual(
    "trimmed email matches stored lead",
    scopedLeads[0]?.convertedAt?.toISOString() ?? null,
    FIRST_CONVERTED_AT.toISOString(),
  );

  const emptyLeads: MemoryLead[] = [];
  const missingLeadResult = await convertCheckoutLead({
    convertedAt: FIRST_CONVERTED_AT,
    email: EMAIL,
    shop: SHOP,
    writer: createMemoryWriter(emptyLeads),
  });
  ctx.assertEqual(
    "missing lead is a no-op",
    missingLeadResult.converted,
    false,
  );
  ctx.assertEqual(
    "conversion never creates a CheckoutLead",
    emptyLeads.length,
    0,
  );

  ctx.scenario("Décision métier — first order et replay only");
  ctx.assertTrue(
    "create_first_subscription converts",
    shouldConvertCheckoutLead({
      isCreateFirstSubscription: true,
      isFirstOrderReplay: false,
      isResumeRenewal: false,
    }),
  );
  ctx.assertTrue(
    "first-order replay converts",
    shouldConvertCheckoutLead({
      isCreateFirstSubscription: false,
      isFirstOrderReplay: true,
      isResumeRenewal: false,
    }),
  );
  ctx.assertFalse(
    "attach_existing renewal does not convert",
    shouldConvertCheckoutLead({
      isCreateFirstSubscription: false,
      isFirstOrderReplay: false,
      isResumeRenewal: false,
    }),
  );
  ctx.assertFalse(
    "resume renewal does not convert",
    shouldConvertCheckoutLead({
      isCreateFirstSubscription: false,
      isFirstOrderReplay: true,
      isResumeRenewal: true,
    }),
  );

  ctx.scenario("Câblage webhook + capture 13H inchangée");
  ctx.assertTrue(
    "orchestrator imports conversion helper",
    orchestratorSource.includes("convertCheckoutLead") &&
      orchestratorSource.includes("shouldConvertCheckoutLead"),
  );
  ctx.assertTrue(
    "conversion uses create_first_subscription decision",
    /shouldConvertCheckoutLead\(\{[\s\S]*isCreateFirstSubscription:\s*decision === "create_first_subscription"/.test(
      orchestratorSource,
    ),
  );
  ctx.assertTrue(
    "replay uses selection shopifyOrderId match",
    orchestratorSource.includes("shopifyIdsMatch") &&
      /shopifyIdsMatch\(\s*matchedSelection\.shopifyOrderId,\s*shopifyOrderId/.test(
        orchestratorSource,
      ),
  );
  ctx.assertTrue(
    "resume renewal is excluded",
    orchestratorSource.includes("isResumeRenewalOrder(matchedSelection)"),
  );
  ctx.assertTrue(
    "email source is Shopify order fields",
    /order\.email \?\? order\.contact_email \?\? order\.customer\?\.email/.test(
      orchestratorSource,
    ),
  );
  ctx.assertTrue(
    "conversion runs after boxOrder upsert",
    orchestratorSource.indexOf("await db.boxOrder.upsert") <
      orchestratorSource.indexOf("await convertCheckoutLead"),
  );
  ctx.assertTrue(
    "helper updates only unconverted leads",
    /updateMany\(\{[\s\S]*convertedAt: null[\s\S]*email[\s\S]*shop/.test(
      conversionSource,
    ),
  );
  ctx.assertFalse(
    "helper never creates a CheckoutLead",
    conversionSource.includes("checkoutLead.create") ||
      conversionSource.includes("checkoutLead.upsert"),
  );
  ctx.assertTrue(
    "13H capture still does not write convertedAt",
    !captureSource.includes("convertedAt:"),
  );
  ctx.assertTrue(
    "CheckoutLead unique key unchanged",
    schemaSource.includes("@@unique([shop, email])"),
  );

  return finishSuite("24-checkout-lead-conversion", ctx);
};

process.exitCode = await runSuite();
