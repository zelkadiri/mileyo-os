import type { SessionStorage } from "@shopify/shopify-app-session-storage";

import {
  recordSessionLoadMs,
  recordSessionStoreMs,
} from "./perfTimings.server";

/**
 * Thin wall-clock wrapper around Shopify session storage.
 * Records durations only when a builder perf ALS context is active.
 * Does not log session ids, tokens, or shop.
 */
export const instrumentSessionStorage = (
  storage: SessionStorage,
): SessionStorage => ({
  async loadSession(id) {
    const start = performance.now();
    try {
      return await storage.loadSession(id);
    } finally {
      recordSessionLoadMs(performance.now() - start);
    }
  },

  async storeSession(session) {
    const start = performance.now();
    try {
      return await storage.storeSession(session);
    } finally {
      recordSessionStoreMs(performance.now() - start);
    }
  },

  deleteSession(id) {
    return storage.deleteSession(id);
  },

  deleteSessions(ids) {
    return storage.deleteSessions(ids);
  },

  findSessionsByShop(shop) {
    return storage.findSessionsByShop(shop);
  },
});
