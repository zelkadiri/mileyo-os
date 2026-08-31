import * as Sentry from "@sentry/node";

type SentryState = {
  enabled: boolean;
  initialized: boolean;
};

const state: SentryState = {
  enabled: false,
  initialized: false,
};

const resolveEnvironment = (): string => {
  const configured = process.env.SENTRY_ENVIRONMENT?.trim();
  if (configured) {
    return configured;
  }

  return process.env.NODE_ENV?.trim() || "development";
};

/**
 * Initialize Sentry once on the Node/Vercel server runtime.
 * No-op (and crash-safe) when SENTRY_DSN is absent.
 */
export const initSentry = (): boolean => {
  if (state.initialized) {
    return state.enabled;
  }

  state.initialized = true;

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    state.enabled = false;
    return false;
  }

  Sentry.init({
    dsn,
    environment: resolveEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });

  state.enabled = true;
  return true;
};

export const isSentryEnabled = (): boolean => {
  if (!state.initialized) {
    initSentry();
  }

  return state.enabled;
};

/** @internal Mileyo business regression tests only. */
export const __resetSentryForTests = (): void => {
  state.enabled = false;
  state.initialized = false;
};

/**
 * Force the enabled flag without calling Sentry.init (no network).
 * @internal Mileyo business regression tests only.
 */
export const __setSentryEnabledForTests = (enabled: boolean): void => {
  state.initialized = true;
  state.enabled = enabled;
};
