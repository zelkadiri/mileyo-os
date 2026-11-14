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

/**
 * Shopify Admin rejects subscriptionBillingAttemptCreate with
 * billingCycleSelector.index when now < billingAttemptExpectedDate − 24h
 * (BILLING_CYCLE_CHARGE_BEFORE_EXPECTED_DATE). Same-calendar-day expected
 * (e.g. Sat 07h–16h) remains chargeable at Mileyo NBD Sat 00:05.
 */
export const SHOPIFY_BILLING_ATTEMPT_EARLIEST_OFFSET_MS =
  24 * 60 * 60 * 1000;

export const getShopifyBillingCycleEarliestChargeAt = (
  billingAttemptExpectedDate: string | Date,
): Date | null => {
  const expectedMs = new Date(billingAttemptExpectedDate).getTime();
  if (Number.isNaN(expectedMs)) {
    return null;
  }
  return new Date(expectedMs - SHOPIFY_BILLING_ATTEMPT_EARLIEST_OFFSET_MS);
};

/** Authorization only — does not identify which cycle to bill. */
export const isShopifyBillingCycleChargeWindowOpen = ({
  billingAttemptExpectedDate,
  now = new Date(),
}: {
  billingAttemptExpectedDate: string | Date;
  now?: Date;
}): boolean => {
  const earliest = getShopifyBillingCycleEarliestChargeAt(
    billingAttemptExpectedDate,
  );
  if (!earliest) {
    return false;
  }
  return now.getTime() >= earliest.getTime();
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
      action: "block_too_early";
      cycle: ShopifyBillingCycleSnapshot;
      shopifyCycleIndex: number;
      earliestChargeAt: Date;
      reason: string;
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
 * Identify the Shopify cycle for a due NBD (byExpected, else byWindow).
 * Does not authorize create — callers must still apply paid/ambiguous/window checks.
 */
export const identifyShopifyBillingCycleCandidate = ({
  cycles,
  nextBillingDate,
}: {
  cycles: ShopifyBillingCycleSnapshot[];
  nextBillingDate: Date;
}): ShopifyBillingCycleSnapshot | null => {
  if (Number.isNaN(nextBillingDate.getTime()) || cycles.length === 0) {
    return null;
  }

  const byExpected =
    cycles.find((cycle) =>
      sameInstant(cycle.billingAttemptExpectedDate, nextBillingDate),
    ) ?? null;

  if (byExpected) {
    return byExpected;
  }

  const dueMs = nextBillingDate.getTime();
  return (
    cycles.find((cycle) => {
      const start = new Date(cycle.cycleStartAt).getTime();
      const end = new Date(cycle.cycleEndAt).getTime();
      return dueMs >= start && dueMs <= end;
    }) ?? null
  );
};

/**
 * Pure classifier (testable). Previous cycles BILLED are normal.
 * Ambiguous only when a *later* cycle already has successful payments while
 * the due NBD still points at an unpaid earlier candidate (Hossam pattern),
 * or when the candidate has in-flight attempts without an order.
 *
 * Identification (byExpected / byWindow) is separate from charge authorization
 * (NBD within cycle bounds + Shopify expected−24h window).
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

  const dueMs = nextBillingDate.getTime();
  const candidate = identifyShopifyBillingCycleCandidate({
    cycles,
    nextBillingDate,
  });

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

  const startMs = new Date(candidate.cycleStartAt).getTime();
  const endMs = new Date(candidate.cycleEndAt).getTime();
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    dueMs < startMs ||
    dueMs > endMs
  ) {
    return {
      action: "block_unresolvable",
      reason: `nextBillingDate=${nextBillingDate.toISOString()} hors bornes du cycle c${candidate.cycleIndex} [${candidate.cycleStartAt} → ${candidate.cycleEndAt}].`,
    };
  }

  const earliestChargeAt = getShopifyBillingCycleEarliestChargeAt(
    candidate.billingAttemptExpectedDate,
  );
  if (
    !earliestChargeAt ||
    !isShopifyBillingCycleChargeWindowOpen({
      billingAttemptExpectedDate: candidate.billingAttemptExpectedDate,
      now,
    })
  ) {
    return {
      action: "block_too_early",
      cycle: candidate,
      earliestChargeAt:
        earliestChargeAt ??
        new Date(Number.NaN),
      reason: `Fenêtre Shopify expected−24h fermée pour c${candidate.cycleIndex} (expected=${candidate.billingAttemptExpectedDate}, earliest=${earliestChargeAt?.toISOString() ?? "invalid"}, now=${now.toISOString()}). Identification byWindow conservée — pas de claim/create.`,
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

/**
 * originTime for subscriptionBillingAttemptCreate when billingCycleSelector.index
 * is set. Shopify defaults originTime to now; if now is outside the selected
 * cycle [start, end] the create is rejected (ORIGIN_TIME_OUT_OF_RANGE).
 *
 * Prefer due NBD (fulfillment scheduling), then Shopify expected, then now —
 * all clamped to the selected cycle. Never invent a time outside the cycle.
 */
export const resolveSubscriptionBillingAttemptOriginTime = ({
  cycle,
  dueBillingDate = null,
  now = new Date(),
}: {
  cycle: Pick<
    ShopifyBillingCycleSnapshot,
    "billingAttemptExpectedDate" | "cycleEndAt" | "cycleStartAt"
  >;
  dueBillingDate?: Date | null;
  now?: Date;
}): string => {
  const startMs = new Date(cycle.cycleStartAt).getTime();
  const endMs = new Date(cycle.cycleEndAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    throw new Error(
      `Bornes de cycle invalides pour originTime (${cycle.cycleStartAt} → ${cycle.cycleEndAt}).`,
    );
  }

  const pickIfInside = (
    value: Date | string | null | undefined,
  ): string | null => {
    if (value == null) {
      return null;
    }
    const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (Number.isNaN(ms) || ms < startMs || ms > endMs) {
      return null;
    }
    return new Date(ms).toISOString();
  };

  return (
    pickIfInside(dueBillingDate) ??
    pickIfInside(cycle.billingAttemptExpectedDate) ??
    pickIfInside(now) ??
    // Past cycleEndAt (c7 @ cron 02h+29s): stay inside selected cycle.
    new Date(Math.max(startMs, endMs - 1000)).toISOString()
  );
};
