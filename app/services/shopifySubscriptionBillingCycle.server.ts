/**
 * Resolve Shopify SubscriptionBillingCycle (cycleIndex) before any charge.
 * Fail-closed when the target cycle cannot be determined safely.
 *
 * API: Admin GraphQL October25 (ApiVersion.October25) — supports
 * subscriptionBillingCycles + billingCycleSelector.index on attempt create.
 */
type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const toSubscriptionContractGid = (subscriptionContractId: string) =>
  subscriptionContractId.includes("/")
    ? subscriptionContractId
    : `gid://shopify/SubscriptionContract/${subscriptionContractId}`;

export type ShopifyBillingCycleAttemptSummary = {
  completedAt: string | null;
  createdAt: string;
  id: string;
  idempotencyKey: string | null;
  orderId: string | null;
  orderName: string | null;
};

export type ShopifyBillingCycleSnapshot = {
  billingAttemptExpectedDate: string;
  cycleEndAt: string;
  cycleIndex: number;
  cycleStartAt: string;
  edited: boolean;
  skipped: boolean;
  status: string;
  successfulAttempts: ShopifyBillingCycleAttemptSummary[];
  attempts: ShopifyBillingCycleAttemptSummary[];
};

export type ResolveBillableShopifyCycleResult =
  | {
      action: "billable";
      cycle: ShopifyBillingCycleSnapshot;
      shopifyCycleIndex: number;
    }
  | {
      action: "already_paid";
      cycle: ShopifyBillingCycleSnapshot;
      shopifyCycleIndex: number;
      reason: string;
    }
  | {
      action: "block_ambiguous";
      shopifyCycleIndex: number | null;
      reason: string;
      cycles: ShopifyBillingCycleSnapshot[];
    }
  | {
      action: "block_unresolvable";
      reason: string;
    };

const billingCyclesQuery = `#graphql
  query MileyoSubscriptionBillingCycles($contractId: ID!, $endIndex: Int!) {
    subscriptionBillingCycles(
      contractId: $contractId
      first: 25
      billingCyclesIndexRangeSelector: { startIndex: 1, endIndex: $endIndex }
    ) {
      nodes {
        cycleIndex
        cycleStartAt
        cycleEndAt
        billingAttemptExpectedDate
        status
        skipped
        edited
        billingAttempts(first: 25) {
          edges {
            node {
              id
              createdAt
              completedAt
              idempotencyKey
              order { id name }
            }
          }
        }
      }
    }
  }
`;

const mapAttempt = (node: {
  id: string;
  createdAt: string;
  completedAt?: string | null;
  idempotencyKey?: string | null;
  order?: { id?: string | null; name?: string | null } | null;
}): ShopifyBillingCycleAttemptSummary => ({
  completedAt: node.completedAt ?? null,
  createdAt: node.createdAt,
  id: node.id,
  idempotencyKey: node.idempotencyKey ?? null,
  orderId: node.order?.id ?? null,
  orderName: node.order?.name ?? null,
});

const mapCycle = (node: {
  cycleIndex: number;
  cycleStartAt: string;
  cycleEndAt: string;
  billingAttemptExpectedDate: string;
  status: string;
  skipped: boolean;
  edited: boolean;
  billingAttempts?: {
    edges?: Array<{ node: Parameters<typeof mapAttempt>[0] }>;
  };
}): ShopifyBillingCycleSnapshot => {
  const attempts = (node.billingAttempts?.edges ?? []).map((edge) =>
    mapAttempt(edge.node),
  );
  return {
    attempts,
    billingAttemptExpectedDate: node.billingAttemptExpectedDate,
    cycleEndAt: node.cycleEndAt,
    cycleIndex: node.cycleIndex,
    cycleStartAt: node.cycleStartAt,
    edited: node.edited,
    skipped: node.skipped,
    status: node.status,
    successfulAttempts: attempts.filter((attempt) => Boolean(attempt.orderId)),
  };
};

export const fetchShopifyBillingCycles = async ({
  admin,
  endIndex = 30,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  endIndex?: number;
  subscriptionContractId: string;
}): Promise<ShopifyBillingCycleSnapshot[]> => {
  const response = await admin.graphql(billingCyclesQuery, {
    variables: {
      contractId: toSubscriptionContractGid(subscriptionContractId),
      endIndex,
    },
  });
  const json = (await response.json()) as {
    data?: {
      subscriptionBillingCycles?: { nodes?: Parameters<typeof mapCycle>[0][] };
    };
    errors?: { message?: string }[];
  };

  if (json.errors?.length) {
    throw new Error(
      json.errors.map((error) => error.message).filter(Boolean).join(" ") ||
        "Impossible de lire subscriptionBillingCycles.",
    );
  }

  return (json.data?.subscriptionBillingCycles?.nodes ?? []).map(mapCycle);
};

