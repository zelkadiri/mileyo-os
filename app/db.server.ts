import { PrismaClient } from "@prisma/client";

import { recordPrismaEngineQueryMs } from "./utils/perfTimings.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

type QueryEventClient = PrismaClient & {
  $on(
    event: "query",
    callback: (event: { query: string; duration: number }) => void,
  ): void;
};

/**
 * Create a PrismaClient with query-engine duration events for temporary
 * builder Server-Timing instrumentation. Events are attributed only when a
 * builder perf ALS context is active — no query/params are logged.
 */
const createPrismaClient = (): PrismaClient => {
  const client = new PrismaClient({
    log: [{ emit: "event", level: "query" }],
  }) as QueryEventClient;

  client.$on("query", (event) => {
    recordPrismaEngineQueryMs(event.query, event.duration);
  });

  return client;
};

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
