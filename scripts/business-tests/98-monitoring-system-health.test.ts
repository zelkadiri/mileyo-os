#!/usr/bin/env npx tsx
/**
 * MONITORING-1 — CronRun heartbeat + santé système.
 * Memory CronRunDb + pure classification + static source checks.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CRON_CONSECUTIVE_FAILURES_INCIDENT,
  CRON_ERROR_MESSAGE_MAX_LEN,
  CRON_HEALTH_LEVEL,
  CRON_NAME,
  CRON_NO_SUCCESS_INCIDENT_MS,
  CRON_RUN_STATUS,
  CRON_SILENCE_AFTER_MS,
  CRON_STUCK_RUNNING_MS,
  RECOVERY_OVERDUE_AFTER_MS,
  RECOVERY_PROCESSING_STUCK_AFTER_MS,
} from "../../app/constants/cronRun";
import { RECOVERY_STATUS } from "../../app/constants/subscriptionPaymentRecovery";
import {
  classifyBillingCronHealthLevel,
  mapBillingCronRunSummary,
} from "../../app/services/monitoring/billing-cron-health.server";
import {
  completeCronRunFailure,
  completeCronRunSuccess,
  startCronRun,
  type CronRunDb,
  type CronRunRecord,
} from "../../app/services/monitoring/cron-run.server";
import {
  classifyRecoveryHealthBucket,
  summarizeRecoveryHealthRows,
} from "../../app/services/monitoring/payment-recovery-health.server";
import { runProcessSubscriptionsCron } from "../../app/services/processSubscriptionsCron.server";
import {
  createBusinessTestContext,
  printSuiteResult,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const createMemoryCronRunDb = (): CronRunDb & {
  rows: Map<string, CronRunRecord>;
} => {
  const rows = new Map<string, CronRunRecord>();
  let seq = 0;

  const client: CronRunDb & { rows: Map<string, CronRunRecord> } = {
    cronRun: {
      create: async ({ data }) => {
        const id = `cron_run_${++seq}`;
        const record: CronRunRecord = {
          completedAt: null,
          createdAt: data.startedAt,
          cronName: data.cronName,
          durationMs: null,
          errorCode: null,
          errorCount: null,
          errorMessage: null,
          id,
          processedCount: null,
          shop: data.shop,
          skippedCount: null,
          startedAt: data.startedAt,
          status: data.status,
        };
        rows.set(id, record);
        return record;
      },
      update: async ({ data, where }) => {
        const existing = rows.get(where.id);
        if (!existing) {
          throw new Error(`CronRun ${where.id} not found`);
        }
        const next: CronRunRecord = {
          ...existing,
          completedAt: data.completedAt,
          durationMs: data.durationMs,
          errorCode: data.errorCode ?? existing.errorCode,
          errorCount: data.errorCount ?? existing.errorCount,
          errorMessage: data.errorMessage ?? existing.errorMessage,
          processedCount: data.processedCount ?? existing.processedCount,
          skippedCount: data.skippedCount ?? existing.skippedCount,
          status: data.status,
        };
        rows.set(where.id, next);
        return next;
      },
    },
    rows,
  };

  return client;
};

const createFailingCronRunDb = (): CronRunDb => ({
  cronRun: {
    create: async () => {
      throw new Error("monitoring db unavailable");
    },
    update: async () => {
      throw new Error("monitoring db unavailable");
    },
  },
});

const emptyBillingSummary = () =>
  ({
    errors: 0,
    processed: 2,
    recovery: {
      diagnostics: [],
      errors: 0,
      paused: 0,
      processed: 0,
      recovered: 0,
      retried: 0,
      skipped: 0,
      skipReasons: {
        contract_sync_error: 0,
        terminal_contract: 0,
      },
    },
    skipped: 5,
    skipReasons: {
      contract_sync_error: 0,
      delivery_billing_not_ready: 0,
      missing_contract_id: 0,
      missing_next_billing_date: 0,
      next_billing_date_in_future: 1,
      paused_or_inactive: 0,
      payment_recovery: 0,
      pending_box_change: 0,
      recent_attempt: 0,
      terminal_contract: 0,
    },
    submitted: 1,
    success: 1,
  }) as const;

const run = async () => {
  const ctx = createBusinessTestContext("98-monitoring-system-health");

  ctx.scenario("A. CronRun persistence running / success / failed / counts");
  {
    const client = createMemoryCronRunDb();
    const startedAt = new Date("2026-09-03T10:00:00.000Z");
    const created = await startCronRun({
      client,
      cronName: CRON_NAME.PROCESS_SUBSCRIPTIONS,
      now: startedAt,
      shop: "shop.myshopify.com",
    });
    ctx.assertTrue("running créé", Boolean(created?.id));
    ctx.assertEqual("status running", created?.status, CRON_RUN_STATUS.RUNNING);
    ctx.assertEqual(
      "cronName",
      created?.cronName,
      CRON_NAME.PROCESS_SUBSCRIPTIONS,
    );

    const success = await completeCronRunSuccess({
      client,
      now: new Date("2026-09-03T10:00:05.000Z"),
      runId: created!.id,
      startedAt,
      summary: { errorCount: 1, processedCount: 3, skippedCount: 7 },
    });
    ctx.assertEqual("success status", success?.status, CRON_RUN_STATUS.SUCCESS);
    ctx.assertEqual("durationMs", success?.durationMs, 5000);
    ctx.assertEqual("processedCount", success?.processedCount, 3);
    ctx.assertEqual("skippedCount", success?.skippedCount, 7);
    ctx.assertEqual("errorCount", success?.errorCount, 1);

    const failRun = await startCronRun({
      client,
      cronName: CRON_NAME.PROCESS_SUBSCRIPTIONS,
      now: new Date("2026-09-03T11:00:00.000Z"),
      shop: "shop.myshopify.com",
    });
    const failed = await completeCronRunFailure({
      client,
      errorMessage: "billing worker exploded",
      now: new Date("2026-09-03T11:00:02.000Z"),
      runId: failRun!.id,
      startedAt: new Date("2026-09-03T11:00:00.000Z"),
    });
    ctx.assertEqual("failed status", failed?.status, CRON_RUN_STATUS.FAILED);
    ctx.assertEqual("errorCode", failed?.errorCode, "cron_exception");
    ctx.assertEqual(
      "errorMessage",
      failed?.errorMessage,
      "billing worker exploded",
    );
  }

  ctx.scenario("B. Persistence failure fail-open");
  {
    process.env.CRON_SECRET = "test-secret";
    process.env.CRON_SHOP = "shop.myshopify.com";
    const response = await runProcessSubscriptionsCron(
      new Request(
        "https://example.com/api/cron/process-subscriptions?secret=test-secret",
      ),
      {
        cronRunClient: createFailingCronRunDb(),
        processDueMealSelectionReminders: async () => ({ scanned: 0 }) as never,
        processDueSubscriptionBillings: async () => emptyBillingSummary() as never,
        processDueUpcomingDeliveryEmails: async () => ({ scanned: 0 }) as never,
      },
    );
    ctx.assertEqual("fail-open HTTP 200", response.status, 200);
    const body = (await response.json()) as { processed?: number; runId?: string | null };
    ctx.assertEqual("processed métier intact", body.processed, 2);
    ctx.assertNull("runId null si start échoue", body.runId ?? null);
  }

  ctx.scenario("C. Aucun PII dans CronRun / monitoring");
  {
    const schema = readRepoFile("prisma/schema.prisma");
    const modelStart = schema.indexOf("model CronRun");
    const modelEnd = schema.indexOf("\n}", modelStart);
    ctx.assertTrue("model CronRun présent", modelStart >= 0 && modelEnd > modelStart);
    const modelChunk = schema.slice(modelStart, modelEnd).toLowerCase();
    ctx.assertFalse("pas email", modelChunk.includes("email"));
    ctx.assertFalse("pas recipient", modelChunk.includes("recipient"));
    ctx.assertFalse("pas payload", modelChunk.includes("payload"));
    ctx.assertFalse("pas token", modelChunk.includes("token"));
    ctx.assertTrue("shop présent", modelChunk.includes("shop"));
    ctx.assertTrue("cronName présent", modelChunk.includes("cronname"));

    const render = readRepoFile(
      "app/features/monitoring/monitoring-render.tsx",
    );
    ctx.assertFalse(
      "UI sans customerEmail",
      render.includes("customerEmail") || render.includes("recipientEmail"),
    );
    ctx.assertTrue("titre Santé système", render.includes("Santé système"));
    ctx.assertTrue(
      "trois blocs",
      render.includes("Facturation automatique") &&
        render.includes("Emails") &&
        render.includes("Recoveries paiement"),
    );
  }

  ctx.scenario("D. Health billing classification");
  {
    const now = new Date("2026-09-03T12:00:00.000Z");

    ctx.assertEqual(
      "aucun run → awaiting_first_run",
      classifyBillingCronHealthLevel({
        consecutiveFailedCount: 0,
        hasAnyRun: false,
        lastRun: null,
        lastSuccessAt: null,
        now,
      }),
      CRON_HEALTH_LEVEL.AWAITING_FIRST_RUN,
    );

    const recentSuccessAt = new Date(now.getTime() - 30 * 60 * 1000);
    const successRun = {
      completedAt: recentSuccessAt,
      durationMs: 100,
      errorCode: null,
      errorCount: 0,
      errorMessage: null,
      id: "r1",
      processedCount: 1,
      skippedCount: 0,
      startedAt: recentSuccessAt,
      status: CRON_RUN_STATUS.SUCCESS,
    };
    ctx.assertEqual(
      "succès <2h → OK",
      classifyBillingCronHealthLevel({
        consecutiveFailedCount: 0,
        hasAnyRun: true,
        lastRun: successRun,
        lastSuccessAt: recentSuccessAt,
        now,
      }),
      CRON_HEALTH_LEVEL.OK,
    );

    const silentAt = new Date(
      now.getTime() - CRON_SILENCE_AFTER_MS - 60_000,
    );
    ctx.assertEqual(
      "silence >2h → attention",
      classifyBillingCronHealthLevel({
        consecutiveFailedCount: 0,
        hasAnyRun: true,
        lastRun: { ...successRun, startedAt: silentAt, completedAt: silentAt },
        lastSuccessAt: silentAt,
        now,
      }),
      CRON_HEALTH_LEVEL.ATTENTION,
    );

    const noSuccessAt = new Date(
      now.getTime() - CRON_NO_SUCCESS_INCIDENT_MS - 1000,
    );
    ctx.assertEqual(
      ">4h sans succès → incident",
      classifyBillingCronHealthLevel({
        consecutiveFailedCount: 0,
        hasAnyRun: true,
        lastRun: {
          ...successRun,
          startedAt: noSuccessAt,
          status: CRON_RUN_STATUS.SUCCESS,
        },
        lastSuccessAt: noSuccessAt,
        now,
      }),
      CRON_HEALTH_LEVEL.INCIDENT,
    );

    const runningFresh = {
      ...successRun,
      id: "running-fresh",
      startedAt: new Date(now.getTime() - 5 * 60 * 1000),
      status: CRON_RUN_STATUS.RUNNING,
      completedAt: null,
    };
    ctx.assertEqual(
      "running <15min → OK (succès récent)",
      classifyBillingCronHealthLevel({
        consecutiveFailedCount: 0,
        hasAnyRun: true,
        lastRun: runningFresh,
        lastSuccessAt: recentSuccessAt,
        now,
      }),
      CRON_HEALTH_LEVEL.OK,
    );
    ctx.assertFalse(
      "running <15min not stuck",
      mapBillingCronRunSummary(runningFresh, now).isStuckRunning,
    );

    const runningStale = {
      ...runningFresh,
      id: "running-stale",
      startedAt: new Date(now.getTime() - CRON_STUCK_RUNNING_MS - 1000),
    };
    ctx.assertTrue(
      "running >15min stuck",
      mapBillingCronRunSummary(runningStale, now).isStuckRunning,
    );
    ctx.assertEqual(
      "running >15min → attention",
      classifyBillingCronHealthLevel({
        consecutiveFailedCount: 0,
        hasAnyRun: true,
        lastRun: runningStale,
        lastSuccessAt: recentSuccessAt,
        now,
      }),
      CRON_HEALTH_LEVEL.ATTENTION,
    );

    const failedRun = {
      ...successRun,
      id: "fail-1",
      startedAt: new Date(now.getTime() - 10 * 60 * 1000),
      status: CRON_RUN_STATUS.FAILED,
    };
    ctx.assertEqual(
      "1 fail → attention",
      classifyBillingCronHealthLevel({
        consecutiveFailedCount: 1,
        hasAnyRun: true,
        lastRun: failedRun,
        lastSuccessAt: recentSuccessAt,
        now,
      }),
      CRON_HEALTH_LEVEL.ATTENTION,
    );
    ctx.assertEqual(
      "2 fails consécutifs → incident",
      classifyBillingCronHealthLevel({
        consecutiveFailedCount: CRON_CONSECUTIVE_FAILURES_INCIDENT,
        hasAnyRun: true,
        lastRun: failedRun,
        lastSuccessAt: recentSuccessAt,
        now,
      }),
      CRON_HEALTH_LEVEL.INCIDENT,
    );
  }

  ctx.scenario("E. Recoveries overdue / stuck / pending / final");
  {
    const now = new Date("2026-09-03T12:00:00.000Z");

    ctx.assertEqual(
      "nextRetryAt futur → pending",
      classifyRecoveryHealthBucket(
        {
          nextRetryAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          status: RECOVERY_STATUS.RETRY_SCHEDULED,
          updatedAt: now,
        },
        now,
      ),
      "pendingCount",
    );

    ctx.assertEqual(
      "overdue >2h → overdue",
      classifyRecoveryHealthBucket(
        {
          nextRetryAt: new Date(
            now.getTime() - RECOVERY_OVERDUE_AFTER_MS - 60_000,
          ),
          status: RECOVERY_STATUS.RETRY_SCHEDULED,
          updatedAt: now,
        },
        now,
      ),
      "overdueCount",
    );

    ctx.assertEqual(
      "processing récent → pending",
      classifyRecoveryHealthBucket(
        {
          nextRetryAt: null,
          status: RECOVERY_STATUS.PROCESSING,
          updatedAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
        now,
      ),
      "pendingCount",
    );

    ctx.assertEqual(
      "processing >1h → stuck",
      classifyRecoveryHealthBucket(
        {
          nextRetryAt: null,
          status: RECOVERY_STATUS.PROCESSING,
          updatedAt: new Date(
            now.getTime() - RECOVERY_PROCESSING_STUCK_AFTER_MS - 1000,
          ),
        },
        now,
      ),
      "processingStuckCount",
    );

    ctx.assertEqual(
      "final_failed → finalFailed",
      classifyRecoveryHealthBucket(
        {
          nextRetryAt: null,
          status: RECOVERY_STATUS.FINAL_FAILED,
          updatedAt: now,
        },
        now,
      ),
      "finalFailedCount",
    );

    ctx.assertNull(
      "recovered exclu",
      classifyRecoveryHealthBucket(
        {
          nextRetryAt: null,
          status: RECOVERY_STATUS.RECOVERED,
          updatedAt: now,
        },
        now,
      ),
    );

    const summary = summarizeRecoveryHealthRows(
      [
        {
          nextRetryAt: new Date(now.getTime() + 3600_000),
          status: RECOVERY_STATUS.RETRY_SCHEDULED,
          updatedAt: now,
        },
        {
          nextRetryAt: new Date(
            now.getTime() - RECOVERY_OVERDUE_AFTER_MS - 1,
          ),
          status: RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
          updatedAt: now,
        },
        {
          nextRetryAt: null,
          status: RECOVERY_STATUS.FINAL_FAILED,
          updatedAt: now,
        },
        {
          nextRetryAt: null,
          status: RECOVERY_STATUS.RECOVERED,
          updatedAt: now,
        },
      ],
      now,
    );
    ctx.assertEqual("summary pending", summary.pendingCount, 1);
    ctx.assertEqual("summary overdue", summary.overdueCount, 1);
    ctx.assertEqual("summary final", summary.finalFailedCount, 1);
    ctx.assertEqual("summary stuck", summary.processingStuckCount, 0);
  }

  ctx.scenario("F. Page monitoring + nav");
  {
    const route = readRepoFile("app/routes/app.monitoring.tsx");
    const nav = readRepoFile("app/routes/app.tsx");
    const data = readRepoFile(
      "app/features/monitoring/monitoring-data.server.ts",
    );
    ctx.assertTrue(
      "route monitoring",
      route.includes("loadMonitoringPageData"),
    );
    ctx.assertTrue(
      "nav Santé système",
      nav.includes('href="/app/monitoring"') &&
        nav.includes(">Santé système</s-link>"),
    );
    ctx.assertTrue(
      "ordre Emails puis Santé",
      nav.indexOf("/app/emails") < nav.indexOf("/app/monitoring") &&
        nav.indexOf("/app/monitoring") <
          nav.indexOf("/app/shopify-notifications"),
    );
    ctx.assertTrue(
      "réutilise loadEmailCronHealth",
      data.includes("loadEmailCronHealth"),
    );
    ctx.assertTrue(
      "charge billing + recoveries",
      data.includes("loadBillingCronHealth") &&
        data.includes("loadPaymentRecoveryHealth"),
    );
    ctx.assertFalse(
      "pas de retry recovery depuis monitoring",
      data.includes("processDueRecoveryRetries") ||
        data.includes("handleEmailsAction"),
    );
  }

  ctx.scenario("G. Cron billing summary persisté / skip ≠ failure");
  {
    process.env.CRON_SECRET = "test-secret";
    process.env.CRON_SHOP = "shop.myshopify.com";
    const client = createMemoryCronRunDb();

    const ok = await runProcessSubscriptionsCron(
      new Request(
        "https://example.com/api/cron/process-subscriptions?secret=test-secret",
      ),
      {
        cronRunClient: client,
        processDueMealSelectionReminders: async () => ({ scanned: 0 }) as never,
        processDueSubscriptionBillings: async () => emptyBillingSummary() as never,
        processDueUpcomingDeliveryEmails: async () => ({ scanned: 0 }) as never,
      },
    );
    ctx.assertEqual("success HTTP 200", ok.status, 200);
    const okBody = (await ok.json()) as { runId?: string; skipped?: number };
    ctx.assertTrue("runId présent", Boolean(okBody.runId));
    const stored = client.rows.get(okBody.runId!);
    ctx.assertEqual("persist success", stored?.status, CRON_RUN_STATUS.SUCCESS);
    ctx.assertEqual("persist processed", stored?.processedCount, 2);
    ctx.assertEqual("persist skipped", stored?.skippedCount, 5);
    ctx.assertEqual("persist errors", stored?.errorCount, 0);
    ctx.assertEqual(
      "business skips ne forcent pas failed",
      stored?.status === CRON_RUN_STATUS.SUCCESS && (okBody.skipped ?? 0) > 0,
      true,
    );

    const failClient = createMemoryCronRunDb();
    const failed = await runProcessSubscriptionsCron(
      new Request(
        "https://example.com/api/cron/process-subscriptions?secret=test-secret",
      ),
      {
        cronRunClient: failClient,
        processDueMealSelectionReminders: async () => ({ scanned: 0 }) as never,
        processDueSubscriptionBillings: async () => {
          throw new Error("outer boom");
        },
        processDueUpcomingDeliveryEmails: async () => ({ scanned: 0 }) as never,
      },
    );
    ctx.assertEqual("outer → 500", failed.status, 500);
    const failBody = (await failed.json()) as { runId?: string };
    const failStored = failClient.rows.get(failBody.runId!);
    ctx.assertEqual(
      "outer → CronRun failed",
      failStored?.status,
      CRON_RUN_STATUS.FAILED,
    );
    ctx.assertEqual(
      "error message tronqué possible",
      (failStored?.errorMessage?.length ?? 0) <= CRON_ERROR_MESSAGE_MAX_LEN,
      true,
    );
  }

  ctx.scenario("H. Migration additive CronRun seulement");
  {
    const migration = readRepoFile(
      "prisma/migrations/20260903120000_add_cron_run/migration.sql",
    );
    ctx.assertTrue(
      "CREATE CronRun",
      migration.includes('CREATE TABLE "CronRun"'),
    );
    ctx.assertFalse("pas DROP", /drop\s+table/i.test(migration));
    ctx.assertFalse(
      "ne touche pas EmailCronRun",
      migration.includes("EmailCronRun"),
    );
    ctx.assertTrue(
      "indexes shop+cronName",
      migration.includes("CronRun_shop_cronName_startedAt_idx") &&
        migration.includes("CronRun_shop_cronName_status_startedAt_idx"),
    );
  }

  ctx.scenario("I. Pas de Sentry check-ins dans MONITORING-1");
  {
    const cron = readRepoFile("app/services/processSubscriptionsCron.server.ts");
    const sentry = readRepoFile("app/services/observability/sentry.server.ts");
    ctx.assertFalse("pas captureCheckIn", cron.includes("captureCheckIn"));
    ctx.assertFalse("pas withMonitor", cron.includes("withMonitor"));
    ctx.assertFalse(
      "sentry.server inchangé check-in",
      sentry.includes("captureCheckIn") || sentry.includes("withMonitor"),
    );
  }

  const result = ctx.finish();
  printSuiteResult(result);
  process.exitCode = result.failed > 0 ? 1 : 0;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
