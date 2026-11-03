/**
 * Historical Shopify billing-attempt → cycle-claim dry-run helpers.
 *
 * Canonical identity: selectionId + Shopify cycleIndex (NOT Paris Saturday).
 * Hossam PROD: all five successful attempts live on cycleIndex 2.
 */
import {
  BILLING_CYCLE_CLAIM_SOURCE,
  BILLING_CYCLE_CLAIM_STATUS,
} from "../constants/subscriptionBillingCycleClaim";
import {
  buildAutoBillingIdempotencyKeyFromShopifyCycle,
  buildBillingCycleKeyFromShopifyCycle,
  buildLegacyDailyAutoBillingIdempotencyKey,
} from "../utils/subscriptionBillingCycleKeys";

export type HistoricalShopifyBillingAttempt = {
  completedAt: string | null;
  createdAt: string;
  idempotencyKey: string | null;
  orderId: string | null;
  orderName: string | null;
  ready: boolean | null;
  /** From Shopify subscriptionBillingCycles.billingAttempts — required for correct mapping. */
  shopifyCycleIndex: number | null;
};

export type HistoricalBoxOrderRef = {
  cancelledAt: Date | string | null;
  createdAt: Date | string;
  isSubscriptionRenewal: boolean;
  shopifyOrderId: string | null;
  shopifyOrderName: string | null;
};

export type HistoricalAttemptClassification =
  | "duplicate_success"
  | "failed_or_incomplete"
  | "first_success_for_cycle"
  | "checkout_first_order_not_billing_attempt"
  | "unknown_key_shape";

export type HistoricalReconcileRow = {
  attempt: HistoricalShopifyBillingAttempt;
  billingCycleKey: string | null;
  boxOrderMatch: HistoricalBoxOrderRef | null;
  classification: HistoricalAttemptClassification;
  notes: string[];
  proposedClaimStatus: "succeeded" | null;
  shopifyCycleIndex: number | null;
};

export type HistoricalReconcilePlan = {
  anomalies: string[];
  collisions: Array<{ billingCycleKey: string; orderNames: string[]; shopifyCycleIndex: number }>;
  contractId: string;
  rows: HistoricalReconcileRow[];
  selectionId: string;
  summary: {
    duplicateSuccesses: number;
    failedOrIncomplete: number;
    firstSuccesses: number;
    proposedSucceededClaims: number;
  };
};

const toOrderIdTail = (orderId: string | null) => {
  if (!orderId) return null;
  const match = orderId.match(/(\d+)$/);
  return match?.[1] ?? orderId;
};

