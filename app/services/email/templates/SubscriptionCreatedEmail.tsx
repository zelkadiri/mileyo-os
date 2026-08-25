import * as React from "react";

import {
  formatEmailGreeting,
  MileyoEmailButton,
  MileyoEmailLayout,
  MileyoEmailText,
  MileyoInfoCard,
  mileyoEmailMutedStyle,
} from "../components";

export type SubscriptionCreatedEmailProps = {
  customerName?: string | null;
  mealsCount?: number | null;
  nextDelivery?: string | null;
  portalUrl?: string | null;
};

/**
 * Subscription created — welcome / confirmation template.
 * No business logic; props are display-ready.
 */
export const SubscriptionCreatedEmail = ({
  customerName,
  mealsCount,
  nextDelivery,
  portalUrl,
}: SubscriptionCreatedEmailProps) => {
  const greeting = formatEmailGreeting(customerName);
  const infoItems = [
    ...(nextDelivery
      ? [{ label: "Prochaine livraison", value: nextDelivery }]
      : []),
    ...(mealsCount != null && mealsCount > 0
      ? [
          {
            label: "Votre box",
            value: `${mealsCount} repas`,
          },
        ]
      : []),
  ];

  return (
    <MileyoEmailLayout
      preview="Votre abonnement Mileyo est maintenant actif."
      eyebrow="Bienvenue chez Mileyo"
      title="Votre abonnement est confirmé"
    >
      <MileyoEmailText>{greeting}</MileyoEmailText>
      <MileyoEmailText>
        Tout est prêt. Votre abonnement Mileyo est maintenant actif.
      </MileyoEmailText>
      <MileyoInfoCard items={infoItems} />
      {portalUrl ? (
        <>
          <MileyoEmailButton href={portalUrl}>
            Gérer mon abonnement
          </MileyoEmailButton>
          <MileyoEmailText style={{ ...mileyoEmailMutedStyle, marginTop: 16 }}>
            Vous pourrez modifier vos repas, gérer vos prochaines livraisons ou
            mettre votre abonnement en pause depuis votre espace client.
          </MileyoEmailText>
        </>
      ) : (
        <MileyoEmailText style={mileyoEmailMutedStyle}>
          Vous pourrez bientôt gérer votre abonnement depuis votre espace
          client Mileyo.
        </MileyoEmailText>
      )}
    </MileyoEmailLayout>
  );
};

export default SubscriptionCreatedEmail;
