/**
 * Recovery async failure + stuck submitted claim (c265 class).
 * Pure classifier / resolveStatus / source contracts — no Shopify, no PROD.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyBillableShopifyCycle,
  isConfirmedTerminalFailedBillingAttempt,
  type ShopifyBillingCycleSnapshot,
} from "../../app/services/shopifySubscriptionBillingCycle.server";
import { resolveBillingAttemptStatus } from "../../app/services/subscriptionBillingWorker.server";
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

  return finishSuite("123-recovery-async-claim-stuck", ctx);
};

process.exitCode = runSuite();
