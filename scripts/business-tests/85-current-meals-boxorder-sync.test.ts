/**
 * Business regression — BOX-CHANGE-7D current-delivery meals → BoxOrder write-through.
 *
 * Paid delivery: Selection + matching BoxOrder.selectedMeals sync; mealsCount frozen.
 * No BoxOrder: Selection-only. Pending future meals untouched. Prep reads BoxOrder.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPreparationDayDataFromBoxOrders } from "../../app/features/preparation/preparation-data.server";
import type { PreparationBoxOrderRecord } from "../../app/features/preparation/preparation-types";
import {
  applyCurrentDeliveryMealSelectionUpdate,
  findCurrentDeliveryBoxOrder,
  PORTAL_CURRENT_DELIVERY_MEALS_SOURCE,
  type CurrentDeliveryMealsDb,
} from "../../app/services/subscriptionCurrentDeliveryMeals.server";
import { parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const SELECTION_ID = "sel_current_10";
const CONTRACT_ID = "28337537164";
const DELIVERY = "2026-08-27";
const OTHER_DELIVERY = "2026-08-20";
const TARGET_DATE = parseDeliveryDate(DELIVERY)!;

const meals10 = (prefix: string) =>
  Array.from({ length: 10 }, (_, i) => `${prefix} ${i + 1}`);

type MemBoxOrder = {
  id: string;
  mealsCount: number | null;
  scheduledDeliveryDate: string | null;
  selectedMeals: unknown;
  selectedMealsSource: string | null;
  shop: string;
  simulated: boolean;
  subscriptionContractId: string | null;
  subscriptionSelectionId: string | null;
};

type MemSelection = {
  id: string;
  mealSelectionLastExplicitDeliveryDate: string | null;
  mealsCount: number;
  selectedMeals: unknown;
};

type MemPending = {
  id: string;
  toMealsCount: number;
  toSelectedMeals: string[];
};

const matchesWhere = (
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean => {
  for (const [key, expected] of Object.entries(where)) {
    if (row[key] !== expected) {
      return false;
    }
  }
  return true;
};

const createMemoryDb = ({
  boxOrders,
  pending,
  selection,
}: {
  boxOrders: MemBoxOrder[];
  pending?: MemPending;
  selection: MemSelection;
}) => {
  let selectionState = { ...selection };
  const orders = boxOrders.map((order) => ({ ...order }));
  const pendingState = pending ? { ...pending, toSelectedMeals: [...pending.toSelectedMeals] } : null;
  let createdBoxOrders = 0;

  const db: CurrentDeliveryMealsDb & {
    _createdBoxOrders: () => number;
    _orders: () => MemBoxOrder[];
    _pending: () => MemPending | null;
    _selection: () => MemSelection;
  } = {
    _createdBoxOrders: () => createdBoxOrders,
    _orders: () => orders,
    _pending: () => pendingState,
    _selection: () => selectionState,
    async $transaction(fn) {
      return fn(db);
    },
    boxOrder: {
      async findMany({ take, where }) {
        const matched = orders.filter((order) =>
          matchesWhere(order as unknown as Record<string, unknown>, where),
        );
        return matched.slice(0, take ?? matched.length).map((order) => ({
          id: order.id,
          mealsCount: order.mealsCount,
          selectedMeals: order.selectedMeals,
        }));
      },
      async update({ data, where }) {
        const order = orders.find((row) => row.id === where.id);
        if (!order) {
          throw new Error(`boxOrder missing: ${where.id}`);
        }
        order.selectedMeals = data.selectedMeals;
        order.selectedMealsSource = data.selectedMealsSource;
        return order;
      },
    },
    subscriptionMealSelection: {
      async update({ data, where }) {
        if (where.id !== selectionState.id) {
          throw new Error(`selection missing: ${where.id}`);
        }
        selectionState = {
          ...selectionState,
          selectedMeals: data.selectedMeals,
          mealSelectionLastExplicitDeliveryDate:
            data.mealSelectionLastExplicitDeliveryDate ??
            selectionState.mealSelectionLastExplicitDeliveryDate,
        };
        return selectionState;
      },
    },
  };

  // Track accidental creates — helper must never create BoxOrders.
  (db as { boxOrder: CurrentDeliveryMealsDb["boxOrder"] & { create?: () => void } }).boxOrder.create =
    () => {
      createdBoxOrders += 1;
      throw new Error("boxOrder.create must not be called");
    };

  return db;
};

const toPrepRecord = (order: MemBoxOrder): PreparationBoxOrderRecord => ({
  boxTitle: `Box ${order.mealsCount ?? "?"} repas`,
  createdAt: new Date("2026-08-20T10:00:00.000Z"),
  customerEmail: "client@example.com",
  customerName: "Client QA",
  deliveryRescheduleReason: null,
  desiredDeliveryDate: order.scheduledDeliveryDate,
  id: order.id,
  isSubscriptionRenewal: order.id.includes("renewal"),
  mealsCount: order.mealsCount,
  orderType: "Abonnement hebdomadaire",
  scheduledDeliveryDate: order.scheduledDeliveryDate,
  selectedMeals: order.selectedMeals,
  shopifyOrderName: order.id === "bo_1032" ? "#1032" : "#1000",
  simulated: order.simulated,
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("85-current-meals-boxorder-sync");

  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const helperSource = readRepoFile(
    "app/services/subscriptionCurrentDeliveryMeals.server.ts",
  );
  const preparationSource = readRepoFile(
    "app/features/preparation/preparation-data.server.ts",
  );

  const updateFutureBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleUpdateFutureMealSelectionAction"),
    portalActionsSource.indexOf("export const handlePortalAction"),
  );

  ctx.scenario("0. Source wiring — write-through on changeMeals only");
  ctx.assertTrue(
    "helper exported",
    helperSource.includes("export const applyCurrentDeliveryMealSelectionUpdate"),
  );
  ctx.assertTrue(
    "portal updateFuture calls helper",
    updateFutureBlock.includes("applyCurrentDeliveryMealSelectionUpdate"),
  );
  ctx.assertTrue(
    "uses resolveMealSelectionCycle for date (no second date logic)",
    updateFutureBlock.includes("resolveMealSelectionCycle(selection)"),
  );
  ctx.assertTrue(
    "fail-closed on sync error (no false success)",
    updateFutureBlock.includes("if (!syncResult.ok)") &&
      updateFutureBlock.includes("return renderMessage"),
  );
  ctx.assertFalse(
    "helper never writes mealsCount",
    /boxOrder\.update[\s\S]{0,400}mealsCount/.test(helperSource),
  );
  ctx.assertFalse(
    "preparation loader unchanged (no overlay)",
    preparationSource.includes("applyCurrentDeliveryMealSelectionUpdate") ||
      preparationSource.includes("mealSelectionLastExplicitDeliveryDate"),
  );
  ctx.assertFalse(
    "changeMeals does not touch pending request API",
    updateFutureBlock.includes("requestSubscriptionBoxChange"),
  );

  const oldMeals = meals10("Cordon");
  const newMeals = [...oldMeals];
  newMeals[0] = "Boulgour";
  const pendingMeals = meals10("Future").concat(meals10("Extra").slice(0, 6));

  ctx.scenario("1–5. Paid BoxOrder 10 — write-through plats, count figé");
  {
    const db = createMemoryDb({
      boxOrders: [
        {
          id: "bo_1032",
          mealsCount: 10,
          scheduledDeliveryDate: DELIVERY,
          selectedMeals: oldMeals,
          selectedMealsSource: "saved_selection",
          shop: SHOP,
          simulated: false,
          subscriptionContractId: CONTRACT_ID,
          subscriptionSelectionId: SELECTION_ID,
        },
      ],
      selection: {
        id: SELECTION_ID,
        mealSelectionLastExplicitDeliveryDate: null,
        mealsCount: 10,
        selectedMeals: oldMeals,
      },
    });

    const result = await applyCurrentDeliveryMealSelectionUpdate({
      db,
      effectiveDeliveryDate: DELIVERY,
      mealsCount: 10,
      selectedMeals: newMeals,
      shop: SHOP,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    });

    ctx.assertTrue("sync ok", result.ok);
    if (result.ok) {
      ctx.assertTrue("boxOrderSynced", result.boxOrderSynced);
      ctx.assertEqual("boxOrderId", result.boxOrderId, "bo_1032");
    }
    ctx.assertEqual(
      "Selection nouveaux 10",
      JSON.stringify(db._selection().selectedMeals),
      JSON.stringify(newMeals),
    );
    ctx.assertEqual(
      "BoxOrder nouveaux 10",
      JSON.stringify(db._orders()[0]!.selectedMeals),
      JSON.stringify(newMeals),
    );
    ctx.assertEqual("BoxOrder.mealsCount reste 10", db._orders()[0]!.mealsCount, 10);
    ctx.assertEqual(
      "selectedMealsSource portal edit",
      db._orders()[0]!.selectedMealsSource,
      PORTAL_CURRENT_DELIVERY_MEALS_SOURCE,
    );
    ctx.assertEqual(
      "explicit delivery tracked",
      db._selection().mealSelectionLastExplicitDeliveryDate,
      DELIVERY,
    );
    ctx.assertTrue("Boulgour présent", newMeals.includes("Boulgour"));
    ctx.assertFalse(
      "ancien plat retiré de BoxOrder",
      (db._orders()[0]!.selectedMeals as string[]).includes("Cordon 1"),
    );
  }

  ctx.scenario("6–9. Preparation lit nouveaux plats via BoxOrder");
  {
    const syncedOrder: MemBoxOrder = {
      id: "bo_1032",
      mealsCount: 10,
      scheduledDeliveryDate: DELIVERY,
      selectedMeals: newMeals,
      selectedMealsSource: PORTAL_CURRENT_DELIVERY_MEALS_SOURCE,
      shop: SHOP,
      simulated: false,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    };
    const day = buildPreparationDayDataFromBoxOrders(
      [toPrepRecord(syncedOrder)],
      TARGET_DATE,
    );
    ctx.assertEqual("prep 1 order", day.orders.length, 1);
    ctx.assertTrue(
      "prep contains Boulgour",
      day.orders[0]!.selectedMeals.includes("Boulgour"),
    );
    ctx.assertFalse(
      "prep sans Cordon 1",
      day.orders[0]!.selectedMeals.includes("Cordon 1"),
    );
    ctx.assertEqual(
      "agrégat Boulgour",
      day.mealTotals.find((m) => m.mealTitle === "Boulgour")?.totalQuantity,
      1,
    );
    ctx.assertEqual(
      "prep mealsCount display still 10",
      day.orders[0]!.mealsCount,
      10,
    );
  }

  ctx.scenario("10–13. Pending isolation — current edit n'altère pas pending 16");
  {
    const db = createMemoryDb({
      boxOrders: [
        {
          id: "bo_1032",
          mealsCount: 10,
          scheduledDeliveryDate: DELIVERY,
          selectedMeals: oldMeals,
          selectedMealsSource: "saved_selection",
          shop: SHOP,
          simulated: false,
          subscriptionContractId: CONTRACT_ID,
          subscriptionSelectionId: SELECTION_ID,
        },
      ],
      pending: {
        id: "pending_16",
        toMealsCount: 16,
        toSelectedMeals: pendingMeals,
      },
      selection: {
        id: SELECTION_ID,
        mealSelectionLastExplicitDeliveryDate: DELIVERY,
        mealsCount: 10,
        selectedMeals: oldMeals,
      },
    });

    const pendingBefore = JSON.stringify(db._pending());

    await applyCurrentDeliveryMealSelectionUpdate({
      db,
      effectiveDeliveryDate: DELIVERY,
      mealsCount: 10,
      selectedMeals: newMeals,
      shop: SHOP,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    });

    ctx.assertEqual("pending JSON inchangé", JSON.stringify(db._pending()), pendingBefore);
    ctx.assertEqual("pending toMealsCount 16", db._pending()!.toMealsCount, 16);
    ctx.assertEqual(
      "pending toSelectedMeals length 16",
      db._pending()!.toSelectedMeals.length,
      16,
    );
    ctx.assertEqual("current BoxOrder count 10", db._orders()[0]!.mealsCount, 10);
  }

  ctx.scenario("14. Wrong delivery — ancien BoxOrder autre date non modifié");
  {
    const historicalMeals = meals10("Old");
    const db = createMemoryDb({
      boxOrders: [
        {
          id: "bo_old",
          mealsCount: 10,
          scheduledDeliveryDate: OTHER_DELIVERY,
          selectedMeals: historicalMeals,
          selectedMealsSource: "order_properties",
          shop: SHOP,
          simulated: false,
          subscriptionContractId: CONTRACT_ID,
          subscriptionSelectionId: SELECTION_ID,
        },
        {
          id: "bo_1032",
          mealsCount: 10,
          scheduledDeliveryDate: DELIVERY,
          selectedMeals: oldMeals,
          selectedMealsSource: "saved_selection",
          shop: SHOP,
          simulated: false,
          subscriptionContractId: CONTRACT_ID,
          subscriptionSelectionId: SELECTION_ID,
        },
      ],
      selection: {
        id: SELECTION_ID,
        mealSelectionLastExplicitDeliveryDate: null,
        mealsCount: 10,
        selectedMeals: oldMeals,
      },
    });

    await applyCurrentDeliveryMealSelectionUpdate({
      db,
      effectiveDeliveryDate: DELIVERY,
      mealsCount: 10,
      selectedMeals: newMeals,
      shop: SHOP,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    });

    ctx.assertEqual(
      "historique inchangé",
      JSON.stringify(db._orders().find((o) => o.id === "bo_old")!.selectedMeals),
      JSON.stringify(historicalMeals),
    );
    ctx.assertEqual(
      "historique source inchangée",
      db._orders().find((o) => o.id === "bo_old")!.selectedMealsSource,
      "order_properties",
    );
    ctx.assertEqual(
      "current synced",
      JSON.stringify(db._orders().find((o) => o.id === "bo_1032")!.selectedMeals),
      JSON.stringify(newMeals),
    );
  }

  ctx.scenario("15–17. No current BoxOrder — Selection only, aucun create");
  {
    const db = createMemoryDb({
      boxOrders: [],
      selection: {
        id: SELECTION_ID,
        mealSelectionLastExplicitDeliveryDate: null,
        mealsCount: 10,
        selectedMeals: oldMeals,
      },
    });

    const result = await applyCurrentDeliveryMealSelectionUpdate({
      db,
      effectiveDeliveryDate: DELIVERY,
      mealsCount: 10,
      selectedMeals: newMeals,
      shop: SHOP,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    });

    ctx.assertTrue("selection-only ok", result.ok);
    if (result.ok) {
      ctx.assertFalse("boxOrderSynced false", result.boxOrderSynced);
      ctx.assertNull("boxOrderId null", result.boxOrderId);
    }
    ctx.assertEqual(
      "Selection updated",
      JSON.stringify(db._selection().selectedMeals),
      JSON.stringify(newMeals),
    );
    ctx.assertEqual("aucun BoxOrder", db._orders().length, 0);
    ctx.assertEqual("aucun create", db._createdBoxOrders(), 0);
  }

  ctx.scenario("18–19. Count mismatch — abort, aucune écriture");
  {
    const db = createMemoryDb({
      boxOrders: [
        {
          id: "bo_1032",
          mealsCount: 10,
          scheduledDeliveryDate: DELIVERY,
          selectedMeals: oldMeals,
          selectedMealsSource: "saved_selection",
          shop: SHOP,
          simulated: false,
          subscriptionContractId: CONTRACT_ID,
          subscriptionSelectionId: SELECTION_ID,
        },
      ],
      selection: {
        id: SELECTION_ID,
        mealSelectionLastExplicitDeliveryDate: null,
        mealsCount: 8,
        selectedMeals: meals10("Sel").slice(0, 8),
      },
    });

    const result = await applyCurrentDeliveryMealSelectionUpdate({
      db,
      effectiveDeliveryDate: DELIVERY,
      mealsCount: 8,
      selectedMeals: meals10("New").slice(0, 8),
      shop: SHOP,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    });

    ctx.assertFalse("mismatch refused", result.ok);
    if (!result.ok) {
      ctx.assertEqual(
        "error code",
        result.error,
        "box_order_meals_count_mismatch",
      );
    }
    ctx.assertEqual(
      "Selection non mutée",
      JSON.stringify(db._selection().selectedMeals),
      JSON.stringify(meals10("Sel").slice(0, 8)),
    );
    ctx.assertEqual(
      "BoxOrder non muté",
      JSON.stringify(db._orders()[0]!.selectedMeals),
      JSON.stringify(oldMeals),
    );
    ctx.assertEqual("BoxOrder count toujours 10", db._orders()[0]!.mealsCount, 10);
  }

  ctx.scenario("20. Renewal BoxOrder write-through");
  {
    const db = createMemoryDb({
      boxOrders: [
        {
          id: "bo_renewal",
          mealsCount: 10,
          scheduledDeliveryDate: DELIVERY,
          selectedMeals: oldMeals,
          selectedMealsSource: "saved_selection",
          shop: SHOP,
          simulated: false,
          subscriptionContractId: CONTRACT_ID,
          subscriptionSelectionId: SELECTION_ID,
        },
      ],
      selection: {
        id: SELECTION_ID,
        mealSelectionLastExplicitDeliveryDate: null,
        mealsCount: 10,
        selectedMeals: oldMeals,
      },
    });

    const result = await applyCurrentDeliveryMealSelectionUpdate({
      db,
      effectiveDeliveryDate: DELIVERY,
      mealsCount: 10,
      selectedMeals: newMeals,
      shop: SHOP,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    });

    ctx.assertTrue("renewal sync ok", result.ok);
    ctx.assertEqual(
      "renewal BoxOrder meals",
      JSON.stringify(db._orders()[0]!.selectedMeals),
      JSON.stringify(newMeals),
    );
    ctx.assertEqual("renewal count frozen", db._orders()[0]!.mealsCount, 10);
  }

  ctx.scenario("21. Identification — selectionId + date ; pas last-by-customer");
  {
    const located = await findCurrentDeliveryBoxOrder({
      db: createMemoryDb({
        boxOrders: [
          {
            id: "bo_wrong_customer_style",
            mealsCount: 10,
            scheduledDeliveryDate: DELIVERY,
            selectedMeals: oldMeals,
            selectedMealsSource: "saved_selection",
            shop: SHOP,
            simulated: false,
            subscriptionContractId: "999",
            subscriptionSelectionId: "other_sel",
          },
          {
            id: "bo_1032",
            mealsCount: 10,
            scheduledDeliveryDate: DELIVERY,
            selectedMeals: oldMeals,
            selectedMealsSource: "saved_selection",
            shop: SHOP,
            simulated: false,
            subscriptionContractId: CONTRACT_ID,
            subscriptionSelectionId: SELECTION_ID,
          },
        ],
        selection: {
          id: SELECTION_ID,
          mealSelectionLastExplicitDeliveryDate: null,
          mealsCount: 10,
          selectedMeals: oldMeals,
        },
      }),
      effectiveDeliveryDate: DELIVERY,
      shop: SHOP,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    });

    ctx.assertTrue("located ok", located.ok);
    if (located.ok) {
      ctx.assertEqual("matched selection BoxOrder", located.boxOrder?.id, "bo_1032");
    }
  }

  ctx.scenario("22. Contract fallback when subscriptionSelectionId missing on BoxOrder");
  {
    const db = createMemoryDb({
      boxOrders: [
        {
          id: "bo_unlinked",
          mealsCount: 10,
          scheduledDeliveryDate: DELIVERY,
          selectedMeals: oldMeals,
          selectedMealsSource: "order_properties",
          shop: SHOP,
          simulated: false,
          subscriptionContractId: CONTRACT_ID,
          subscriptionSelectionId: null,
        },
      ],
      selection: {
        id: SELECTION_ID,
        mealSelectionLastExplicitDeliveryDate: null,
        mealsCount: 10,
        selectedMeals: oldMeals,
      },
    });

    const result = await applyCurrentDeliveryMealSelectionUpdate({
      db,
      effectiveDeliveryDate: DELIVERY,
      mealsCount: 10,
      selectedMeals: newMeals,
      shop: SHOP,
      subscriptionContractId: CONTRACT_ID,
      subscriptionSelectionId: SELECTION_ID,
    });

    ctx.assertTrue("fallback sync ok", result.ok);
    ctx.assertEqual(
      "unlinked BoxOrder updated via contract",
      JSON.stringify(db._orders()[0]!.selectedMeals),
      JSON.stringify(newMeals),
    );
  }

  ctx.scenario("23. Validation length guard — helper throws before DB");
  {
    let threw = false;
    try {
      await applyCurrentDeliveryMealSelectionUpdate({
        db: createMemoryDb({
          boxOrders: [],
          selection: {
            id: SELECTION_ID,
            mealSelectionLastExplicitDeliveryDate: null,
            mealsCount: 10,
            selectedMeals: oldMeals,
          },
        }),
        effectiveDeliveryDate: DELIVERY,
        mealsCount: 10,
        selectedMeals: meals10("X").slice(0, 9),
        shop: SHOP,
        subscriptionSelectionId: SELECTION_ID,
      });
    } catch {
      threw = true;
    }
    ctx.assertTrue("rejects length mismatch before write", threw);
  }

  // Cutoff: portal still gates via getPortalModificationBlockResponse before sync.
  ctx.assertTrue(
    "cutoff block before sync (source)",
    updateFutureBlock.indexOf("getPortalModificationBlockResponse") <
      updateFutureBlock.indexOf("applyCurrentDeliveryMealSelectionUpdate"),
  );

  return finishSuite("85-current-meals-boxorder-sync", ctx);
};

runSuite().catch((error) => {
  console.error(error);
  process.exit(1);
});
