/**
 * EmailEvent handler registry (EMAIL-6D / EMAIL-6E / EMAIL-6F).
 *
 * The generic worker looks up handlers by eventType only.
 */

import type { EmailEventRecord } from "./email-event.server";

export type EmailEventHandlerResult =
  | {
      outcome: "sent";
      providerId?: string;
    }
  | {
      outcome: "cancelled";
      reason?: string;
    }
  | {
      outcome: "retryable_failure";
      errorCode?: string;
      message?: string;
    }
  | {
      outcome: "permanent_failure";
      errorCode?: string;
      message?: string;
    };

export type EmailEventHandlerContext = {
  event: EmailEventRecord;
  now: Date;
};

export type EmailEventHandler = (
  context: EmailEventHandlerContext,
) => Promise<EmailEventHandlerResult>;

export type EmailEventHandlerRegistry = Readonly<
  Record<string, EmailEventHandler>
>;

import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import { mealSelectionConfirmedEmailEventHandler } from "./meal-selection-confirmed-email-event-handler.server";
import { mealSelectionReminderEmailEventHandler } from "./meal-selection-reminder-email-event-handler.server";
import { paymentFailedEmailEventHandler } from "./payment-failed-email-event-handler.server";
import { paymentRecoveredEmailEventHandler } from "./payment-recovered-email-event-handler.server";
import { subscriptionCreatedEmailEventHandler } from "./subscription-created-email-event-handler.server";
import { subscriptionPausedEmailEventHandler } from "./subscription-paused-email-event-handler.server";
import { upcomingDeliveryEmailEventHandler } from "./upcoming-delivery-email-event-handler.server";

/**
 * Production handler map — all 7 transactional EmailEvent types.
 */
export const EMAIL_EVENT_HANDLER_REGISTRY: EmailEventHandlerRegistry = {
  [EMAIL_EVENT_TYPE.PAYMENT_FAILED]: paymentFailedEmailEventHandler,
  [EMAIL_EVENT_TYPE.PAYMENT_RECOVERED]: paymentRecoveredEmailEventHandler,
  [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: subscriptionCreatedEmailEventHandler,
  [EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED]: subscriptionPausedEmailEventHandler,
  [EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED]:
    mealSelectionConfirmedEmailEventHandler,
  [EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER]:
    mealSelectionReminderEmailEventHandler,
  [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: upcomingDeliveryEmailEventHandler,
};

export const getEmailEventHandler = (
  eventType: string,
  registry: EmailEventHandlerRegistry = EMAIL_EVENT_HANDLER_REGISTRY,
): EmailEventHandler | undefined => registry[eventType];
