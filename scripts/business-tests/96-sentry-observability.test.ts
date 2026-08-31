/**
 * Business regression — SENTRY-1 server-only technical observability.
 *
 * Deterministic mocks only. Never sends real Sentry events.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  __resetBuilderCheckoutTestDeps,
  __setBuilderCheckoutTestDeps,
  createBuilderStorefrontCheckout,
} from "../../app/features/builder/builder-checkout.server";
import { BUILDER_CART_PREPARE_ERROR } from "../../app/features/builder/builder-cart";
import { runProcessSubscriptionsCron } from "../../app/services/processSubscriptionsCron.server";
import {
  __resetCaptureTechnicalErrorForTests,
  __setCaptureExceptionForTests,
  captureTechnicalError,
  sanitizeTechnicalErrorContext,
} from "../../app/services/observability/captureTechnicalError.server";
import {
  __resetSentryForTests,
  __setSentryEnabledForTests,
  initSentry,
  isSentryEnabled,
} from "../../app/services/observability/sentry.server";
import { runProcessEmailRetriesCron } from "../../app/services/email/processEmailRetriesCron.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";

type CapturedCall = {
  captureContext?: {
    extra?: Record<string, string | number | boolean | null>;
  };
  exception: unknown;
};

const installCaptureMock = () => {
  const calls: CapturedCall[] = [];
  __setCaptureExceptionForTests((exception, captureContext) => {
    calls.push({ captureContext, exception });
    return "mock-event-id";
  });
  return calls;
};

const resetObservabilityMocks = () => {
  __resetCaptureTechnicalErrorForTests();
  __resetSentryForTests();
  __resetBuilderCheckoutTestDeps();
  delete process.env.SENTRY_DSN;
  delete process.env.SENTRY_ENVIRONMENT;
};

const sampleCheckoutInput = () => ({
  boxVariantId: "gid://shopify/ProductVariant/1",
  deliveryRangeLabel: "20–26 août",
  email: "guest@example.com",
  mealCount: 10,
  meals: [{ quantity: 1, title: "Poulet" }],
  scheduledDeliveryDate: "2026-08-20",
  sellingPlanId: "gid://shopify/SellingPlan/1",
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("96-sentry-observability");
  const previousDsn = process.env.SENTRY_DSN;
  const previousEnv = process.env.SENTRY_ENVIRONMENT;
  const previousSecret = process.env.CRON_SECRET;
  const previousShop = process.env.CRON_SHOP;

  const restoreEnv = () => {
    resetObservabilityMocks();
    if (previousDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = previousDsn;
    }
    if (previousEnv === undefined) {
      delete process.env.SENTRY_ENVIRONMENT;
    } else {
      process.env.SENTRY_ENVIRONMENT = previousEnv;
    }
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

  try {
    ctx.scenario("A. DSN absent — init safe + capture no-op");
    {
      resetObservabilityMocks();
      const calls = installCaptureMock();
      const enabled = initSentry();
      ctx.assertFalse("init without DSN → disabled", enabled);
      ctx.assertFalse("isSentryEnabled false", isSentryEnabled());

      captureTechnicalError(new Error("should-not-send"), {
        shop: SHOP,
        source: "test",
      });
      ctx.assertEqual("capture no-op without DSN", calls.length, 0);
    }

    ctx.scenario("B. Context allow-list");
    {
      resetObservabilityMocks();
      __setSentryEnabledForTests(true);
      const calls = installCaptureMock();

      const sanitized = sanitizeTechnicalErrorContext({
        address: "1 rue interdite",
        apiKey: "secret-key",
        authorization: "Bearer x",
        cronName: "process-subscriptions",
        customerEmail: "pii@example.com",
        email: "pii@example.com",
        errorCode: "billing_attempt_throw",
        metaJson: { raw: true },
        password: "pw",
        payload: { cart: true },
        phone: "+33000000000",
        rawOrder: { id: 1 },
        recipientEmail: "pii@example.com",
        recoveryId: "rec_1",
        selectionId: "sel_1",
        shop: SHOP,
        source: "billing",
        subscriptionContractId: "gid://shopify/SubscriptionContract/1",
        token: "tok",
        accessToken: "atk",
        secret: "sec",
        DATABASE_URL: "postgres://x",
        DIRECT_URL: "postgres://y",
        CRON_SECRET: "cron",
      });

      ctx.assertEqual("allow shop", sanitized.shop, SHOP);
      ctx.assertEqual("allow source", sanitized.source, "billing");
      ctx.assertEqual("allow selectionId", sanitized.selectionId, "sel_1");
      ctx.assertEqual("allow recoveryId", sanitized.recoveryId, "rec_1");
      ctx.assertEqual(
        "allow subscriptionContractId",
        sanitized.subscriptionContractId,
        "gid://shopify/SubscriptionContract/1",
      );
      ctx.assertEqual(
        "allow errorCode",
        sanitized.errorCode,
        "billing_attempt_throw",
      );
      ctx.assertEqual(
        "allow cronName",
        sanitized.cronName,
        "process-subscriptions",
      );
      ctx.assertEqual(
        "deny email",
        Object.prototype.hasOwnProperty.call(sanitized, "email"),
        false,
      );
      ctx.assertEqual(
        "deny customerEmail",
        Object.prototype.hasOwnProperty.call(sanitized, "customerEmail"),
        false,
      );
      ctx.assertEqual(
        "deny token",
        Object.prototype.hasOwnProperty.call(sanitized, "token"),
        false,
      );
      ctx.assertEqual(
        "deny secret",
        Object.prototype.hasOwnProperty.call(sanitized, "secret"),
        false,
      );
      ctx.assertEqual(
        "deny address",
        Object.prototype.hasOwnProperty.call(sanitized, "address"),
        false,
      );
      ctx.assertEqual(
        "deny payload",
        Object.prototype.hasOwnProperty.call(sanitized, "payload"),
        false,
      );
      ctx.assertEqual(
        "deny rawOrder",
        Object.prototype.hasOwnProperty.call(sanitized, "rawOrder"),
        false,
      );

      captureTechnicalError(new Error("technical"), {
        email: "pii@example.com",
        shop: SHOP,
        source: "billing",
        token: "tok",
      });

      ctx.assertEqual("capture once after allow-list", calls.length, 1);
      ctx.assertEqual(
        "extra keeps shop",
        calls[0]?.captureContext?.extra?.shop,
        SHOP,
      );
      ctx.assertEqual(
        "extra drops email",
        Object.prototype.hasOwnProperty.call(
          calls[0]?.captureContext?.extra ?? {},
          "email",
        ),
        false,
      );
    }

    ctx.scenario("C. Technical error — captureException exactly 1×");
    {
      resetObservabilityMocks();
      __setSentryEnabledForTests(true);
      const calls = installCaptureMock();
      const err = new Error("boom");
      captureTechnicalError(err, { source: "entry.server", route: "/app" });
      captureTechnicalError(err, { source: "entry.server", route: "/app" });
      ctx.assertEqual("two explicit calls → 2 events", calls.length, 2);

      const singleCalls = installCaptureMock();
      captureTechnicalError(new Error("once"), { source: "test" });
      ctx.assertEqual("single call → 1 event", singleCalls.length, 1);
    }

    ctx.scenario("D. Business failure paths — no Sentry in decline/skip branches");
    {
      const billingWorker = readRepoFile(
        "app/services/subscriptionBillingWorker.server.ts",
      );
      const recovery = readRepoFile(
        "app/services/subscriptionPaymentRecovery.server.ts",
      );
      const entryServer = readRepoFile("app/entry.server.tsx");

      const throwCatchIndex = billingWorker.indexOf(
        'errorCode: "billing_attempt_throw"',
      );
      const resolveStatusIndex = billingWorker.indexOf(
        "resolveBillingAttemptStatus",
      );
      ctx.assertTrue(
        "billing throw catch instruments Sentry",
        throwCatchIndex > 0,
      );
      ctx.assertTrue(
        "resolveBillingAttemptStatus remains separate from throw catch",
        resolveStatusIndex > 0 && resolveStatusIndex < throwCatchIndex,
      );

      const declineAbsentNearFailureHandler =
        !billingWorker.includes("captureTechnicalError") ||
        billingWorker.indexOf("handleAutomaticBillingFailure") <
          billingWorker.lastIndexOf("captureTechnicalError") ||
        !/handleAutomaticBillingFailure[\s\S]{0,400}captureTechnicalError/.test(
          billingWorker,
        );
      ctx.assertTrue(
        "handleAutomaticBillingFailure does not call captureTechnicalError",
        declineAbsentNearFailureHandler,
      );

      ctx.assertTrue(
        "recovery unexpected retry captures",
        recovery.includes('errorCode: "payment_recovery_unexpected"'),
      );
      ctx.assertTrue(
        "entry skips RouteErrorResponse 4xx",
        entryServer.includes("error.status < 500"),
      );
      ctx.assertTrue(
        "entry onError does not call captureTechnicalError",
        /onError\(error\) \{[\s\S]*?console\.error\(error\);[\s\S]*?\}/.test(
          entryServer,
        ) &&
          !/onError\(error\) \{[\s\S]*captureTechnicalError[\s\S]*?\}/.test(
            entryServer,
          ),
      );
    }

    ctx.scenario("E. Cron / worker — technical outer → capture");
    {
      resetObservabilityMocks();
      __setSentryEnabledForTests(true);
      const calls = installCaptureMock();

      process.env.CRON_SECRET = "test-secret";
      process.env.CRON_SHOP = SHOP;

      const billingResponse = await runProcessSubscriptionsCron(
        new Request(
          "https://example.com/api/cron/process-subscriptions?secret=test-secret",
        ),
        {
          processDueSubscriptionBillings: async () => {
            throw new Error("billing worker exploded");
          },
          processDueMealSelectionReminders: async () =>
            ({ scanned: 0 }) as never,
          processDueUpcomingDeliveryEmails: async () =>
            ({ scanned: 0 }) as never,
        },
      );

      ctx.assertEqual("billing outer throw → 500", billingResponse.status, 500);
      ctx.assertEqual("billing outer → 1 capture", calls.length, 1);
      ctx.assertEqual(
        "billing outer cronName",
        calls[0]?.captureContext?.extra?.cronName,
        "process-subscriptions",
      );
      ctx.assertEqual(
        "billing outer shop",
        calls[0]?.captureContext?.extra?.shop,
        SHOP,
      );

      const runnerCalls = installCaptureMock();
      const runnerResponse = await runProcessSubscriptionsCron(
        new Request(
          "https://example.com/api/cron/process-subscriptions?secret=test-secret",
        ),
        {
          processDueSubscriptionBillings: async () =>
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
              skipped: 0,
              skipReasons: {
                contract_sync_error: 0,
                delivery_billing_not_ready: 0,
                missing_contract_id: 0,
                missing_next_billing_date: 0,
                next_billing_date_in_future: 0,
                paused_or_inactive: 0,
                payment_recovery: 0,
                pending_box_change: 0,
                recent_attempt: 0,
                terminal_contract: 0,
              },
              submitted: 0,
              success: 0,
            }) as never,
          processDueMealSelectionReminders: async () => {
            throw new Error("meal runner exploded");
          },
          processDueUpcomingDeliveryEmails: async () => {
            throw new Error("upcoming runner exploded");
          },
        },
      );

      ctx.assertEqual(
        "runner failures stay HTTP 200 (swallowed)",
        runnerResponse.status,
        200,
      );
      ctx.assertEqual("two runner throws → 2 captures", runnerCalls.length, 2);
      ctx.assertEqual(
        "meal runner tag",
        runnerCalls[0]?.captureContext?.extra?.runner,
        "meal-selection-reminder",
      );
      ctx.assertEqual(
        "upcoming runner tag",
        runnerCalls[1]?.captureContext?.extra?.runner,
        "upcoming-delivery",
      );

      const unauthorizedCalls = installCaptureMock();
      const unauthorized = await runProcessSubscriptionsCron(
        new Request(
          "https://example.com/api/cron/process-subscriptions?secret=wrong",
        ),
      );
      ctx.assertEqual("invalid secret → 401", unauthorized.status, 401);
      ctx.assertEqual("401 does not capture", unauthorizedCalls.length, 0);

      const emailCalls = installCaptureMock();
      const emailResponse = await runProcessEmailRetriesCron(
        new Request(
          "https://example.com/api/cron/process-email-retries?secret=test-secret",
        ),
        {
          processDueEmailEvents: async () => {
            throw new Error("email cron exploded");
          },
          startEmailCronRun: async () => ({ id: "run_test_1" }) as never,
          completeEmailCronRunFailure: async () => undefined,
          completeEmailCronRunSuccess: async () => undefined,
        },
      );
      ctx.assertEqual("email cron_exception → 500", emailResponse.status, 500);
      ctx.assertEqual("email cron → 1 capture", emailCalls.length, 1);
      ctx.assertEqual(
        "email errorCode cron_exception",
        emailCalls[0]?.captureContext?.extra?.errorCode,
        "cron_exception",
      );
      ctx.assertEqual(
        "email runId",
        emailCalls[0]?.captureContext?.extra?.runId,
        "run_test_1",
      );
    }

    ctx.scenario("F. Builder — Storefront throw captures; métier does not");
    {
      resetObservabilityMocks();
      __setSentryEnabledForTests(true);

      const throwCalls = installCaptureMock();
      __setBuilderCheckoutTestDeps({
        getStorefront: async () => ({
          storefront: {
            graphql: async () => {
              throw new Error("storefront network down");
            },
          },
        }),
      });

      const thrown = await createBuilderStorefrontCheckout({
        input: sampleCheckoutInput(),
        shop: SHOP,
      });
      ctx.assertFalse("throw → ok false", thrown.ok);
      if (!thrown.ok) {
        ctx.assertEqual(
          "throw → prepare error message",
          thrown.message,
          BUILDER_CART_PREPARE_ERROR,
        );
      }
      ctx.assertEqual("storefront throw → 1 capture", throwCalls.length, 1);
      ctx.assertEqual(
        "builder source",
        throwCalls[0]?.captureContext?.extra?.source,
        "builder_checkout",
      );
      ctx.assertEqual(
        "builder has no email in extra",
        Object.prototype.hasOwnProperty.call(
          throwCalls[0]?.captureContext?.extra ?? {},
          "email",
        ),
        false,
      );

      const businessCalls = installCaptureMock();
      __setBuilderCheckoutTestDeps({
        getStorefront: async () => ({
          storefront: {
            graphql: async () =>
              new Response(
                JSON.stringify({
                  data: {
                    cartCreate: {
                      cart: null,
                      userErrors: [
                        { code: "INVALID", message: "Invalid merchandise" },
                      ],
                    },
                  },
                }),
                { status: 200 },
              ),
          },
        }),
      });

      const business = await createBuilderStorefrontCheckout({
        input: sampleCheckoutInput(),
        shop: SHOP,
      });
      ctx.assertFalse("userErrors → ok false", business.ok);
      ctx.assertEqual(
        "userErrors métier → no capture",
        businessCalls.length,
        0,
      );
    }

    ctx.scenario("G. Package / architecture constraints");
    {
      const pkg = JSON.parse(readRepoFile("package.json")) as {
        dependencies?: Record<string, string>;
      };
      ctx.assertTrue(
        "@sentry/node present",
        Boolean(pkg.dependencies?.["@sentry/node"]),
      );
      ctx.assertFalse(
        "no @sentry/react",
        Boolean(pkg.dependencies?.["@sentry/react"]),
      );
      ctx.assertFalse(
        "no @sentry/react-router",
        Boolean(pkg.dependencies?.["@sentry/react-router"]),
      );
      ctx.assertFalse(
        "no @sentry/vite-plugin",
        Boolean(pkg.dependencies?.["@sentry/vite-plugin"]),
      );

      const sentryInit = readRepoFile(
        "app/services/observability/sentry.server.ts",
      );
      ctx.assertTrue(
        "sendDefaultPii false",
        sentryInit.includes("sendDefaultPii: false"),
      );
      ctx.assertTrue(
        "tracesSampleRate 0",
        sentryInit.includes("tracesSampleRate: 0"),
      );
    }
  } finally {
    restoreEnv();
  }

  return finishSuite("96-sentry-observability", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
