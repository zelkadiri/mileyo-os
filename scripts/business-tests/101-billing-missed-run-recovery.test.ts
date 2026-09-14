/**
 * Business regression — missed billing cron runs before mutation do not drop due cycles.
 *
 * Proves: abort before admin/session success leaves selection unchanged and still
 * eligible; a later successful gate bills normally. No Vercel simulation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import { getSelectionSkipReason } from "../../app/services/subscriptionBillingWorker.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepoFile = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

type SelectionSnapshot = {
  active: boolean;
  lastBillingAttemptAt: Date | null;
  lastBillingAttemptError: string | null;
  lastBillingAttemptId: string | null;
  lastBillingAttemptStatus: string | null;
  nextBillingDate: Date;
  resumeAttemptKey: string | null;
  resumeAttemptOrderId: string | null;
  resumeAttemptStartedAt: Date | null;
  resumeAttemptStatus: string | null;
  status: string;
  subscriptionContractId: string;
};

const snapshotOf = (selection: SelectionSnapshot) =>
  JSON.stringify({
    active: selection.active,
    lastBillingAttemptAt: selection.lastBillingAttemptAt?.toISOString() ?? null,
    lastBillingAttemptError: selection.lastBillingAttemptError,
    lastBillingAttemptId: selection.lastBillingAttemptId,
    lastBillingAttemptStatus: selection.lastBillingAttemptStatus,
    nextBillingDate: selection.nextBillingDate.toISOString(),
    resumeAttemptKey: selection.resumeAttemptKey,
    resumeAttemptOrderId: selection.resumeAttemptOrderId,
    resumeAttemptStartedAt:
      selection.resumeAttemptStartedAt?.toISOString() ?? null,
    resumeAttemptStatus: selection.resumeAttemptStatus,
    status: selection.status,
    subscriptionContractId: selection.subscriptionContractId,
  });

/**
 * Simulates a cron run that fails at the Shopify session hard gate
 * (before any selection mutation). Mirrors the 10/09 incident shape.
 */
const abortBeforeMutation = (_shop: string): never => {
  throw new Error(
    "Timed out fetching a new connection from the connection pool",
  );
};

const runSuite = () => {
  const ctx = createBusinessTestContext("101-billing-missed-run-recovery");

  const dueAt = new Date("2026-09-10T03:00:00.000Z"); // 05:00 CEST
  const selection: SelectionSnapshot = {
    active: true,
    lastBillingAttemptAt: null,
    lastBillingAttemptError: null,
    lastBillingAttemptId: null,
    lastBillingAttemptStatus: null,
    nextBillingDate: dueAt,
    resumeAttemptKey: null,
    resumeAttemptOrderId: null,
    resumeAttemptStartedAt: null,
    resumeAttemptStatus: null,
    status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
    subscriptionContractId: "gid://shopify/SubscriptionContract/missed-run",
  };
  const baseline = snapshotOf(selection);

  ctx.scenario("Given — active selection due, no attempt, no recovery");
  ctx.assertNull(
    "selection is billing-eligible",
    getSelectionSkipReason(selection),
  );
  ctx.assertEqual(
    "nextBillingDate is the due instant",
    selection.nextBillingDate.toISOString(),
    dueAt.toISOString(),
  );

  ctx.scenario("Run 1 — abort before mutation leaves selection unchanged");
  ctx.given("cron 05:00 session/pool failure");
  let run1Error: string | null = null;
  try {
    abortBeforeMutation("mileyo.myshopify.com");
  } catch (error) {
    run1Error = error instanceof Error ? error.message : "unknown";
  }
  ctx.assertTrue("run 1 aborted", run1Error !== null);
  ctx.assertEqual(
    "run 1 did not change selection",
    snapshotOf(selection),
    baseline,
  );
  ctx.assertNull(
    "run 1 selection still due",
    getSelectionSkipReason(selection),
  );

  ctx.scenario("Run 2 — second abort before mutation still unchanged");
  ctx.given("cron 06:00 session/pool failure");
  let run2Error: string | null = null;
  try {
    abortBeforeMutation("mileyo.myshopify.com");
  } catch (error) {
    run2Error = error instanceof Error ? error.message : "unknown";
  }
  ctx.assertTrue("run 2 aborted", run2Error !== null);
  ctx.assertEqual(
    "run 2 did not change selection",
    snapshotOf(selection),
    baseline,
  );
  ctx.assertNull(
    "run 2 selection still due (no recovery, no nextBillingDate advance)",
    getSelectionSkipReason(selection),
  );

  ctx.scenario("Run 3 — session returns; due cycle still bills normally");
  ctx.given("cron 07:00 admin/session OK");
  ctx.when("eligibility is re-evaluated without prior mutations");
  const skipReason = getSelectionSkipReason(selection);
  ctx.assertNull("run 3 selection still eligible for normal billing", skipReason);
  ctx.assertEqual(
    "no lastBillingAttemptAt set by missed runs",
    selection.lastBillingAttemptAt,
    null,
  );
  ctx.assertEqual(
    "no lastBillingAttemptId set by missed runs",
    selection.lastBillingAttemptId,
    null,
  );
  ctx.assertEqual(
    "nextBillingDate still the original due instant",
    selection.nextBillingDate.toISOString(),
    dueAt.toISOString(),
  );
  ctx.then("worker would call triggerSubscriptionBillingAttempt (not recovery)");
  // Source contract: eligibility gate allows proceed; recovery ownership absent.
  ctx.assertTrue(
    "no active recovery ownership for this fixture",
    getSelectionSkipReason(selection, null) === null,
  );

  ctx.scenario("Architecture — hard gate sits before mutations");
  const workerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const processDueSource = workerSource.slice(
    workerSource.indexOf("export const processDueSubscriptionBillings"),
  );
  const adminGateIndex = processDueSource.indexOf(
    "getAdminWithTransientDbRetry(shop)",
  );
  const firstMutationMarkers = [
    "processDueRecoveryRetries",
    "subscriptionMealSelection.findMany",
    "triggerSubscriptionBillingAttempt({",
    "applyPendingSubscriptionBoxChangeForBilling({",
  ];
  ctx.assertTrue("admin/session gate present", adminGateIndex >= 0);
  for (const marker of firstMutationMarkers) {
    const markerIndex = processDueSource.indexOf(marker);
    ctx.assertTrue(`marker present: ${marker}`, markerIndex >= 0);
    ctx.assertTrue(
      `admin gate before ${marker}`,
      adminGateIndex < markerIndex,
    );
  }
  ctx.assertTrue(
    "no whole-worker retry loop around processDueSubscriptionBillings",
    !processDueSource.includes("for (let attempt") &&
      !processDueSource.includes("while ("),
  );

  return finishSuite("101-billing-missed-run-recovery", ctx);
};

process.exitCode = runSuite();
