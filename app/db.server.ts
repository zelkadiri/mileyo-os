import { Prisma, PrismaClient } from "@prisma/client";

import { recordPrismaModelOpMs } from "./utils/perfTimings.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

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
  const client = new PrismaClient().$extends({
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
  if (process.env.NODE_ENV === "production") {
    return createPrismaClient();
  }

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
