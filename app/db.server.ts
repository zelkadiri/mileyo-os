import { PrismaClient } from "@prisma/client";

import { recordPrismaModelOpMs } from "./utils/perfTimings.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
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

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
