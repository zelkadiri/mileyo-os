#!/usr/bin/env npx tsx
/**
 * Dry-run only — historical Shopify billing attempts → cycle claims.
 * Identity = Shopify cycleIndex (never local Saturday 2026-10-24 for Hossam).
 *
 * Usage:
 *   npx tsx scripts/billing-history-reconcile-dry-run.ts
 */
import {
  buildHossamHistoricalReconcileDryRun,
  buildSucceededClaimInsertsFromPlan,
  listAttemptAuditRefsForCycle,
} from "../app/services/subscriptionBillingHistoryReconcile.server";

const plan = buildHossamHistoricalReconcileDryRun();
const proposedInserts = buildSucceededClaimInsertsFromPlan({
  plan,
  shop: "4pvhfk-d8.myshopify.com",
});
const cycle2Attempts = listAttemptAuditRefsForCycle(plan, 2);

console.log(
  JSON.stringify(
    {
      mode: "dry-run",
      contractId: plan.contractId,
      selectionId: plan.selectionId,
      summary: plan.summary,
      collisions: plan.collisions,
      anomalies: plan.anomalies,
      cycle2AttemptAuditRefs: cycle2Attempts,
      proposedSucceededClaimInserts: proposedInserts,
      opsNotes: [
        "Exactly ONE succeeded claim for Shopify cycleIndex 2.",
        "Keep all five attempt refs for audit — do not create five succeeded claims.",
        "Four duplicates = anomalies for manual refund review — no auto-refund.",
        "Cycle 1 stays UNBILLED (checkout #1175) — do NOT auto-bill cycle 1.",
        "Never map Hossam to local Saturday 2026-10-24.",
        "Apply path intentionally omitted from this script.",
      ],
    },
    null,
    2,
  ),
);
