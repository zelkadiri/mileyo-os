import type { EmailSendFailure, EmailSendFailureReason } from "./email.types";

/** Resend SDK error shape (`ErrorResponse` in resend@6.22.0). */
export type ResendSendError = {
  message: string;
  name: string;
  statusCode: number | null;
};

const RESEND_REASON_BY_NAME: Readonly<
  Partial<Record<string, EmailSendFailureReason>>
> = {
  invalid_idempotency_key: "invalid_idempotency_key",
  invalid_idempotent_request: "invalid_idempotent_request",
  concurrent_idempotent_requests: "concurrent_idempotent_requests",
  rate_limit_exceeded: "rate_limit_exceeded",
  validation_error: "validation_error",
};

/**
 * Map a Resend send error to Mileyo transport result fields.
 * Keeps legacy `send_error` for unmapped provider codes.
 */
export const mapResendSendError = (error: ResendSendError): EmailSendFailure => {
  const providerErrorCode = error.name;
  const reason = RESEND_REASON_BY_NAME[error.name] ?? "send_error";

  return {
    ok: false,
    reason,
    message: error.message,
    providerErrorCode,
  };
};

export type ResolvedSendEmailIdempotencyKey =
  | { mode: "absent" }
  | { mode: "present"; key: string };

/**
 * Resolve caller idempotency key before hitting Resend.
 * Empty / whitespace-only keys are rejected explicitly.
 */
export const resolveSendEmailIdempotencyKey = (
  idempotencyKey?: string,
):
  | ResolvedSendEmailIdempotencyKey
  | Pick<EmailSendFailure, "ok" | "reason" | "message"> => {
  if (idempotencyKey === undefined) {
    return { mode: "absent" };
  }

  if (idempotencyKey.length === 0 || idempotencyKey.trim().length === 0) {
    return {
      ok: false,
      reason: "invalid_idempotency_key",
      message: "idempotencyKey must be a non-empty string",
    };
  }

  return { mode: "present", key: idempotencyKey };
};
