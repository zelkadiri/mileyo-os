/**
 * Patch 1.1 — hardening proofs (payment recovery + cron fail-closed).
 *
 * Usage: npx tsx scripts/dev-patch11-hardening-tests.ts
 */
import db from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import { findSubscriptionMealSelectionByContractId } from "../app/services/subscriptionMealSelection.server";
import {
  processDueRecoveryRetries,
  RECOVERY_STATUS,
} from "../app/services/subscriptionPaymentRecovery.server";
import { processDueSubscriptionBillings } from "../app/services/subscriptionBillingWorker.server";

const SHOP = "mileyo-ok1bszwz.myshopify.com";
const REFERENCE_CONTRACT_ID = "25688637580";
const CANCELLED_CONTRACT_ID = "25507627148";

const snapshotSelection = async (contractId: string) => {
  const selection = await findSubscriptionMealSelectionByContractId({
    shop: SHOP,
    subscriptionContractId: contractId,
  });

  return selection
    ? {
        active: selection.active,
        id: selection.id,
        lastBillingAttemptAt: selection.lastBillingAttemptAt?.toISOString() ?? null,
        lastBillingAttemptId: selection.lastBillingAttemptId,
        mealsCount: selection.mealsCount,
        nextBillingDate: selection.nextBillingDate?.toISOString() ?? null,
        selectedMealsLength: Array.isArray(selection.selectedMeals)
          ? selection.selectedMeals.length
          : null,
        status: selection.status,
        subscriptionContractId: selection.subscriptionContractId,
      }
    : null;
};

const ensureDueRecovery = async ({
  contractId,
  status,
}: {
  contractId: string;
  status: string;
}) => {
  const selection = await findSubscriptionMealSelectionByContractId({
    shop: SHOP,
    subscriptionContractId: contractId,
  });

  if (!selection) {
    throw new Error(`Selection not found for contract ${contractId}`);
  }

  await db.subscriptionMealSelection.update({
    data: { status, active: false },
    where: { id: selection.id },
  });

  const billingCycleKey = `mileyo_patch11_${selection.id}`;
  const past = new Date(Date.now() - 60_000);

  await db.subscriptionPaymentRecovery.upsert({
    create: {
      billingCycleKey,
      failureCount: 1,
      lastFailureAt: past,
      nextRetryAt: past,
      shop: SHOP,
      status: RECOVERY_STATUS.RETRY_SCHEDULED,
      subscriptionMealSelectionId: selection.id,
    },
    update: {
      failureCount: 1,
      lastFailureAt: past,
      nextRetryAt: past,
      status: RECOVERY_STATUS.RETRY_SCHEDULED,
    },
    where: {
      subscriptionMealSelectionId_billingCycleKey: {
        billingCycleKey,
        subscriptionMealSelectionId: selection.id,
      },
    },
  });

  return selection.id;
};

const logStep = (title: string, data: unknown) => {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
};

const withInvalidShopToken = async <T>(fn: () => Promise<T>) => {
  const sessions = await db.session.findMany({
    where: { shop: SHOP },
  });
  const savedTokens = new Map(sessions.map((session) => [session.id, session.accessToken]));

  await db.session.updateMany({
    data: { accessToken: "invalid_patch11_token" },
    where: { shop: SHOP },
  });

  try {
    return await fn();
  } finally {
    for (const [sessionId, accessToken] of savedTokens) {
      await db.session.update({
        data: { accessToken },
        where: { id: sessionId },
      });
    }
  }
};

const runScenario1CancelledRecovery = async (
  admin: Parameters<typeof processDueRecoveryRetries>[1],
) => {
  await ensureDueRecovery({
    contractId: CANCELLED_CONTRACT_ID,
    status: "cancelled",
  });

  const before = await snapshotSelection(CANCELLED_CONTRACT_ID);
  const summary = await processDueRecoveryRetries(SHOP, admin);
  const after = await snapshotSelection(CANCELLED_CONTRACT_ID);

  logStep("Scenario 1 — cancelled + recovery due", {
    after,
    before,
    recoverySkipReasons: summary.skipReasons,
    retried: summary.retried,
    skipped: summary.skipped,
    terminalDiagnostics: summary.diagnostics.filter(
      (item) => item.branch === "terminal_contract",
    ),
  });

  return {
    ok:
      summary.skipReasons.terminal_contract >= 1 &&
      summary.retried === 0 &&
      before?.lastBillingAttemptId === after?.lastBillingAttemptId,
  };
};

