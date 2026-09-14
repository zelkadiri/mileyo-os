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
  /**
   * Wall-clock of Prisma `Session.findUnique` during auth phase
   * (via client extension; ALS-safe). Not engine `$on("query")` duration.
   */
  sessionQuery: number;
  /**
   * Wall-clock of Prisma `AppSettings.findUnique` during settings phase
   * (via client extension; ALS-safe).
   */
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

/**
 * Attribute Prisma client-extension wall time by model/operation.
 * Only findUnique reads are counted so refresh upserts / counts do not pollute.
 */
export const recordPrismaModelOpMs = (
  model: string | undefined,
  operation: string,
  durationMs: number,
): void => {
  const current = store.getStore();
  if (!current || current.phase === "idle") return;
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  if (
    current.phase === "auth" &&
    model === "Session" &&
    operation === "findUnique"
  ) {
    current.sessionQuery += durationMs;
    return;
  }

  if (
    current.phase === "settings" &&
    model === "AppSettings" &&
    operation === "findUnique"
  ) {
    current.settingsQuery += durationMs;
  }
};
