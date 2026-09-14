/**
 * Business regression — transient Prisma DB/pool retry for Shopify admin session.
 *
 * Hardens unauthenticated.admin only. No billing mutations. Deterministic mocks.
 */
import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHOPIFY_ADMIN_SESSION_MAX_ATTEMPTS,
  SHOPIFY_ADMIN_SESSION_RETRY_DELAY_MS,
  getAdminWithTransientDbRetry,
  isTransientPrismaConnectionError,
} from "../../app/services/shopify/retry-admin-session.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepoFile = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

const SHOP = "mileyo-dev.myshopify.com";

const poolTimeoutError = () =>
  new Prisma.PrismaClientKnownRequestError(
    "Timed out fetching a new connection from the connection pool\nCurrent connection pool timeout: 10\nconnection limit: 5",
    { clientVersion: "6.19.3", code: "P2024" },
  );

const cantReachError = () =>
  new Prisma.PrismaClientInitializationError(
    "Can't reach database server at: aws-1-eu-west-1.pooler.supabase.com:6543",
    "6.19.3",
  );

class MissingSessionTableError extends Error {
  constructor(
    message: string,
    public readonly cause: Error,
  ) {
    super(message);
    this.name = "MissingSessionTableError";
  }
}

const adminStub = { admin: { graphql: async () => null } } as never;

