import * as React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text } from "react-email";

export type PaymentFailedEmailProps = {
  customerName?: string | null;
  failureCount?: number | null;
  nextRetryAt?: string | null;
};

/**
 * Payment failed — informational template.
 * No business logic; props are display-ready.
 */
export const PaymentFailedEmail = ({
  customerName,
  failureCount,
  nextRetryAt,
}: PaymentFailedEmailProps) => {
  const greeting = customerName?.trim()
    ? `Bonjour ${customerName.trim()},`
    : "Bonjour,";

  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre paiement d’abonnement n’a pas abouti</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading} as="h1">
            Paiement échoué
          </Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Nous n’avons pas pu encaisser le paiement de votre abonnement
            Mileyo.
          </Text>
          {nextRetryAt ? (
            <Text style={text}>
              Prochaine tentative automatique : {nextRetryAt}
            </Text>
          ) : null}
          {failureCount != null && failureCount > 0 ? (
            <Text style={muted}>
              Tentative {failureCount} enregistrée.
            </Text>
          ) : null}
          <Text style={text}>
            Vous pouvez mettre à jour votre moyen de paiement depuis votre
            espace client si besoin.
          </Text>
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

const muted: React.CSSProperties = {
  ...text,
  color: "#666666",
};

export default PaymentFailedEmail;
