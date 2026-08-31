/**
 * Business regression — EMAIL-6D EmailEvent retry cron.
 *
 * Auth (CRON_SECRET / CRON_SHOP), isolation from subscriptions cron,
 * vercel schedule, empty-table success. No domain email migration.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const runSuite = async () => {
  const ctx = createBusinessTestContext("65-email-event-retry-cron");

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

  ctx.scenario("A. Auth — secret / shop");
  {
    delete process.env.CRON_SECRET;
    process.env.CRON_SHOP = SHOP;
    const missingSecret = await runProcessEmailRetriesCron(
      new Request("https://example.com/api/cron/process-email-retries"),
    );
    ctx.assertEqual("secret absent → 500", missingSecret.status, 500);

    process.env.CRON_SECRET = "test-secret";
    const badSecret = await runProcessEmailRetriesCron(
      new Request(
        "https://example.com/api/cron/process-email-retries?secret=wrong",
      ),
    );
    ctx.assertEqual("secret invalide → 401", badSecret.status, 401);

    delete process.env.CRON_SHOP;
    const missingShop = await runProcessEmailRetriesCron(
      new Request(
        "https://example.com/api/cron/process-email-retries?secret=test-secret",
      ),
    );
    ctx.assertEqual("shop absent → 500", missingShop.status, 500);
  }

  ctx.scenario("B. Success — bearer + worker summary");
  {
    process.env.CRON_SECRET = "test-secret";
    process.env.CRON_SHOP = SHOP;

    let calledShop: string | undefined;
    const response = await runProcessEmailRetriesCron(
      new Request("https://example.com/api/cron/process-email-retries", {
        headers: { Authorization: "Bearer test-secret" },
      }),
      {
        processDueEmailEvents: async (options) => {
          calledShop = options?.shop;
          return {
            cancelled: 0,
            claimed: 0,
            errors: [],
            failed: 0,
            reclaimed: 0,
            retried: 0,
            scanned: 0,
            sent: 0,
            skippedNotClaimed: 0,
            unsupported: 0,
          };
        },
      },
    );

    ctx.assertEqual("secret valide → 200", response.status, 200);
    ctx.assertEqual("CRON_SHOP propagé", calledShop, SHOP);
    const body = (await response.json()) as {
      scanned: number;
      shop: string;
    };
    ctx.assertEqual("shop dans body", body.shop, SHOP);
    ctx.assertEqual("scanned 0 (table vide OK)", body.scanned, 0);
  }

  ctx.scenario("C. Worker exception → 500 propre");
  {
    process.env.CRON_SECRET = "test-secret";
    process.env.CRON_SHOP = SHOP;

    const response = await runProcessEmailRetriesCron(
      new Request(
        "https://example.com/api/cron/process-email-retries?secret=test-secret",
      ),
      {
        processDueEmailEvents: async () => {
          throw new Error("worker exploded");
        },
      },
    );
    ctx.assertEqual("exception worker → 500", response.status, 500);
    const body = (await response.json()) as { error: string };
    ctx.assertEqual("message exception", body.error, "worker exploded");
  }

  ctx.scenario("D. Isolation — subscriptions cron + vercel schedule");
  {
    const subscriptionsCronRoute = readRepoFile(
      "app/routes/api.cron.process-subscriptions.tsx",
    );
    const subscriptionsCron = readRepoFile(
      "app/services/processSubscriptionsCron.server.ts",
    );
    const emailRetriesCron = readRepoFile(
      "app/routes/api.cron.process-email-retries.tsx",
    );
    const emailRetriesCronServer = readRepoFile(
      "app/services/email/processEmailRetriesCron.server.ts",
    );
    const vercel = readRepoFile("vercel.json");

    ctx.assertFalse(
      "subscriptions cron n'importe pas email worker",
      /processDueEmailEvents|email-event-worker/.test(subscriptionsCron),
    );
    ctx.assertTrue(
      "subscriptions route délègue au helper server",
      /runProcessSubscriptionsCron/.test(subscriptionsCronRoute),
    );
    ctx.assertTrue(
      "subscriptions conserve billing",
      /processDueSubscriptionBillings/.test(subscriptionsCron),
    );
    ctx.assertTrue(
      "subscriptions conserve reminder",
      /processDueMealSelectionReminders/.test(subscriptionsCron),
    );
    ctx.assertTrue(
      "subscriptions conserve upcoming",
      /processDueUpcomingDeliveryEmails/.test(subscriptionsCron),
    );
    ctx.assertTrue(
      "email retries cron importe worker",
      /processDueEmailEvents/.test(emailRetriesCronServer),
    );
    ctx.assertTrue(
      "email retries route délègue au helper server",
      /runProcessEmailRetriesCron/.test(emailRetriesCron),
    );
    ctx.assertTrue(
      "vercel garde process-subscriptions",
      vercel.includes("/api/cron/process-subscriptions"),
    );
    ctx.assertTrue(
      "vercel ajoute process-email-retries",
      vercel.includes("/api/cron/process-email-retries"),
    );
    ctx.assertTrue(
      "schedule email retries 5 * * * *",
      /"path":\s*"\/api\/cron\/process-email-retries"[\s\S]*?"schedule":\s*"5 \* \* \* \*"/.test(
        vercel,
      ),
    );
    ctx.assertTrue(
      "schedule subscriptions 0 * * * *",
      /"path":\s*"\/api\/cron\/process-subscriptions"[\s\S]*?"schedule":\s*"0 \* \* \* \*"/.test(
        vercel,
      ),
    );
  }

  restoreEnv();
  return finishSuite("65-email-event-retry-cron", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
