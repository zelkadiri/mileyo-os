/**
 * Patch 3 — meal/box modification lock during billing (unit checks, no Shopify calls).
 * Does not mutate the reference contract 25688637580.
 */
import db from "../app/db.server";
import { RECOVERY_STATUS } from "../app/constants/subscriptionPaymentRecovery";
import { isTerminalSubscriptionSelectionStatus } from "../app/constants/subscriptionMealSelection";
import {
  getSubscriptionModificationBlockReason,
  isInFlightBillingAttemptStatus,
} from "../app/services/subscriptionModificationBlock.server";
import {
  RECENT_BILLING_ATTEMPT_WINDOW_MS,
  RESUME_LOCK_STATUS,
} from "../app/services/subscriptionBillingWorker.server";
import { normalizeShopifyId } from "../app/utils/shopifyIds.server";

const REFERENCE_CONTRACT_ID = "25688637580";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });
const fail = (name: string, detail: string) => checks.push({ name, ok: false, detail });

const baseSelection = () => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStatus: null as string | null,
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

function expectBlock(
  name: string,
  reason: ReturnType<typeof getSubscriptionModificationBlockReason>,
  expected: ReturnType<typeof getSubscriptionModificationBlockReason>,
) {
  if (reason === expected) {
    pass(name, `reason=${reason ?? "null"}`);
  } else {
    fail(name, `expected=${expected ?? "null"}, got=${reason ?? "null"}`);
  }
}

