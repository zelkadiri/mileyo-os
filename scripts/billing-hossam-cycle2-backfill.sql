-- =============================================================================
-- MILEYO P0 — Hossam cycleIndex 2 claim backfill (PROD)
-- STATUS: VERIFIED / NOT EXECUTED by agents. Ops applies manually after review.
-- =============================================================================
-- Contract:  26652508488 (ACTIVE — do not pause/cancel)
-- Selection: cmvl524nv0001jw08yu7toq1g
-- Cycle:     Shopify cycleIndex 2 only (BILLED, 5 paid attempts)
-- Do NOT create claims for cycle 1 (UNBILLED checkout #1175).
-- Do NOT insert 5 succeeded rows — exactly ONE succeeded claim for c2.
-- Do NOT use order-name digits as Shopify GIDs (e.g. Order/1216 is WRONG).
-- First success order: #1216 = gid://shopify/Order/8030041145672
-- =============================================================================

-- PRECHECK (READ-ONLY) — run before INSERT; abort if unexpected
-- SET default_transaction_read_only = on;  -- for prechecks only

SELECT id, "subscriptionContractId", status, active, "nextBillingDate"
FROM "SubscriptionMealSelection"
WHERE id = 'cmvl524nv0001jw08yu7toq1g';
-- expect: contract 26652508488, status active, active true

SELECT to_regclass('public."SubscriptionBillingCycleClaim"') AS claim_table;
-- expect: non-null AFTER migrations

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'SubscriptionBillingCycleClaim'
ORDER BY indexname;
-- expect UNIQUE on (subscriptionMealSelectionId, billingCycleKey)
-- expect UNIQUE on (idempotencyKey)

SELECT id, "billingCycleKey", status, "idempotencyKey", "shopifyOrderId"
FROM "SubscriptionBillingCycleClaim"
WHERE "subscriptionMealSelectionId" = 'cmvl524nv0001jw08yu7toq1g';
-- expect: 0 rows before backfill

-- =============================================================================
-- APPLY (PROD-MUTATION) — single row. Collisions tested in isolated PG (suite 114),
-- NOT by intentionally violating UNIQUE in PROD.
-- =============================================================================
-- BEGIN;

INSERT INTO "SubscriptionBillingCycleClaim" (
  "id",
  "shop",
  "subscriptionMealSelectionId",
  "subscriptionContractId",
  "billingCycleKey",
  "idempotencyKey",
  "status",
  "source",
  "billingAttemptId",
  "shopifyOrderId",
  "lastErrorMessage",
  "claimedAt",
  "succeededAt",
  "lastReconciledAt",
  "createdAt",
  "updatedAt"
) VALUES (
  'cclaim_hossam_c2_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
  '4pvhfk-d8.myshopify.com',
  'cmvl524nv0001jw08yu7toq1g',
  '26652508488',
  'mileyo_cycle_cmvl524nv0001jw08yu7toq1g_c2',
  'mileyo_auto_cmvl524nv0001jw08yu7toq1g_c2',
  'succeeded',
  'cron',
  'gid://shopify/SubscriptionBillingAttempt/87011197256',
  'gid://shopify/Order/8030041145672',
  NULL,
  NOW(),
  NOW(),
  NOW(),
  NOW(),
  NOW()
);

-- COMMIT;  -- only after SELECT verify below in same txn or immediately after

-- POSTCHECK (READ-ONLY)
SELECT
  "billingCycleKey",
  "idempotencyKey",
  status,
  source,
  "subscriptionContractId",
  "shopifyOrderId",
  "billingAttemptId"
FROM "SubscriptionBillingCycleClaim"
WHERE "subscriptionMealSelectionId" = 'cmvl524nv0001jw08yu7toq1g';
-- expect exactly 1 row:
--   billingCycleKey = mileyo_cycle_cmvl524nv0001jw08yu7toq1g_c2
--   idempotencyKey  = mileyo_auto_cmvl524nv0001jw08yu7toq1g_c2
--   status          = succeeded
--   shopifyOrderId  = gid://shopify/Order/8030041145672

-- =============================================================================
-- AUDIT REFS (DO NOT INSERT AS CLAIMS) — 5 payment references on cycle 2
-- =============================================================================
-- 1 first_success_for_cycle:
--   attempt gid://shopify/SubscriptionBillingAttempt/87011197256
--   created 2026-10-30T16:00:25Z
--   legacy key mileyo_auto_cmvl524nv0001jw08yu7toq1g_2026-10-30
--   order #1216 gid://shopify/Order/8030041145672
--
-- 2–5 duplicate_success (refund review — no auto-refund):
--   #1219 2026-10-31 attempt 87036920136 order 8031043027272
--   #1233 2026-11-01 attempt 87157080392 order 8033678328136 (cancelledAt 2026-11-01T10:48:02Z)
--   #1239 2026-11-02 attempt 87435739464 order 8036542415176 (cancelledAt 2026-11-02T05:23:06Z)
--   #1243 2026-11-03 attempt 87590437192 order 8039082787144
--
-- ANOMALIES (4 duplicates + cycle1 warnings) — keep in ops notes, not DB rows.
-- After import: prepareCanonical / claimOrLoad for c2 → block_succeeded (no new charge).
-- New attempts on OTHER cycleIndexes still allowed for non-held contracts.
-- Hossam remains blocked by incident hold + NBD HOLD regardless.
-- =============================================================================
