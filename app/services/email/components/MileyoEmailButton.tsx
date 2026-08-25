import * as React from "react";
import { Button } from "react-email";

import { mileyoEmailColors } from "./mileyoEmailTokens";

export type MileyoEmailButtonProps = {
  href: string;
  children: React.ReactNode;
};

/**
 * Primary CTA — matches builder `.tunnel-cta` (purple-black pill).
 * No URL fallback under the button (mobile clutter).
 */
export const MileyoEmailButton = ({
  href,
  children,
}: MileyoEmailButtonProps) => (
  <table
    role="presentation"
    width="100%"
    cellPadding={0}
    cellSpacing={0}
    style={wrap}
  >
    <tbody>
      <tr>
        <td align="center">
          <Button href={href} style={button}>
            {children}
          </Button>
        </td>
      </tr>
    </tbody>
  </table>
);

const wrap: React.CSSProperties = {
  margin: "6px 0 2px",
  width: "100%",
};

const button: React.CSSProperties = {
  backgroundColor: mileyoEmailColors.button,
  borderRadius: "28px",
  color: mileyoEmailColors.buttonText,
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 700,
  letterSpacing: "0.01em",
  lineHeight: "20px",
  padding: "12px 22px",
  textAlign: "center" as const,
  textDecoration: "none",
};

export default MileyoEmailButton;
