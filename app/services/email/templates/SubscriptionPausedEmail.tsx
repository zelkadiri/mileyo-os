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

import type { SubscriptionPauseCause } from "../email.types";

export type SubscriptionPausedEmailProps = {
  customerName?: string | null;
  pauseCause: SubscriptionPauseCause;
  portalUrl?: string | null;
};

/**
 * Subscription paused — confirmation template (cause-specific copy).
 * No business logic; props are display-ready.
 */
export const SubscriptionPausedEmail = ({
  customerName,
  pauseCause,
  portalUrl,
}: SubscriptionPausedEmailProps) => {
  const greeting = customerName?.trim()
    ? `Bonjour ${customerName.trim()},`
    : "Bonjour,";

  const isVoluntary = pauseCause === "user_voluntary";

  return (
    <Html lang="fr">
      <Head />
      <Preview>
        {isVoluntary
          ? "Votre abonnement Mileyo est en pause"
          : "Votre abonnement Mileyo a été suspendu"}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading} as="h1">
            {isVoluntary ? "Abonnement en pause" : "Abonnement suspendu"}
          </Heading>
          <Text style={text}>{greeting}</Text>
          {isVoluntary ? (
            <>
              <Text style={text}>
                Nous confirmons la mise en pause de votre abonnement Mileyo.
                Aucune nouvelle livraison ne sera préparée tant que votre
                abonnement reste suspendu.
              </Text>
              {portalUrl ? (
                <Text style={text}>
                  Vous pouvez le reprendre à tout moment depuis votre{" "}
                  <Link href={portalUrl} style={link}>
                    espace client
                  </Link>
                  .
                </Text>
              ) : (
                <Text style={text}>
                  Vous pourrez reprendre votre abonnement depuis votre espace
                  client Mileyo.
                </Text>
              )}
            </>
          ) : (
            <>
              <Text style={text}>
                Votre abonnement Mileyo a été suspendu après plusieurs échecs de
                paiement. Pour le réactiver, merci de régulariser votre situation
                et de mettre à jour votre moyen de paiement.
              </Text>
              {portalUrl ? (
                <Text style={text}>
                  Rendez-vous sur votre{" "}
                  <Link href={portalUrl} style={link}>
                    espace client
                  </Link>{" "}
                  pour mettre à jour vos informations de paiement et reprendre
                  votre abonnement.
                </Text>
              ) : (
                <Text style={text}>
                  Connectez-vous à votre espace client Mileyo pour mettre à jour
                  votre moyen de paiement.
                </Text>
              )}
            </>
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

export default SubscriptionPausedEmail;
