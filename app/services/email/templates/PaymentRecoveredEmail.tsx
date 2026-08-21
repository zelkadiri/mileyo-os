import * as React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text } from "react-email";

export type PaymentRecoveredEmailProps = {
  customerName?: string | null;
};

/**
 * Payment recovered — confirmation template.
 * No business logic; props are display-ready.
 */
export const PaymentRecoveredEmail = ({
  customerName,
}: PaymentRecoveredEmailProps) => {
  const greeting = customerName?.trim()
    ? `Bonjour ${customerName.trim()},`
    : "Bonjour,";

  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre paiement a été récupéré</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading} as="h1">
            Paiement récupéré
          </Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Bonne nouvelle : le paiement de votre abonnement Mileyo a bien été
            encaissé. Votre abonnement continue normalement.
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

export default PaymentRecoveredEmail;
