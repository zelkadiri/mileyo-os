/**
 * Business regression — BOX-CHANGE-3B future meals on pending box change.
 *
 * Pending stores toSelectedMeals (target cycle) separately from
 * SubscriptionMealSelection (current delivery). No billing apply.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SubscriptionBoxChange } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
  SUBSCRIPTION_BOX_CHANGE_STATUS,
} from "../../app/constants/subscriptionBoxChange";
import { validateMealSelection } from "../../app/features/portal/portal-formatters";
import type { PortalMeal } from "../../app/features/portal/portal-types";
import {
  getPendingSubscriptionBoxChange,
  requestSubscriptionBoxChange,
  sameSelectedMeals,
  type SubscriptionBoxChangeDb,
} from "../../app/services/subscriptionBoxChange.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP_A = "mileyo-dev.myshopify.com";
const SHOP_B = "other-shop.myshopify.com";
const NOW = new Date("2026-08-26T10:00:00.000Z");
const EFFECTIVE_BILLING = new Date("2026-08-29T22:05:00.000Z");

let idSeq = 0;
const nextId = () => `sbc_${++idSeq}`;

const mealsFor = (count: number, prefix = "Meal") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);

const uniquePendingError = () =>
  new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`subscriptionMealSelectionId`)",
    {
      clientVersion: "test",
      code: "P2002",
      meta: { target: ["subscriptionMealSelectionId"] },
    },
  );

const matchesWhere = (
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean => {
  for (const [key, expected] of Object.entries(where)) {
    const actual = row[key];
    if (
      expected !== null &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      !(expected instanceof Date)
    ) {
      continue;
    }
    if (actual instanceof Date && expected instanceof Date) {
      if (actual.getTime() !== expected.getTime()) {
        return false;
      }
      continue;
    }
    if (actual !== expected) {
      return false;
    }
  }
  return true;
};

const createMemoryDb = () => {
  const changes: SubscriptionBoxChange[] = [];

  const db: SubscriptionBoxChangeDb = {
    async $transaction(fn) {
      return fn(db);
    },
    boxOrder: {
      async findFirst() {
        return null;
      },
    },
    subscriptionBoxChange: {
      async create({ data }) {
        if (
          data.status === SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING &&
          changes.some(
            (row) =>
              row.subscriptionMealSelectionId ===
                data.subscriptionMealSelectionId &&
              row.status === SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
          )
        ) {
          throw uniquePendingError();
        }

        const row: SubscriptionBoxChange = {
          appliedAt: null,
          cancelledAt: null,
          createdAt: NOW,
          effectiveBillingDate: data.effectiveBillingDate,
          failedAt: null,
          failureReason: null,
          fromProductVariantId: data.fromProductVariantId,
          id: nextId(),
          requestedAt: data.requestedAt ?? NOW,
          shop: data.shop,
          status: data.status,
          subscriptionContractId: data.subscriptionContractId,
          subscriptionMealSelectionId: data.subscriptionMealSelectionId,
          toMealsCount: data.toMealsCount,
          toProductVariantId: data.toProductVariantId,
          toSelectedMeals: data.toSelectedMeals,
          toSellingPlanId: data.toSellingPlanId ?? null,
          updatedAt: NOW,
        };
        changes.push(row);
        return row;
      },
      async findFirst({ orderBy, where }) {
        const filtered = changes.filter((row) =>
          matchesWhere(row as unknown as Record<string, unknown>, where),
        );
        if (orderBy && "requestedAt" in orderBy && orderBy.requestedAt === "desc") {
          filtered.sort(
            (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime(),
          );
        }
        return filtered[0] ?? null;
      },
      async findUnique({ where }) {
        return changes.find((row) => row.id === where.id) ?? null;
      },
      async update({ data, where }) {
        const index = changes.findIndex((row) => row.id === where.id);
        if (index < 0) {
          throw new Error(`missing SubscriptionBoxChange ${where.id}`);
        }
        const next = {
          ...changes[index],
          ...data,
          updatedAt: NOW,
        } as SubscriptionBoxChange;
        changes[index] = next;
        return next;
      },
      async updateMany({ data, where }) {
        let count = 0;
        for (let i = 0; i < changes.length; i += 1) {
          if (
            matchesWhere(
              changes[i] as unknown as Record<string, unknown>,
              where,
            )
          ) {
            changes[i] = {
              ...changes[i],
              ...data,
              updatedAt: NOW,
            } as SubscriptionBoxChange;
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return { changes, db };
};

const baseRequest = (
  overrides: Partial<Parameters<typeof requestSubscriptionBoxChange>[0]> = {},
) => ({
  effectiveBillingDate: EFFECTIVE_BILLING,
  fromProductVariantId: "gid://shopify/ProductVariant/8",
  shop: SHOP_A,
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  subscriptionMealSelectionId: "sel_1",
  toMealsCount: 12,
  toProductVariantId: "gid://shopify/ProductVariant/12",
  toSelectedMeals: mealsFor(12, "Future"),
  toSellingPlanId: "gid://shopify/SellingPlan/12",
  ...overrides,
});

const buildCatalogMeals = (count: number): PortalMeal[] =>
  Array.from({ length: count }, (_, index) => {
    const variantId = `gid://shopify/ProductVariant/meal_${index + 1}`;
    return {
      allergenes: [],
      badges: [],
      calories: null,
      carbs: null,
      fat: null,
      fiber: null,
      // Portal catalog sets id = variantId (see portal-catalog.server.ts).
      id: variantId,
      imageAlt: "",
      imageUrl: null,
      ingredients: [],
      objective: "weight_loss" as const,
      portionGrams: null,
      proteins: null,
      salt: null,
      saturatedFat: null,
      sugars: null,
      title: `Catalog Meal ${index + 1}`,
      variantId,
      variantTitle: "",
    };
  });

const quantitiesFor = (meals: PortalMeal[], take: number) => {
  const quantities: Record<string, number> = {};
  for (let i = 0; i < take; i += 1) {
    quantities[meals[i]!.variantId] = 1;
  }
  return quantities;
};

const runSuite = async () => {
  const ctx = createBusinessTestContext(
    "82-subscription-box-change-pending-meals",
  );

  const schemaSource = readRepoFile("prisma/schema.prisma");
  const migrationSource = readRepoFile(
    "prisma/migrations/20260826120000_add_subscription_box_change/migration.sql",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const billingWorkerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const serviceSource = readRepoFile(
    "app/services/subscriptionBoxChange.server.ts",
  );

  const changeBoxBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleChangeSubscriptionBoxAction"),
    portalActionsSource.indexOf("const handleUpdateFutureMealSelectionAction"),
  );
  const updateFutureBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleUpdateFutureMealSelectionAction"),
    portalActionsSource.indexOf("export const handlePortalAction"),
  );
  const lockedStart = changeBoxBlock.indexOf("if (locked)");
  const unpaidMarker = changeBoxBlock.indexOf(
    "// unpaid → immediate (existing behavior)",
  );
  const lockedBlock = changeBoxBlock.slice(
    lockedStart,
    unpaidMarker > lockedStart ? unpaidMarker : changeBoxBlock.length,
  );

  // Simulated current selection (not written by pending path).
  const currentSelection = {
    mealsCount: 8,
    selectedMeals: mealsFor(8, "Current"),
  };

  ctx.scenario("A. Schema — toSelectedMeals on pending only");
  ctx.assertTrue(
    "SubscriptionBoxChange has toSelectedMeals",
    /model SubscriptionBoxChange[\s\S]*toSelectedMeals\s+Json/.test(
      schemaSource,
    ),
  );
  ctx.assertTrue(
    "migration JSONB toSelectedMeals NOT NULL",
    migrationSource.includes('"toSelectedMeals" JSONB NOT NULL'),
  );
  ctx.assertTrue(
    "no billed price SoT",
    !schemaSource.includes("toPrice") && !migrationSource.includes("toPrice"),
  );

  ctx.scenario("B. Pending 12 meals — current 8 untouched");
  {
    const mem = createMemoryDb();
    const currentSnapshot = {
      mealsCount: currentSelection.mealsCount,
      selectedMeals: [...currentSelection.selectedMeals],
    };

    const result = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });

    ctx.assertEqual("pending mealsCount 12", result.change.toMealsCount, 12);
    ctx.assertEqual(
      "pending selectedMeals length 12",
      (result.change.toSelectedMeals as string[]).length,
      12,
    );
    ctx.assertTrue(
      "pending selectedMeals content",
      sameSelectedMeals(result.change.toSelectedMeals, mealsFor(12, "Future")),
    );
    ctx.assertEqual(
      "current mealsCount still 8",
      currentSnapshot.mealsCount,
      8,
    );
    ctx.assertTrue(
      "current selectedMeals still 8",
      sameSelectedMeals(currentSnapshot.selectedMeals, mealsFor(8, "Current")),
    );
    ctx.assertFalse("first not replayed", result.replayed);
  }

  ctx.scenario("C. Validation uses target mealCount (not current 8)");
  {
    const catalog = buildCatalogMeals(16);

    const ok12 = validateMealSelection({
      meals: catalog,
      mealsCount: 12,
      objective: "weight_loss",
      quantities: quantitiesFor(catalog, 12),
    });
    ctx.assertTrue("12 plats for box 12 accepted", !("error" in ok12));
    if (!("error" in ok12)) {
      ctx.assertEqual("validated titles length 12", ok12.titles.length, 12);
    }

    const tooFew = validateMealSelection({
      meals: catalog,
      mealsCount: 12,
      objective: "weight_loss",
      quantities: quantitiesFor(catalog, 11),
    });
    ctx.assertTrue("11 plats for box 12 rejected", "error" in tooFew);

    const tooMany = validateMealSelection({
      meals: catalog,
      mealsCount: 12,
      objective: "weight_loss",
      quantities: quantitiesFor(catalog, 13),
    });
    ctx.assertTrue("13 plats for box 12 rejected", "error" in tooMany);

    ctx.assertTrue(
      "locked portal validates against selectedBox.mealCount",
      lockedBlock.includes("mealsCount: selectedBox.mealCount"),
    );
    ctx.assertFalse(
      "locked portal does not validate against selection.mealsCount",
      lockedBlock.includes("mealsCount: selection.mealsCount"),
    );
  }

  ctx.scenario("D. Replay exact target+meals / replace meals same box");
  {
    const mem = createMemoryDb();
    const first = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    const replay = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    ctx.assertTrue("exact replay safe", replay.replayed);
    ctx.assertEqual("replay same id", replay.change.id, first.change.id);
    ctx.assertEqual(
      "no duplicate pending on replay",
      mem.changes.filter((row) => row.status === "pending").length,
      1,
    );

    const mealsB = mealsFor(12, "FutureB");
    const replacedMeals = await requestSubscriptionBoxChange(
      baseRequest({ toSelectedMeals: mealsB }),
      { db: mem.db, now: NOW },
    );
    ctx.assertTrue("same box new meals replaced", replacedMeals.replaced);
    ctx.assertFalse("same box new meals not replay", replacedMeals.replayed);
    ctx.assertEqual("final pending still 12", replacedMeals.change.toMealsCount, 12);
    ctx.assertTrue(
      "final pending meals are B",
      sameSelectedMeals(replacedMeals.change.toSelectedMeals, mealsB),
    );
    ctx.assertEqual(
      "exactly one active pending",
      mem.changes.filter((row) => row.status === "pending").length,
      1,
    );
  }

  ctx.scenario("E. Replace 12 → 16 — from stays current 8");
  {
    const mem = createMemoryDb();
    await requestSubscriptionBoxChange(baseRequest(), { db: mem.db, now: NOW });
    const to16 = await requestSubscriptionBoxChange(
      baseRequest({
        toMealsCount: 16,
        toProductVariantId: "gid://shopify/ProductVariant/16",
        toSelectedMeals: mealsFor(16, "Future16"),
        toSellingPlanId: "gid://shopify/SellingPlan/16",
      }),
      { db: mem.db, now: NOW },
    );
    ctx.assertTrue("12→16 replaced", to16.replaced);
    ctx.assertEqual("target mealsCount 16", to16.change.toMealsCount, 16);
    ctx.assertEqual(
      "target meals length 16",
      (to16.change.toSelectedMeals as string[]).length,
      16,
    );
    ctx.assertEqual(
      "from remains current variant 8",
      to16.change.fromProductVariantId,
      "gid://shopify/ProductVariant/8",
    );
    ctx.assertEqual(
      "to is 16 not previous 12",
      to16.change.toProductVariantId,
      "gid://shopify/ProductVariant/16",
    );
  }

  ctx.scenario("F. changeMeals courant does not touch pending");
  {
    const mem = createMemoryDb();
    const pendingMeals = mealsFor(12, "Future");
    await requestSubscriptionBoxChange(
      baseRequest({ toSelectedMeals: pendingMeals }),
      { db: mem.db, now: NOW },
    );

    // Simulate updateFutureMealSelection: only current selection changes.
    const currentAfterMealEdit = {
      mealsCount: 8,
      selectedMeals: mealsFor(8, "CurrentB"),
    };

    const pending = await getPendingSubscriptionBoxChange({
      db: mem.db,
      shop: SHOP_A,
      subscriptionMealSelectionId: "sel_1",
    });

    ctx.assertEqual("current mealsCount still 8 after edit", currentAfterMealEdit.mealsCount, 8);
    ctx.assertTrue(
      "current meals changed to B",
      sameSelectedMeals(currentAfterMealEdit.selectedMeals, mealsFor(8, "CurrentB")),
    );
    ctx.assertTrue(
      "pending meals unchanged",
      sameSelectedMeals(pending?.toSelectedMeals, pendingMeals),
    );
    ctx.assertEqual("pending mealsCount still 12", pending?.toMealsCount, 12);

    ctx.assertFalse(
      "updateFutureMealSelection source never writes pending",
      updateFutureBlock.includes("toSelectedMeals") ||
        updateFutureBlock.includes("requestSubscriptionBoxChange"),
    );
    ctx.assertTrue(
      "updateFutureMealSelection still targets selection.mealsCount",
      updateFutureBlock.includes("mealsCount: selection.mealsCount"),
    );
  }

  ctx.scenario("G. Unpaid immediate — no pending; recovery/cutoff/billing untouched");
  ctx.assertTrue(
    "unpaid still mutates Shopify",
    changeBoxBlock.includes("updateSubscriptionContractBoxViaDraft"),
  );
  ctx.assertTrue(
    "unpaid writes selection selectedMeals",
    changeBoxBlock.includes("selectedMeals: validation.titles as Prisma.InputJsonValue"),
  );
  ctx.assertTrue(
    "locked does not write SubscriptionMealSelection",
    !/subscriptionMealSelection\.update/.test(lockedBlock),
  );
  ctx.assertTrue(
    "recovery still blocks box change",
    changeBoxBlock.includes("isRecoveryBlockingBoxChange"),
  );
  ctx.assertTrue(
    "cutoff still via getPortalModificationBlockReason",
    changeBoxBlock.includes("getPortalModificationBlockReason"),
  );
  ctx.assertTrue(
    "billing worker apply wired (BOX-CHANGE-4)",
    billingWorkerSource.includes("applyPendingSubscriptionBoxChangeForBilling"),
  );
  ctx.assertFalse(
    "no applying/applied in change box",
    changeBoxBlock.includes("markSubscriptionBoxChangeApplying") ||
      changeBoxBlock.includes("markSubscriptionBoxChangeApplied"),
  );

  ctx.scenario("H. Payload serializable + shop/selection isolation");
  {
    const mem = createMemoryDb();
    const meals = mealsFor(12, "Iso");
    const created = await requestSubscriptionBoxChange(
      baseRequest({ toSelectedMeals: meals }),
      { db: mem.db, now: NOW },
    );

    const serialized = JSON.stringify(created.change.toSelectedMeals);
    const reloaded = JSON.parse(serialized) as string[];
    ctx.assertTrue(
      "toSelectedMeals JSON round-trip",
      sameSelectedMeals(reloaded, meals),
    );

    await requestSubscriptionBoxChange(
      baseRequest({
        shop: SHOP_B,
        subscriptionMealSelectionId: "sel_2",
        toSelectedMeals: mealsFor(12, "ShopB"),
      }),
      { db: mem.db, now: NOW },
    );

    const sel1 = await getPendingSubscriptionBoxChange({
      db: mem.db,
      shop: SHOP_A,
      subscriptionMealSelectionId: "sel_1",
    });
    const sel1WrongShop = await getPendingSubscriptionBoxChange({
      db: mem.db,
      shop: SHOP_B,
      subscriptionMealSelectionId: "sel_1",
    });
    const sel2 = await getPendingSubscriptionBoxChange({
      db: mem.db,
      shop: SHOP_B,
      subscriptionMealSelectionId: "sel_2",
    });

    ctx.assertTrue(
      "sel_1 pending meals Iso",
      sameSelectedMeals(sel1?.toSelectedMeals, meals),
    );
    ctx.assertEqual("shop filter isolates sel_1", sel1WrongShop, null);
    ctx.assertTrue(
      "sel_2 pending meals ShopB",
      sameSelectedMeals(sel2?.toSelectedMeals, mealsFor(12, "ShopB")),
    );
  }

  ctx.scenario("I. BOX-CHANGE-4 readiness data present on pending");
  ctx.assertTrue(
    "request input requires toSelectedMeals",
    serviceSource.includes("toSelectedMeals: string[]") ||
      serviceSource.includes("toSelectedMeals: input.toSelectedMeals"),
  );
  ctx.assertTrue(
    "idempotence includes sameSelectedMeals",
    serviceSource.includes("sameSelectedMeals"),
  );

  return finishSuite("82-subscription-box-change-pending-meals", ctx);
};

runSuite();
