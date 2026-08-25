/**
 * EmailEvent handler — meal selection confirmed (EMAIL-6F).
 * Send + business stamp only; EmailEvent transitions stay in the generic worker.
 */

import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import db from "../../db.server";
import { getSelectedMealsFromJson } from "../../utils/mealSelection";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type { EmailEventHandler } from "./email-event-handlers.server";
import type { EmailEventRecord } from "./email-event.server";
import {
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  EmailEventMetaParseError,
  parseEmailEventDeliveryDateMeta,
  stampMealSelectionConfirmedForDelivery,
} from "./email-outbox-event-driven.server";
import {
  buildMealSelectionConfirmedEmailData,
  hasExplicitMealSelectionForDelivery,
  isMealSelectionConfirmedAlreadySentForDelivery,
  resolveMealSelectionCycle,
  resolveSubscriptionEmailRecipient,
} from "./meal-selection-email.server";

let testHandlerDb: typeof db | null = null;

/** @internal Mileyo business regression tests only. */
export const __setMealSelectionConfirmedEmailEventTestDb = (
  client: typeof db | null,
): void => {
  testHandlerDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetMealSelectionConfirmedEmailEventTestDb = (): void => {
  testHandlerDb = null;
};

const resolveHandlerDb = () => testHandlerDb ?? db;

const cancelled = (reason: string) =>
  ({ outcome: "cancelled" as const, reason });

export const processMealSelectionConfirmedEmailEvent = async ({
  event,
  now,
}: {
  event: EmailEventRecord;
  now: Date;
}) => {
  let deliveryDate: string;

  try {
    ({ deliveryDate } = parseEmailEventDeliveryDateMeta(event.metaJson));
  } catch (error) {
    const message =
      error instanceof EmailEventMetaParseError
        ? error.message
        : "invalid metaJson";
    return {
      errorCode: "invalid_meta",
      message,
      outcome: "permanent_failure" as const,
    };
  }

  if (event.referenceType !== EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION) {
    return {
      errorCode: "invalid_reference_type",
      message: `expected referenceType=${EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION}`,
      outcome: "permanent_failure" as const,
    };
  }

  if (event.eventType !== EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED) {
    return {
      errorCode: "invalid_event_type",
      message: `expected eventType=${EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED}`,
      outcome: "permanent_failure" as const,
    };
  }

  const selection =
    await resolveHandlerDb().subscriptionMealSelection.findUnique({
      where: { id: event.referenceId },
    });

  if (!selection) {
    return cancelled("selection_missing");
  }

  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection, now);

  if (!effectiveDeliveryDate || effectiveDeliveryDate !== deliveryDate) {
    return cancelled("delivery_cycle_mismatch");
  }

  if (
    !hasExplicitMealSelectionForDelivery({
      effectiveDeliveryDate,
      mealSelectionLastExplicitDeliveryDate:
        selection.mealSelectionLastExplicitDeliveryDate,
    })
  ) {
    return cancelled("no_explicit_selection");
  }

  if (selection.active !== true || selection.status !== "active") {
    return cancelled("inactive");
  }

  if (
    isMealSelectionConfirmedAlreadySentForDelivery({
      effectiveDeliveryDate: deliveryDate,
      mealSelectionConfirmedDeliveryDate:
        selection.mealSelectionConfirmedDeliveryDate,
    })
  ) {
    return {
      outcome: "sent" as const,
      providerId: event.providerId ?? undefined,
    };
  }

  if (!isMileyoTransactionalEmailEnabled()) {
    return cancelled("transactional_emails_disabled");
  }

  const order = await resolveHandlerDb().boxOrder.findUnique({
    select: { customerEmail: true, customerName: true },
    where: {
      shop_shopifyOrderId: {
        shop: selection.shop,
        shopifyOrderId: selection.shopifyOrderId,
      },
    },
  });

  const { customerName, recipient } = resolveSubscriptionEmailRecipient(
    selection,
    order,
  );

  if (!recipient) {
    return cancelled("no_recipient");
  }

  const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);
  const mealsCount = selection.mealsCount ?? 0;

  if (mealsCount <= 0) {
    return cancelled("invalid_meals_count");
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail(
    {
      data: buildMealSelectionConfirmedEmailData({
        customerName,
        effectiveDeliveryDate,
        mealsCount,
        selectedMeals,
        shop: selection.shop,
      }),
      subject: "Votre sélection de repas est confirmée",
      template: "meal-selection-confirmed",
      to: recipient,
    },
    { idempotencyKey: event.idempotencyKey },
  );

  if (!result.ok) {
    return classifyEmailSendFailureForEmailEvent(result);
  }

  await stampMealSelectionConfirmedForDelivery({
    deliveryDate,
    selectionId: selection.id,
  });

  return {
    outcome: "sent" as const,
    providerId: result.id,
  };
};

export const mealSelectionConfirmedEmailEventHandler: EmailEventHandler =
  async ({ event, now }) =>
    processMealSelectionConfirmedEmailEvent({ event, now });
