import { Prisma, PrismaClient } from "@prisma/client";

import { recordPrismaModelOpMs } from "./utils/perfTimings.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

/**
 * Serverless-safe datasource URL.
 *
 * Prisma default pool size is `num_physical_cpus * 2 + 1` (often 5 on Vercel).
 * Each isolate owns its own pool; with Supabase transaction pooler (:6543) that
 * multiplies client connections and surfaces as P2024 / pool timeout — which
 * Shopify then wraps as MissingSessionTableError during session.count().
 *
 * Official Prisma 6 / Supabase serverless guidance: start at connection_limit=1
 * when using an external pooler. Never raise the limit here; never touch
 * pool_timeout. Do not override an explicit operator-set connection_limit.
 */
export const resolvePrismaDatasourceUrl = (
  rawUrl: string | undefined = process.env.DATABASE_URL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | undefined => {
  if (!rawUrl) {
    return undefined;
  }

  if (nodeEnv !== "production") {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl);

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "1");
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
};

/**
 * PrismaClient with a request-scoped timing extension.
 *
 * NOTE: Prisma `$on("query")` does NOT see AsyncLocalStorage in this runtime
 * (engine emits outside the ALS context). Client extensions DO retain ALS, so
 * we attribute wall-clock model ops here instead of engine query events.
 *
 * Cast back to PrismaClient so call sites keep the existing type surface.
 */
const createPrismaClient = (): PrismaClient => {
  const url = resolvePrismaDatasourceUrl();
  const client = new PrismaClient(
    url ? { datasources: { db: { url } } } : undefined,
  ).$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const start = performance.now();
        try {
          return await query(args);
        } finally {
          recordPrismaModelOpMs(model, operation, performance.now() - start);
        }
      },
    },
  });

  return client as unknown as PrismaClient;
};

/** Delegate key for a Prisma model name (`PreparationDeliveryDateState` → `preparationDeliveryDateState`). */
const prismaModelDelegateKey = (modelName: string) =>
  modelName.charAt(0).toLowerCase() + modelName.slice(1);

/**
 * After `prisma generate`, Vite HMR can keep a stale `global.prismaGlobal`
 * whose delegates predate new models — `db.foo` is then `undefined` and
 * `db.foo.findMany()` throws TypeError. Recreate when out of sync with DMMF.
 *
 * Also reuse the same client in production: Vercel isolates may evaluate the
 * module more than once; skipping globalThis creates extra pools per isolate.
 */
const isPrismaClientInSyncWithGeneratedSchema = (
  client: PrismaClient,
): boolean => {
  const asRecord = client as unknown as Record<string, unknown>;

  for (const model of Prisma.dmmf.datamodel.models) {
    const key = prismaModelDelegateKey(model.name);

    if (typeof asRecord[key] === "undefined") {
      return false;
    }
  }

  return true;
};

const resolvePrismaClient = (): PrismaClient => {
  const existing = global.prismaGlobal;

  if (existing && isPrismaClientInSyncWithGeneratedSchema(existing)) {
    return existing;
  }

  if (existing) {
    void existing.$disconnect().catch(() => undefined);
  }

  global.prismaGlobal = createPrismaClient();
  return global.prismaGlobal;
};

const prisma = resolvePrismaClient();

export default prisma;
