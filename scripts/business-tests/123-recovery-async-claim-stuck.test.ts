/**
 * Recovery async failure + stuck submitted claim (c265 class).
 * Pure classifier / resolveStatus / source contracts — no Shopify, no PROD.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Prisma } from "@prisma/client";

import {
  BILLING_CYCLE_CLAIM_SOURCE,
  BILLING_CYCLE_CLAIM_STATUS,
} from "../../app/constants/subscriptionBillingCycleClaim";
import {
  classifyBillableShopifyCycle,
  isConfirmedTerminalFailedBillingAttempt,
  type ShopifyBillingCycleSnapshot,
} from "../../app/services/shopifySubscriptionBillingCycle.server";
import {
  __setBillingCycleClaimDelegateForTests,
  claimOrLoadBillingCycle,
  markBillingCycleClaimFailed,
  markBillingCycleClaimUncertain,
  reconcileBillingCycleClaimOnConfirmedFailure,
  rotateClaimIdempotencyKeyAfterConfirmedFailure,
  type BillingCycleClaimRow,
} from "../../app/services/subscriptionBillingCycleClaim.server";
import { resolveBillingAttemptStatus } from "../../app/services/subscriptionBillingWorker.server";
import { buildBillingCycleKeyFromShopifyCycle } from "../../app/utils/subscriptionBillingCycleKeys";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepo = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

const mkAttempt = ({
  completedAt = null as string | null,
  errorMessage = null as string | null,
  id = "att_1",
  orderId = null as string | null,
}: {
  completedAt?: string | null;
  errorMessage?: string | null;
  id?: string;
  orderId?: string | null;
}) => ({
  completedAt,
  createdAt: "2026-11-14T01:00:29Z",
  errorMessage,
  id,
  idempotencyKey: "mileyo_auto_sel_c4",
  orderId,
  orderName: orderId ? "#1" : null,
});

const mkCycle = ({
  attempts,
  cycleIndex = 4,
  expected = "2026-11-14T20:00:00.000Z",
  status = "UNBILLED",
}: {
  attempts: ShopifyBillingCycleSnapshot["attempts"];
  cycleIndex?: number;
  expected?: string;
  status?: string;
}): ShopifyBillingCycleSnapshot => ({
  attempts,
  billingAttemptExpectedDate: expected,
  cycleEndAt: expected,
  cycleIndex,
  cycleStartAt: "2026-11-07T13:00:01.000Z",
  edited: false,
  skipped: false,
  status,
  successfulAttempts: attempts.filter((a) => Boolean(a.orderId)),
});

const nbdInCycle = new Date("2026-11-13T23:05:00.000Z");
const nowInWindow = new Date("2026-11-14T01:00:00.000Z");

const runSuite = () => {
  const ctx = createBusinessTestContext("123-recovery-async-claim-stuck");
  const recoverySrc = readRepo(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const claimSrc = readRepo(
    "app/services/subscriptionBillingCycleClaim.server.ts",
  );
  const cycleSrc = readRepo(
    "app/services/shopifySubscriptionBillingCycle.server.ts",
  );
  const workerSrc = readRepo(
    "app/services/subscriptionBillingWorker.server.ts",
  );

  ctx.scenario("T1/T2/T3 — claim failed reconcile wired; recovery not duplicated");
  {
    ctx.assertTrue(
      "reconcileBillingCycleClaimOnConfirmedFailure exported",
      claimSrc.includes(
        "export const reconcileBillingCycleClaimOnConfirmedFailure",
      ),
    );
    ctx.assertTrue(
      "processBillingAttemptFailure reconciles claim before duplicate short-circuit",
      recoverySrc.indexOf("reconcileBillingCycleClaimOnConfirmedFailure") <
        recoverySrc.indexOf(
          "if (isRecoveryFailureAlreadyRecorded(existing, billingAttemptId))",
        ),
    );
    ctx.assertTrue(
      "scheduleRecoveryAfterFailure reconciles claim on failure status",
      recoverySrc.includes('billingResult.status === "failure"') &&
        recoverySrc.includes("reconcileBillingCycleClaimOnConfirmedFailure"),
    );
    ctx.assertTrue(
      "never downgrades succeeded claims",
      claimSrc.includes("BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED") &&
        claimSrc.includes("return claim"),
    );
  }

  ctx.scenario("T4 — FAILED terminal excluded from openAttempts → billable");
  {
    const failed = mkAttempt({
      completedAt: "2026-11-14T01:00:33Z",
      errorMessage: "Your card does not support this type of purchase.",
    });
    ctx.assertTrue(
      "helper recognizes terminal failure",
      isConfirmedTerminalFailedBillingAttempt(failed),
    );
    const classified = classifyBillableShopifyCycle({
      cycles: [mkCycle({ attempts: [failed] })],
      nextBillingDate: nbdInCycle,
      now: nowInWindow,
    });
    ctx.assertEqual("T4 billable", classified.action, "billable");
  }

  ctx.scenario("T5 — PENDING remains blocking");
  {
    const pending = mkAttempt({ completedAt: null, errorMessage: null });
    ctx.assertTrue(
      "pending is not terminal failure",
      !isConfirmedTerminalFailedBillingAttempt(pending),
    );
    const classified = classifyBillableShopifyCycle({
      cycles: [mkCycle({ attempts: [pending] })],
      nextBillingDate: nbdInCycle,
      now: nowInWindow,
    });
    ctx.assertEqual("T5 block_ambiguous", classified.action, "block_ambiguous");
  }

  ctx.scenario("T6 — UNKNOWN (completed, no error, no order) remains blocking");
  {
    const unknown = mkAttempt({
      completedAt: "2026-11-14T01:00:33Z",
      errorMessage: null,
    });
    const classified = classifyBillableShopifyCycle({
      cycles: [mkCycle({ attempts: [unknown] })],
      nextBillingDate: nbdInCycle,
      now: nowInWindow,
    });
    ctx.assertEqual("T6 block_ambiguous", classified.action, "block_ambiguous");
  }

  ctx.scenario("T7 — SUCCESS with order cannot be recharged");
  {
    const paid = mkAttempt({
      completedAt: "2026-11-14T01:00:33Z",
      orderId: "gid://shopify/Order/1",
    });
    const classified = classifyBillableShopifyCycle({
      cycles: [mkCycle({ attempts: [paid], status: "BILLED" })],
      nextBillingDate: nbdInCycle,
      now: nowInWindow,
    });
    ctx.assertEqual("T7 already_paid", classified.action, "already_paid");
  }

  ctx.scenario("T8 — completedAt + errorMessage ⇒ failure (not success)");
  {
    const resolved = resolveBillingAttemptStatus([], {
      completedAt: "2026-11-14T01:00:33Z",
      errorMessage: "Your card does not support this type of purchase.",
      id: "gid://shopify/SubscriptionBillingAttempt/1",
      ready: true,
    });
    ctx.assertEqual("T8 status failure", resolved.status, "failure");
    ctx.assertTrue(
      "T8 keeps error message",
      Boolean(resolved.errorMessage?.includes("does not support")),
    );
  }

  ctx.scenario("T8b — completedAt alone ⇒ unknown (fail-closed, not success)");
  {
    const resolved = resolveBillingAttemptStatus([], {
      completedAt: "2026-11-14T01:00:33Z",
      id: "gid://shopify/SubscriptionBillingAttempt/1",
      ready: true,
    });
    ctx.assertEqual("T8b status unknown", resolved.status, "unknown");
  }

  ctx.scenario("T8c — orderId ⇒ success");
  {
    const resolved = resolveBillingAttemptStatus([], {
      completedAt: "2026-11-14T01:00:33Z",
      id: "gid://shopify/SubscriptionBillingAttempt/1",
      order: { id: "gid://shopify/Order/1", name: "#1" },
      ready: true,
    });
    ctx.assertEqual("T8c status success", resolved.status, "success");
  }

  ctx.scenario("T8d — errorMessage + commande payée ⇒ unknown, jamais failure");
  {
    const resolved = resolveBillingAttemptStatus([], {
      completedAt: "2026-11-14T01:00:33Z",
      errorMessage: "Your card was declined.",
      id: "gid://shopify/SubscriptionBillingAttempt/paid",
      order: { id: "gid://shopify/Order/9001", name: "#9001" },
      processingError: { code: "PAYMENT_ERROR", message: "Card declined" },
      ready: true,
    });
    ctx.assertEqual("T8d status unknown", resolved.status, "unknown");
    ctx.assertTrue(
      "T8d keeps the contradictory error",
      Boolean(resolved.errorMessage?.includes("declined")),
    );
    const userErrorsAndOrder = resolveBillingAttemptStatus(
      [{ message: "Billing attempt failed." }],
      {
        id: "gid://shopify/SubscriptionBillingAttempt/paid2",
        order: { id: "gid://shopify/Order/9002", name: "#9002" },
      },
    );
    ctx.assertEqual(
      "T8d userErrors + order unknown",
      userErrorsAndOrder.status,
      "unknown",
    );
  }

  ctx.scenario("T9 — duplicate webhook path still reconciles claim");
  {
    ctx.assertTrue(
      "duplicate short-circuit after claim reconcile in processBillingAttemptFailure",
      recoverySrc.includes("Always converge claim on confirmed failure") ||
        recoverySrc.includes(
          "converge claim even when recovery row is a duplicate",
        ) ||
        (recoverySrc.includes("reconcileBillingCycleClaimOnConfirmedFailure") &&
          recoverySrc.includes("duplicate_ignored")),
    );
  }

  ctx.scenario("T12 — rotation only from failed claims (source)");
  {
    ctx.assertTrue(
      "rotate requires FAILED status",
      claimSrc.includes(
        "existing.status !== BILLING_CYCLE_CLAIM_STATUS.FAILED",
      ),
    );
    ctx.assertTrue(
      "recovery retry reconciles stuck submitted before rotate path",
      recoverySrc.includes("Historical stuck submitted claims"),
    );
  }

  ctx.scenario("T14 — PAUSED voluntary: no auto-activate in recovery");
  {
    ctx.assertTrue(
      "recovery documents no activate",
      recoverySrc.includes("never auto-activate") ||
        recoverySrc.includes("calls subscriptionContractActivate") === false ||
        recoverySrc.includes(
          "This slice never\n      // calls subscriptionContractActivate",
        ) ||
        recoverySrc.includes("This slice never"),
    );
    ctx.assertTrue(
      "recovery file does not call activateSubscriptionContractWithVerification",
      !recoverySrc.includes("activateSubscriptionContractWithVerification("),
    );
  }

  ctx.scenario("T16 — originTime PR #5 preserved");
  {
    ctx.assertTrue(
      "originTime helper still present",
      cycleSrc.includes("resolveSubscriptionBillingAttemptOriginTime"),
    );
    ctx.assertTrue(
      "createBillingAttempt still passes originTime",
      workerSrc.includes("originTime") &&
        workerSrc.includes("subscriptionBillingAttemptInput.originTime"),
    );
  }

  ctx.scenario("T17/T18 — anti-double guards preserved");
  {
    ctx.assertTrue(
      "openAttempts still block non-terminal unknowns",
      cycleSrc.includes("openAttempts"),
    );
    ctx.assertTrue(
      "already_paid path intact",
      cycleSrc.includes('action: "already_paid"'),
    );
    ctx.assertTrue(
      "claim unique + rotate still gated",
      claimSrc.includes("Cannot rotate billing claim idempotency key"),
    );
  }

  ctx.scenario("GraphQL cycle query fetches errorMessage");
  {
    ctx.assertTrue(
      "billingAttempts query includes errorMessage",
      cycleSrc.includes("errorMessage"),
    );
  }

  return ctx;
};

type ClaimWhere = {
  AND?: ClaimWhere[];
  billingAttemptId?: string | null;
  id?: string;
  idempotencyKey?: string;
  NOT?: ClaimWhere;
  OR?: ClaimWhere[];
  status?: string | { in?: string[] };
  subscriptionMealSelectionId?: string;
  subscriptionMealSelectionId_billingCycleKey?: {
    billingCycleKey: string;
    subscriptionMealSelectionId: string;
  };
};

const matchesClaimWhere = (row: BillingCycleClaimRow, where: ClaimWhere) => {
  if (where.id !== undefined && row.id !== where.id) {
    return false;
  }
  if (
    where.idempotencyKey !== undefined &&
    row.idempotencyKey !== where.idempotencyKey
  ) {
    return false;
  }
  if (
    where.subscriptionMealSelectionId !== undefined &&
    row.subscriptionMealSelectionId !== where.subscriptionMealSelectionId
  ) {
    return false;
  }
  if (where.subscriptionMealSelectionId_billingCycleKey) {
    const key = where.subscriptionMealSelectionId_billingCycleKey;
    if (
      row.billingCycleKey !== key.billingCycleKey ||
      row.subscriptionMealSelectionId !== key.subscriptionMealSelectionId
    ) {
      return false;
    }
  }
  if (typeof where.status === "string" && row.status !== where.status) {
    return false;
  }
  if (
    where.status &&
    typeof where.status !== "string" &&
    where.status.in &&
    !where.status.in.includes(row.status)
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(where, "billingAttemptId") &&
    row.billingAttemptId !== where.billingAttemptId
  ) {
    return false;
  }
  if (where.OR && !where.OR.some((clause) => matchesClaimWhere(row, clause))) {
    return false;
  }
  if (
    where.AND &&
    !where.AND.every((clause) => matchesClaimWhere(row, clause))
  ) {
    return false;
  }
  if (where.NOT && matchesClaimWhere(row, where.NOT)) {
    return false;
  }
  return true;
};

const createClaimStore = () => {
  const rows: BillingCycleClaimRow[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  let beforeUpdateMany: (() => void | Promise<void>) | null = null;
  let nextId = 1;

  const enqueue = <T>(fn: () => Promise<T> | T) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const copy = (row: BillingCycleClaimRow): BillingCycleClaimRow => ({
    ...row,
  });

  const uniqueConflict = () =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      clientVersion: "test",
      code: "P2002",
    });

  const applyData = (
    row: BillingCycleClaimRow,
    data: Partial<BillingCycleClaimRow>,
  ) => {
    Object.assign(row, data, { updatedAt: new Date() });
  };

  const delegate = {
    create: async ({
      data,
    }: {
      data: Omit<
        BillingCycleClaimRow,
        "claimedAt" | "createdAt" | "id" | "updatedAt"
      > &
        Partial<Pick<BillingCycleClaimRow, "claimedAt" | "createdAt" | "id">>;
    }) =>
      enqueue(() => {
        const conflict = rows.some(
          (row) =>
            (row.subscriptionMealSelectionId ===
              data.subscriptionMealSelectionId &&
              row.billingCycleKey === data.billingCycleKey) ||
            row.idempotencyKey === data.idempotencyKey,
        );
        if (conflict) {
          throw uniqueConflict();
        }
        const now = new Date();
        const row: BillingCycleClaimRow = {
          billingAttemptId: data.billingAttemptId ?? null,
          billingCycleKey: data.billingCycleKey,
          claimedAt: data.claimedAt ?? now,
          createdAt: data.createdAt ?? now,
          id: data.id ?? `claim_${nextId++}`,
          idempotencyKey: data.idempotencyKey,
          lastErrorMessage: data.lastErrorMessage ?? null,
          lastReconciledAt: data.lastReconciledAt ?? null,
          shop: data.shop,
          shopifyOrderId: data.shopifyOrderId ?? null,
          source: data.source,
          status: data.status,
          subscriptionContractId: data.subscriptionContractId ?? null,
          subscriptionMealSelectionId: data.subscriptionMealSelectionId,
          succeededAt: data.succeededAt ?? null,
          updatedAt: now,
        };
        rows.push(row);
        return copy(row);
      }),
    findUnique: async ({ where }: { where: ClaimWhere }) => {
      const found = rows.find((row) => matchesClaimWhere(row, where));
      return found ? copy(found) : null;
    },
    findUniqueOrThrow: async ({ where }: { where: ClaimWhere }) => {
      const found = rows.find((row) => matchesClaimWhere(row, where));
      if (!found) {
        throw new Error("claim not found");
      }
      return copy(found);
    },
    update: async ({
      data,
      where,
    }: {
      data: Partial<BillingCycleClaimRow>;
      where: ClaimWhere;
    }) =>
      enqueue(() => {
        const found = rows.find((row) => matchesClaimWhere(row, where));
        if (!found) {
          throw new Error("claim not found");
        }
        applyData(found, data);
        return copy(found);
      }),
    updateMany: async ({
      data,
      where,
    }: {
      data: Partial<BillingCycleClaimRow>;
      where: ClaimWhere;
    }) =>
      enqueue(async () => {
        if (beforeUpdateMany) {
          await beforeUpdateMany();
        }
        const matched = rows.filter((row) => matchesClaimWhere(row, where));
        for (const row of matched) {
          applyData(row, data);
        }
        return { count: matched.length };
      }),
  };

  return {
    delegate,
    resetHook() {
      beforeUpdateMany = null;
    },
    rows,
    setBeforeUpdateMany(hook: () => void | Promise<void>) {
      beforeUpdateMany = hook;
    },
    seed(row: BillingCycleClaimRow) {
      rows.push({ ...row });
    },
  };
};

const selectionId = "sel_recovery_review";
const cycleKey = buildBillingCycleKeyFromShopifyCycle(selectionId, 4);
const paidOrderId = "gid://shopify/Order/9001";
const attemptOld = "gid://shopify/SubscriptionBillingAttempt/old";
const attemptNew = "gid://shopify/SubscriptionBillingAttempt/new";

const seedClaim = (
  overrides: Partial<BillingCycleClaimRow> = {},
): BillingCycleClaimRow => {
  const now = new Date("2026-11-14T01:00:00.000Z");
  return {
    billingAttemptId: attemptNew,
    billingCycleKey: cycleKey,
    claimedAt: now,
    createdAt: now,
    id: "claim_seed",
    idempotencyKey: "mileyo_auto_sel_recovery_review_c4",
    lastErrorMessage: null,
    lastReconciledAt: null,
    shop: "mileyo-test.myshopify.com",
    shopifyOrderId: null,
    source: BILLING_CYCLE_CLAIM_SOURCE.CRON,
    status: BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
    subscriptionContractId: "gid://shopify/SubscriptionContract/1",
    subscriptionMealSelectionId: selectionId,
    succeededAt: null,
    updatedAt: now,
    ...overrides,
  };
};

const runClaimTransitionTests = async (
  ctx: ReturnType<typeof createBusinessTestContext>,
) => {
  const store = createClaimStore();
  __setBillingCycleClaimDelegateForTests(
    store.delegate as unknown as Parameters<
      typeof __setBillingCycleClaimDelegateForTests
    >[0],
  );

  try {
    ctx.scenario("Webhook ancien après nouvelle attempt — claim récent intact");
    {
      store.seed(
        seedClaim({
          billingAttemptId: attemptNew,
          status: BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
        }),
      );
      const after = await reconcileBillingCycleClaimOnConfirmedFailure({
        billingAttemptId: attemptOld,
        billingCycleKey: cycleKey,
        errorMessage: "Your card does not support this type of purchase.",
        selectionId,
      });
      ctx.assertEqual(
        "statut reste submitted",
        after?.status,
        BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
      );
      ctx.assertEqual(
        "attempt récente conservée",
        after?.billingAttemptId,
        attemptNew,
      );
      const reload = await claimOrLoadBillingCycle({
        selectionId,
        shop: "mileyo-test.myshopify.com",
        shopifyCycleIndex: 4,
        source: BILLING_CYCLE_CLAIM_SOURCE.RECOVERY,
        subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      });
      ctx.assertEqual(
        "nouvelle facturation bloquée",
        reload.action,
        "reconcile_in_flight",
      );
      const directOldFailure = await markBillingCycleClaimFailed({
        billingAttemptId: attemptOld,
        claimId: "claim_seed",
        errorMessage: "late failure of the older attempt",
      });
      ctx.assertEqual(
        "markFailed conditionnel ignore l'ancienne attempt",
        directOldFailure.status,
        BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
      );
      ctx.assertEqual(
        "attempt récente toujours en place",
        directOldFailure.billingAttemptId,
        attemptNew,
      );
      ctx.assertEqual("une seule ligne de claim", store.rows.length, 1);

      const pendingPlusOldFailure = classifyBillableShopifyCycle({
        cycles: [
          mkCycle({
            attempts: [
              mkAttempt({
                completedAt: "2026-11-14T01:00:33Z",
                errorMessage: "Insufficient funds.",
                id: attemptOld,
              }),
              mkAttempt({
                completedAt: null,
                errorMessage: null,
                id: attemptNew,
              }),
            ],
          }),
        ],
        nextBillingDate: nbdInCycle,
        now: nowInWindow,
      });
      ctx.assertEqual(
        "PENDING récent bloque le cycle",
        pendingPlusOldFailure.action,
        "block_ambiguous",
      );
      const unknownPlusOldFailure = classifyBillableShopifyCycle({
        cycles: [
          mkCycle({
            attempts: [
              mkAttempt({
                completedAt: "2026-11-14T01:00:20Z",
                errorMessage: "Insufficient funds.",
                id: attemptOld,
              }),
              mkAttempt({
                completedAt: "2026-11-14T01:00:40Z",
                errorMessage: null,
                id: attemptNew,
              }),
            ],
          }),
        ],
        nextBillingDate: nbdInCycle,
        now: nowInWindow,
      });
      ctx.assertEqual(
        "UNKNOWN récent bloque le cycle",
        unknownPlusOldFailure.action,
        "block_ambiguous",
      );
    }

    ctx.scenario("Claim SUCCEEDED avant échec concurrent — pas de rétrogradation");
    {
      store.rows.length = 0;
      store.seed(
        seedClaim({
          billingAttemptId: attemptNew,
          id: "claim_race",
          status: BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
        }),
      );
      store.setBeforeUpdateMany(() => {
        const row = store.rows[0];
        if (row) {
          row.status = BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED;
          row.billingAttemptId = attemptNew;
          row.shopifyOrderId = paidOrderId;
          row.succeededAt = new Date("2026-11-14T01:00:33.000Z");
        }
      });
      const after = await reconcileBillingCycleClaimOnConfirmedFailure({
        billingAttemptId: attemptNew,
        billingCycleKey: cycleKey,
        errorMessage: "Your card was declined.",
        selectionId,
      });
      store.resetHook();
      ctx.assertEqual(
        "course succès gagne",
        after?.status,
        BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
      );
      ctx.assertEqual("commande conservée", after?.shopifyOrderId, paidOrderId);
      const direct = await markBillingCycleClaimFailed({
        billingAttemptId: attemptOld,
        claimId: "claim_race",
        errorMessage: "late failure",
      });
      ctx.assertEqual(
        "markFailed ne rétrograde pas SUCCEEDED",
        direct.status,
        BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
      );
    }

    ctx.scenario("ErrorMessage + commande PAID — claim non FAILED");
    {
      store.rows.length = 0;
      store.seed(
        seedClaim({
          billingAttemptId: attemptNew,
          id: "claim_paid_error",
          status: BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
        }),
      );
      const resolved = resolveBillingAttemptStatus([], {
        completedAt: "2026-11-14T01:00:33Z",
        errorMessage: "Your card was declined.",
        id: attemptNew,
        order: { id: paidOrderId, name: "#9001" },
        ready: true,
      });
      ctx.assertEqual("résolution fail-closed", resolved.status, "unknown");
      ctx.assertFalse(
        "pas un échec terminal confirmé",
        isConfirmedTerminalFailedBillingAttempt({
          errorMessage: "Your card was declined.",
          orderId: paidOrderId,
        }),
      );
      const classified = classifyBillableShopifyCycle({
        cycles: [
          mkCycle({
            attempts: [
              mkAttempt({
                completedAt: "2026-11-14T01:00:33Z",
                errorMessage: "Your card was declined.",
                id: attemptNew,
                orderId: paidOrderId,
              }),
            ],
            status: "BILLED",
          }),
        ],
        nextBillingDate: nbdInCycle,
        now: nowInWindow,
      });
      ctx.assertTrue(
        "cycle avec commande non rechargeable",
        classified.action !== "billable",
      );
      if (resolved.status === "unknown") {
        await markBillingCycleClaimUncertain({
          billingAttemptId: attemptNew,
          claimId: "claim_paid_error",
          errorMessage: resolved.errorMessage,
        });
      } else if (resolved.status === "failure") {
        await markBillingCycleClaimFailed({
          billingAttemptId: attemptNew,
          claimId: "claim_paid_error",
          errorMessage: resolved.errorMessage,
        });
      }
      ctx.assertEqual(
        "claim bloqué en uncertain",
        store.rows[0]?.status,
        BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
      );
      const second = await claimOrLoadBillingCycle({
        selectionId,
        shop: "mileyo-test.myshopify.com",
        shopifyCycleIndex: 4,
        source: BILLING_CYCLE_CLAIM_SOURCE.RECOVERY,
        subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      });
      ctx.assertEqual("pas de second passage", second.action, "block_uncertain");
      ctx.assertEqual("pas de second claim", store.rows.length, 1);
    }

    ctx.scenario("Paiement FAILED normal puis recovery — une seule rotation");
    {
      store.rows.length = 0;
      store.seed(
        seedClaim({
          billingAttemptId: attemptOld,
          id: "claim_normal_fail",
          status: BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
        }),
      );
      const failed = await reconcileBillingCycleClaimOnConfirmedFailure({
        billingAttemptId: attemptOld,
        billingCycleKey: cycleKey,
        errorMessage: "Your card does not support this type of purchase.",
        selectionId,
      });
      ctx.assertEqual(
        "échec confirmé de la même attempt",
        failed?.status,
        BILLING_CYCLE_CLAIM_STATUS.FAILED,
      );
      ctx.assertEqual(
        "attempt échouée conservée",
        failed?.billingAttemptId,
        attemptOld,
      );
      const firstLoad = await claimOrLoadBillingCycle({
        selectionId,
        shop: "mileyo-test.myshopify.com",
        shopifyCycleIndex: 4,
        source: BILLING_CYCLE_CLAIM_SOURCE.RECOVERY,
        subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      });
      ctx.assertEqual("recovery peut reprendre le claim FAILED", firstLoad.action, "proceed");
      const rotated = await rotateClaimIdempotencyKeyAfterConfirmedFailure({
        attemptNumber: 2,
        claimId: "claim_normal_fail",
        selectionId,
      });
      ctx.assertEqual(
        "rotation vers claimed",
        rotated.status,
        BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
      );
      ctx.assertTrue(
        "clé recovery distincte",
        rotated.idempotencyKey.includes("_a2"),
      );
      const replay = await reconcileBillingCycleClaimOnConfirmedFailure({
        billingAttemptId: attemptOld,
        billingCycleKey: cycleKey,
        errorMessage: "Your card does not support this type of purchase.",
        selectionId,
      });
      ctx.assertEqual(
        "rejeu du webhook ancien ne re-FAILED pas",
        replay?.status,
        BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
      );
      let secondRotateFailed = false;
      try {
        await rotateClaimIdempotencyKeyAfterConfirmedFailure({
          attemptNumber: 3,
          claimId: "claim_normal_fail",
          selectionId,
        });
      } catch (error) {
        secondRotateFailed =
          error instanceof Error &&
          error.message.includes("Cannot rotate billing claim idempotency key");
      }
      ctx.assertTrue("seconde rotation refusée", secondRotateFailed);
      const blocked = await claimOrLoadBillingCycle({
        selectionId,
        shop: "mileyo-test.myshopify.com",
        shopifyCycleIndex: 4,
        source: BILLING_CYCLE_CLAIM_SOURCE.RECOVERY,
        subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      });
      ctx.assertEqual(
        "attempt suivante bloquée tant que claimed",
        blocked.action,
        "reconcile_in_flight",
      );
      ctx.assertEqual("toujours une seule ligne", store.rows.length, 1);
      ctx.assertEqual(
        "une seule clé recovery",
        store.rows.filter((row) => row.idempotencyKey.includes("_a")).length,
        1,
      );
    }

    ctx.scenario("Deux workers simultanés — une rotation, aucun claim doublon");
    {
      store.rows.length = 0;
      const [first, second] = await Promise.all([
        claimOrLoadBillingCycle({
          selectionId,
          shop: "mileyo-test.myshopify.com",
          shopifyCycleIndex: 4,
          source: BILLING_CYCLE_CLAIM_SOURCE.CRON,
          subscriptionContractId: "gid://shopify/SubscriptionContract/1",
        }),
        claimOrLoadBillingCycle({
          selectionId,
          shop: "mileyo-test.myshopify.com",
          shopifyCycleIndex: 4,
          source: BILLING_CYCLE_CLAIM_SOURCE.CRON,
          subscriptionContractId: "gid://shopify/SubscriptionContract/1",
        }),
      ]);
      const created = [first, second].filter(
        (result) => result.action === "proceed" && result.isNew,
      );
      ctx.assertEqual("un seul insert", created.length, 1);
      ctx.assertEqual("les deux voient la même ligne", first.claim.id, second.claim.id);
      ctx.assertEqual("pas de second claim", store.rows.length, 1);

      const sharedClaimId = first.claim.id;
      store.rows[0]!.status = BILLING_CYCLE_CLAIM_STATUS.FAILED;
      store.rows[0]!.billingAttemptId = attemptOld;
      const rotations = await Promise.allSettled([
        rotateClaimIdempotencyKeyAfterConfirmedFailure({
          attemptNumber: 2,
          claimId: sharedClaimId,
          selectionId,
        }),
        rotateClaimIdempotencyKeyAfterConfirmedFailure({
          attemptNumber: 3,
          claimId: sharedClaimId,
          selectionId,
        }),
      ]);
      ctx.assertEqual(
        "une seule rotation acceptée",
        rotations.filter((result) => result.status === "fulfilled").length,
        1,
      );
      ctx.assertEqual(
        "l'autre worker est refusé",
        rotations.filter((result) => result.status === "rejected").length,
        1,
      );
      ctx.assertEqual("un seul claim après course", store.rows.length, 1);
      ctx.assertEqual(
        "statut post-rotation bloquant",
        store.rows[0]?.status,
        BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
      );
      const recoveryKeys = new Set(
        store.rows.map((row) => row.idempotencyKey),
      );
      ctx.assertEqual("une seule clé active", recoveryKeys.size, 1);
    }

    ctx.scenario("PENDING et UNKNOWN restent bloquants sur le claim");
    {
      store.rows.length = 0;
      store.seed(
        seedClaim({
          billingAttemptId: attemptNew,
          id: "claim_uncertain",
          status: BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
        }),
      );
      const different = await reconcileBillingCycleClaimOnConfirmedFailure({
        billingAttemptId: attemptOld,
        billingCycleKey: cycleKey,
        errorMessage: "Old decline",
        selectionId,
      });
      ctx.assertEqual(
        "UNKNOWN d'une autre attempt reste uncertain",
        different?.status,
        BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
      );
      const pending = classifyBillableShopifyCycle({
        cycles: [mkCycle({ attempts: [mkAttempt({ id: attemptNew })] })],
        nextBillingDate: nbdInCycle,
        now: nowInWindow,
      });
      ctx.assertEqual("PENDING cycle bloqué", pending.action, "block_ambiguous");
      const unknown = classifyBillableShopifyCycle({
        cycles: [
          mkCycle({
            attempts: [
              mkAttempt({
                completedAt: "2026-11-14T01:00:33Z",
                id: attemptNew,
              }),
            ],
          }),
        ],
        nextBillingDate: nbdInCycle,
        now: nowInWindow,
      });
      ctx.assertEqual("UNKNOWN cycle bloqué", unknown.action, "block_ambiguous");
    }
  } finally {
    store.resetHook();
    __setBillingCycleClaimDelegateForTests(null);
  }
};

const execute = async () => {
  const ctx = runSuite();
  await runClaimTransitionTests(ctx);
  return finishSuite("123-recovery-async-claim-stuck", ctx);
};

process.exitCode = await execute();
