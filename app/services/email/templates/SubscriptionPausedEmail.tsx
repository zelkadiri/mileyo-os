import * as React from "react";

import type { SubscriptionPauseCause } from "../email.types";
import {
  formatEmailGreeting,
  MileyoEmailButton,
  MileyoEmailLayout,
  MileyoEmailText,
} from "../components";

export type SubscriptionPausedEmailProps = {
  customerName?: string | null;
  pauseCause: SubscriptionPauseCause;
  portalUrl?: string | null;
};

/**
 * Subscription paused — confirmation template (cause-specific copy).
 * No business logic; props are display-ready.
 */
export const SubscriptionPausedEmail = ({
  customerName,
  pauseCause,
  portalUrl,
}: SubscriptionPausedEmailProps) => {
  const greeting = formatEmailGreeting(customerName);
  const isVoluntary = pauseCause === "user_voluntary";

  if (isVoluntary) {
    return (
      <MileyoEmailLayout
        preview="Votre abonnement Mileyo est actuellement en pause."
        eyebrow="Abonnement"
        title="Votre abonnement est en pause"
      >
        <MileyoEmailText>{greeting}</MileyoEmailText>
        <MileyoEmailText>
          Votre abonnement Mileyo est maintenant en pause. Aucune nouvelle box
          ne sera préparée tant que vous ne le réactivez pas.
        </MileyoEmailText>
        <MileyoEmailText>
          Vous pouvez reprendre votre abonnement à tout moment depuis votre
          espace client.
        </MileyoEmailText>
        {portalUrl ? (
          <MileyoEmailButton href={portalUrl}>
            Gérer mon abonnement
          </MileyoEmailButton>
        ) : null}
      </MileyoEmailLayout>
    );
  }

  return (
    <MileyoEmailLayout
      preview="Votre abonnement Mileyo est temporairement suspendu."
      eyebrow="Paiement"
      title="Votre abonnement est temporairement suspendu"
    >
      <MileyoEmailText>{greeting}</MileyoEmailText>
      <MileyoEmailText>
        Nous n&apos;avons pas pu finaliser le paiement de votre abonnement après
        plusieurs tentatives.
      </MileyoEmailText>
      <MileyoEmailText>
        Pour reprendre vos prochaines livraisons, mettez à jour votre moyen de
        paiement depuis votre espace client.
      </MileyoEmailText>
      {portalUrl ? (
        <MileyoEmailButton href={portalUrl}>
          Gérer mon abonnement
        </MileyoEmailButton>
      ) : null}
    </MileyoEmailLayout>
  );
};

export default SubscriptionPausedEmail;