const runSuite = async () => {
  const ctx = createBusinessTestContext("100-shopify-admin-session-retry");

  ctx.scenario("Constants — 2 attempts, 1000 ms delay");
  ctx.assertEqual(
    "max attempts is 2",
    SHOPIFY_ADMIN_SESSION_MAX_ATTEMPTS,
    2,
  );
  ctx.assertEqual(
    "retry delay is 1000 ms",
    SHOPIFY_ADMIN_SESSION_RETRY_DELAY_MS,
    1000,
  );

  ctx.scenario("Classifier — transient messages / codes");
  ctx.assertTrue(
    "pool timeout P2024 is transient",
    isTransientPrismaConnectionError(poolTimeoutError()),
  );
  ctx.assertTrue(
    "can't reach InitializationError is transient",
    isTransientPrismaConnectionError(cantReachError()),
  );
  ctx.assertTrue(
    "P1001 code is transient",
    isTransientPrismaConnectionError(
      new Prisma.PrismaClientKnownRequestError("unreachable", {
        clientVersion: "6.19.3",
        code: "P1001",
      }),
    ),
  );

  ctx.scenario("Classifier — wrapped MissingSessionTableError + Prisma cause");
  const wrappedTransient = new MissingSessionTableError(
    "Prisma session table does not exist. This could happen for a few reasons",
    cantReachError(),
  );
  ctx.assertTrue(
    "wrapped MissingSessionTableError with transient cause is transient",
    isTransientPrismaConnectionError(wrappedTransient),
  );

  ctx.scenario("Classifier — non-transient (fail-closed)");
  ctx.assertFalse(
    "plain MissingSessionTableError without transient cause is not transient",
    isTransientPrismaConnectionError(
      new MissingSessionTableError(
        "Prisma session table does not exist",
        new Error("relation \"Session\" does not exist"),
      ),
    ),
  );
  ctx.assertFalse(
    "schema P2021 is not transient",
    isTransientPrismaConnectionError(
      new Prisma.PrismaClientKnownRequestError(
        "The table `public.Session` does not exist in the current database.",
        { clientVersion: "6.19.3", code: "P2021" },
      ),
    ),
  );
  ctx.assertFalse(
    "unknown Error is not transient",
    isTransientPrismaConnectionError(new Error("shop not found")),
  );
  ctx.assertFalse(
    "InitializationError without connection wording is not transient",
    isTransientPrismaConnectionError(
      new Prisma.PrismaClientInitializationError(
        "Invalid datasource configuration",
        "6.19.3",
      ),
    ),
  );

  ctx.scenario("A. Success direct — 1 call, 0 sleep");
  {
    let calls = 0;
    let sleeps = 0;
    const result = await getAdminWithTransientDbRetry(SHOP, {
      getAdmin: async () => {
        calls += 1;
        return adminStub;
      },
      sleep: async () => {
        sleeps += 1;
      },
    });
    ctx.assertEqual("direct success calls getAdmin once", calls, 1);
    ctx.assertEqual("direct success does not sleep", sleeps, 0);
    ctx.assertEqual("direct success returns admin", result, adminStub);
  }

  ctx.scenario("B. Transient then success — 2 calls, 1 sleep 1000");
  {
    let calls = 0;
    const sleepMs: number[] = [];
    const warnLogs: Array<{ message: string; context?: Record<string, unknown> }> =
      [];
    const result = await getAdminWithTransientDbRetry(SHOP, {
      getAdmin: async () => {
        calls += 1;
        if (calls === 1) {
          throw poolTimeoutError();
        }
        return adminStub;
      },
      sleep: async (ms) => {
        sleepMs.push(ms);
      },
      warn: (message, context) => {
        warnLogs.push({ context, message });
      },
    });
    ctx.assertEqual("transient→success calls getAdmin twice", calls, 2);
    ctx.assertEqual("transient→success sleeps once", sleepMs.length, 1);
    ctx.assertEqual(
      "transient→success sleep is 1000 ms",
      sleepMs[0],
      SHOPIFY_ADMIN_SESSION_RETRY_DELAY_MS,
    );
    ctx.assertEqual("transient→success returns admin", result, adminStub);
    ctx.assertEqual("transient→success warns once", warnLogs.length, 1);
    ctx.assertEqual(
      "warn reasonCode is generic",
      warnLogs[0]?.context?.reasonCode,
      "transient_prisma_connection",
    );
    ctx.assertEqual(
      "warn includes attempt 1",
      warnLogs[0]?.context?.attempt,
      1,
    );
    ctx.assertEqual(
      "warn includes maxAttempts 2",
      warnLogs[0]?.context?.maxAttempts,
      2,
    );
  }

  ctx.scenario("C. Transient twice — 2 calls, 1 sleep, error propagated");
  {
    let calls = 0;
    let sleeps = 0;
    let thrown: unknown = null;
    try {
      await getAdminWithTransientDbRetry(SHOP, {
        getAdmin: async () => {
          calls += 1;
          throw cantReachError();
        },
        sleep: async () => {
          sleeps += 1;
        },
        warn: () => undefined,
      });
    } catch (error) {
      thrown = error;
    }
    ctx.assertEqual("double transient calls getAdmin twice", calls, 2);
    ctx.assertEqual("double transient sleeps once", sleeps, 1);
    ctx.assertTrue(
      "double transient propagates InitializationError",
      thrown instanceof Prisma.PrismaClientInitializationError,
    );
  }

  ctx.scenario("D. Non-transient — 1 call, 0 sleep, error propagated");
  {
    let calls = 0;
    let sleeps = 0;
    const schemaError = new Prisma.PrismaClientKnownRequestError(
      "The table `public.Session` does not exist in the current database.",
      { clientVersion: "6.19.3", code: "P2021" },
    );
    let thrown: unknown = null;
    try {
      await getAdminWithTransientDbRetry(SHOP, {
        getAdmin: async () => {
          calls += 1;
          throw schemaError;
        },
        sleep: async () => {
          sleeps += 1;
        },
      });
    } catch (error) {
      thrown = error;
    }
    ctx.assertEqual("non-transient calls getAdmin once", calls, 1);
    ctx.assertEqual("non-transient does not sleep", sleeps, 0);
    ctx.assertEqual("non-transient propagates same error", thrown, schemaError);
  }

  ctx.scenario("E. Wrapped MissingSessionTableError transient — retry");
  {
    let calls = 0;
    let sleeps = 0;
    await getAdminWithTransientDbRetry(SHOP, {
      getAdmin: async () => {
        calls += 1;
        if (calls === 1) {
          throw new MissingSessionTableError(
            "Prisma session table does not exist",
            poolTimeoutError(),
          );
        }
        return adminStub;
      },
      sleep: async () => {
        sleeps += 1;
      },
      warn: () => undefined,
    });
    ctx.assertEqual("wrapped transient retries (2 calls)", calls, 2);
    ctx.assertEqual("wrapped transient sleeps once", sleeps, 1);
  }

  ctx.scenario("F. True MissingSessionTableError without transient cause — no retry");
  {
    let calls = 0;
    let sleeps = 0;
    let thrown: unknown = null;
    const realMissing = new MissingSessionTableError(
      "Prisma session table does not exist",
      new Error("relation does not exist"),
    );
    try {
      await getAdminWithTransientDbRetry(SHOP, {
        getAdmin: async () => {
          calls += 1;
          throw realMissing;
        },
        sleep: async () => {
          sleeps += 1;
        },
      });
    } catch (error) {
      thrown = error;
    }
    ctx.assertEqual("real missing table calls once", calls, 1);
    ctx.assertEqual("real missing table does not sleep", sleeps, 0);
    ctx.assertEqual("real missing table propagates", thrown, realMissing);
  }

  ctx.scenario("G. Logs contain no PII / secrets");
  {
    const warnLogs: Array<{ message: string; context?: Record<string, unknown> }> =
      [];
    let n = 0;
    await getAdminWithTransientDbRetry(SHOP, {
      getAdmin: async () => {
        n += 1;
        if (n === 1) {
          throw poolTimeoutError();
        }
        return adminStub;
      },
      sleep: async () => undefined,
      warn: (message, context) => {
        warnLogs.push({ context, message });
      },
    });

    const serialized = JSON.stringify(warnLogs);
    ctx.assertTrue("warn log exists", warnLogs.length === 1);
    ctx.assertFalse(
      "logs exclude password",
      /password|DATABASE_URL|postgres:\/\//i.test(serialized),
    );
    ctx.assertFalse(
      "logs exclude token",
      /accessToken|shpat_|Bearer /i.test(serialized),
    );
    ctx.assertFalse(
      "logs exclude customer/order payloads",
      /customerEmail|orderId|creditCard/i.test(serialized),
    );
    ctx.assertEqual(
      "allowed fields only include shop + technical codes",
      Object.keys(warnLogs[0]?.context ?? {}).sort().join(","),
      ["attempt", "maxAttempts", "reasonCode", "shop", "source"].sort().join(","),
    );
  }

  ctx.scenario("Wiring — processDueSubscriptionBillings uses retry helper first");
  const workerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const processDueSource = workerSource.slice(
    workerSource.indexOf("export const processDueSubscriptionBillings"),
  );
  const retryCallIndex = processDueSource.indexOf(
    "getAdminWithTransientDbRetry(shop)",
  );
  const recoveryIndex = processDueSource.indexOf("processDueRecoveryRetries");
  const billingAttemptIndex = processDueSource.indexOf(
    "triggerSubscriptionBillingAttempt({",
  );
  ctx.assertTrue(
    "imports getAdminWithTransientDbRetry",
    workerSource.includes(
      'from "./shopify/retry-admin-session.server"',
    ),
  );
  ctx.assertTrue(
    "does not call unauthenticated.admin directly in processDue",
    !processDueSource.includes("unauthenticated.admin"),
  );
  ctx.assertTrue("retry helper called", retryCallIndex >= 0);
  ctx.assertTrue(
    "retry sits before recovery retries",
    retryCallIndex < recoveryIndex,
  );
  ctx.assertTrue(
    "retry sits before billing attempt",
    retryCallIndex < billingAttemptIndex,
  );

  return finishSuite("100-shopify-admin-session-retry", ctx);
};

process.exitCode = await runSuite();
