/**
 * Business regression — EMAIL-6G-C cron health + visual alerting.
 *
 * Memory EmailCronRunDb + pure classification + static source checks.
 * No Resend webhooks, no Slack/email ops alerts, no retry rule changes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  EMAIL_CRON_CONSECUTIVE_FAILURES_INCIDENT,
  EMAIL_CRON_HEALTH_LEVEL,
  EMAIL_CRON_NO_SUCCESS_INCIDENT_MS,
  EMAIL_CRON_RECENT_RUNS_LIMIT,
  EMAIL_CRON_RUN_STATUS,
  EMAIL_CRON_SILENCE_AFTER_MS,
  EMAIL_CRON_STUCK_RUNNING_MS,
} from "../../app/constants/emailCron";
import { EMAIL_EVENT_MAX_ATTEMPTS } from "../../app/constants/emailEvent";
import {
  buildEmailCronAlerts,
  classifyEmailCronHealthLevel,
  mapCronRunSummary,
} from "../../app/features/emails/emails-cron-health.server";
import {
  completeEmailCronRunFailure,
  completeEmailCronRunSuccess,
  startEmailCronRun,
  type EmailCronRunDb,
  type EmailCronRunRecord,
} from "../../app/services/email/email-cron-run.server";
import { runProcessEmailRetriesCron } from "../../app/services/email/processEmailRetriesCron.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const countOccurrences = (source: string, pattern: RegExp): number =>
  (source.match(pattern) || []).length;

const SHOP = "mileyo-dev.myshopify.com";

const emptyWorkerSummary = () => ({
  cancelled: 0,
  claimed: 0,
  errors: [] as [],
  failed: 0,
  reclaimed: 0,
  retried: 0,
  scanned: 0,
  sent: 0,
  skippedNotClaimed: 0,
  unsupported: 0,
});

const createMemoryEmailCronRunDb = (): EmailCronRunDb & {
  rows: Map<string, EmailCronRunRecord>;
} => {
  const rows = new Map<string, EmailCronRunRecord>();

  const client: EmailCronRunDb & { rows: Map<string, EmailCronRunRecord> } = {
    emailCronRun: {
      create: async ({ data }) => {
        const id = randomUUID();
        const record: EmailCronRunRecord = {
          completedAt: null,
          createdAt: data.startedAt,
          durationMs: null,
          errorCode: null,
          errorMessage: null,
          failedCount: null,
          id,
          processedCount: null,
          reclaimedCount: null,
          requeuedCount: null,
          sentCount: null,
          shop: data.shop,
          startedAt: data.startedAt,
          status: data.status,
        };
        rows.set(id, record);
        return { ...record };
      },
      update: async ({ data, where }) => {
        const existing = rows.get(where.id);
        if (!existing) {
          throw new Error(`EmailCronRun ${where.id} not found`);
        }
        const next: EmailCronRunRecord = {
          ...existing,
          completedAt: data.completedAt ?? existing.completedAt,
          durationMs: data.durationMs ?? existing.durationMs,
          errorCode:
            data.errorCode !== undefined ? data.errorCode : existing.errorCode,
          errorMessage:
            data.errorMessage !== undefined
              ? data.errorMessage
              : existing.errorMessage,
          failedCount:
            data.failedCount !== undefined
              ? data.failedCount
              : existing.failedCount,
          processedCount:
            data.processedCount !== undefined
              ? data.processedCount
              : existing.processedCount,
          reclaimedCount:
            data.reclaimedCount !== undefined
              ? data.reclaimedCount
              : existing.reclaimedCount,
          requeuedCount:
            data.requeuedCount !== undefined
              ? data.requeuedCount
              : existing.requeuedCount,
          sentCount:
            data.sentCount !== undefined ? data.sentCount : existing.sentCount,
          status: data.status,
        };
        rows.set(where.id, next);
        return { ...next };
      },
    },
    rows,
  };

  return client;
};

const createFailingEmailCronRunDb = (): EmailCronRunDb => ({
  emailCronRun: {
    create: async () => {
      throw new Error("monitoring db down");
    },
    update: async () => {
      throw new Error("monitoring db down");
    },
  },
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("78-email-cron-health");

  const previousSecret = process.env.CRON_SECRET;
  const previousShop = process.env.CRON_SHOP;

  const restoreEnv = () => {
    if (previousSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previousSecret;
    }
    if (previousShop === undefined) {
      delete process.env.CRON_SHOP;
    } else {
      process.env.CRON_SHOP = previousShop;
    }
  };

  ctx.scenario("A–E. Run créé / success / failed / counts / duration");
  {
    const client = createMemoryEmailCronRunDb();
    const startedAt = new Date("2026-08-25T10:00:00.000Z");
    const created = await startEmailCronRun({
      client,
      now: startedAt,
      shop: SHOP,
    });
    ctx.assertTrue("A. run créé au début", created != null);
    ctx.assertEqual("A. status running", created!.status, EMAIL_CRON_RUN_STATUS.RUNNING);
    ctx.assertEqual("A. shop", created!.shop, SHOP);
    ctx.assertNull("A. completedAt null", created!.completedAt);

    const summary = {
      ...emptyWorkerSummary(),
      claimed: 4,
      failed: 1,
      reclaimed: 2,
      retried: 1,
      scanned: 5,
      sent: 3,
    };
    const completedAt = new Date("2026-08-25T10:00:02.500Z");
    const success = await completeEmailCronRunSuccess({
      client,
      now: completedAt,
      runId: created!.id,
      startedAt,
      summary,
    });
    ctx.assertEqual("B. status success", success!.status, EMAIL_CRON_RUN_STATUS.SUCCESS);
    ctx.assertEqual("D. processed=claimed", success!.processedCount, 4);
    ctx.assertEqual("D. sent", success!.sentCount, 3);
    ctx.assertEqual("D. failed", success!.failedCount, 1);
    ctx.assertEqual("D. requeued=retried", success!.requeuedCount, 1);
    ctx.assertEqual("D. reclaimed", success!.reclaimedCount, 2);
    ctx.assertEqual("E. durationMs", success!.durationMs, 2500);
    ctx.assertTrue("B. completedAt set", success!.completedAt != null);

    const failStarted = new Date("2026-08-25T11:00:00.000Z");
    const failRun = await startEmailCronRun({
      client,
      now: failStarted,
      shop: SHOP,
    });
    const failCompleted = new Date("2026-08-25T11:00:01.000Z");
    const failed = await completeEmailCronRunFailure({
      client,
      errorCode: "cron_exception",
      errorMessage: "worker exploded",
      now: failCompleted,
      runId: failRun!.id,
      startedAt: failStarted,
    });
    ctx.assertEqual("C. status failed", failed!.status, EMAIL_CRON_RUN_STATUS.FAILED);
    ctx.assertEqual("C. errorCode", failed!.errorCode, "cron_exception");
    ctx.assertEqual("C. errorMessage", failed!.errorMessage, "worker exploded");
    ctx.assertEqual("C. durationMs", failed!.durationMs, 1000);
  }

  ctx.scenario("F. Monitoring DB failure n’empêche pas worker métier");
  {
    process.env.CRON_SECRET = "test-secret";
    process.env.CRON_SHOP = SHOP;
    let workerCalled = false;
    const response = await runProcessEmailRetriesCron(
      new Request("https://example.com/api/cron/process-email-retries", {
        headers: { Authorization: "Bearer test-secret" },
      }),
      {
        cronRunClient: createFailingEmailCronRunDb(),
        processDueEmailEvents: async () => {
          workerCalled = true;
          return emptyWorkerSummary();
        },
      },
    );
    ctx.assertTrue("F. worker appelé malgré monitoring down", workerCalled);
    ctx.assertEqual("F. cron HTTP 200", response.status, 200);
    const body = (await response.json()) as { runId: string | null; scanned: number };
    ctx.assertNull("F. runId null (fail-open)", body.runId);
    ctx.assertEqual("F. scanned 0", body.scanned, 0);
  }

  ctx.scenario("G. Aucun PII dans EmailCronRun");
  {
    const schema = readRepoFile("prisma/schema.prisma");
    const modelStart = schema.indexOf("model EmailCronRun");
    const modelEnd = schema.indexOf("\n}", modelStart);
    ctx.assertTrue("model EmailCronRun présent", modelStart >= 0 && modelEnd > modelStart);
    const modelChunk = schema.slice(modelStart, modelEnd);
    const fieldLines = modelChunk
      .split("\n")
      .filter((line) => /^\s+\w+\s+/.test(line) && !line.trim().startsWith("@@"));
    const fieldBlob = fieldLines.join("\n").toLowerCase();
    ctx.assertFalse("G. pas recipientEmail", fieldBlob.includes("recipient"));
    ctx.assertFalse("G. pas metaJson", fieldBlob.includes("metajson"));
    ctx.assertFalse("G. pas providerId", fieldBlob.includes("provider"));
    ctx.assertFalse("G. pas payload", fieldBlob.includes("payload"));
    ctx.assertTrue("G. shop présent", fieldBlob.includes("shop"));
    ctx.assertTrue("G. compteurs présents", fieldBlob.includes("processedcount"));
  }

  ctx.scenario("H–J. Dernier run / success / failed (classification inputs)");
  {
    const now = new Date("2026-08-25T12:00:00.000Z");
    const lastSuccessAt = new Date("2026-08-25T11:05:00.000Z");
    const lastRun = {
      completedAt: lastSuccessAt,
      durationMs: 100,
      errorCode: null,
      errorMessage: null,
      failedCount: 0,
      id: "run-1",
      processedCount: 1,
      reclaimedCount: 0,
      requeuedCount: 0,
      sentCount: 1,
      startedAt: lastSuccessAt,
      status: EMAIL_CRON_RUN_STATUS.SUCCESS,
    };
    const mapped = mapCronRunSummary(lastRun, now);
    ctx.assertEqual("H. last run status", mapped.status, "success");
    ctx.assertFalse("H. not stuck", mapped.isStuckRunning);

    const levelOk = classifyEmailCronHealthLevel({
      consecutiveFailedCount: 0,
      lastRun,
      lastSuccessAt,
      now,
    });
    ctx.assertEqual("L. health OK", levelOk, EMAIL_CRON_HEALTH_LEVEL.OK);

    const failedRun = {
      ...lastRun,
      id: "run-fail",
      startedAt: new Date("2026-08-25T11:30:00.000Z"),
      status: EMAIL_CRON_RUN_STATUS.FAILED,
    };
    const levelAttention = classifyEmailCronHealthLevel({
      consecutiveFailedCount: 1,
      lastRun: failedRun,
      lastSuccessAt,
      now,
    });
    ctx.assertEqual(
      "M. health attention (last failed)",
      levelAttention,
      EMAIL_CRON_HEALTH_LEVEL.ATTENTION,
    );

    const levelIncident = classifyEmailCronHealthLevel({
      consecutiveFailedCount: EMAIL_CRON_CONSECUTIVE_FAILURES_INCIDENT,
      lastRun: failedRun,
      lastSuccessAt,
      now,
    });
    ctx.assertEqual(
      "M. health incident (consecutive failed)",
      levelIncident,
      EMAIL_CRON_HEALTH_LEVEL.INCIDENT,
    );

    const staleSuccess = new Date(
      now.getTime() - EMAIL_CRON_NO_SUCCESS_INCIDENT_MS - 1000,
    );
    const levelNoSuccess = classifyEmailCronHealthLevel({
      consecutiveFailedCount: 0,
      lastRun: {
        ...lastRun,
        startedAt: staleSuccess,
        status: EMAIL_CRON_RUN_STATUS.SUCCESS,
      },
      lastSuccessAt: staleSuccess,
      now,
    });
    ctx.assertEqual(
      "M. health incident (no success >4h)",
      levelNoSuccess,
      EMAIL_CRON_HEALTH_LEVEL.INCIDENT,
    );

    ctx.assertTrue("J. last failed distinguishable", failedRun.status === "failed");
    ctx.assertTrue("I. last success distinguishable", lastRun.status === "success");
  }

  ctx.scenario("K. Silence >2h");
  {
    const now = new Date("2026-08-25T14:00:00.000Z");
    const oldRunStarted = new Date(
      now.getTime() - EMAIL_CRON_SILENCE_AFTER_MS - 60_000,
    );
    const lastSuccessAt = oldRunStarted;
    const lastRun = {
      completedAt: oldRunStarted,
      durationMs: 50,
      errorCode: null,
      errorMessage: null,
      failedCount: 0,
      id: "old",
      processedCount: 0,
      reclaimedCount: 0,
      requeuedCount: 0,
      sentCount: 0,
      startedAt: oldRunStarted,
      status: EMAIL_CRON_RUN_STATUS.SUCCESS,
    };
    // success within 4h window? oldRun is >2h but maybe <4h
    const within4h = now.getTime() - lastSuccessAt.getTime() < EMAIL_CRON_NO_SUCCESS_INCIDENT_MS;
    ctx.assertTrue("silence window < incident window", within4h);
    const level = classifyEmailCronHealthLevel({
      consecutiveFailedCount: 0,
      lastRun,
      lastSuccessAt,
      now,
    });
    ctx.assertEqual("K. silence → attention", level, EMAIL_CRON_HEALTH_LEVEL.ATTENTION);

    const alerts = buildEmailCronAlerts({
      exhaustedCount: 0,
      failedCount: 0,
      lastRun: mapCronRunSummary(lastRun, now),
      lastSuccessAt: lastSuccessAt.toISOString(),
      now,
      staleProcessingCount: 0,
    });
    ctx.assertTrue(
      "K. alerte silence",
      alerts.some((a) => a.id === "cron_silence"),
    );
    ctx.assertTrue(
      "K. message silence",
      alerts.some((a) =>
        a.message.includes("n’a pas été observé récemment"),
      ),
    );
  }

  ctx.scenario("N–Q. Alertes stale / failed / exhausted / no anomaly");
  {
    const now = new Date("2026-08-25T12:00:00.000Z");
    const freshSuccess = {
      completedAt: now.toISOString(),
      durationMs: 100,
      errorCode: null,
      errorMessage: null,
      failedCount: 0,
      id: "fresh",
      isStuckRunning: false,
      processedCount: 1,
      reclaimedCount: 0,
      requeuedCount: 0,
      sentCount: 1,
      startedAt: now.toISOString(),
      status: EMAIL_CRON_RUN_STATUS.SUCCESS,
    };

    const none = buildEmailCronAlerts({
      exhaustedCount: 0,
      failedCount: 0,
      lastRun: freshSuccess,
      lastSuccessAt: now.toISOString(),
      now,
      staleProcessingCount: 0,
    });
    ctx.assertEqual("Q. no anomaly", none.length, 0);

    const withFailed = buildEmailCronAlerts({
      exhaustedCount: 0,
      failedCount: 3,
      lastRun: freshSuccess,
      lastSuccessAt: now.toISOString(),
      now,
      staleProcessingCount: 0,
    });
    ctx.assertTrue(
      "O. failed alert",
      withFailed.some(
        (a) => a.id === "email_failed" && a.message === "3 emails en échec",
      ),
    );
    ctx.assertTrue(
      "O. failed href",
      withFailed.some((a) => a.href === "/app/emails?status=failed"),
    );

    const withExhausted = buildEmailCronAlerts({
      exhaustedCount: 1,
      failedCount: 1,
      lastRun: freshSuccess,
      lastSuccessAt: now.toISOString(),
      now,
      staleProcessingCount: 0,
    });
    ctx.assertTrue(
      "P. exhausted alert",
      withExhausted.some(
        (a) => a.id === "email_exhausted" && a.message === "1 email épuisé",
      ),
    );

    const withStale = buildEmailCronAlerts({
      exhaustedCount: 0,
      failedCount: 0,
      lastRun: freshSuccess,
      lastSuccessAt: now.toISOString(),
      now,
      staleProcessingCount: 2,
    });
    ctx.assertTrue(
      "N. stale processing alert",
      withStale.some(
        (a) =>
          a.id === "email_stale_processing" &&
          a.message === "2 emails potentiellement bloqués" &&
          a.href === "/app/emails?status=processing",
      ),
    );

    const stuckRunning = mapCronRunSummary(
      {
        completedAt: null,
        durationMs: null,
        errorCode: null,
        errorMessage: null,
        failedCount: null,
        id: "stuck",
        processedCount: null,
        reclaimedCount: null,
        requeuedCount: null,
        sentCount: null,
        startedAt: new Date(now.getTime() - EMAIL_CRON_STUCK_RUNNING_MS - 1000),
        status: EMAIL_CRON_RUN_STATUS.RUNNING,
      },
      now,
    );
    ctx.assertTrue("stuck flag", stuckRunning.isStuckRunning);
    const stuckAlerts = buildEmailCronAlerts({
      exhaustedCount: 0,
      failedCount: 0,
      lastRun: stuckRunning,
      lastSuccessAt: now.toISOString(),
      now,
      staleProcessingCount: 0,
    });
    ctx.assertTrue(
      "stuck alert message",
      stuckAlerts.some((a) => a.message === "Run potentiellement interrompu"),
    );
  }

  ctx.scenario("R. Recent runs list limit");
  {
    ctx.assertEqual("R. limit historique", EMAIL_CRON_RECENT_RUNS_LIMIT, 10);
    const render = readRepoFile("app/features/emails/emails-render.tsx");
    ctx.assertTrue(
      "R. UI derniers runs",
      render.includes("Derniers runs") &&
        render.includes("cronHealth.recentRuns"),
    );
  }

  ctx.scenario("S–T. Auth admin + health UI read-only");
  {
    const route = readRepoFile("app/routes/app.emails.tsx");
    const render = readRepoFile("app/features/emails/emails-render.tsx");
    const data = readRepoFile("app/features/emails/emails-data.server.ts");
    ctx.assertTrue(
      "S. authenticate admin loader",
      data.includes("authenticate.admin") || route.includes("authenticate.admin"),
    );
    ctx.assertTrue(
      "S. loadEmailsPageData",
      route.includes("loadEmailsPageData"),
    );
    const healthSectionStart = render.indexOf("Santé du cron email");
    const eventsSectionStart = render.indexOf('heading="Événements"');
    ctx.assertTrue(
      "health section présente",
      healthSectionStart >= 0 && eventsSectionStart > healthSectionStart,
    );
    const healthChunk = render.slice(healthSectionStart, eventsSectionStart);
    ctx.assertFalse(
      "T. pas de Form post dans health",
      healthChunk.includes('method="post"') ||
        healthChunk.includes("RETRY_EMAIL_EVENT_INTENT"),
    );
    ctx.assertFalse(
      "T. pas de db write dans render",
      render.includes("emailCronRun.create") ||
        render.includes("emailCronRun.update"),
    );
    ctx.assertTrue(
      "T. alertes zone",
      render.includes("Alertes") &&
        render.includes("Aucune anomalie détectée."),
    );
  }

  ctx.scenario("U–W. Cron auth / cap / manual retry inchangés");
  {
    const cronRoute = readRepoFile("app/routes/api.cron.process-email-retries.tsx");
    const cron = readRepoFile(
      "app/services/email/processEmailRetriesCron.server.ts",
    );
    const worker = readRepoFile(
      "app/services/email/email-event-worker.server.ts",
    );
    const constants = readRepoFile("app/constants/emailEvent.ts");
    const vercel = readRepoFile("vercel.json");

    ctx.assertTrue(
      "U. CRON_SECRET auth",
      cron.includes("CRON_SECRET") && cron.includes("Unauthorized"),
    );
    ctx.assertTrue(
      "U. route délègue au helper server",
      /runProcessEmailRetriesCron/.test(cronRoute),
    );
    ctx.assertTrue(
      "U. schedule inchangé",
      /"path":\s*"\/api\/cron\/process-email-retries"[\s\S]*?"schedule":\s*"5 \* \* \* \*"/.test(
        vercel,
      ),
    );
    ctx.assertTrue(
      "V. MAX_ATTEMPTS inchangé",
      constants.includes("EMAIL_EVENT_MAX_ATTEMPTS = 5") ||
        /EMAIL_EVENT_MAX_ATTEMPTS\s*=\s*5/.test(constants),
    );
    ctx.assertEqual("V. cap value", EMAIL_EVENT_MAX_ATTEMPTS, 5);
    ctx.assertTrue(
      "W. manualRetryEmailEvent intact",
      worker.includes("manualRetryEmailEvent") &&
        worker.includes('failureMode: "manual"'),
    );
    ctx.assertTrue(
      "monitoring fail-open documenté",
      cron.includes("fail-open") ||
        cron.includes("never block processDueEmailEvents"),
    );
  }

  ctx.scenario("X. Suite enregistrée 1x + migration dédiée");
  {
    const runner = readRepoFile(
      "scripts/business-tests/00-run-business-regression-suite.ts",
    );
    ctx.assertEqual(
      "X. suite 78 enregistrée 1x",
      countOccurrences(runner, /78-email-cron-health\.test\.ts/g),
      1,
    );
    ctx.assertTrue(
      "migration add_email_cron_run_health",
      existsSync(
        join(
          repoRoot,
          "prisma/migrations/20260825180000_add_email_cron_run_health/migration.sql",
        ),
      ),
    );
    const migration = readRepoFile(
      "prisma/migrations/20260825180000_add_email_cron_run_health/migration.sql",
    );
    ctx.assertTrue(
      "migration crée EmailCronRun seulement",
      migration.includes('"EmailCronRun"') &&
        !migration.includes('"EmailEvent"'),
    );
    ctx.assertTrue(
      "feature health server",
      existsSync(
        join(repoRoot, "app/features/emails/emails-cron-health.server.ts"),
      ),
    );
  }

  ctx.scenario("Cron end-to-end avec memory client (success + failed)");
  {
    process.env.CRON_SECRET = "test-secret";
    process.env.CRON_SHOP = SHOP;
    const client = createMemoryEmailCronRunDb();

    const ok = await runProcessEmailRetriesCron(
      new Request(
        "https://example.com/api/cron/process-email-retries?secret=test-secret",
      ),
      {
        cronRunClient: client,
        processDueEmailEvents: async () => ({
          ...emptyWorkerSummary(),
          claimed: 2,
          reclaimed: 1,
          retried: 0,
          scanned: 2,
          sent: 2,
        }),
      },
    );
    ctx.assertEqual("cron success 200", ok.status, 200);
    const okBody = (await ok.json()) as { runId: string | null };
    ctx.assertTrue("runId présent", typeof okBody.runId === "string");
    const stored = client.rows.get(okBody.runId!);
    ctx.assertEqual("stored success", stored?.status, "success");
    ctx.assertEqual("stored processed", stored?.processedCount, 2);
    ctx.assertEqual("stored sent", stored?.sentCount, 2);
    ctx.assertEqual("stored reclaimed", stored?.reclaimedCount, 1);

    const failClient = createMemoryEmailCronRunDb();
    const fail = await runProcessEmailRetriesCron(
      new Request(
        "https://example.com/api/cron/process-email-retries?secret=test-secret",
      ),
      {
        cronRunClient: failClient,
        processDueEmailEvents: async () => {
          throw new Error("boom");
        },
      },
    );
    ctx.assertEqual("cron fail 500", fail.status, 500);
    const failBody = (await fail.json()) as { runId: string | null; error: string };
    ctx.assertEqual("error message", failBody.error, "boom");
    const failStored = failClient.rows.get(failBody.runId!);
    ctx.assertEqual("stored failed", failStored?.status, "failed");
    ctx.assertEqual("stored errorMessage", failStored?.errorMessage, "boom");
  }

  restoreEnv();
  return finishSuite("78-email-cron-health", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
