import * as React from "react";

import {
  formatEmailGreeting,
  MileyoEmailButton,
  MileyoEmailLayout,
  MileyoEmailText,
} from "../components";

export type PaymentRecoveredEmailProps = {
  customerName?: string | null;
  portalUrl?: string | null;
};

/**
 * Payment recovered — confirmation template.
 * No business logic; props are display-ready.
 */
export const PaymentRecoveredEmail = ({
  customerName,
  portalUrl,
}: PaymentRecoveredEmailProps) => {
  const greeting = formatEmailGreeting(customerName);

  return (
    <MileyoEmailLayout
      preview="Votre paiement a bien été confirmé."
      eyebrow="Paiement"
      title="Paiement confirmé"
    >
      <MileyoEmailText>{greeting}</MileyoEmailText>
      <MileyoEmailText>
        Bonne nouvelle, le paiement de votre abonnement a bien été validé.
      </MileyoEmailText>
      <MileyoEmailText>
        Vos prochaines livraisons suivent leur cours normalement.
      </MileyoEmailText>
      {portalUrl ? (
        <MileyoEmailButton href={portalUrl}>
          Voir mon abonnement
        </MileyoEmailButton>
      ) : null}
    </MileyoEmailLayout>
  );
};

export default PaymentRecoveredEmail;
