/**
 * EmailEvent handler registry (EMAIL-6D).
 *
 * Production registry starts empty — domain handlers are wired in 6E/6F.
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
import { mealSelectionReminderEmailEventHandler } from "./meal-selection-reminder-email-event-handler.server";
import { upcomingDeliveryEmailEventHandler } from "./upcoming-delivery-email-event-handler.server";

/**
 * Production handler map. EMAIL-6E wires scheduled campaign emails only.
 */
export const EMAIL_EVENT_HANDLER_REGISTRY: EmailEventHandlerRegistry = {
  [EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER]:
    mealSelectionReminderEmailEventHandler,
  [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: upcomingDeliveryEmailEventHandler,
};

export const getEmailEventHandler = (
  eventType: string,
  registry: EmailEventHandlerRegistry = EMAIL_EVENT_HANDLER_REGISTRY,
): EmailEventHandler | undefined => registry[eventType];
