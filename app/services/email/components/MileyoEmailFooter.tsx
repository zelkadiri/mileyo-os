import * as React from "react";
import { Link, Text } from "react-email";

import {
  MILEYO_EMAIL_SUPPORT_FALLBACK_HREF,
  MILEYO_EMAIL_SUPPORT_LABEL,
  mileyoEmailColors,
  mileyoEmailLinkStyle,
} from "./mileyoEmailTokens";

export type MileyoEmailFooterProps = {
  supportHref?: string | null;
  supportLabel?: string | null;
  /** When false, omit support line (rare). Default true. */
  showSupport?: boolean;
};

/**
 * Compact transactional footer — support + discreet line. No logo repeat.
 */
export const MileyoEmailFooter = ({
  supportHref,
  supportLabel,
  showSupport = true,
}: MileyoEmailFooterProps) => {
  const href = supportHref?.trim() || MILEYO_EMAIL_SUPPORT_FALLBACK_HREF;
  const label = supportLabel?.trim() || MILEYO_EMAIL_SUPPORT_LABEL;

  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={footerTable}
    >
      <tbody>
        {showSupport ? (
          <tr>
            <td style={supportCell}>
              <Text style={supportText}>
                Une question ?{" "}
                <Link href={href} style={mileyoEmailLinkStyle}>
                  {label}
                </Link>
              </Text>
            </td>
          </tr>
        ) : null}
        <tr>
          <td style={noteCell}>
            <Text style={legalNote}>
              Mileyo — cet email concerne votre abonnement.
            </Text>
          </td>
        </tr>
      </tbody>
    </table>
  );
};

const footerTable: React.CSSProperties = {
  borderTop: `1px solid ${mileyoEmailColors.border}`,
  marginTop: "20px",
  width: "100%",
};

const supportCell: React.CSSProperties = {
  paddingTop: "12px",
};

const noteCell: React.CSSProperties = {
  paddingTop: "6px",
};

const supportText: React.CSSProperties = {
  color: mileyoEmailColors.muted,
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};

const legalNote: React.CSSProperties = {
  color: mileyoEmailColors.muted,
  fontSize: "11px",
  lineHeight: "16px",
  margin: 0,
};

export default MileyoEmailFooter;
