import { Resend } from "resend";

export const RESEND_API_KEY_ENV = "RESEND_API_KEY";
export const EMAIL_FROM_ENV = "EMAIL_FROM";

export type ResendClient = Resend;

/**
 * Resolve Resend API key from the environment.
 * Returns null when unset or blank (local / misconfigured).
 */
export const getResendApiKey = (
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const key = env[RESEND_API_KEY_ENV]?.trim();
  return key ? key : null;
};

/**
 * Resolve configured sender from EMAIL_FROM.
 * Returns null when unset or blank — never falls back to a hardcoded address.
 */
export const getEmailFrom = (
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const from = env[EMAIL_FROM_ENV]?.trim();
  return from ? from : null;
};

/**
 * Create a Resend client, or null when RESEND_API_KEY is missing.
 * Server-only. No business logic.
 */
export const createEmailClient = (
  env: NodeJS.ProcessEnv = process.env,
): ResendClient | null => {
  const apiKey = getResendApiKey(env);

  if (!apiKey) {
    if (env.NODE_ENV !== "production") {
      console.warn(
        `[email] ${RESEND_API_KEY_ENV} is not set — email sending is disabled`,
      );
    }
    return null;
  }

  return new Resend(apiKey);
};