export const buildHistoricalBillingReconcilePlan = ({
  attempts,
  boxOrders,
  contractId,
  selectionId,
}: {
  attempts: HistoricalShopifyBillingAttempt[];
  boxOrders: HistoricalBoxOrderRef[];
  contractId: string;
  selectionId: string;
}): HistoricalReconcilePlan => {
  const anomalies: string[] = [];
  const rows: HistoricalReconcileRow[] = [];
  const successesByCycle = new Map<string, HistoricalReconcileRow[]>();

  const sortedAttempts = [...attempts].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  for (const attempt of sortedAttempts) {
    const notes: string[] = [];
    const shopifyCycleIndex = attempt.shopifyCycleIndex;
    let billingCycleKey: string | null = null;

    if (shopifyCycleIndex != null && shopifyCycleIndex >= 1) {
      billingCycleKey = buildBillingCycleKeyFromShopifyCycle(
        selectionId,
        shopifyCycleIndex,
      );
      notes.push(
        `mapped via Shopify cycleIndex=${shopifyCycleIndex} (not local Saturday anchor)`,
      );
      if (attempt.idempotencyKey?.includes("_2026-10-24")) {
        notes.push(
          "WARNING: key looks like Saturday-anchor — ignored for identity; Shopify cycleIndex wins",
        );
      }
    } else {
      notes.push("missing shopifyCycleIndex — cannot map safely");
      anomalies.push(
        `Unmapped attempt ${attempt.idempotencyKey ?? attempt.createdAt}`,
      );
    }

    const orderTail = toOrderIdTail(attempt.orderId);
    const boxOrderMatch =
      boxOrders.find((order) => {
        if (attempt.orderName && order.shopifyOrderName === attempt.orderName) {
          return true;
        }
        if (
          orderTail &&
          order.shopifyOrderId &&
          toOrderIdTail(order.shopifyOrderId) === orderTail
        ) {
          return true;
        }
        return false;
      }) ?? null;

    const hasOrder = Boolean(attempt.orderId || attempt.orderName);
    let classification: HistoricalAttemptClassification = "failed_or_incomplete";
    let proposedClaimStatus: "succeeded" | null = null;

    if (!billingCycleKey) {
      classification = "unknown_key_shape";
    } else if (hasOrder) {
      const prior = successesByCycle.get(billingCycleKey) ?? [];
      if (prior.length === 0) {
        classification = "first_success_for_cycle";
        proposedClaimStatus = "succeeded";
      } else {
        classification = "duplicate_success";
        anomalies.push(
          `Duplicate success on Shopify cycle ${shopifyCycleIndex}: ${attempt.orderName ?? attempt.orderId} after ${prior[0]?.attempt.orderName}`,
        );
      }
    }

    const row: HistoricalReconcileRow = {
      attempt,
      billingCycleKey,
      boxOrderMatch,
      classification,
      notes,
      proposedClaimStatus,
      shopifyCycleIndex,
    };

    if (
      (classification === "first_success_for_cycle" ||
        classification === "duplicate_success") &&
      billingCycleKey
    ) {
      const list = successesByCycle.get(billingCycleKey) ?? [];
      list.push(row);
      successesByCycle.set(billingCycleKey, list);
    }

    if (hasOrder && !boxOrderMatch) {
      anomalies.push(
        `Shopify order ${attempt.orderName ?? attempt.orderId} has no local BoxOrder match`,
      );
    }

    rows.push(row);
  }

  const collisions = [...successesByCycle.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([billingCycleKey, list]) => ({
      billingCycleKey,
      orderNames: list.map(
        (r) => r.attempt.orderName ?? r.attempt.orderId ?? "?",
      ),
      shopifyCycleIndex: list[0]?.shopifyCycleIndex ?? -1,
    }));

  const firstSuccesses = rows.filter(
    (r) => r.classification === "first_success_for_cycle",
  ).length;
  const duplicateSuccesses = rows.filter(
    (r) => r.classification === "duplicate_success",
  ).length;

  return {
    anomalies,
    collisions,
    contractId,
    rows,
    selectionId,
    summary: {
      duplicateSuccesses,
      failedOrIncomplete: rows.filter(
        (r) => r.classification === "failed_or_incomplete",
      ).length,
      firstSuccesses,
      proposedSucceededClaims: firstSuccesses,
    },
  };
};

/**
 * Hossam fixture from PROD Shopify read (2026-11-03 audit):
 * cycle 1 UNBILLED (checkout #1175 covers commercial start — do NOT auto-bill),
 * cycle 2 BILLED with five successful attempts.
 */
export const HOSSAM_HISTORICAL_RECONCILE_FIXTURE = {
  contractId: "26652508488",
  selectionId: "cmvl524nv0001jw08yu7toq1g",
  shopifyCycle1Note:
    "UNBILLED — first order #1175 is checkout, not a billing attempt. Do not auto-charge cycle 1.",
  attempts: [
    {
      completedAt: "2026-10-30T16:00:30Z",
      createdAt: "2026-10-30T16:00:25Z",
      idempotencyKey: buildLegacyDailyAutoBillingIdempotencyKey(
        "cmvl524nv0001jw08yu7toq1g",
        "2026-10-30",
      ),
      // Real Shopify Order GID (PROD BoxOrder / billingAttempts read 2026-11-03) — never use name digits alone.
      orderId: "gid://shopify/Order/8030041145672",
      orderName: "#1216",
      ready: true,
      shopifyCycleIndex: 2,
    },
    {
      completedAt: "2026-10-31T00:00:31Z",
      createdAt: "2026-10-31T00:00:27Z",
      idempotencyKey: buildLegacyDailyAutoBillingIdempotencyKey(
        "cmvl524nv0001jw08yu7toq1g",
        "2026-10-31",
      ),
      orderId: "gid://shopify/Order/8031043027272",
      orderName: "#1219",
      ready: true,
      shopifyCycleIndex: 2,
    },
    {
      completedAt: "2026-11-01T00:00:31Z",
      createdAt: "2026-11-01T00:00:27Z",
      idempotencyKey: buildLegacyDailyAutoBillingIdempotencyKey(
        "cmvl524nv0001jw08yu7toq1g",
        "2026-11-01",
      ),
      orderId: "gid://shopify/Order/8033678328136",
      orderName: "#1233",
      ready: true,
      shopifyCycleIndex: 2,
    },
    {
      completedAt: "2026-11-02T00:00:30Z",
      createdAt: "2026-11-02T00:00:26Z",
      idempotencyKey: buildLegacyDailyAutoBillingIdempotencyKey(
        "cmvl524nv0001jw08yu7toq1g",
        "2026-11-02",
      ),
      orderId: "gid://shopify/Order/8036542415176",
      orderName: "#1239",
      ready: true,
      shopifyCycleIndex: 2,
    },
    {
      completedAt: "2026-11-03T00:00:29Z",
      createdAt: "2026-11-03T00:00:24Z",
      idempotencyKey: buildLegacyDailyAutoBillingIdempotencyKey(
        "cmvl524nv0001jw08yu7toq1g",
        "2026-11-03",
      ),
      orderId: "gid://shopify/Order/8039082787144",
      orderName: "#1243",
      ready: true,
      shopifyCycleIndex: 2,
    },
  ] satisfies HistoricalShopifyBillingAttempt[],
  boxOrders: [
    {
      cancelledAt: null,
      createdAt: "2026-10-23T15:42:29.433Z",
      isSubscriptionRenewal: false,
      shopifyOrderId: "gid://shopify/Order/8011436261704",
      shopifyOrderName: "#1175",
    },
    {
      cancelledAt: null,
      createdAt: "2026-10-30T16:00:34.269Z",
      isSubscriptionRenewal: true,
      shopifyOrderId: "gid://shopify/Order/8030041145672",
      shopifyOrderName: "#1216",
    },
    {
      cancelledAt: null,
      createdAt: "2026-10-31T00:00:37.324Z",
      isSubscriptionRenewal: true,
      shopifyOrderId: "gid://shopify/Order/8031043027272",
      shopifyOrderName: "#1219",
    },
    {
      cancelledAt: "2026-11-01T10:48:02.000Z",
      createdAt: "2026-11-01T00:00:37.220Z",
      isSubscriptionRenewal: true,
      shopifyOrderId: "gid://shopify/Order/8033678328136",
      shopifyOrderName: "#1233",
    },
    {
      cancelledAt: "2026-11-02T05:23:06.000Z",
      createdAt: "2026-11-02T00:00:34.552Z",
      isSubscriptionRenewal: true,
      shopifyOrderId: "gid://shopify/Order/8036542415176",
      shopifyOrderName: "#1239",
    },
    {
      cancelledAt: null,
      createdAt: "2026-11-03T00:00:32.810Z",
      isSubscriptionRenewal: true,
      shopifyOrderId: "gid://shopify/Order/8039082787144",
      shopifyOrderName: "#1243",
    },
  ] satisfies HistoricalBoxOrderRef[],
};

