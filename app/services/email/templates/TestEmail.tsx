import * as React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text } from "react-email";

export type TestEmailProps = {
  message?: string;
};

/**
 * Minimal React Email template used to validate the render pipeline.
 * Not a customer-facing email.
 */
export const TestEmail = ({
  message = "Mileyo OS email foundation is working.",
}: TestEmailProps) => (
  <Html lang="fr">
    <Head />
    <Preview>Mileyo OS — test email</Preview>
    <Body style={body}>
      <Container style={container}>
        <Heading style={heading} as="h1">
          Email test — Mileyo OS
        </Heading>
        <Text style={text} data-testid="email-test-message">
          {message}
        </Text>
      </Container>
    </Body>
  </Html>
);

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
  margin: 0,
};

export default TestEmail;
