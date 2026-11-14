import type { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

import { captureTechnicalError } from "../services/observability/captureTechnicalError.server";

type HealableSessionStorage = SessionStorage & {
  isReady: () => Promise<boolean>;
};

/** @internal Exported for business regression tests only. */
export const isSessionStoragePoisonError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message) : "";

  return (
    name === "MissingSessionTableError" ||
    name === "MissingSessionStorageError" ||
    /session table does not exist/i.test(message) ||
    /session storage is not ready/i.test(message)
  );
};

/**
 * Shopify PrismaSessionStorage pollForTable() swallows the real Prisma error and
 * permanently rejects `ready` after one failure. Warm Vercel isolates then keep
 * throwing MissingSessionTableError even when `Session` exists.
 *
 * On poison errors: call isReady() once (re-poll + heal), retry the operation
 * exactly once. Persistent failures rethrow the original error.
 * Logs only error name/code/message prefix — never tokens or connection strings.
 */
export const resilientShopifySessionStorage = (
  storage: HealableSessionStorage,
): SessionStorage => {
  const withHeal = async <T>(
    operation: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (!isSessionStoragePoisonError(error)) {
        throw error;
      }

      const cause =
        error && typeof error === "object" && "cause" in error
          ? (error as { cause?: unknown }).cause
          : undefined;
      const causeMessage =
        cause && typeof cause === "object" && "message" in cause
          ? String((cause as { message?: unknown }).message)
          : cause
            ? String(cause)
            : null;
      const causeCode =
        cause && typeof cause === "object" && "code" in cause
          ? String((cause as { code?: unknown }).code)
          : null;

      console.error("[shopify-session-storage] poison/ready failure — healing", {
        causeCode,
        causeMessage: causeMessage?.slice(0, 240) ?? null,
        operation,
        poisonMessage:
          error && typeof error === "object" && "message" in error
            ? String((error as { message?: unknown }).message).slice(0, 240)
            : null,
        poisonName:
          error && typeof error === "object" && "name" in error
            ? String((error as { name?: unknown }).name)
            : null,
      });

      captureTechnicalError(error, {
        errorCode: causeCode ?? `session_storage_${operation}`,
        source: "shopify_session_storage",
      });

      const ready = await storage.isReady();
      if (!ready) {
        throw error;
      }

      // Exactly one retry after a successful heal — never recurse withHeal.
      return await run();
    }
  };

  return {
    deleteSession(id) {
      return withHeal("deleteSession", () => storage.deleteSession(id));
    },
    deleteSessions(ids) {
      return withHeal("deleteSessions", () => storage.deleteSessions(ids));
    },
    findSessionsByShop(shop) {
      return withHeal("findSessionsByShop", () =>
        storage.findSessionsByShop(shop),
      );
    },
    loadSession(id) {
      return withHeal("loadSession", () => storage.loadSession(id));
    },
    storeSession(session: Session) {
      return withHeal("storeSession", () => storage.storeSession(session));
    },
  };
};
