#!/usr/bin/env npx tsx
/**
 * Audit/backfill subscription delivery billing alignment for legacy subscriptions.
 *
 * Dry-run by default (no mutations).
 * Apply only with: APPLY_DELIVERY_BILLING_ALIGNMENT=1
 *
 * Usage:
 *   npx tsx scripts/backfill-subscription-delivery-billing-alignment.ts
 *   APPLY_DELIVERY_BILLING_ALIGNMENT=1 npx tsx scripts/backfill-subscription-delivery-billing-alignment.ts
 */
import db from "../app/db.server";
import {
  applySubscriptionDeliveryBillingAlignment,
  auditSubscriptionDeliveryBillingAlignment,
  type DeliveryBillingAlignmentAction,
} from "../app/services/subscriptionDeliveryBillingAlignment.server";
import { unauthenticated } from "../app/shopify.server";

const APPLY = process.env.APPLY_DELIVERY_BILLING_ALIGNMENT === "1";
const SHOP_FILTER = process.env.CRON_SHOP?.trim() || null;

type ActionCounts = Record<DeliveryBillingAlignmentAction, number>;

const emptyActionCounts = (): ActionCounts => ({
  failed_shopify_update: 0,
  ok_already_aligned: 0,
  skipped_inactive_contract: 0,
  skipped_invalid_data: 0,
  skipped_missing_delivery_context: 0,
  would_update_db: 0,
  would_update_shopify_and_db: 0,
});

const formatAuditLine = ({
  audit,
  selection,
}: {
  audit: Awaited<ReturnType<typeof auditSubscriptionDeliveryBillingAlignment>>;
  selection: {
    id: string;
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday: number | null;
    shop: string;
    status: string;
    subscriptionContractId: string | null;
  };
}) =>
  JSON.stringify({
    action: audit.action,
    hasBoxOrderForActiveDelivery: audit.hasBoxOrderForActiveDelivery,
    mode: APPLY ? "apply" : "dry_run",
    preferredDeliveryWeekday: selection.preferredDeliveryWeekday ?? null,
    projectedActiveDeliveryDate: audit.projectedActiveDeliveryDate,
    recommendedNextBillingDate:
      audit.recommendedNextBillingDate?.toISOString() ?? null,
    selectionId: selection.id,
    shop: selection.shop,
    shopifyNextBillingDate: audit.shopifyNextBillingDate?.toISOString() ?? null,
    status: selection.status,
    storedNextBillingDate: audit.storedNextBillingDate?.toISOString() ?? null,
    storedNextScheduledDeliveryDate: selection.nextScheduledDeliveryDate ?? null,
    subscriptionContractId: selection.subscriptionContractId,
  });

const main = async () => {
  console.log(
    `[DELIVERY_BILLING_ALIGNMENT] starting ${APPLY ? "apply" : "dry_run"} audit`,
    {
      shopFilter: SHOP_FILTER,
    },
  );

  const selections = await db.subscriptionMealSelection.findMany({
    orderBy: [{ shop: "asc" }, { createdAt: "asc" }],
    where: {
      status: "active",
      active: true,
      ...(SHOP_FILTER ? { shop: SHOP_FILTER } : {}),
    },
  });

  const counts = emptyActionCounts();
  let applied = 0;

  for (const selection of selections) {
    let admin;

    try {
      ({ admin } = await unauthenticated.admin(selection.shop));
    } catch (error) {
      console.log("[DELIVERY_BILLING_ALIGNMENT] shop admin unavailable", {
        error: error instanceof Error ? error.message : error,
        selectionId: selection.id,
        shop: selection.shop,
      });
      counts.skipped_invalid_data += 1;
      continue;
    }

    let audit = await auditSubscriptionDeliveryBillingAlignment({
      admin,
      selection,
    });

    if (
      APPLY &&
      selection.subscriptionContractId &&
      (audit.action === "would_update_db" ||
        audit.action === "would_update_shopify_and_db")
    ) {
      audit = await applySubscriptionDeliveryBillingAlignment({
        admin,
        audit,
        selectionId: selection.id,
        subscriptionContractId: selection.subscriptionContractId,
      });
      applied += 1;
    }

    counts[audit.action] += 1;
    console.log(formatAuditLine({ audit, selection }));
  }

  console.log("[DELIVERY_BILLING_ALIGNMENT] summary", {
    applied,
    mode: APPLY ? "apply" : "dry_run",
    scanned: selections.length,
    ...counts,
  });
};

main().catch((error) => {
  console.error("[DELIVERY_BILLING_ALIGNMENT] fatal", {
    error: error instanceof Error ? error.message : error,
  });
  process.exitCode = 1;
});
