export const CAPTURE_CHECKOUT_LEAD_INTENT = "capture_checkout_lead";

export const BUILDER_EMAIL_MAX_LENGTH = 254;

export const BUILDER_EMAIL_ERROR = {
  EMPTY: "empty",
  INVALID: "invalid",
  TOO_LONG: "too_long",
} as const;

export type BuilderEmailError =
  (typeof BUILDER_EMAIL_ERROR)[keyof typeof BUILDER_EMAIL_ERROR];

export type NormalizeBuilderEmailResult =
  | { error: BuilderEmailError; valid: false }
  | { valid: true; value: string };

const hasInternalWhitespace = (value: string) => /\s/.test(value);

/**
 * Pragmatic checkout-email check. Trim only — local-part case is preserved.
 */
export const normalizeBuilderEmail = (
  input: unknown,
): NormalizeBuilderEmailResult => {
  if (typeof input !== "string") {
    return { error: BUILDER_EMAIL_ERROR.INVALID, valid: false };
  }

  const value = input.trim();

  if (!value) {
    return { error: BUILDER_EMAIL_ERROR.EMPTY, valid: false };
  }

  if (value.length > BUILDER_EMAIL_MAX_LENGTH) {
    return { error: BUILDER_EMAIL_ERROR.TOO_LONG, valid: false };
  }

  if (hasInternalWhitespace(value)) {
    return { error: BUILDER_EMAIL_ERROR.INVALID, valid: false };
  }

  const separatorIndex = value.indexOf("@");
  if (separatorIndex <= 0 || separatorIndex !== value.lastIndexOf("@")) {
    return { error: BUILDER_EMAIL_ERROR.INVALID, valid: false };
  }

  const local = value.slice(0, separatorIndex);
  const domain = value.slice(separatorIndex + 1);

  if (!local || !domain) {
    return { error: BUILDER_EMAIL_ERROR.INVALID, valid: false };
  }

  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return { error: BUILDER_EMAIL_ERROR.INVALID, valid: false };
  }

  const domainLabels = domain.split(".");
  if (domainLabels.some((label) => !label)) {
    return { error: BUILDER_EMAIL_ERROR.INVALID, valid: false };
  }

  return { valid: true, value };
};
