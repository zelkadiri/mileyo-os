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
  const greeting = customerName?.trim()
    ? `Bonjour ${customerName.trim()},`
    : "Bonjour,";

  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre abonnement Mileyo est actif</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading} as="h1">
            Abonnement confirmé
          </Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Votre abonnement Mileyo est bien en place. Nous préparons vos
            prochaines livraisons selon la sélection que vous avez choisie.
          </Text>
          {mealsCount != null && mealsCount > 0 ? (
            <Text style={text}>
              Votre box contient {mealsCount} repas par livraison.
            </Text>
          ) : null}
          {nextDelivery ? (
            <Text style={text}>
              Prochaine livraison prévue : {nextDelivery}
            </Text>
          ) : null}
          {portalUrl ? (
            <Text style={text}>
              Vous pouvez gérer votre abonnement, modifier vos repas ou mettre
              en pause depuis votre{" "}
              <Link href={portalUrl} style={link}>
                espace client
              </Link>
              .
            </Text>
          ) : (
            <Text style={text}>
              Vous pourrez bientôt gérer votre abonnement depuis votre espace
              client Mileyo.
            </Text>
          )}
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

export default SubscriptionCreatedEmail;
