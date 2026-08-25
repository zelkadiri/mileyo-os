import * as React from "react";

import {
  formatEmailGreeting,
  MileyoEmailButton,
  MileyoEmailLayout,
  MileyoEmailText,
  MileyoInfoCard,
  mileyoEmailMutedStyle,
} from "../components";

export type MealSelectionReminderEmailProps = {
  customerName?: string | null;
  deliveryDateLabel: string;
  cutoffLabel: string;
  mealsCount?: number;
  portalUrl?: string | null;
};

/**
 * Meal selection reminder — nudge before cutoff when no explicit choice for the cycle.
 * Carry-over from a previous cycle does not suppress this email.
 */
export const MealSelectionReminderEmail = ({
  customerName,
  deliveryDateLabel,
  cutoffLabel,
  portalUrl,
}: MealSelectionReminderEmailProps) => {
  const greeting = formatEmailGreeting(customerName);
  const cutoff = cutoffLabel?.trim() || null;

  return (
    <MileyoEmailLayout
      preview="Choisissez vos repas avant la date limite."
      eyebrow="Votre prochaine box"
      title="Il est temps de choisir vos repas"
    >
      <MileyoEmailText>{greeting}</MileyoEmailText>
      <MileyoEmailText>
        Votre prochaine livraison approche et votre sélection n&apos;est pas
        encore finalisée.
      </MileyoEmailText>
      <MileyoInfoCard
        items={[
          {
            label: "Livraison prévue",
            value: deliveryDateLabel,
          },
        ]}
      />
      {cutoff ? (
        <MileyoEmailText style={mileyoEmailMutedStyle}>
          Vous pouvez modifier votre sélection jusqu&apos;au {cutoff}.
        </MileyoEmailText>
      ) : null}
      {portalUrl ? (
        <MileyoEmailButton href={portalUrl}>
          Choisir mes repas
        </MileyoEmailButton>
      ) : null}
    </MileyoEmailLayout>
  );
};

export default MealSelectionReminderEmail;
