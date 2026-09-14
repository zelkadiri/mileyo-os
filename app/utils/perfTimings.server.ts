import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped builder performance timings (Server-Timing only).
 * Never store tokens, shop secrets, session IDs, or query params here.
 */
export type BuilderPerfPhase = "idle" | "auth" | "settings";

export type BuilderPerfTimings = {
  phase: BuilderPerfPhase;
  sessionLoad: number;
  sessionLoadCount: number;
  sessionStore: number;
  sessionStoreCount: number;
  /** Prisma engine duration (ms) for Session queries during auth phase. */
  sessionQuery: number;
  /** Prisma engine duration (ms) for AppSettings queries during settings phase. */
  settingsQuery: number;
};

const store = new AsyncLocalStorage<BuilderPerfTimings>();

export const createBuilderPerfTimings = (): BuilderPerfTimings => ({
  phase: "idle",
  sessionLoad: 0,
  sessionLoadCount: 0,
  sessionStore: 0,
  sessionStoreCount: 0,
  sessionQuery: 0,
  settingsQuery: 0,
});

export const runWithBuilderPerfTimings = <T>(
  fn: () => Promise<T>,
): Promise<T> => store.run(createBuilderPerfTimings(), fn);

export const getBuilderPerfTimings = (): BuilderPerfTimings | undefined =>
  store.getStore();

export const setBuilderPerfPhase = (phase: BuilderPerfPhase): void => {
  const current = store.getStore();
  if (current) current.phase = phase;
};

export const recordSessionLoadMs = (ms: number): void => {
  const current = store.getStore();
  if (!current || !Number.isFinite(ms) || ms < 0) return;
  current.sessionLoad += ms;
  current.sessionLoadCount += 1;
};

export const recordSessionStoreMs = (ms: number): void => {
  const current = store.getStore();
  if (!current || !Number.isFinite(ms) || ms < 0) return;
  current.sessionStore += ms;
  current.sessionStoreCount += 1;
};

/** True for Prisma engine SELECT text (load path). Excludes upsert/insert writes. */
const isSelectQuery = (query: string): boolean => /^\s*SELECT\b/i.test(query);

/**
 * Attribute Prisma engine query duration to the active builder phase.
 * Uses only table-name markers from the SQL text — never logs query/params.
 *
 * Auth phase counts only SELECT on "Session" so a refresh `storeSession`
 * upsert cannot inflate `sessionQuery`. Settings phase counts SELECT on
 * "AppSettings" only.
 */
export const recordPrismaEngineQueryMs = (
  query: string,
  durationMs: number,
): void => {
  const current = store.getStore();
  if (!current || current.phase === "idle") return;
  if (typeof query !== "string" || query.length === 0) return;
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  if (!isSelectQuery(query)) return;

  if (current.phase === "auth" && query.includes('"Session"')) {
    current.sessionQuery += durationMs;
    return;
  }

  if (current.phase === "settings" && query.includes('"AppSettings"')) {
    current.settingsQuery += durationMs;
  }
};
