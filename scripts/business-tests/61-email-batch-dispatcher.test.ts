/**
 * Business regression — EMAIL-INFRA-2 email batch dispatcher.
 *
 * Pure infra: concurrency pool, outcome aggregation, bounded errors.
 * No DB, no Resend, no Mileyo business rules.
 */
import {
  EMAIL_BATCH_DEFAULT_CONCURRENCY,
  EMAIL_BATCH_DEFAULT_MAX_ERRORS,
  dispatchEmailBatch,
} from "../../app/services/email/email-batch-dispatcher.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const runSuite = async () => {
  const ctx = createBusinessTestContext("61-email-batch-dispatcher");

  ctx.scenario("A. Base — empty / success / attempted");
  {
    const empty = await dispatchEmailBatch({
      items: [] as string[],
      worker: async () => ({ outcome: "success" as const }),
    });
    ctx.assertEqual("liste vide attempted", empty.attempted, 0);
    ctx.assertEqual("liste vide succeeded", empty.succeeded, 0);
    ctx.assertEqual("liste vide failed", empty.failed, 0);
    ctx.assertEqual("liste vide skipped", empty.skipped, 0);
    ctx.assertEqual("liste vide errors", empty.errors.length, 0);
  }

  {
    const one = await dispatchEmailBatch({
      items: ["a"],
      worker: async () => ({ outcome: "success" as const }),
    });
    ctx.assertEqual("un item success attempted", one.attempted, 1);
    ctx.assertEqual("un item success succeeded", one.succeeded, 1);
    ctx.assertEqual("un item success failed", one.failed, 0);
  }

  {
    const many = await dispatchEmailBatch({
      items: ["a", "b", "c", "d", "e"],
      worker: async () => ({ outcome: "success" as const }),
    });
    ctx.assertEqual("plusieurs success attempted", many.attempted, 5);
    ctx.assertEqual("plusieurs success succeeded", many.succeeded, 5);
    ctx.assertEqual("plusieurs success failed", many.failed, 0);
    ctx.assertEqual("plusieurs success skipped", many.skipped, 0);
  }

  ctx.scenario("B. Concurrence — default / custom / pool");
  {
    let active = 0;
    let maxActive = 0;
    const result = await dispatchEmailBatch({
      items: Array.from({ length: 9 }, (_, i) => i),
      worker: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(40);
        active -= 1;
        return { outcome: "success" as const };
      },
    });
    ctx.assertEqual(
      "default concurrency constante",
      EMAIL_BATCH_DEFAULT_CONCURRENCY,
      3,
    );
    ctx.assertEqual("default maxActive ≤ 3", maxActive <= 3, true);
    ctx.assertEqual("default maxActive atteint 3", maxActive, 3);
    ctx.assertEqual("default attempted", result.attempted, 9);
    ctx.assertEqual("default succeeded", result.succeeded, 9);
  }

  {
    let active = 0;
    let maxActive = 0;
    await dispatchEmailBatch({
      concurrency: 1,
      items: [1, 2, 3, 4],
      worker: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
        return { outcome: "success" as const };
      },
    });
    ctx.assertEqual("concurrency=1 maxActive", maxActive, 1);
  }

  {
    let active = 0;
    let maxActive = 0;
    await dispatchEmailBatch({
      concurrency: 2,
      items: [1, 2, 3, 4, 5],
      worker: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(25);
        active -= 1;
        return { outcome: "success" as const };
      },
    });
    ctx.assertEqual("concurrency=2 maxActive", maxActive, 2);
    ctx.assertEqual("concurrency=2 jamais > limite", maxActive <= 2, true);
  }

  {
    type TimedItem = { durationMs: number; id: string };
    const items: TimedItem[] = [
      { durationMs: 120, id: "A" },
      { durationMs: 30, id: "B" },
      { durationMs: 30, id: "C" },
    ];
    const startedAt = new Map<string, number>();
    const finishedAt = new Map<string, number>();
    const batchStarted = Date.now();

    await dispatchEmailBatch({
      concurrency: 2,
      getItemKey: (item) => item.id,
      items,
      worker: async (item) => {
        startedAt.set(item.id, Date.now() - batchStarted);
        await delay(item.durationMs);
        finishedAt.set(item.id, Date.now() - batchStarted);
        return { outcome: "success" as const };
      },
    });

    const startA = startedAt.get("A") ?? -1;
    const startB = startedAt.get("B") ?? -1;
    const startC = startedAt.get("C") ?? -1;
    const finishB = finishedAt.get("B") ?? -1;
    const finishA = finishedAt.get("A") ?? -1;

    ctx.assertTrue("A et B démarrent en premier (pool)", startA < 40 && startB < 40);
    ctx.assertTrue(
      "C démarre après libération de B, sans attendre A",
      startC >= finishB - 15 && startC < finishA - 20,
    );
  }

  ctx.scenario("C. Résultats — success / skipped / failed / throw");
  {
    const mixed = await dispatchEmailBatch({
      getItemKey: (item) => item,
      items: ["ok", "skip", "fail", "boom", "ok2"],
      worker: async (item) => {
        if (item === "ok" || item === "ok2") {
          return { outcome: "success" as const };
        }
        if (item === "skip") {
          return { outcome: "skipped" as const, reason: "already_sent" };
        }
        if (item === "fail") {
          return {
            message: "transport down",
            outcome: "failed" as const,
            reason: "send_failed",
          };
        }
        throw new Error("worker exploded");
      },
    });

    ctx.assertEqual("mixed attempted", mixed.attempted, 5);
    ctx.assertEqual("mixed succeeded", mixed.succeeded, 2);
    ctx.assertEqual("mixed skipped", mixed.skipped, 1);
    ctx.assertEqual("mixed failed", mixed.failed, 2);
    ctx.assertEqual("mixed errors length", mixed.errors.length, 2);
    ctx.assertTrue(
      "échec partiel n'arrête pas le reste",
      mixed.succeeded === 2 && mixed.attempted === 5,
    );

    const failError = mixed.errors.find((error) => error.itemKey === "fail");
    const boomError = mixed.errors.find((error) => error.itemKey === "boom");
    ctx.assertEqual("failed reason", failError?.reason, "send_failed");
    ctx.assertEqual("failed message", failError?.message, "transport down");
    ctx.assertEqual("throw message", boomError?.message, "worker exploded");
    ctx.assertEqual("throw sans reason", boomError?.reason, undefined);
  }

  {
    const completionOrder: string[] = [];
    await dispatchEmailBatch({
      concurrency: 3,
      items: [
        { durationMs: 60, id: "slow" },
        { durationMs: 10, id: "fast" },
        { durationMs: 20, id: "mid" },
      ],
      worker: async (item) => {
        await delay(item.durationMs);
        completionOrder.push(item.id);
        return { outcome: "success" as const };
      },
    });
    ctx.assertTrue(
      "ordre de completion non garanti (fast avant slow)",
      completionOrder[0] === "fast" || completionOrder.indexOf("fast") < completionOrder.indexOf("slow"),
    );
  }

  ctx.scenario("D. Errors bornées");
  {
    ctx.assertEqual(
      "default maxErrors constante",
      EMAIL_BATCH_DEFAULT_MAX_ERRORS,
      50,
    );

    const bounded = await dispatchEmailBatch({
      getItemKey: (item) => `item-${item}`,
      items: Array.from({ length: 80 }, (_, i) => i),
      worker: async (item) => ({
        message: `fail-${item}`,
        outcome: "failed" as const,
        reason: "always",
      }),
    });
    ctx.assertEqual("failed exact malgré plafond", bounded.failed, 80);
    ctx.assertEqual("attempted exact", bounded.attempted, 80);
    ctx.assertEqual("errors plafonnées à 50", bounded.errors.length, 50);
    ctx.assertEqual("itemKey présent", bounded.errors[0]?.itemKey, "item-0");
    ctx.assertTrue(
      "toutes les erreurs bornées ont itemKey",
      bounded.errors.every((error) => typeof error.itemKey === "string"),
    );
  }

  {
    const customCap = await dispatchEmailBatch({
      items: [1, 2, 3, 4, 5],
      maxErrors: 2,
      worker: async () => {
        throw new Error("nope");
      },
    });
    ctx.assertEqual("custom maxErrors failed exact", customCap.failed, 5);
    ctx.assertEqual("custom maxErrors length", customCap.errors.length, 2);
  }

  ctx.scenario("E. Validation paramètres");
  {
    let concurrencyZeroThrew = false;
    try {
      await dispatchEmailBatch({
        concurrency: 0,
        items: [1],
        worker: async () => ({ outcome: "success" as const }),
      });
    } catch {
      concurrencyZeroThrew = true;
    }
    ctx.assertTrue("concurrency 0 → exception", concurrencyZeroThrew);

    let concurrencyNegThrew = false;
    try {
      await dispatchEmailBatch({
        concurrency: -1,
        items: [1],
        worker: async () => ({ outcome: "success" as const }),
      });
    } catch {
      concurrencyNegThrew = true;
    }
    ctx.assertTrue("concurrency négative → exception", concurrencyNegThrew);

    let concurrencyFloatThrew = false;
    try {
      await dispatchEmailBatch({
        concurrency: 2.5,
        items: [1],
        worker: async () => ({ outcome: "success" as const }),
      });
    } catch {
      concurrencyFloatThrew = true;
    }
    ctx.assertTrue("concurrency non entière → exception", concurrencyFloatThrew);

    let maxErrorsNegThrew = false;
    try {
      await dispatchEmailBatch({
        items: [1],
        maxErrors: -1,
        worker: async () => ({ outcome: "success" as const }),
      });
    } catch {
      maxErrorsNegThrew = true;
    }
    ctx.assertTrue("maxErrors négatif → exception", maxErrorsNegThrew);
  }

  return finishSuite("61-email-batch-dispatcher", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
