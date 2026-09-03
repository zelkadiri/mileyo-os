#!/usr/bin/env npx tsx
/**
 * MONITORING-1B — Sentry Cron Check-ins (fail-open, no PII, no métier change).
 *
 * Deterministic mocks only. Never sends real Sentry check-ins.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { CheckIn, MonitorConfig } from "@sentry/node";

import {
  SENTRY_CRON_CHECKIN_MARGIN_MINUTES,
  SENTRY_CRON_MAX_RUNTIME_MINUTES,
  SENTRY_CRON_MONITOR_CONFIG,
  SENTRY_CRON_MONITOR_SLUG,
  SENTRY_CRON_SCHEDULE,
  SENTRY_CRON_TIMEZONE,
} from "../../app/constants/sentryCron";
import {
  completeEmailCronRunFailure,
  completeEmailCronRunSuccess,
  startEmailCronRun,
  type EmailCronRunDb,
  type EmailCronRunRecord,
} from "../../app/services/email/email-cron-run.server";
import { runProcessEmailRetriesCron } from "../../app/services/email/processEmailRetriesCron.server";
import {
  completeCronRunFailure,
  completeCronRunSuccess,
  startCronRun,
  type CronRunDb,
  type CronRunRecord,
} from "../../app/services/monitoring/cron-run.server";
import {
  __resetSentryCronForTests,
  __setCaptureCheckInForTests,
  completeCronCheckInFailure,
  completeCronCheckInSuccess,
  startCronCheckIn,
} from "../../app/services/observability/sentry-cron.server";
import {
  __resetSentryForTests,
  __setSentryEnabledForTests,
} from "../../app/services/observability/sentry.server";
import { runProcessSubscriptionsCron } from "../../app/services/processSubscriptionsCron.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";

type CapturedCheckIn = {
  checkIn: CheckIn;
  upsertMonitorConfig?: MonitorConfig;
};

const emptyBillingSummary = () =>
  ({
    errors: 0,
    processed: 0,
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
    skipped: 3,
    skipReasons: {
      contract_sync_error: 0,
      delivery_billing_not_ready: 0,
      missing_contract_id: 0,
      missing_next_billing_date: 0,
      next_billing_date_in_future: 3,
      paused_or_inactive: 0,
      payment_recovery: 0,
      pending_box_change: 0,
      recent_attempt: 0,
      terminal_contract: 0,
    },
    submitted: 0,
    success: 0,
  }) as never;

const emptyEmailSummary = () => ({
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

const createMemoryCronRunDb = (): CronRunDb & {
  rows: Map<string, CronRunRecord>;
} => {
  const rows = new Map<string, CronRunRecord>();
  let seq = 0;

  return {
    rows,
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
        const next: CronRunRecord = { ...existing, ...data };
        rows.set(where.id, next);
        return next;
      },
    },
  };
};

const createMemoryEmailCronRunDb = (): EmailCronRunDb & {
  rows: Map<string, EmailCronRunRecord>;
} => {
  const rows = new Map<string, EmailCronRunRecord>();

  return {
    rows,
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
          status: data.status ?? existing.status,
        };
        rows.set(where.id, next);
        return { ...next };
      },
    },
  };
};

const installCheckInMock = () => {
  const calls: CapturedCheckIn[] = [];
  let seq = 0;
  __setCaptureCheckInForTests((checkIn, upsertMonitorConfig) => {
    calls.push({ checkIn, upsertMonitorConfig });
    if (checkIn.status === "in_progress") {
      return `checkin_${++seq}`;
    }
    return "checkInId" in checkIn ? checkIn.checkInId : `checkin_${++seq}`;
  });
  return calls;
};

const assertNoPiiInCheckIns = (
  ctx: ReturnType<typeof createBusinessTestContext>,
  label: string,
  calls: CapturedCheckIn[],
) => {
  for (const call of calls) {
    const serialized = JSON.stringify(call);
    ctx.assertFalse(
      `${label}: no shop field`,
      /"shop"\s*:/.test(serialized),
    );
    ctx.assertFalse(
      `${label}: no email field`,
      /"email"\s*:/.test(serialized),
    );
    ctx.assertFalse(
      `${label}: no token field`,
      /"token"\s*:/.test(serialized),
    );
    ctx.assertFalse(
      `${label}: no payload field`,
      /"payload"\s*:/.test(serialized),
    );
    ctx.assertFalse(
      `${label}: no @ address`,
      serialized.includes("@"),
    );

    const keys = Object.keys(call.checkIn);
    const allowed = new Set([
      "checkInId",
      "duration",
      "monitorSlug",
      "status",
    ]);
    for (const key of keys) {
      ctx.assertTrue(
        `${label}: check-in key ${key} allowed`,
        allowed.has(key),
      );
    }
    if (call.upsertMonitorConfig) {
      const configKeys = Object.keys(call.upsertMonitorConfig);
      const allowedConfig = new Set([
        "checkinMargin",
        "failureIssueThreshold",
        "isolateTrace",
        "maxRuntime",
        "recoveryThreshold",
        "schedule",
        "timezone",
      ]);
      for (const key of configKeys) {
        ctx.assertTrue(
          `${label}: monitor config key ${key} allowed`,
          allowedConfig.has(key),
        );
      }
    }
  }
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("99-sentry-cron-checkins");
  const previousSecret = process.env.CRON_SECRET;
  const previousShop = process.env.CRON_SHOP;
  const previousDsn = process.env.SENTRY_DSN;

  const restore = () => {
    __resetSentryCronForTests();
    __resetSentryForTests();
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
    if (previousDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = previousDsn;
    }
  };

  try {
    ctx.scenario("A. Wrapper — in_progress / ok / error + fail-open");
    {
      __resetSentryCronForTests();
      __resetSentryForTests();
      delete process.env.SENTRY_DSN;
      __setSentryEnabledForTests(true);

      const calls = installCheckInMock();
      const slug = SENTRY_CRON_MONITOR_SLUG.PROCESS_SUBSCRIPTIONS;
      const startedAtMs = Date.now() - 1500;

      const checkInId = startCronCheckIn(slug);
      ctx.assertTrue("start returns checkInId", typeof checkInId === "string");
      ctx.assertEqual("in_progress once", calls.length, 1);
      ctx.assertEqual("in_progress status", calls[0]?.checkIn.status, "in_progress");
      ctx.assertEqual(
        "in_progress slug",
        calls[0]?.checkIn.monitorSlug,
        slug,
      );
      ctx.assertEqual(
        "upsert schedule type",
        calls[0]?.upsertMonitorConfig?.schedule?.type,
        "crontab",
      );
      ctx.assertEqual(
        "upsert schedule value",
        calls[0]?.upsertMonitorConfig?.schedule &&
          "value" in calls[0].upsertMonitorConfig.schedule
          ? calls[0].upsertMonitorConfig.schedule.value
          : null,
        SENTRY_CRON_SCHEDULE.PROCESS_SUBSCRIPTIONS,
      );
      ctx.assertEqual(
        "upsert checkinMargin",
        calls[0]?.upsertMonitorConfig?.checkinMargin,
        15,
      );
      ctx.assertEqual(
        "upsert maxRuntime",
        calls[0]?.upsertMonitorConfig?.maxRuntime,
        30,
      );
      ctx.assertEqual(
        "upsert timezone UTC",
        calls[0]?.upsertMonitorConfig?.timezone,
        "UTC",
      );

      completeCronCheckInSuccess(slug, checkInId, startedAtMs);
      ctx.assertEqual("ok after success", calls.length, 2);
      ctx.assertEqual("ok status", calls[1]?.checkIn.status, "ok");
      ctx.assertEqual(
        "ok same checkInId",
        "checkInId" in (calls[1]?.checkIn ?? {})
          ? (calls[1]?.checkIn as { checkInId: string }).checkInId
          : null,
        checkInId,
      );

      const failCalls = installCheckInMock();
      const failId = startCronCheckIn(slug);
      completeCronCheckInFailure(slug, failId, startedAtMs);
      ctx.assertEqual("error path two calls", failCalls.length, 2);
      ctx.assertEqual("error status", failCalls[1]?.checkIn.status, "error");
      ctx.assertEqual(
        "error same checkInId",
        "checkInId" in (failCalls[1]?.checkIn ?? {})
          ? (failCalls[1]?.checkIn as { checkInId: string }).checkInId
          : null,
        failId,
      );

      assertNoPiiInCheckIns(ctx, "wrapper", [...calls, ...failCalls]);

      // DSN / disabled → fail-open
      __resetSentryCronForTests();
      __resetSentryForTests();
      delete process.env.SENTRY_DSN;
      const disabledCalls = installCheckInMock();
      const disabledId = startCronCheckIn(slug);
      ctx.assertEqual("disabled → null id", disabledId, null);
      ctx.assertEqual("disabled → no SDK call", disabledCalls.length, 0);

      // SDK throw → fail-open
      __setSentryEnabledForTests(true);
      __setCaptureCheckInForTests(() => {
        throw new Error("sdk down");
      });
      const thrownId = startCronCheckIn(slug);
      ctx.assertEqual("SDK throw → null id", thrownId, null);
      completeCronCheckInSuccess(slug, "orphan-id", startedAtMs);
      completeCronCheckInFailure(slug, "orphan-id", startedAtMs);
      ctx.assertTrue("complete after SDK throw did not rethrow", true);
    }

    ctx.scenario("B. Monitor config constants");
    {
      ctx.assertEqual(
        "billing slug",
        SENTRY_CRON_MONITOR_SLUG.PROCESS_SUBSCRIPTIONS,
        "mileyo-process-subscriptions",
      );
      ctx.assertEqual(
        "email slug",
        SENTRY_CRON_MONITOR_SLUG.PROCESS_EMAIL_RETRIES,
        "mileyo-process-email-retries",
      );
      ctx.assertEqual(
        "billing cron",
        SENTRY_CRON_SCHEDULE.PROCESS_SUBSCRIPTIONS,
        "0 * * * *",
      );
      ctx.assertEqual(
        "email cron",
        SENTRY_CRON_SCHEDULE.PROCESS_EMAIL_RETRIES,
        "5 * * * *",
      );
      ctx.assertEqual("timezone UTC", SENTRY_CRON_TIMEZONE, "UTC");
      ctx.assertEqual(
        "checkinMargin 15",
        SENTRY_CRON_CHECKIN_MARGIN_MINUTES,
        15,
      );
      ctx.assertEqual(
        "maxRuntime 30",
        SENTRY_CRON_MAX_RUNTIME_MINUTES,
        30,
      );

      const billing =
        SENTRY_CRON_MONITOR_CONFIG[
          SENTRY_CRON_MONITOR_SLUG.PROCESS_SUBSCRIPTIONS
        ];
      const email =
        SENTRY_CRON_MONITOR_CONFIG[
          SENTRY_CRON_MONITOR_SLUG.PROCESS_EMAIL_RETRIES
        ];
      ctx.assertEqual("billing margin", billing.checkinMargin, 15);
      ctx.assertEqual("billing maxRuntime", billing.maxRuntime, 30);
      ctx.assertEqual("billing tz", billing.timezone, "UTC");
      ctx.assertEqual("email margin", email.checkinMargin, 15);
      ctx.assertEqual("email maxRuntime", email.maxRuntime, 30);
      ctx.assertEqual("email tz", email.timezone, "UTC");
      ctx.assertEqual(
        "billing schedule value",
        billing.schedule.value,
        "0 * * * *",
      );
      ctx.assertEqual(
        "email schedule value",
        email.schedule.value,
        "5 * * * *",
      );
    }

    ctx.scenario("C. Billing cron — success / outer error / business skip");
    {
      process.env.CRON_SECRET = "test-secret";
      process.env.CRON_SHOP = SHOP;

      const checkInCalls: Array<{
        kind: "start" | "ok" | "error";
        slug: string;
        id: string | null | undefined;
      }> = [];

      const trackCheckInDeps = {
        startCronCheckIn: (slug: typeof SENTRY_CRON_MONITOR_SLUG.PROCESS_SUBSCRIPTIONS) => {
          const id = "billing_checkin_1";
          checkInCalls.push({ kind: "start", slug, id });
          return id;
        },
        completeCronCheckInSuccess: (
          slug: typeof SENTRY_CRON_MONITOR_SLUG.PROCESS_SUBSCRIPTIONS,
          id: string | null | undefined,
        ) => {
          checkInCalls.push({ kind: "ok", slug, id });
        },
        completeCronCheckInFailure: (
          slug: typeof SENTRY_CRON_MONITOR_SLUG.PROCESS_SUBSCRIPTIONS,
          id: string | null | undefined,
        ) => {
          checkInCalls.push({ kind: "error", slug, id });
        },
      };

      // Success
      checkInCalls.length = 0;
      const db = createMemoryCronRunDb();
      const success = await runProcessSubscriptionsCron(
        new Request(
          "https://example.com/api/cron/process-subscriptions?secret=test-secret",
        ),
        {
          ...trackCheckInDeps,
          cronRunClient: db,
          startCronRun,
          completeCronRunSuccess,
          completeCronRunFailure,
          processDueSubscriptionBillings: async () => emptyBillingSummary(),
          processDueMealSelectionReminders: async () => ({ scanned: 0 }) as never,
          processDueUpcomingDeliveryEmails: async () => ({ scanned: 0 }) as never,
        },
      );
      ctx.assertEqual("billing success HTTP 200", success.status, 200);
      const successBody = (await success.json()) as { skipped: number; runId: string };
      ctx.assertEqual("billing skip count preserved", successBody.skipped, 3);
      ctx.assertEqual("billing check-ins count", checkInCalls.length, 2);
      ctx.assertEqual("billing start then ok", checkInCalls[0]?.kind, "start");
      ctx.assertEqual("billing ok", checkInCalls[1]?.kind, "ok");
      ctx.assertEqual(
        "billing same id",
        checkInCalls[1]?.id,
        checkInCalls[0]?.id,
      );
      ctx.assertEqual(
        "billing slug",
        checkInCalls[0]?.slug,
        SENTRY_CRON_MONITOR_SLUG.PROCESS_SUBSCRIPTIONS,
      );
      const successRun = [...db.rows.values()][0];
      ctx.assertEqual("CronRun success status", successRun?.status, "success");

      // Outer exception → in_progress + error; métier response unchanged
      checkInCalls.length = 0;
      const failDb = createMemoryCronRunDb();
      const failed = await runProcessSubscriptionsCron(
        new Request(
          "https://example.com/api/cron/process-subscriptions?secret=test-secret",
        ),
        {
          ...trackCheckInDeps,
          cronRunClient: failDb,
          startCronRun,
          completeCronRunSuccess,
          completeCronRunFailure,
          processDueSubscriptionBillings: async () => {
            throw new Error("billing exploded");
          },
          processDueMealSelectionReminders: async () => ({ scanned: 0 }) as never,
          processDueUpcomingDeliveryEmails: async () => ({ scanned: 0 }) as never,
        },
      );
      ctx.assertEqual("billing failure HTTP 500", failed.status, 500);
      const failBody = (await failed.json()) as { error: string; runId: string };
      ctx.assertTrue("billing error message", Boolean(failBody.error));
      ctx.assertEqual("billing fail check-ins", checkInCalls.length, 2);
      ctx.assertEqual("billing start", checkInCalls[0]?.kind, "start");
      ctx.assertEqual("billing error", checkInCalls[1]?.kind, "error");
      ctx.assertEqual(
        "billing fail same id",
        checkInCalls[1]?.id,
        checkInCalls[0]?.id,
      );
      const failRun = [...failDb.rows.values()][0];
      ctx.assertEqual("CronRun failed status", failRun?.status, "failed");

      // Auth skip → no check-in
      checkInCalls.length = 0;
      const unauthorized = await runProcessSubscriptionsCron(
        new Request(
          "https://example.com/api/cron/process-subscriptions?secret=wrong",
        ),
        trackCheckInDeps,
      );
      ctx.assertEqual("auth skip 401", unauthorized.status, 401);
      ctx.assertEqual("auth skip no check-in", checkInCalls.length, 0);
    }

    ctx.scenario("D. Email cron — success / failure + EmailCronRun intact");
    {
      process.env.CRON_SECRET = "test-secret";
      process.env.CRON_SHOP = SHOP;

      const checkInCalls: Array<{
        kind: "start" | "ok" | "error";
        slug: string;
        id: string | null | undefined;
      }> = [];

      const trackCheckInDeps = {
        startCronCheckIn: (
          slug: typeof SENTRY_CRON_MONITOR_SLUG.PROCESS_EMAIL_RETRIES,
        ) => {
          const id = "email_checkin_1";
          checkInCalls.push({ kind: "start", slug, id });
          return id;
        },
        completeCronCheckInSuccess: (
          slug: typeof SENTRY_CRON_MONITOR_SLUG.PROCESS_EMAIL_RETRIES,
          id: string | null | undefined,
        ) => {
          checkInCalls.push({ kind: "ok", slug, id });
        },
        completeCronCheckInFailure: (
          slug: typeof SENTRY_CRON_MONITOR_SLUG.PROCESS_EMAIL_RETRIES,
          id: string | null | undefined,
        ) => {
          checkInCalls.push({ kind: "error", slug, id });
        },
      };

      const db = createMemoryEmailCronRunDb();
      const success = await runProcessEmailRetriesCron(
        new Request(
          "https://example.com/api/cron/process-email-retries?secret=test-secret",
        ),
        {
          ...trackCheckInDeps,
          cronRunClient: db,
          startEmailCronRun,
          completeEmailCronRunSuccess,
          completeEmailCronRunFailure,
          processDueEmailEvents: async () => emptyEmailSummary(),
        },
      );
      ctx.assertEqual("email success HTTP 200", success.status, 200);
      ctx.assertEqual("email check-ins", checkInCalls.length, 2);
      ctx.assertEqual("email start", checkInCalls[0]?.kind, "start");
      ctx.assertEqual("email ok", checkInCalls[1]?.kind, "ok");
      ctx.assertEqual(
        "email slug",
        checkInCalls[0]?.slug,
        SENTRY_CRON_MONITOR_SLUG.PROCESS_EMAIL_RETRIES,
      );
      const successRun = [...db.rows.values()][0];
      ctx.assertEqual("EmailCronRun success", successRun?.status, "success");

      checkInCalls.length = 0;
      const failDb = createMemoryEmailCronRunDb();
      const failed = await runProcessEmailRetriesCron(
        new Request(
          "https://example.com/api/cron/process-email-retries?secret=test-secret",
        ),
        {
          ...trackCheckInDeps,
          cronRunClient: failDb,
          startEmailCronRun,
          completeEmailCronRunSuccess,
          completeEmailCronRunFailure,
          processDueEmailEvents: async () => {
            throw new Error("email worker exploded");
          },
        },
      );
      ctx.assertEqual("email failure HTTP 500", failed.status, 500);
      ctx.assertEqual("email fail check-ins", checkInCalls.length, 2);
      ctx.assertEqual("email fail start", checkInCalls[0]?.kind, "start");
      ctx.assertEqual("email fail error", checkInCalls[1]?.kind, "error");
      const failRun = [...failDb.rows.values()][0];
      ctx.assertEqual("EmailCronRun failed", failRun?.status, "failed");
      ctx.assertEqual("EmailCronRun errorCode", failRun?.errorCode, "cron_exception");
    }

    ctx.scenario("E. Static source — fail-open + dual signal documented");
    {
      const wrapper = readRepoFile(
        "app/services/observability/sentry-cron.server.ts",
      );
      const billing = readRepoFile(
        "app/services/processSubscriptionsCron.server.ts",
      );
      const email = readRepoFile(
        "app/services/email/processEmailRetriesCron.server.ts",
      );
      const sentryInit = readRepoFile(
        "app/services/observability/sentry.server.ts",
      );

      ctx.assertTrue(
        "wrapper documents dual signal",
        wrapper.includes("does NOT call captureException") ||
          wrapper.includes("does not call captureException"),
      );
      ctx.assertTrue(
        "wrapper fail-open",
        wrapper.includes("fail-open"),
      );
      ctx.assertTrue(
        "billing uses captureCheckIn path via wrapper",
        billing.includes("startCronCheckIn") &&
          billing.includes("completeCronCheckInSuccess") &&
          billing.includes("completeCronCheckInFailure"),
      );
      ctx.assertTrue(
        "email uses wrapper",
        email.includes("startCronCheckIn") &&
          email.includes("completeCronCheckInSuccess"),
      );
      ctx.assertTrue(
        "billing documents dual signal",
        billing.includes("dual signal") ||
          billing.includes("check-in does not re-capture"),
      );
      ctx.assertTrue(
        "email documents dual signal",
        email.includes("dual signal") ||
          email.includes("check-in does not re-capture"),
      );
      ctx.assertTrue(
        "single Sentry init remains",
        sentryInit.includes("Sentry.init") &&
          !wrapper.includes("Sentry.init"),
      );
      ctx.assertFalse(
        "no withMonitor in billing",
        billing.includes("withMonitor"),
      );
      ctx.assertFalse(
        "no withMonitor in email",
        email.includes("withMonitor"),
      );
      ctx.assertFalse(
        "email does not import CronRun monitoring",
        email.includes("monitoring/cron-run"),
      );
      ctx.assertTrue(
        "email still uses EmailCronRun helpers",
        email.includes("startEmailCronRun") &&
          email.includes("completeEmailCronRunSuccess"),
      );
    }
  } finally {
    restore();
  }

  return finishSuite("99-sentry-cron-checkins", ctx);
};

runSuite()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
