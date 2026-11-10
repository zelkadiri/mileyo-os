/**
 * Complimentary delivery — source wiring + safety invariants.
 * No live Shopify, no PROD, no payments.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COMPLIMENTARY_BOX_FINANCIAL_STATUS,
  COMPLIMENTARY_DELIVERY_STATUS,
  buildComplimentaryShopifyOrderId,
  isComplimentaryShopifyOrderId,
} from "../../app/constants/complimentaryDelivery";
import { isSubscriptionBillingIncidentHeld } from "../../app/constants/subscriptionBillingIncidentHold";
import { isDeliveryCutoffPassed } from "../../app/utils/deliveryDate";
import { createBusinessTestContext, finishSuite } from "./_framework";

const root = join(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const run = async () => {
  const ctx = createBusinessTestContext("119-complimentary-delivery");

  ctx.scenario("T_cutoff Monday for Thursday 12 Nov");
  {
    const delivery = "2026-11-12" as const;
    ctx.assertFalse(
      "avant 23h59 Paris lundi → ouvert",
      isDeliveryCutoffPassed(delivery, new Date("2026-11-09T22:59:00+01:00")),
    );
    ctx.assertFalse(
      "à 23h59 Paris lundi → encore ouvert",
      isDeliveryCutoffPassed(delivery, new Date("2026-11-09T23:59:00+01:00")),
    );
    ctx.assertTrue(
      "mardi 00h00 Paris → fermé",
      isDeliveryCutoffPassed(delivery, new Date("2026-11-10T00:00:00+01:00")),
    );
  }

  ctx.scenario("T_ids complimentary never look like Shopify GIDs");
  {
    const id = buildComplimentaryShopifyOrderId("op-hossam-20261112");
    ctx.assertTrue("prefix", isComplimentaryShopifyOrderId(id));
    ctx.assertFalse("not gid", id.startsWith("gid://"));
    ctx.assertEqual(
      "financial status honest",
      COMPLIMENTARY_BOX_FINANCIAL_STATUS,
      "complimentary",
    );
    ctx.assertEqual(
      "scheduled status",
      COMPLIMENTARY_DELIVERY_STATUS.SCHEDULED,
      "scheduled",
    );
  }

  ctx.scenario("T_wiring service + cron + schema + migration");
  {
    const service = read("app/services/complimentaryDelivery.server.ts");
    const cron = read("app/services/processSubscriptionsCron.server.ts");
    const schema = read("prisma/schema.prisma");
    const migration = read(
      "prisma/migrations/20261108193000_add_complimentary_delivery/migration.sql",
    );
    const constants = read("app/constants/complimentaryDelivery.ts");

    ctx.assertTrue(
      "no billing attempt in complimentary service",
      !service.includes("triggerSubscriptionBillingAttempt(") &&
        !service.includes("createBillingAttempt(") &&
        !service.includes("claimOrLoadBillingCycle("),
    );
    ctx.assertTrue(
      "never writes nextBillingDate",
      !service.includes('nextBillingDate:'),
    );
    ctx.assertTrue(
      "uses complimentary financial status",
      service.includes("COMPLIMENTARY_BOX_FINANCIAL_STATUS") &&
        constants.includes('complimentary"'),
    );
    ctx.assertTrue(
      "simulated false kitchen path",
      service.includes("simulated: false"),
    );
    ctx.assertTrue(
      "cron wires complimentary runner fail-open",
      cron.includes("processDueComplimentaryDeliveries") &&
        cron.includes("complimentaryDeliveries"),
    );
    ctx.assertTrue(
      "schema model present",
      schema.includes("model ComplimentaryDelivery"),
    );
    ctx.assertTrue(
      "migration creates table",
      migration.includes('CREATE TABLE "ComplimentaryDelivery"'),
    );
    ctx.assertTrue(
      "unique per selection+delivery",
      migration.includes(
        "ComplimentaryDelivery_subscriptionMealSelectionId_scheduledDeliveryDate_key",
      ),
    );
  }

  ctx.scenario("T_portal shows offerte without mutating NBD path");
  {
    const portalData = read("app/features/portal/portal-data.server.ts");
    const portalRender = read("app/features/portal/portal-render.ts");
    ctx.assertTrue(
      "portal loads complimentary rows",
      portalData.includes("listOpenComplimentaryDeliveriesForSelection"),
    );
    ctx.assertTrue(
      "portal notice 0€",
      portalRender.includes("Box offerte") &&
        portalRender.includes("aucun prélèvement"),
    );
  }

  ctx.scenario("T_HOLD list cleared for Hossam");
  {
    const hold = read("app/constants/subscriptionBillingIncidentHold.ts");
    ctx.assertTrue(
      "hold helper export preserved",
      hold.includes("isSubscriptionBillingIncidentHeld") &&
        hold.includes("SUBSCRIPTION_BILLING_INCIDENT_HOLD_CONTRACT_IDS"),
    );
    ctx.assertTrue(
      "Hossam removed from HOLD list",
      !hold.includes('"26652508488"') && !hold.includes("'26652508488'"),
    );
    ctx.assertFalse(
      "runtime hold cleared",
      isSubscriptionBillingIncidentHeld("26652508488"),
    );
  }

  ctx.scenario("T_runner retry after failure + kitchen CSV visibility");
  {
    const service = read("app/services/complimentaryDelivery.server.ts");
    const boxOrder = read("app/constants/boxOrder.ts");
    const prep = read("app/features/preparation/preparation-data.server.ts");
    const scheduleScript = read(
      "scripts/dev-schedule-complimentary-delivery.ts",
    );

    ctx.assertTrue(
      "failed rows are re-eligible (RETRY history)",
      service.includes("COMPLIMENTARY_DELIVERY_HISTORY_EVENT.RETRY") &&
        service.includes("COMPLIMENTARY_DELIVERY_STATUS.FAILED"),
    );
    ctx.assertTrue(
      "processing claim is idempotent via updateMany status filter",
      service.includes("updateMany") &&
        service.includes("COMPLIMENTARY_DELIVERY_STATUS.PROCESSING"),
    );
    ctx.assertTrue(
      "kitchen where ignores financialStatus (complimentary visible)",
      boxOrder.includes("simulated: false") &&
        boxOrder.includes("cancelledAt: null") &&
        !boxOrder.includes('financialStatus: "paid"'),
    );
    ctx.assertTrue(
      "preparation day builder uses kitchen filter only",
      prep.includes("isKitchenPreparationBoxOrder"),
    );
    ctx.assertTrue(
      "no Shopify Order Admin API call in complimentary service",
      !service.includes("orderCreate") &&
        !service.includes("ordersCreate") &&
        !service.includes("admin.graphql") &&
        !service.includes("unauthenticated.admin"),
    );
    ctx.assertTrue(
      "schedule script dry-run by default + confirm gate",
      scheduleScript.includes("dryRun: !apply") &&
        scheduleScript.includes('--confirm=YES') &&
        scheduleScript.includes("mutatesNextBillingDate: false") &&
        scheduleScript.includes("createsPayment: false"),
    );
    ctx.assertTrue(
      "schedule script requires env+shop+contract+operation-id",
      scheduleScript.includes('--env=dev|prod') &&
        scheduleScript.includes("operation-id") &&
        !scheduleScript.includes("26652508488"),
    );
    ctx.assertTrue(
      "mealsCount taken from live selection at fulfill",
      service.includes("selection.selectedMeals") &&
        service.includes("expectedCount"),
    );
  }

  ctx.scenario("T_isolation excludes SubscriptionPromotion engine");
  {
    const cron = read("app/services/processSubscriptionsCron.server.ts");
    const portalData = read("app/features/portal/portal-data.server.ts");
    const portalRender = read("app/features/portal/portal-render.ts");
    const portalTypes = read("app/features/portal/portal-types.ts");
    const schema = read("prisma/schema.prisma");
    const billingWorker = read(
      "app/services/subscriptionBillingWorker.server.ts",
    );

    ctx.assertFalse(
      "no SubscriptionPromotion model in isolated schema",
      schema.includes("model SubscriptionPromotion"),
    );
    ctx.assertFalse(
      "portal data has no promotion imports",
      portalData.includes("subscriptionPromotion") ||
        portalData.includes("listOpenPromotionsForContract"),
    );
    ctx.assertFalse(
      "portal render has no promo badge",
      portalRender.includes("Prix promotionnel") ||
        portalRender.includes("promotionSecured"),
    );
    ctx.assertFalse(
      "portal types have no promotional forecast fields",
      portalTypes.includes("promotionSecured") ||
        portalTypes.includes("promotional?:"),
    );
    ctx.assertFalse(
      "cron has no promotion runner",
      cron.includes("subscriptionPromotion") ||
        cron.includes("processDueSubscriptionPromotions"),
    );
    ctx.assertFalse(
      "billing worker unchanged for promotions",
      billingWorker.includes("promotion_amount_mismatch") ||
        billingWorker.includes("ENABLE_ZERO_AMOUNT"),
    );
  }

  return finishSuite("119-complimentary-delivery", ctx);
};

process.exitCode = await run();
