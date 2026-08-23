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
  mealsCount,
  portalUrl,
}: MealSelectionReminderEmailProps) => {
  const greeting = customerName?.trim()
    ? `Bonjour ${customerName.trim()},`
    : "Bonjour,";

  return (
    <Html lang="fr">
      <Head />
      <Preview>N&apos;oubliez pas de choisir vos repas</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading} as="h1">
            Choisissez vos repas
          </Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Vous n&apos;avez pas encore confirmé vos repas pour la livraison du{" "}
            <strong>{deliveryDateLabel}</strong>.
          </Text>
          {mealsCount != null && mealsCount > 0 ? (
            <Text style={text}>
              Pensez à sélectionner vos {mealsCount} repas avant le{" "}
              <strong>{cutoffLabel}</strong>.
            </Text>
          ) : (
            <Text style={text}>
              Pensez à faire votre sélection avant le{" "}
              <strong>{cutoffLabel}</strong>.
            </Text>
          )}
          <Text style={text}>
            Si vous ne modifiez rien, la sélection de votre dernière livraison
            pourra rester appliquée pour cette semaine.
          </Text>
          {portalUrl ? (
            <Text style={text}>
              Rendez-vous dans votre{" "}
              <Link href={portalUrl} style={link}>
                espace client
              </Link>{" "}
              pour choisir ou ajuster vos repas.
            </Text>
          ) : null}
          {portalUrl ? (
            <Text style={text}>
              <Link href={portalUrl} style={ctaLink}>
                Choisir mes repas
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

const link: React.CSSProperties = {
  color: "#111111",
  textDecoration: "underline",
};

const ctaLink: React.CSSProperties = {
  color: "#111111",
  fontWeight: 600,
  textDecoration: "underline",
};

export default MealSelectionReminderEmail;
