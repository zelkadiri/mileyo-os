import * as Sentry from "@sentry/node";

import { initSentry, isSentryEnabled } from "./sentry.server";

const ALLOWED_CONTEXT_KEYS = [
  "shop",
  "route",
  "source",
  "webhookTopic",
  "subscriptionContractId",
  "selectionId",
  "shopifyOrderId",
  "orderName",
  "billingAttemptId",
  "recoveryId",
  "emailEventId",
  "emailEventType",
  "cronName",
  "errorCode",
  "runId",
  "runner",
] as const;

export type TechnicalErrorContextKey = (typeof ALLOWED_CONTEXT_KEYS)[number];

export type TechnicalErrorContext = Partial<
  Record<TechnicalErrorContextKey, string | number | boolean | null | undefined>
>;

const MAX_ERROR_MESSAGE_LENGTH = 500;

type CaptureExceptionFn = (
  exception: unknown,
  captureContext?: {
    extra?: Record<string, string | number | boolean | null>;
  },
) => string;

let captureExceptionImpl: CaptureExceptionFn = (exception, captureContext) =>
  Sentry.captureException(exception, captureContext);

const truncateMessage = (message: string): string => {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message;
  }

  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`;
};

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    if (error.message.length > MAX_ERROR_MESSAGE_LENGTH) {
      const truncated = new Error(truncateMessage(error.message));
      truncated.name = error.name;
      truncated.stack = error.stack;
      return truncated;
    }

    return error;
  }

  if (typeof error === "string") {
    return new Error(truncateMessage(error));
  }

  return new Error("Unknown technical error");
};

/**
 * Keep only allow-listed technical context keys.
 * Unknown keys (including PII / secrets / payloads) are dropped.
 */
export const sanitizeTechnicalErrorContext = (
  context?: Record<string, unknown> | null,
): Record<string, string | number | boolean | null> => {
  if (!context) {
    return {};
  }

  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const key of ALLOWED_CONTEXT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) {
      continue;
    }

    const value = context[key];
    if (value === undefined) {
      continue;
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      sanitized[key] =
        typeof value === "string" ? truncateMessage(value) : value;
    }
  }

  return sanitized;
};

/**
 * Capture a technical (non-business) error to Sentry when enabled.
 * Safe no-op when SENTRY_DSN is absent.
 */
export const captureTechnicalError = (
  error: unknown,
  context?: Record<string, unknown> | null,
): void => {
  initSentry();

  if (!isSentryEnabled()) {
    return;
  }

  const extra = sanitizeTechnicalErrorContext(context);
  const exception = toError(error);

  captureExceptionImpl(
    exception,
    Object.keys(extra).length > 0 ? { extra } : undefined,
  );
};

/** @internal Mileyo business regression tests only. */
export const __setCaptureExceptionForTests = (
  fn: CaptureExceptionFn | null,
): void => {
  captureExceptionImpl =
    fn ??
    ((exception, captureContext) =>
      Sentry.captureException(exception, captureContext));
};

/** @internal Mileyo business regression tests only. */
export const __resetCaptureTechnicalErrorForTests = (): void => {
  captureExceptionImpl = (exception, captureContext) =>
    Sentry.captureException(exception, captureContext);
};