async function main() {
  // 1. Active without in-flight attempt → allowed
  expectBlock(
    "active without billing attempt",
    getSubscriptionModificationBlockReason(baseSelection()),
    null,
  );

  // 2. Cron billing in progress → meal/box blocked
  const cronInFlight = {
    ...baseSelection(),
    lastBillingAttemptAt: new Date(),
    lastBillingAttemptStatus: "submitted",
  };
  expectBlock(
    "cron billing in progress blocks meal change",
    getSubscriptionModificationBlockReason(cronInFlight),
    "billing_processing",
  );
  expectBlock(
    "cron billing in progress blocks box change",
    getSubscriptionModificationBlockReason(cronInFlight),
    "billing_processing",
  );

  // 3. Resume payment in flight
  const resumeInFlight = {
    ...baseSelection(),
    resumeAttemptStatus: RESUME_LOCK_STATUS.PROCESSING,
    resumeAttemptOrderId: null,
  };
  expectBlock(
    "resume payment in flight blocks modifications",
    getSubscriptionModificationBlockReason(resumeInFlight),
    "resume_processing",
  );

  // 4. Recovery processing (order being created)
  expectBlock(
    "recovery processing blocks modifications",
    getSubscriptionModificationBlockReason(baseSelection(), {
      status: RECOVERY_STATUS.PROCESSING,
    }),
    "recovery_processing",
  );

  // 5. Recovery scheduled but not processing → allowed
  expectBlock(
    "recovery retry_scheduled does not block",
    getSubscriptionModificationBlockReason(baseSelection(), {
      status: RECOVERY_STATUS.RETRY_SCHEDULED,
    }),
    null,
  );

  // 6. Failed / finished attempt → allowed when contract still active
  const failedRecent = {
    ...baseSelection(),
    lastBillingAttemptAt: new Date(),
    lastBillingAttemptStatus: "failure",
  };
  expectBlock(
    "recent failed billing attempt allows modification",
    getSubscriptionModificationBlockReason(failedRecent),
    null,
  );

  const successRecent = {
    ...baseSelection(),
    lastBillingAttemptAt: new Date(),
    lastBillingAttemptStatus: "success",
  };
  expectBlock(
    "recent successful billing attempt allows modification",
    getSubscriptionModificationBlockReason(successRecent),
    null,
  );

  const unknownRecent = {
    ...baseSelection(),
    lastBillingAttemptAt: new Date(),
    lastBillingAttemptStatus: "unknown",
  };
  expectBlock(
    "recent unknown billing attempt blocks modification",
    getSubscriptionModificationBlockReason(unknownRecent),
    "billing_processing",
  );

  const staleUnknown = {
    ...baseSelection(),
    lastBillingAttemptAt: new Date(
      Date.now() - RECENT_BILLING_ATTEMPT_WINDOW_MS - 60_000,
    ),
    lastBillingAttemptStatus: "unknown",
  };
  expectBlock(
    "stale unknown attempt does not block",
    getSubscriptionModificationBlockReason(staleUnknown),
    null,
  );

  // Expired attempt outside window → allowed even if status was submitted
  const staleSubmitted = {
    ...baseSelection(),
    lastBillingAttemptAt: new Date(
      Date.now() - RECENT_BILLING_ATTEMPT_WINDOW_MS - 60_000,
    ),
    lastBillingAttemptStatus: "submitted",
  };
  expectBlock(
    "stale submitted attempt does not block",
    getSubscriptionModificationBlockReason(staleSubmitted),
    null,
  );

  // 8. Terminal contract — Patch 1 guard is separate; helper does not block terminal by itself
  const terminal = {
    ...baseSelection(),
    status: "cancelled",
    active: false,
  };
  if (getSubscriptionModificationBlockReason(terminal) === null) {
    pass(
      "terminal contract not blocked by modification helper alone",
      "Patch 1 syncAndAssertSubscriptionContractActionAllowed remains authoritative",
    );
  } else {
    fail(
      "terminal contract not blocked by modification helper alone",
      `unexpected block reason=${getSubscriptionModificationBlockReason(terminal)}`,
    );
  }

  if (isTerminalSubscriptionSelectionStatus("cancelled")) {
    pass("terminal status guard available", "cancelled is terminal");
  } else {
    fail("terminal status guard available", "cancelled should be terminal");
  }

  // 9. In-flight status helper
  for (const status of ["submitted", "challenged", "processing", "unknown", RESUME_LOCK_STATUS.PROCESSING]) {
    if (isInFlightBillingAttemptStatus(status)) {
      pass(`in-flight status ${status}`, "recognized");
    } else {
      fail(`in-flight status ${status}`, "not recognized");
    }
  }
  for (const status of ["success", "failure"]) {
    if (!isInFlightBillingAttemptStatus(status)) {
      pass(`terminal billing status ${status}`, "not in-flight");
    } else {
      fail(`terminal billing status ${status}`, "incorrectly in-flight");
    }
  }

  // 10. Reference contract 25688637580 — read-only sanity check
  const reference = await db.subscriptionMealSelection.findFirst({
    where: {
      subscriptionContractId: {
        contains: REFERENCE_CONTRACT_ID,
      },
    },
  });

  if (!reference) {
    pass(
      "reference contract 25688637580",
      "not in local DB — skipped live block check",
    );
  } else if (
    normalizeShopifyId(reference.subscriptionContractId) !== REFERENCE_CONTRACT_ID
  ) {
    fail("reference contract 25688637580", "contract id normalization mismatch");
  } else {
    const recovery = await db.subscriptionPaymentRecovery.findFirst({
      orderBy: { updatedAt: "desc" },
      where: { subscriptionMealSelectionId: reference.id },
    });
    const blockReason = getSubscriptionModificationBlockReason(
      reference,
      recovery,
    );

    if (reference.status === "active" && reference.active && blockReason === null) {
      pass(
        "reference contract 25688637580",
        `active, no modification block (id=${reference.id})`,
      );
    } else if (blockReason) {
      pass(
        "reference contract 25688637580",
        `block reason=${blockReason} reflects current billing state (id=${reference.id})`,
      );
    } else {
      fail(
        "reference contract 25688637580",
        `status=${reference.status} active=${reference.active} block=${blockReason}`,
      );
    }
  }

  const failed = checks.filter((check) => !check.ok);

  console.log("\nPatch 3 — modification block tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