const sameInstant = (left: string, right: Date) =>
  new Date(left).getTime() === right.getTime();

/**
 * Pure classifier (testable). Previous cycles BILLED are normal.
 * Ambiguous only when a *later* cycle already has successful payments while
 * the due NBD still points at an unpaid earlier candidate (Hossam pattern),
 * or when the candidate has in-flight attempts without an order.
 */
export const classifyBillableShopifyCycle = ({
  cycles,
  nextBillingDate,
  now = new Date(),
}: {
  cycles: ShopifyBillingCycleSnapshot[];
  nextBillingDate: Date;
  now?: Date;
}): ResolveBillableShopifyCycleResult => {
  if (Number.isNaN(nextBillingDate.getTime())) {
    return {
      action: "block_unresolvable",
      reason: "nextBillingDate invalide — facturation bloquée.",
    };
  }

  if (cycles.length === 0) {
    return {
      action: "block_unresolvable",
      reason: "Aucun SubscriptionBillingCycle Shopify retourné.",
    };
  }

  const byExpected =
    cycles.find((cycle) =>
      sameInstant(cycle.billingAttemptExpectedDate, nextBillingDate),
    ) ?? null;

  const dueMs = nextBillingDate.getTime();
  const byWindow =
    cycles.find((cycle) => {
      const start = new Date(cycle.cycleStartAt).getTime();
      const end = new Date(cycle.cycleEndAt).getTime();
      return dueMs >= start && dueMs <= end;
    }) ?? null;

  const candidate = byExpected ?? byWindow;

  if (!candidate) {
    return {
      action: "block_unresolvable",
      reason: `Aucun cycle Shopify pour nextBillingDate=${nextBillingDate.toISOString()}.`,
    };
  }

  if (candidate.successfulAttempts.length > 0) {
    return {
      action: "already_paid",
      cycle: candidate,
      reason: `Cycle Shopify ${candidate.cycleIndex} a déjà ${candidate.successfulAttempts.length} paiement(s) avec commande.`,
      shopifyCycleIndex: candidate.cycleIndex,
    };
  }

  // Hossam-style stuck NBD: unpaid candidate while a *later* cycle already charged.
  // Prior cycles with payments are expected for healthy weekly renewals.
  const laterCyclesWithPayments = cycles.filter(
    (cycle) =>
      cycle.cycleIndex > candidate.cycleIndex &&
      cycle.successfulAttempts.length > 0,
  );

  if (laterCyclesWithPayments.length > 0 && dueMs <= now.getTime()) {
    const neighborSummary = laterCyclesWithPayments
      .map(
        (cycle) =>
          `c${cycle.cycleIndex}:${cycle.successfulAttempts.length} paid (status=${cycle.status})`,
      )
      .join("; ");
    return {
      action: "block_ambiguous",
      cycles,
      reason: `Cycle candidat c${candidate.cycleIndex} sans paiement, mais cycle(s) ultérieur(s) déjà payé(s) (${neighborSummary}). Réconciliation manuelle requise — pas de débit auto.`,
      shopifyCycleIndex: candidate.cycleIndex,
    };
  }

  const openAttempts = candidate.attempts.filter((attempt) => !attempt.orderId);
  if (openAttempts.length > 0) {
    return {
      action: "block_ambiguous",
      cycles,
      reason: `Cycle c${candidate.cycleIndex} a ${openAttempts.length} attempt(s) sans order — réconciliation Shopify avant nouvelle charge.`,
      shopifyCycleIndex: candidate.cycleIndex,
    };
  }

  return {
    action: "billable",
    cycle: candidate,
    shopifyCycleIndex: candidate.cycleIndex,
  };
};

/**
 * Choose the Shopify cycle to bill for a due nextBillingDate, then reconcile
 * attempts. Never trust BILLED/UNBILLED alone.
 */
export const resolveBillableShopifyCycle = async ({
  admin,
  nextBillingDate,
  now,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  nextBillingDate: Date;
  now?: Date;
  subscriptionContractId: string;
}): Promise<ResolveBillableShopifyCycleResult> => {
  let cycles: ShopifyBillingCycleSnapshot[];
  try {
    cycles = await fetchShopifyBillingCycles({
      admin,
      subscriptionContractId,
    });
  } catch (error) {
    return {
      action: "block_unresolvable",
      reason:
        error instanceof Error
          ? error.message
          : "Lecture des cycles Shopify impossible.",
    };
  }

  return classifyBillableShopifyCycle({ cycles, nextBillingDate, now });
};
