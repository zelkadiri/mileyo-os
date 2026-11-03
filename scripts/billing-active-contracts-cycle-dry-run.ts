#!/usr/bin/env npx tsx
/**
 * READ-ONLY dry-run — classify all ACTIVE local selections against Shopify cycles.
 * Never creates billing attempts. Never writes DB. Never mutates Shopify.
 *
 * Usage (PROD credentials via .env.production.local DIRECT_URL — SELECT only):
 *   npx tsx scripts/billing-active-contracts-cycle-dry-run.ts
 */
import { PrismaClient } from "@prisma/client";
import { classifyBillableShopifyCycle } from "../app/services/shopifySubscriptionBillingCycle.server";
import { isSubscriptionBillingIncidentHeld } from "../app/constants/subscriptionBillingIncidentHold";

type CycleNode = {
  cycleIndex: number;
  cycleStartAt: string;
  cycleEndAt: string;
  billingAttemptExpectedDate: string;
  status: string;
  skipped: boolean;
  edited: boolean;
  billingAttempts?: {
    edges?: Array<{
      node: {
        id: string;
        createdAt: string;
        completedAt?: string | null;
        idempotencyKey?: string | null;
        order?: { id?: string | null; name?: string | null } | null;
      };
    }>;
  };
};

const mapCycles = (nodes: CycleNode[]) =>
  nodes.map((node) => {
    const attempts = (node.billingAttempts?.edges ?? []).map((edge) => ({
      completedAt: edge.node.completedAt ?? null,
      createdAt: edge.node.createdAt,
      id: edge.node.id,
      idempotencyKey: edge.node.idempotencyKey ?? null,
      orderId: edge.node.order?.id ?? null,
      orderName: edge.node.order?.name ?? null,
    }));
    return {
      attempts,
      billingAttemptExpectedDate: node.billingAttemptExpectedDate,
      cycleEndAt: node.cycleEndAt,
      cycleIndex: node.cycleIndex,
      cycleStartAt: node.cycleStartAt,
      edited: node.edited,
      skipped: node.skipped,
      status: node.status,
      successfulAttempts: attempts.filter((a) => Boolean(a.orderId)),
    };
  });

const query = `#graphql
  query DryRunCycles($contractId: ID!) {
    subscriptionContract(id: $contractId) {
      id
      status
      nextBillingDate
    }
    subscriptionBillingCycles(
      contractId: $contractId
      first: 20
      billingCyclesIndexRangeSelector: { startIndex: 1, endIndex: 20 }
    ) {
      nodes {
        cycleIndex
        cycleStartAt
        cycleEndAt
        billingAttemptExpectedDate
        status
        skipped
        edited
        billingAttempts(first: 15) {
          edges {
            node {
              id
              createdAt
              completedAt
              idempotencyKey
              order { id name }
            }
          }
        }
      }
    }
  }
`;

