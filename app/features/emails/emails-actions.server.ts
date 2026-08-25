/**
 * Admin email actions (EMAIL-6G-B) — safe manual retry of failed EmailEvents.
 */

import {
  RETRY_EMAIL_EVENT_INTENT,
  type EmailsActionData,
} from "./emails-types";

export type { EmailsActionData };
export { RETRY_EMAIL_EVENT_INTENT };

const messageForResult = (status: EmailsActionData["status"]): string => {
  if (status === "sent") {
    return "Email envoyé.";
  }
  if (status === "failed") {
    return "Nouvelle tentative échouée.";
  }
  if (status === "cancelled") {
    return "L’événement a été annulé pendant le retry.";
  }
  if (status === "invalid_request") {
    return "Requête invalide.";
  }
  // not_found | not_eligible
  return "Cet événement n’est plus éligible au retry.";
};

/**
 * Authenticated shop is the only shop authority — never trust a client shop field.
 * Worker is dynamically imported to avoid EMAIL-6F-style cycles.
 */
export const handleEmailsAction = async ({
  request,
  shop,
}: {
  request: Request;
  shop: string;
}): Promise<EmailsActionData> => {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();

  if (intent !== RETRY_EMAIL_EVENT_INTENT || !eventId) {
    return {
      eventId: eventId || null,
      message: messageForResult("invalid_request"),
      ok: false,
      status: "invalid_request",
    };
  }

  const { manualRetryEmailEvent } = await import(
    "../../services/email/email-event-worker.server"
  );

  const result = await manualRetryEmailEvent({ eventId, shop });

  if (result.status === "sent" || result.status === "failed") {
    console.log("[emailAdmin] manualRetry", {
      attemptCount: result.attemptCount,
      eventId: result.eventId,
      eventType: result.eventType,
      result: result.status,
      shop,
      ...(result.status === "failed" && result.errorCode
        ? { errorCode: result.errorCode }
        : {}),
    });
  } else if (result.status === "cancelled") {
    console.log("[emailAdmin] manualRetry", {
      attemptCount: result.attemptCount,
      eventId: result.eventId,
      eventType: result.eventType,
      result: result.status,
      shop,
    });
  } else {
    console.log("[emailAdmin] manualRetry", {
      eventId: result.eventId,
      reason: "reason" in result ? result.reason : result.status,
      result: result.status,
      shop,
    });
  }

  return {
    eventId: result.eventId,
    message: messageForResult(result.status),
    ok: result.status === "sent",
    status: result.status,
  };
};
