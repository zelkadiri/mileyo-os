#!/usr/bin/env npx tsx
/**
 * Backfill BoxOrder.objective + boxVariantShopifyId from historical rawOrder.
 *
 * Resolves the paid box line via findBoxLineItem → variant_id → box catalog
 * mileyo.objective. Never invents values. Never nulls an existing snapshot.
 *
 * Usage (dry-run by default):
 *   npx tsx --env-file=.env scripts/dev-backfill-box-order-objective.ts
 *   npx tsx --env-file=.env scripts/dev-backfill-box-order-objective.ts --shop your-shop.myshopify.com
 *
 * Apply writes:
 *   npx tsx --env-file=.env scripts/dev-backfill-box-order-objective.ts --apply
 *   npx tsx --env-file=.env scripts/dev-backfill-box-order-objective.ts --shop your-shop.myshopify.com --apply
 */
import db from "../app/db.server";
import { resolveBoxOrderObjectiveSnapshotFromRawOrder } from "../app/features/orders-webhook/box-order-objective-snapshot.server";
import { unauthenticated } from "../app/shopify.server";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const shopIndex = args.indexOf("--shop");
const shopFilter =
  shopIndex >= 0 ? args[shopIndex + 1]?.trim() || null : null;

type Counters = {
  alreadyComplete: number;
  failed: number;
  invalidObjective: number;
  missingBoxLine: number;
  missingRawOrder: number;
  missingVariantId: number;
  scanned: number;
  updated: number;
  variantNotFound: number;
};

const emptyCounters = (): Counters => ({
  alreadyComplete: 0,
  failed: 0,
  invalidObjective: 0,
  missingBoxLine: 0,
  missingRawOrder: 0,
  missingVariantId: 0,
  scanned: 0,
  updated: 0,
  variantNotFound: 0,
});

const main = async () => {
  const counters = emptyCounters();

  const candidates = await db.boxOrder.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      boxVariantShopifyId: true,
      id: true,
      objective: true,
      rawOrder: true,
      shop: true,
      shopifyOrderId: true,
      simulated: true,
    },
    where: {
      OR: [{ boxVariantShopifyId: null }, { objective: null }],
      simulated: false,
      ...(shopFilter ? { shop: shopFilter } : {}),
    },
  });

  console.log(
    `[BACKFILL_BOX_OBJECTIVE] mode=${apply ? "apply" : "dry-run"} candidates=${candidates.length}${
      shopFilter ? ` shop=${shopFilter}` : ""
    }`,
  );

  const adminByShop = new Map<
    string,
    Awaited<ReturnType<typeof unauthenticated.admin>>["admin"]
  >();

  const getAdmin = async (shop: string) => {
    const cached = adminByShop.get(shop);

    if (cached) {
      return cached;
    }

    const { admin } = await unauthenticated.admin(shop);
    adminByShop.set(shop, admin);

    return admin;
  };

  for (const order of candidates) {
    counters.scanned += 1;

    if (order.objective && order.boxVariantShopifyId) {
      counters.alreadyComplete += 1;
      continue;
    }

    try {
      const admin = await getAdmin(order.shop);
      const resolved = await resolveBoxOrderObjectiveSnapshotFromRawOrder({
        admin,
        rawOrder: order.rawOrder,
      });

      if (!resolved.ok) {
        counters[resolved.reason] += 1;
        continue;
      }

      const nextObjective = order.objective ?? resolved.snapshot.objective;
      const nextVariantId =
        order.boxVariantShopifyId ?? resolved.snapshot.boxVariantShopifyId;

      const needsUpdate =
        nextObjective !== order.objective ||
        nextVariantId !== order.boxVariantShopifyId;

      if (!needsUpdate) {
        counters.alreadyComplete += 1;
        continue;
      }

      if (apply) {
        await db.boxOrder.update({
          data: {
            // Never write null over an existing value.
            ...(order.objective ? {} : { objective: nextObjective }),
            ...(order.boxVariantShopifyId
              ? {}
              : { boxVariantShopifyId: nextVariantId }),
          },
          where: { id: order.id },
        });
      }

      counters.updated += 1;
    } catch {
      counters.failed += 1;
    }
  }

  console.log("[BACKFILL_BOX_OBJECTIVE] summary", counters);
  console.log(
    apply
      ? "[BACKFILL_BOX_OBJECTIVE] writes applied"
      : "[BACKFILL_BOX_OBJECTIVE] dry-run only — re-run with --apply to write",
  );
};

main()
  .catch((error) => {
    console.error(
      "[BACKFILL_BOX_OBJECTIVE] fatal",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
