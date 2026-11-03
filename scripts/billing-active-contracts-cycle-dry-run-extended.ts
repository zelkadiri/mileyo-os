#!/usr/bin/env npx tsx
/**
 * READ-ONLY extended dry-run — full row dump + Hossam classified without hold shortcut.
 * Never creates billing attempts. Never writes DB. Never mutates Shopify.
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
    lastBillingAttemptStatus: string | null;
  }[];

  const now = new Date();
  const rows: Record<string, unknown>[] = [];

  for (const selection of selections) {
    if (!selection.nextBillingDate) {
      rows.push({
        bucket: "missing_nbd",
        action: "missing_nbd",
        contractId: selection.subscriptionContractId,
        selectionId: selection.id,
        held: isSubscriptionBillingIncidentHeld(selection.subscriptionContractId),
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
      rows.push({
        bucket: "shopify_error",
        action: "shopify_error",
        contractId: selection.subscriptionContractId,
        selectionId: selection.id,
        held: isSubscriptionBillingIncidentHeld(selection.subscriptionContractId),
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
    const nbdDue =
      new Date(selection.nextBillingDate).getTime() <= now.getTime();
    const held = isSubscriptionBillingIncidentHeld(
      selection.subscriptionContractId,
    );
    const paidCycles = cycles
      .filter((c) => c.successfulAttempts.length > 0)
      .map((c) => ({
        i: c.cycleIndex,
        status: c.status,
        paid: c.successfulAttempts.length,
        skipped: c.skipped,
        edited: c.edited,
      }));

    const action = classified.action;
    const effectiveBucket = held
      ? "held_incident"
      : action === "billable"
        ? nbdDue
          ? "billable_due"
          : "billable_future_nbd"
        : action;

    rows.push({
      contractId: selection.subscriptionContractId,
      selectionId: selection.id,
      held,
      localNbd: new Date(selection.nextBillingDate).toISOString(),
      shopifyNbd: json.data.subscriptionContract?.nextBillingDate ?? null,
      shopifyStatus: json.data.subscriptionContract?.status ?? null,
      nbdDue,
      action,
      shopifyCycleIndex:
        "shopifyCycleIndex" in classified
          ? classified.shopifyCycleIndex
          : null,
      reason: "reason" in classified ? classified.reason : null,
      effectiveBucket,
      paidCycles,
      lastBillingAttemptStatus: selection.lastBillingAttemptStatus,
    });

    await new Promise((r) => setTimeout(r, 60));
  }

  const effectiveCounts: Record<string, number> = {};
  const underlying: Record<string, number> = {};
  const cycleTargets: Record<string, number> = {};
  for (const row of rows) {
    const eb = String(row.effectiveBucket);
    const act = String(row.action);
    effectiveCounts[eb] = (effectiveCounts[eb] || 0) + 1;
    underlying[act] = (underlying[act] || 0) + 1;
    const ci = String(row.shopifyCycleIndex);
    cycleTargets[ci] = (cycleTargets[ci] || 0) + 1;
  }

  const hossam = rows.find(
    (r) =>
      String(r.contractId) === "26652508488" ||
      String(r.contractId).includes("26652508488"),
  );

  console.log(
    JSON.stringify(
      {
        mode: "read-only-extended",
        shop,
        scanned: rows.length,
        now: now.toISOString(),
        effectiveCounts,
        underlyingClassifierCounts: underlying,
        cycleIndexTargets: cycleTargets,
        hossam,
        blockAmbiguous: rows.filter((r) => r.action === "block_ambiguous"),
        blockUnresolvable: rows.filter(
          (r) => r.action === "block_unresolvable",
        ),
        alreadyPaid: rows.filter((r) => r.action === "already_paid"),
        billableDue: rows.filter((r) => r.effectiveBucket === "billable_due"),
        sampleFuture: rows
          .filter((r) => r.effectiveBucket === "billable_future_nbd")
          .slice(0, 10)
          .map((r) => ({
            contractId: r.contractId,
            localNbd: r.localNbd,
            shopifyNbd: r.shopifyNbd,
            cycle: r.shopifyCycleIndex,
            paidCycles: r.paidCycles,
            shopifyStatus: r.shopifyStatus,
          })),
        editedOrSkippedPaid: rows.filter((r) => {
          const paid = r.paidCycles as
            | Array<{ edited?: boolean; skipped?: boolean }>
            | undefined;
          return (paid ?? []).some((p) => p.edited || p.skipped);
        }).length,
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
