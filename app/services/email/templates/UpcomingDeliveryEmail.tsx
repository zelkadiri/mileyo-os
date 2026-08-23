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
  const greeting = customerName?.trim()
    ? `Bonjour ${customerName.trim()},`
    : "Bonjour,";

  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre prochaine box Mileyo arrive bientôt</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={brand}>Mileyo</Text>
          <Heading style={heading} as="h1">
            Votre prochaine box
          </Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Votre prochaine box Mileyo est prévue pour le{" "}
            <strong>{deliveryDateLabel}</strong>.
          </Text>
          {mealsCount != null && mealsCount > 0 ? (
            <Text style={sectionLabel}>
              {mealsCount} repas prévus pour cette livraison
            </Text>
          ) : null}
          {selectedMeals.length > 0 ? (
            <Text style={list} aria-label="Repas prévus">
              {selectedMeals.map((meal, index) => (
                <span key={`${meal}-${index}`}>
                  {index > 0 ? <br /> : null}• {meal}
                </span>
              ))}
            </Text>
          ) : null}
          {portalUrl ? (
            <>
              <Text style={text}>
                Consultez votre abonnement et le détail de vos livraisons
                depuis votre espace client.
              </Text>
              <Text style={ctaBlock}>
                <Link href={portalUrl} style={ctaLink}>
                  Voir mon abonnement
                </Link>
              </Text>
              <Text style={muted}>
                Ou copiez ce lien dans votre navigateur :{" "}
                <Link href={portalUrl} style={link}>
                  {portalUrl}
                </Link>
              </Text>
            </>
          ) : null}
          {supportHref ? (
            <Text style={footer}>
              Une question ?{" "}
              <Link href={supportHref} style={link}>
                {supportLabel?.trim() || "Contactez notre équipe"}
              </Link>
              .
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

const brand: React.CSSProperties = {
  color: "#111111",
  fontSize: "12px",
  fontWeight: 600,
  letterSpacing: "0.08em",
  margin: "0 0 12px",
  textTransform: "uppercase",
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

const sectionLabel: React.CSSProperties = {
  color: "#111111",
  fontSize: "14px",
  fontWeight: 600,
  lineHeight: "22px",
  margin: "16px 0 8px",
};

const list: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 16px",
};

const ctaBlock: React.CSSProperties = {
  margin: "0 0 8px",
};

const ctaLink: React.CSSProperties = {
  backgroundColor: "#111111",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: 600,
  lineHeight: "22px",
  padding: "12px 20px",
  textDecoration: "none",
};

const link: React.CSSProperties = {
  color: "#111111",
  textDecoration: "underline",
};

const muted: React.CSSProperties = {
  color: "#666666",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0 0 16px",
};

const footer: React.CSSProperties = {
  borderTop: "1px solid #eeeeee",
  color: "#666666",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "24px 0 0",
  paddingTop: "16px",
};

export default UpcomingDeliveryEmail;
