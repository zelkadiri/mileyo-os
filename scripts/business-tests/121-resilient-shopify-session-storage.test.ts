/**
 * Business regression — resilient Shopify Prisma session storage heal.
 *
 * Covers poison/ready recovery. No billing. No Shopify token refresh. Deterministic mocks.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Session } from "@shopify/shopify-api";

import {
  isSessionStoragePoisonError,
  resilientShopifySessionStorage,
} from "../../app/utils/resilientShopifySessionStorage.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepoFile = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

class MissingSessionTableError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "MissingSessionTableError";
  }
}

class MissingSessionStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingSessionStorageError";
  }
}

const fakeSession = {
  id: "offline_test.myshopify.com",
  shop: "test.myshopify.com",
  isOnline: false,
  accessToken: "redacted",
} as unknown as Session;

const runSuite = async () => {
  const ctx = createBusinessTestContext("121-resilient-shopify-session-storage");

  ctx.scenario("Source — shopify.server wires resilient wrapper");
  const shopifySource = readRepoFile("app/shopify.server.ts");
  ctx.assertTrue(
    "imports resilientShopifySessionStorage",
    shopifySource.includes("resilientShopifySessionStorage"),
  );
  ctx.assertTrue(
    "wraps PrismaSessionStorage instance",
    shopifySource.includes("resilientShopifySessionStorage(prismaSessionStorage)"),
  );
  ctx.assertTrue(
    "does not change billing / HOLD imports",
    !shopifySource.includes("subscriptionBilling") &&
      !shopifySource.includes("IncidentHold"),
  );

  ctx.scenario("T1 Classifier — poison vs non-poison");
  ctx.assertTrue(
    "MissingSessionTableError is poison",
    isSessionStoragePoisonError(
      new MissingSessionTableError(
        "Prisma session table does not exist",
        new Error("The table `session` does not exist in the current database."),
      ),
    ),
  );
  ctx.assertTrue(
    "MissingSessionStorageError is poison",
    isSessionStoragePoisonError(
      new MissingSessionStorageError("Prisma session storage is not ready"),
    ),
  );
  ctx.assertTrue(
    "generic DB error is not poison",
    !isSessionStoragePoisonError(new Error("P2024 connection pool timeout")),
  );

  ctx.scenario("T1 Storage healthy — load/store pass through once");
  {
    let loads = 0;
    let stores = 0;
    let isReadyCalls = 0;
    const inner = {
      async loadSession() {
        loads += 1;
        return fakeSession;
      },
      async storeSession() {
        stores += 1;
        return true;
      },
      async deleteSession() {
        return true;
      },
      async deleteSessions() {
        return true;
      },
      async findSessionsByShop() {
        return [fakeSession];
      },
      async isReady() {
        isReadyCalls += 1;
        return true;
      },
    };
    const wrapped = resilientShopifySessionStorage(inner);
    const loaded = await wrapped.loadSession("offline_test.myshopify.com");
    const stored = await wrapped.storeSession(fakeSession);
    ctx.assertEqual("healthy load once", loads, 1);
    ctx.assertEqual("healthy store once", stores, 1);
    ctx.assertEqual("healthy no isReady", isReadyCalls, 0);
    ctx.assertTrue("healthy load returns session", loaded === fakeSession);
    ctx.assertTrue("healthy store returns true", stored === true);
  }

  ctx.scenario("T2/T3 Poisoned ready — isReady heal then single retry");
  {
    let loads = 0;
    let isReadyCalls = 0;
    const inner = {
      async loadSession() {
        loads += 1;
        if (loads === 1) {
          throw new MissingSessionTableError(
            "Prisma session table does not exist",
            new Error("The table `session` does not exist in the current database."),
          );
        }
        return fakeSession;
      },
      async storeSession() {
        return true;
      },
      async deleteSession() {
        return true;
      },
      async deleteSessions() {
        return true;
      },
      async findSessionsByShop() {
        return [];
      },
      async isReady() {
        isReadyCalls += 1;
        return true;
      },
    };
    const wrapped = resilientShopifySessionStorage(inner);
    const loaded = await wrapped.loadSession("offline_test.myshopify.com");
    ctx.assertEqual("poison load retried once", loads, 2);
    ctx.assertEqual("isReady called once", isReadyCalls, 1);
    ctx.assertTrue("healed load returns session", loaded === fakeSession);
  }

  ctx.scenario("T4 Persistent failure — original error rethrown");
  {
    let loads = 0;
    let isReadyCalls = 0;
    const poison = new MissingSessionTableError(
      "Prisma session table does not exist",
      new Error("The table `session` does not exist in the current database."),
    );
    const inner = {
      async loadSession() {
        loads += 1;
        throw poison;
      },
      async storeSession() {
        return true;
      },
      async deleteSession() {
        return true;
      },
      async deleteSessions() {
        return true;
      },
      async findSessionsByShop() {
        return [];
      },
      async isReady() {
        isReadyCalls += 1;
        return false;
      },
    };
    const wrapped = resilientShopifySessionStorage(inner);
    let caught: unknown;
    try {
      await wrapped.loadSession("offline_test.myshopify.com");
    } catch (error) {
      caught = error;
    }
    ctx.assertEqual("persistent load attempted once before heal", loads, 1);
    ctx.assertEqual("isReady attempted", isReadyCalls, 1);
    ctx.assertTrue("rethrows original poison", caught === poison);
  }

  ctx.scenario("T5 Retry limited — no infinite loop on post-heal failure");
  {
    let loads = 0;
    let isReadyCalls = 0;
    const poison = new MissingSessionTableError("Prisma session table does not exist");
    const inner = {
      async loadSession() {
        loads += 1;
        throw poison;
      },
      async storeSession() {
        return true;
      },
      async deleteSession() {
        return true;
      },
      async deleteSessions() {
        return true;
      },
      async findSessionsByShop() {
        return [];
      },
      async isReady() {
        isReadyCalls += 1;
        return true;
      },
    };
    const wrapped = resilientShopifySessionStorage(inner);
    let caught: unknown;
    try {
      await wrapped.loadSession("x");
    } catch (error) {
      caught = error;
    }
    ctx.assertEqual("exactly two load attempts", loads, 2);
    ctx.assertEqual("exactly one isReady", isReadyCalls, 1);
    ctx.assertTrue("second failure surfaces", caught === poison);
  }

  ctx.scenario("T6 storeSession heal path");
  {
    let stores = 0;
    const inner = {
      async loadSession() {
        return undefined;
      },
      async storeSession() {
        stores += 1;
        if (stores === 1) {
          throw new MissingSessionStorageError("Prisma session storage is not ready");
        }
        return true;
      },
      async deleteSession() {
        return true;
      },
      async deleteSessions() {
        return true;
      },
      async findSessionsByShop() {
        return [];
      },
      async isReady() {
        return true;
      },
    };
    const wrapped = resilientShopifySessionStorage(inner);
    const ok = await wrapped.storeSession(fakeSession);
    ctx.assertEqual("store retried once", stores, 2);
    ctx.assertTrue("store succeeded after heal", ok === true);
  }

  ctx.scenario("T6b Non-poison errors are not healed");
  {
    let loads = 0;
    let isReadyCalls = 0;
    const boom = new Error("P2024 pool timeout");
    const inner = {
      async loadSession() {
        loads += 1;
        throw boom;
      },
      async storeSession() {
        return true;
      },
      async deleteSession() {
        return true;
      },
      async deleteSessions() {
        return true;
      },
      async findSessionsByShop() {
        return [];
      },
      async isReady() {
        isReadyCalls += 1;
        return true;
      },
    };
    const wrapped = resilientShopifySessionStorage(inner);
    let caught: unknown;
    try {
      await wrapped.loadSession("x");
    } catch (error) {
      caught = error;
    }
    ctx.assertEqual("non-poison load once", loads, 1);
    ctx.assertEqual("non-poison no isReady", isReadyCalls, 0);
    ctx.assertTrue("non-poison rethrown", caught === boom);
  }

  ctx.scenario("T7/T10 Source guards — no token/billing/HOLD mutations");
  const resilientSource = readRepoFile(
    "app/utils/resilientShopifySessionStorage.server.ts",
  );
  ctx.assertTrue(
    "no refresh_token grant",
    !resilientSource.includes("refresh_token") &&
      !resilientSource.includes("access_token"),
  );
  ctx.assertTrue(
    "no Session deleteAll / truncate",
    !resilientSource.includes("deleteMany") &&
      !resilientSource.includes("TRUNCATE"),
  );
  ctx.assertTrue(
    "no billing / HOLD coupling",
    !resilientSource.includes("Billing") &&
      !resilientSource.includes("HOLD") &&
      !resilientSource.includes("IncidentHold"),
  );

  return finishSuite("121-resilient-shopify-session-storage", ctx);
};

process.exitCode = await runSuite();