const main = async () => {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL required (read-only intended)");
  }

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await db.$executeRawUnsafe(`SET default_transaction_read_only = on`);

  const sessions = (await db.$queryRawUnsafe(`
    SELECT shop, "accessToken" FROM "Session" WHERE shop LIKE '%4pvhfk%' LIMIT 1
  `)) as { shop: string; accessToken: string }[];
  if (!sessions[0]) {
    throw new Error("No Shopify session");
  }
  const { shop, accessToken } = sessions[0];

  const selections = (await db.$queryRawUnsafe(`
    SELECT id, "subscriptionContractId", "nextBillingDate", status, active,
           "lastBillingAttemptStatus"
    FROM "SubscriptionMealSelection"
    WHERE shop LIKE '%4pvhfk%' AND active = true AND status = 'active'
      AND "subscriptionContractId" IS NOT NULL
    ORDER BY id
  `)) as {
    id: string;
    subscriptionContractId: string;
    nextBillingDate: Date | null;
    status: string;
    active: boolean;
    lastBillingAttemptStatus: string | null;
  }[];

  const now = new Date();
  const rows: Record<string, unknown>[] = [];
  const counts = {
    already_paid: 0,
    billable: 0,
    block_ambiguous: 0,
    block_unresolvable: 0,
    held_incident: 0,
    missing_nbd: 0,
    shopify_error: 0,
  };

  for (const selection of selections) {
    if (isSubscriptionBillingIncidentHeld(selection.subscriptionContractId)) {
      counts.held_incident += 1;
      rows.push({
        bucket: "held_incident",
        contractId: selection.subscriptionContractId,
        selectionId: selection.id,
        note: "Incident hold — no charge after deploy",
      });
      continue;
    }

    if (!selection.nextBillingDate) {
      counts.missing_nbd += 1;
      rows.push({
        bucket: "missing_nbd",
        contractId: selection.subscriptionContractId,
        selectionId: selection.id,
      });
      continue;
    }

    const contractGid = selection.subscriptionContractId.includes("/")
      ? selection.subscriptionContractId
      : `gid://shopify/SubscriptionContract/${selection.subscriptionContractId}`;

    const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query,
        variables: { contractId: contractGid },
      }),
    });
    const json = (await res.json()) as {
      data?: {
        subscriptionContract?: {
          nextBillingDate?: string | null;
          status?: string;
        };
        subscriptionBillingCycles?: { nodes?: CycleNode[] };
      };
      errors?: { message?: string }[];
    };

    if (json.errors?.length || !json.data) {
      counts.shopify_error += 1;
      rows.push({
        bucket: "shopify_error",
        contractId: selection.subscriptionContractId,
        selectionId: selection.id,
        error: json.errors?.map((e) => e.message).join("; ") ?? "no data",
      });
      continue;
    }

    const cycles = mapCycles(json.data.subscriptionBillingCycles?.nodes ?? []);
    const classified = classifyBillableShopifyCycle({
      cycles,
      nextBillingDate: new Date(selection.nextBillingDate),
      now,
    });

    const nbdDue = new Date(selection.nextBillingDate).getTime() <= now.getTime();
    const bucket =
      classified.action === "billable"
        ? nbdDue
          ? "billable_due"
          : "billable_future_nbd"
        : classified.action;

    if (classified.action in counts) {
      (counts as Record<string, number>)[classified.action] += 1;
    }
    if (classified.action === "billable" && !nbdDue) {
      // keep billable count but note future
    }

    rows.push({
      bucket,
      contractId: selection.subscriptionContractId,
      selectionId: selection.id,
      localNbd: new Date(selection.nextBillingDate).toISOString(),
      shopifyNbd: json.data.subscriptionContract?.nextBillingDate ?? null,
      shopifyStatus: json.data.subscriptionContract?.status ?? null,
      nbdDue,
      action: classified.action,
      shopifyCycleIndex:
        "shopifyCycleIndex" in classified
          ? classified.shopifyCycleIndex
          : null,
      reason: "reason" in classified ? classified.reason : null,
      lastBillingAttemptStatus: selection.lastBillingAttemptStatus,
    });

    // Gentle rate limit
    await new Promise((r) => setTimeout(r, 80));
  }

  const billableDue = rows.filter((r) => r.bucket === "billable_due").length;
  const billableFuture = rows.filter(
    (r) => r.bucket === "billable_future_nbd",
  ).length;

  console.log(
    JSON.stringify(
      {
        mode: "read-only-dry-run",
        shop,
        scanned: selections.length,
        now: now.toISOString(),
        counts: {
          ...counts,
          billable_due: billableDue,
          billable_future_nbd: billableFuture,
        },
        ambiguousOrBlocking: rows.filter((r) =>
          ["block_ambiguous", "block_unresolvable", "shopify_error", "missing_nbd"].includes(
            String(r.bucket),
          ),
        ),
        held: rows.filter((r) => r.bucket === "held_incident"),
        billableDueSample: rows
          .filter((r) => r.bucket === "billable_due")
          .slice(0, 15),
        alreadyPaidSample: rows
          .filter((r) => r.bucket === "already_paid")
          .slice(0, 10),
      },
      null,
      2,
    ),
  );

  await db.$disconnect();
};

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
