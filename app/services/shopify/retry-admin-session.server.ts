/**
 * Transient DB/pool retry for Shopify unauthenticated.admin(session) only.
 *
 * Retries ONLY clearly transient Prisma connection failures before any billing
 * mutation. Fail-closed on unknown / schema / auth / business errors.
 * Server-only. No PII beyond shop (already used in cron observability).
 */

import { unauthenticated } from "../../shopify.server";

/** Total attempts including the first call. */
export const SHOPIFY_ADMIN_SESSION_MAX_ATTEMPTS = 2;

/** Fixed delay before the single retry (ms). */
export const SHOPIFY_ADMIN_SESSION_RETRY_DELAY_MS = 1000;

const TRANSIENT_MESSAGE_PATTERNS: RegExp[] = [
  /can't reach database server/i,
  /timed out fetching a new connection from the connection pool/i,
  /current connection pool timeout/i,
];

/** Prisma codes that are connection / pool timeouts (not schema/validation). */
const TRANSIENT_PRISMA_CODES = new Set(["P1001", "P1017", "P2024"]);

const MAX_CAUSE_DEPTH = 4;

export type AdminSessionClient = Awaited<
  ReturnType<typeof unauthenticated.admin>
>;

export type GetAdminWithTransientDbRetryDeps = {
  getAdmin?: (shop: string) => Promise<AdminSessionClient>;
  sleep?: (ms: number) => Promise<void>;
  warn?: (message: string, context?: Record<string, unknown>) => void;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const readStringField = (value: unknown, key: string): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : null;
};

const collectErrorChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth += 1) {
    chain.push(current);

    if (typeof current !== "object") {
      break;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return chain;
};

const nodeLooksTransient = (node: unknown): boolean => {
  if (node == null) {
    return false;
  }

  const message = readStringField(node, "message") ?? "";
  const name = readStringField(node, "name") ?? "";
  const code =
    readStringField(node, "code") ?? readStringField(node, "errorCode");

  if (code && TRANSIENT_PRISMA_CODES.has(code)) {
    return true;
  }

  if (TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }

  // Initialization errors are only transient when the message is connection-related.
  if (
    name === "PrismaClientInitializationError" &&
    TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return true;
  }

  return false;
};

/**
 * Pure classifier: true only for clearly transient Prisma connection / pool errors.
 * Walks error.cause chain (Shopify MissingSessionTableError wraps the real Prisma error).
 * Unknown / schema / missing-table-without-transient-cause → false (fail-closed).
 */
export const isTransientPrismaConnectionError = (error: unknown): boolean => {
  for (const node of collectErrorChain(error)) {
    if (nodeLooksTransient(node)) {
      return true;
    }
  }

  return false;
};

/**
 * Load Shopify admin (session) with at most one retry on transient Prisma DB/pool errors.
 *
 * Latency:
 * - direct success: +0 ms
 * - recovered blip: ~+1000 ms
 * - double failure: ~+1000 ms then throw
 */
export const getAdminWithTransientDbRetry = async (
  shop: string,
  deps: GetAdminWithTransientDbRetryDeps = {},
): Promise<AdminSessionClient> => {
  const getAdmin =
    deps.getAdmin ?? ((targetShop: string) => unauthenticated.admin(targetShop));
  const sleep = deps.sleep ?? defaultSleep;
  const warn = deps.warn ?? console.warn;

  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= SHOPIFY_ADMIN_SESSION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await getAdmin(shop);
    } catch (error) {
      lastError = error;

      const canRetry =
        attempt < SHOPIFY_ADMIN_SESSION_MAX_ATTEMPTS &&
        isTransientPrismaConnectionError(error);

      if (!canRetry) {
        throw error;
      }

      warn("[shopify-admin-session] transient db error — retrying", {
        attempt,
        maxAttempts: SHOPIFY_ADMIN_SESSION_MAX_ATTEMPTS,
        reasonCode: "transient_prisma_connection",
        shop,
        source: "getAdminWithTransientDbRetry",
      });

      await sleep(SHOPIFY_ADMIN_SESSION_RETRY_DELAY_MS);
    }
  }

  throw lastError;
};
