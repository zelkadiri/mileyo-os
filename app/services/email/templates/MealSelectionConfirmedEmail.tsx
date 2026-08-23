import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from "react-email";

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
  mealsCount,
  portalUrl,
}: MealSelectionConfirmedEmailProps) => {
  const greeting = customerName?.trim()
    ? `Bonjour ${customerName.trim()},`
    : "Bonjour,";
  const count = selectedCount ?? selectedMeals.length;

  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre sélection de repas est confirmée</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading} as="h1">
            Sélection confirmée
          </Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Votre sélection de repas pour la livraison du{" "}
            <strong>{deliveryDateLabel}</strong> est bien enregistrée.
          </Text>
          {mealsCount != null && mealsCount > 0 ? (
            <Text style={text}>
              Vous avez choisi {count} repas sur {mealsCount}.
            </Text>
          ) : null}
          {selectedMeals.length > 0 ? (
            <>
              <Text style={text}>Vos repas :</Text>
              <Text style={list}>
                {selectedMeals.map((meal, index) => (
                  <span key={`${meal}-${index}`}>
                    {index > 0 ? <br /> : null}• {meal}
                  </span>
                ))}
              </Text>
            </>
          ) : null}
          {portalUrl ? (
            <Text style={text}>
              Vous pouvez modifier votre sélection jusqu&apos;à la date limite
              depuis votre{" "}
              <Link href={portalUrl} style={link}>
                espace client
              </Link>
              .
            </Text>
          ) : null}
          {portalUrl ? (
            <Text style={text}>
              <Link href={portalUrl} style={ctaLink}>
                Modifier ma sélection
              </Link>
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
};

const body: React.CSSProperties = {
  backgroundColor: "#f6f6f6",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: 0,
  padding: "24px 0",
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "24px",
};

const heading: React.CSSProperties = {
  color: "#111111",
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 16px",
};

const text: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 12px",
};

const list: React.CSSProperties = {
  ...text,
  margin: "0 0 16px",
};

const link: React.CSSProperties = {
  color: "#111111",
  textDecoration: "underline",
};

const ctaLink: React.CSSProperties = {
  color: "#111111",
  fontWeight: 600,
  textDecoration: "underline",
};

export default MealSelectionConfirmedEmail;
