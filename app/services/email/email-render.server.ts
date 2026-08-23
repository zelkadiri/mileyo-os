import * as React from "react";
import { render, toPlainText } from "react-email";

import type { EmailRenderResult, EmailTemplateName } from "./email.types";
import { PaymentFailedEmail } from "./templates/PaymentFailedEmail";
import { PaymentRecoveredEmail } from "./templates/PaymentRecoveredEmail";
import { SubscriptionCreatedEmail } from "./templates/SubscriptionCreatedEmail";
import { SubscriptionPausedEmail } from "./templates/SubscriptionPausedEmail";
import { TestEmail } from "./templates/TestEmail";

const templateRegistry: Record<
  EmailTemplateName,
  React.ComponentType<Record<string, unknown>>
> = {
  "payment-failed": PaymentFailedEmail as React.ComponentType<
    Record<string, unknown>
  >,
  "payment-recovered": PaymentRecoveredEmail as React.ComponentType<
    Record<string, unknown>
  >,
  "subscription-created": SubscriptionCreatedEmail as React.ComponentType<
    Record<string, unknown>
  >,
  "subscription-paused": SubscriptionPausedEmail as React.ComponentType<
    Record<string, unknown>
  >,
  test: TestEmail as React.ComponentType<Record<string, unknown>>,
};

/**
 * Render a React Email template to HTML + plain text.
 * Server-only. No transport / business logic.
 */
export const renderEmailTemplate = async (
  template: EmailTemplateName,
  data: Record<string, unknown> = {},
): Promise<EmailRenderResult> => {
  const Component = templateRegistry[template];

  if (!Component) {
    throw new Error(`Unknown email template: ${String(template)}`);
  }

  const html = await render(React.createElement(Component, data));
  const text = toPlainText(html);

  return { html, text };
};
