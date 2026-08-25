import * as React from "react";

import {
  formatEmailGreeting,
  MileyoEmailButton,
  MileyoEmailLayout,
  MileyoEmailText,
} from "../components";

export type PaymentFailedEmailProps = {
  customerName?: string | null;
  /** Kept for payload compatibility; never shown to the customer. */
  failureCount?: number | null;
  nextRetryAt?: string | null;
  portalUrl?: string | null;
};

/**
 * Payment failed — informational template.
 * No business logic; props are display-ready.
 */
export const PaymentFailedEmail = ({
  customerName,
  nextRetryAt,
  portalUrl,
}: PaymentFailedEmailProps) => {
  const greeting = formatEmailGreeting(customerName);
  const retryLabel = nextRetryAt?.trim() || null;

  return (
    <MileyoEmailLayout
      preview="Une action peut être nécessaire pour votre abonnement."
      eyebrow="Paiement"
      title="Un problème est survenu avec votre paiement"
    >
      <MileyoEmailText>{greeting}</MileyoEmailText>
      <MileyoEmailText>
        Nous n&apos;avons pas pu encaisser le paiement de votre abonnement
        Mileyo.
      </MileyoEmailText>
      {retryLabel ? (
        <MileyoEmailText>
          Nous réessaierons automatiquement le {retryLabel}.
        </MileyoEmailText>
      ) : null}
      <MileyoEmailText>
        Si nécessaire, vous pouvez vérifier votre moyen de paiement depuis votre
        espace client.
      </MileyoEmailText>
      {portalUrl ? (
        <MileyoEmailButton href={portalUrl}>
          Gérer mon abonnement
        </MileyoEmailButton>
      ) : null}
    </MileyoEmailLayout>
  );
};

export default PaymentFailedEmail;
