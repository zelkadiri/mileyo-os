import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "react-email";

import { MileyoEmailFooter } from "./MileyoEmailFooter";
import { MileyoEmailHeader } from "./MileyoEmailHeader";
import {
  mileyoEmailBodyStyle,
  mileyoEmailCardStyle,
  mileyoEmailEyebrowStyle,
  mileyoEmailOuterStyle,
  mileyoEmailTextStyle,
  mileyoEmailTitleStyle,
} from "./mileyoEmailTokens";

export type MileyoEmailLayoutProps = {
  preview: string;
  eyebrow?: string | null;
  title: string;
  children: React.ReactNode;
  supportHref?: string | null;
  supportLabel?: string | null;
  showSupport?: boolean;
};

/**
 * Shared shell for all Mileyo transactional emails:
 * cream background → centered logo → content card → footer.
 */
export const MileyoEmailLayout = ({
  preview,
  eyebrow,
  title,
  children,
  supportHref,
  supportLabel,
  showSupport = true,
}: MileyoEmailLayoutProps) => {
  const eyebrowLabel = eyebrow?.trim() || null;

  return (
    <Html lang="fr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={mileyoEmailBodyStyle}>
        <Container style={mileyoEmailOuterStyle}>
          <MileyoEmailHeader />
          <Container style={mileyoEmailCardStyle}>
            {eyebrowLabel ? (
              <Text style={mileyoEmailEyebrowStyle}>{eyebrowLabel}</Text>
            ) : null}
            <Heading style={mileyoEmailTitleStyle} as="h1">
              {title}
            </Heading>
            {children}
            <MileyoEmailFooter
              supportHref={supportHref}
              supportLabel={supportLabel}
              showSupport={showSupport}
            />
          </Container>
        </Container>
      </Body>
    </Html>
  );
};

/** Convenience re-export for body paragraphs inside the layout. */
export const MileyoEmailText = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => <Text style={{ ...mileyoEmailTextStyle, ...style }}>{children}</Text>;

export default MileyoEmailLayout;