export const buildHossamHistoricalReconcileDryRun = () => {
  const plan = buildHistoricalBillingReconcilePlan(
    HOSSAM_HISTORICAL_RECONCILE_FIXTURE,
  );
  plan.anomalies.push(
    HOSSAM_HISTORICAL_RECONCILE_FIXTURE.shopifyCycle1Note,
    "Do NOT import claim for cycle 1. Do NOT charge cycle 1 automatically.",
    "Four duplicate successes on cycle 2 require ops refund review — no auto-refund.",
  );
  return plan;
};

export type ClaimApplyRow = {
  billingAttemptId: string | null;
  billingCycleKey: string;
  idempotencyKey: string;
  shop: string;
  shopifyOrderId: string | null;
  status: typeof BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED;
  subscriptionContractId: string;
  subscriptionMealSelectionId: string;
  source: typeof BILLING_CYCLE_CLAIM_SOURCE.CRON;
};

export const buildSucceededClaimInsertsFromPlan = ({
  plan,
  shop,
}: {
  plan: HistoricalReconcilePlan;
  shop: string;
}): ClaimApplyRow[] =>
  plan.rows
    .filter(
      (row) =>
        row.proposedClaimStatus === "succeeded" &&
        row.billingCycleKey &&
        row.shopifyCycleIndex != null,
    )
    .map((row) => ({
      billingAttemptId: null,
      billingCycleKey: row.billingCycleKey!,
      idempotencyKey: buildAutoBillingIdempotencyKeyFromShopifyCycle(
        plan.selectionId,
        row.shopifyCycleIndex!,
      ),
      shop,
      shopifyOrderId: row.attempt.orderId,
      source: BILLING_CYCLE_CLAIM_SOURCE.CRON,
      status: BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
      subscriptionContractId: plan.contractId,
      subscriptionMealSelectionId: plan.selectionId,
    }));

/** Audit-only list of all attempt refs for a succeeded cycle (not separate claims). */
export const listAttemptAuditRefsForCycle = (
  plan: HistoricalReconcilePlan,
  shopifyCycleIndex: number,
) =>
  plan.rows
    .filter((row) => row.shopifyCycleIndex === shopifyCycleIndex)
    .map((row) => ({
      classification: row.classification,
      createdAt: row.attempt.createdAt,
      idempotencyKey: row.attempt.idempotencyKey,
      orderName: row.attempt.orderName,
      cancelledAt: row.boxOrderMatch?.cancelledAt ?? null,
    }));
