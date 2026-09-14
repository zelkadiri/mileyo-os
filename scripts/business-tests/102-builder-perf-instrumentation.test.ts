/**
 * Runtime checks for temporary builder perf instrumentation.
 * No framework — exercises ALS isolation + session storage wrapper transparency.
 */
import { createBusinessTestContext, finishSuite } from "./_framework";
import { instrumentSessionStorage } from "../../app/utils/instrumentedSessionStorage.server";
import {
  getBuilderPerfTimings,
  recordPrismaEngineQueryMs,
  recordSessionLoadMs,
  runWithBuilderPerfTimings,
  setBuilderPerfPhase,
} from "../../app/utils/perfTimings.server";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

const fakeSession = { id: "offline_example.myshopify.com" } as never;

const createFakeStorage = (opts?: {
  loadError?: Error;
  storeError?: Error;
}): SessionStorage & {
  calls: {
    deleteSession: number;
    deleteSessions: number;
    findSessionsByShop: number;
    loadSession: number;
    storeSession: number;
  };
} => {
  const calls = {
    deleteSession: 0,
    deleteSessions: 0,
    findSessionsByShop: 0,
    loadSession: 0,
    storeSession: 0,
  };

  return {
    calls,
    async loadSession(id) {
      calls.loadSession += 1;
      if (opts?.loadError) throw opts.loadError;
      return id ? fakeSession : undefined;
    },
    async storeSession() {
      calls.storeSession += 1;
      if (opts?.storeError) throw opts.storeError;
      return true;
    },
    async deleteSession() {
      calls.deleteSession += 1;
      return true;
    },
    async deleteSessions() {
      calls.deleteSessions += 1;
      return true;
    },
    async findSessionsByShop() {
      calls.findSessionsByShop += 1;
      return [fakeSession];
    },
  };
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("102-builder-perf-instrumentation");

  ctx.scenario("A. Wrapper transparent without ALS");
  {
    const inner = createFakeStorage();
    const wrapped = instrumentSessionStorage(inner);
    const loaded = await wrapped.loadSession("offline_x");
    ctx.assertEqual("loadSession returns inner value", loaded, fakeSession);
    ctx.assertEqual("loadSession forwarded once", inner.calls.loadSession, 1);
    ctx.assertEqual(
      "no ALS → no leaked store",
      getBuilderPerfTimings(),
      undefined,
    );

    const stored = await wrapped.storeSession(fakeSession);
    ctx.assertEqual("storeSession returns true", stored, true);
    ctx.assertEqual("storeSession forwarded once", inner.calls.storeSession, 1);

    await wrapped.deleteSession("id");
    await wrapped.deleteSessions(["a", "b"]);
    const found = await wrapped.findSessionsByShop("shop");
    ctx.assertEqual("deleteSession forwarded", inner.calls.deleteSession, 1);
    ctx.assertEqual("deleteSessions forwarded", inner.calls.deleteSessions, 1);
    ctx.assertEqual(
      "findSessionsByShop forwarded",
      inner.calls.findSessionsByShop,
      1,
    );
    ctx.assertEqual("findSessionsByShop returns inner", found.length, 1);
  }

  ctx.scenario("B. Errors propagate unchanged");
  {
    const loadErr = new Error("load-boom");
    const storeErr = new Error("store-boom");
    const loadWrapped = instrumentSessionStorage(
      createFakeStorage({ loadError: loadErr }),
    );
    const storeWrapped = instrumentSessionStorage(
      createFakeStorage({ storeError: storeErr }),
    );

    let loadCaught: unknown;
    try {
      await loadWrapped.loadSession("x");
    } catch (error) {
      loadCaught = error;
    }
    ctx.assertEqual("loadSession rethrows same error", loadCaught, loadErr);

    let storeCaught: unknown;
    try {
      await storeWrapped.storeSession(fakeSession);
    } catch (error) {
      storeCaught = error;
    }
    ctx.assertEqual("storeSession rethrows same error", storeCaught, storeErr);
  }

  ctx.scenario("C. ALS records load timing when active");
  {
    const inner = createFakeStorage();
    const wrapped = instrumentSessionStorage(inner);
    await runWithBuilderPerfTimings(async () => {
      setBuilderPerfPhase("auth");
      await wrapped.loadSession("offline_y");
      const perf = getBuilderPerfTimings();
      ctx.assertEqual("sessionLoadCount=1", perf?.sessionLoadCount, 1);
      ctx.assertTrue(
        "sessionLoad duration recorded",
        typeof perf?.sessionLoad === "number" && perf.sessionLoad >= 0,
      );
    });
    ctx.assertEqual(
      "ALS cleared after run",
      getBuilderPerfTimings(),
      undefined,
    );
  }

  ctx.scenario("D. Concurrent ALS contexts do not mix");
  {
    const results = await Promise.all([
      runWithBuilderPerfTimings(async () => {
        setBuilderPerfPhase("auth");
        recordSessionLoadMs(10);
        await new Promise((r) => setTimeout(r, 20));
        recordSessionLoadMs(5);
        return getBuilderPerfTimings()?.sessionLoad;
      }),
      runWithBuilderPerfTimings(async () => {
        setBuilderPerfPhase("auth");
        recordSessionLoadMs(100);
        await new Promise((r) => setTimeout(r, 5));
        return getBuilderPerfTimings()?.sessionLoad;
      }),
    ]);
    ctx.assertEqual("context A total sessionLoad", results[0], 15);
    ctx.assertEqual("context B total sessionLoad", results[1], 100);
  }

  ctx.scenario("E. Prisma SELECT attribution only; no write pollution");
  {
    await runWithBuilderPerfTimings(async () => {
      setBuilderPerfPhase("auth");
      recordPrismaEngineQueryMs(
        'SELECT "id" FROM "Session" WHERE "id" = $1',
        12.5,
      );
      recordPrismaEngineQueryMs(
        'INSERT INTO "Session" ("id") VALUES ($1) ON CONFLICT ("id") DO UPDATE SET "accessToken" = $2',
        99,
      );
      recordPrismaEngineQueryMs(
        'SELECT "id" FROM "AppSettings" WHERE "shop" = $1',
        40,
      );
      const authPerf = getBuilderPerfTimings();
      ctx.assertEqual(
        "auth SELECT Session counted",
        authPerf?.sessionQuery,
        12.5,
      );
      ctx.assertEqual(
        "auth upsert Session ignored (sessionQuery unchanged)",
        authPerf?.sessionQuery,
        12.5,
      );
      ctx.assertEqual(
        "AppSettings ignored outside settings phase",
        authPerf?.settingsQuery,
        0,
      );

      setBuilderPerfPhase("settings");
      recordPrismaEngineQueryMs(
        'SELECT "id","shop" FROM "AppSettings" WHERE "shop" = $1 LIMIT 1',
        33,
      );
      recordPrismaEngineQueryMs(
        'SELECT COUNT(*) FROM "Session"',
        8,
      );
      const settingsPerf = getBuilderPerfTimings();
      ctx.assertEqual(
        "settings AppSettings SELECT counted",
        settingsPerf?.settingsQuery,
        33,
      );
      ctx.assertEqual(
        "Session SELECT ignored outside auth phase",
        settingsPerf?.sessionQuery,
        12.5,
      );

      setBuilderPerfPhase("idle");
      recordPrismaEngineQueryMs(
        'SELECT COUNT(*) FROM "Session"',
        50,
      );
      ctx.assertEqual(
        "idle Session poll not attributed",
        getBuilderPerfTimings()?.sessionQuery,
        12.5,
      );
    });
  }

  ctx.scenario("F. Server-Timing source has durations only");
  {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const route = readFileSync(
      join(root, "app/routes/apps.box-builder.tsx"),
      "utf8",
    );
    const timingMaps = route.match(
      /timings\.[a-zA-Z]+ = performance\.now\(\)[\s\S]{0,40}/g,
    );
    ctx.assertTrue(
      "timings assigned from performance.now",
      Boolean(timingMaps && timingMaps.length > 0),
    );
    ctx.assertFalse(
      "no shop written into timings object",
      /timings\.[a-zA-Z]+\s*=\s*shop/.test(route),
    );
    ctx.assertFalse(
      "Server-Timing builder uses dur= only",
      /Server-Timing[\s\S]{0,200}(accessToken|refreshToken|postgres|SELECT )/i.test(
        route,
      ),
    );
  }

  return finishSuite("102-builder-perf-instrumentation", ctx);
};

process.exitCode = await runSuite();
