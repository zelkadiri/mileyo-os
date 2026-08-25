import * as React from "react";

import {
  formatEmailGreeting,
  MileyoEmailButton,
  MileyoEmailLayout,
  MileyoEmailText,
  MileyoInfoCard,
  MileyoMealList,
} from "../components";

export type UpcomingDeliveryEmailProps = {
  customerName?: string | null;
  deliveryDateLabel: string;
  mealsCount?: number;
  selectedMeals?: string[];
  portalUrl?: string | null;
  supportHref?: string | null;
  supportLabel?: string | null;
};

/**
 * Upcoming delivery — sent on J-2 / J-1 after meal cutoff.
 * No business logic; props are display-ready.
 */
export const UpcomingDeliveryEmail = ({
  customerName,
  deliveryDateLabel,
  mealsCount,
  selectedMeals = [],
  portalUrl,
  supportHref,
  supportLabel,
}: UpcomingDeliveryEmailProps) => {
  const greeting = formatEmailGreeting(customerName);
  const infoItems = [
    {
      label: "Livraison prévue",
      value: deliveryDateLabel,
    },
    ...(mealsCount != null && mealsCount > 0
      ? [
          {
            label: "Votre box",
            value: `${mealsCount} repas dans votre box`,
          },
        ]
      : []),
  ];

  return (
    <MileyoEmailLayout
      preview="Votre prochaine box arrive bientôt."
      eyebrow="Votre prochaine box"
      title="Votre box arrive bientôt"
      supportHref={supportHref}
      supportLabel={supportLabel}
    >
      <MileyoEmailText>{greeting}</MileyoEmailText>
      <MileyoEmailText>
        Votre prochaine box Mileyo arrive bientôt.
      </MileyoEmailText>
      <MileyoInfoCard items={infoItems} />
      <MileyoMealList meals={selectedMeals} heading="Repas prévus" />
      {portalUrl ? (
        <MileyoEmailButton href={portalUrl}>
          Voir mon abonnement
        </MileyoEmailButton>
      ) : null}
    </MileyoEmailLayout>
  );
};

export default UpcomingDeliveryEmail;
