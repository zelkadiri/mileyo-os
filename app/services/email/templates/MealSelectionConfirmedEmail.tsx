import * as React from "react";

import {
  formatEmailGreeting,
  MileyoEmailButton,
  MileyoEmailLayout,
  MileyoEmailText,
  MileyoInfoCard,
  MileyoMealList,
  mileyoEmailMutedStyle,
} from "../components";

export type MealSelectionConfirmedEmailProps = {
  customerName?: string | null;
  deliveryDateLabel: string;
  selectedMeals?: string[];
  selectedCount?: number;
  mealsCount?: number;
  portalUrl?: string | null;
};

/**
 * Meal selection confirmed — sent after an explicit portal save.
 * No business logic; props are display-ready.
 */
export const MealSelectionConfirmedEmail = ({
  customerName,
  deliveryDateLabel,
  selectedMeals = [],
  selectedCount,
  portalUrl,
}: MealSelectionConfirmedEmailProps) => {
  const greeting = formatEmailGreeting(customerName);
  const count = selectedCount ?? selectedMeals.length;
  const previewDate = deliveryDateLabel?.trim() || "prochaine livraison";

  return (
    <MileyoEmailLayout
      preview={`Vos repas pour le ${previewDate} sont enregistrés.`}
      eyebrow="Votre sélection"
      title="Vos repas sont confirmés"
    >
      <MileyoEmailText>{greeting}</MileyoEmailText>
      <MileyoEmailText>
        Votre sélection pour la livraison du {deliveryDateLabel} est bien
        enregistrée.
      </MileyoEmailText>
      {count > 0 ? (
        <MileyoInfoCard
          items={[
            {
              label: "Votre sélection",
              value: `${count} repas sélectionnés`,
            },
          ]}
        />
      ) : null}
      <MileyoMealList meals={selectedMeals} />
      <MileyoEmailText style={mileyoEmailMutedStyle}>
        Vous pouvez encore modifier votre sélection jusqu&apos;à la date
        limite.
      </MileyoEmailText>
      {portalUrl ? (
        <MileyoEmailButton href={portalUrl}>Modifier mes repas</MileyoEmailButton>
      ) : null}
    </MileyoEmailLayout>
  );
};

export default MealSelectionConfirmedEmail;