const runScenario2ExpiredRecovery = async (
  admin: Parameters<typeof processDueRecoveryRetries>[1],
) => {
  const disposable = await db.subscriptionMealSelection.findFirst({
    where: {
      shop: SHOP,
      subscriptionContractId: { not: REFERENCE_CONTRACT_ID },
      status: { not: "archived_duplicate" },
    },
  });

  if (!disposable?.subscriptionContractId) {
    throw new Error("No disposable selection for expired scenario");
  }

  const contractId = disposable.subscriptionContractId;
  await ensureDueRecovery({ contractId, status: "expired" });

  const before = await snapshotSelection(contractId);
  const summary = await processDueRecoveryRetries(SHOP, admin);
  const after = await snapshotSelection(contractId);

  logStep("Scenario 2 — expired + recovery due", {
    after,
    before,
    contractId,
    recoverySkipReasons: summary.skipReasons,
    retried: summary.retried,
    skipped: summary.skipped,
    terminalDiagnostics: summary.diagnostics.filter(
      (item) => item.branch === "terminal_contract",
    ),
  });

  return {
    ok:
      summary.skipReasons.terminal_contract >= 1 &&
      summary.retried === 0 &&
      before?.lastBillingAttemptId === after?.lastBillingAttemptId,
  };
};

const runScenario3CronSyncError = async () => {
  const activeRecoveryIds = (
    await db.subscriptionPaymentRecovery.findMany({
      select: { subscriptionMealSelectionId: true },
      where: {
        shop: SHOP,
        status: {
          in: [
            RECOVERY_STATUS.PROCESSING,
            RECOVERY_STATUS.RETRY_SCHEDULED,
            RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
            RECOVERY_STATUS.EMAIL_SEND_FAILED,
          ],
        },
      },
    })
  ).map((recovery) => recovery.subscriptionMealSelectionId);

  const disposable = await db.subscriptionMealSelection.findFirst({
    where: {
      id: { notIn: activeRecoveryIds },
      shop: SHOP,
      subscriptionContractId: {
        notIn: [REFERENCE_CONTRACT_ID, CANCELLED_CONTRACT_ID],
      },
      status: { in: ["active", "paused"] },
    },
  });

  if (!disposable?.subscriptionContractId) {
    throw new Error("No disposable selection without recovery for sync error scenario");
  }

  const contractId = disposable.subscriptionContractId;
  const savedState = {
    active: disposable.active,
    nextBillingDate: disposable.nextBillingDate,
    status: disposable.status,
  };
  const before = await snapshotSelection(contractId);
  const dueYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await db.subscriptionMealSelection.update({
    data: {
      active: true,
      nextBillingDate: dueYesterday,
      status: "active",
    },
    where: { id: disposable.id },
  });

  const summary = await withInvalidShopToken(() =>
    processDueSubscriptionBillings(SHOP),
  );

  await db.subscriptionMealSelection.update({
    data: {
      active: savedState.active,
      nextBillingDate: savedState.nextBillingDate,
      status: savedState.status,
    },
    where: { id: disposable.id },
  });

  const after = await snapshotSelection(contractId);

  logStep("Scenario 3 — cron sync error (fail closed)", {
    after,
    before,
    contractId,
    cronSkipReasons: summary.skipReasons,
    processed: summary.processed,
  });

  return {
    ok:
      summary.skipReasons.contract_sync_error >= 1 &&
      before?.status === after?.status &&
      before?.active === after?.active &&
      before?.lastBillingAttemptId === after?.lastBillingAttemptId,
  };
};

const runScenario4CronNormalPath = async () => {
  const summary = await processDueSubscriptionBillings(SHOP);

  logStep("Scenario 4 — cron normal path (shop reachable)", {
    cronSkipReasons: summary.skipReasons,
    errors: summary.errors,
    processed: summary.processed,
    recovery: summary.recovery,
    submitted: summary.submitted,
    success: summary.success,
  });

  return {
    ok: summary.skipReasons.contract_sync_error === 0,
  };
};

const runScenario5ReferenceIntact = async () => {
  const reference = await snapshotSelection(REFERENCE_CONTRACT_ID);

  logStep("Scenario 5 — reference contract intact", reference);

  return {
    ok:
      reference?.status === "active" &&
      reference?.active === true &&
      reference?.subscriptionContractId === REFERENCE_CONTRACT_ID &&
      (reference?.selectedMealsLength ?? 0) > 0,
  };
};

const main = async () => {
  const referenceBefore = await snapshotSelection(REFERENCE_CONTRACT_ID);
  logStep("Reference BEFORE all scenarios", referenceBefore);

  const { admin } = await unauthenticated.admin(SHOP);

  const results = {
    scenario1: await runScenario1CancelledRecovery(admin),
    scenario2: await runScenario2ExpiredRecovery(admin),
    scenario3: await runScenario3CronSyncError(),
    scenario4: await runScenario4CronNormalPath(),
    scenario5: await runScenario5ReferenceIntact(),
  };

  logStep("RESULTS", results);

  if (!Object.values(results).every((result) => result.ok)) {
    process.exitCode = 1;
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
