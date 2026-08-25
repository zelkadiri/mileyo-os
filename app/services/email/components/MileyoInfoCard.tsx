import * as React from "react";
import { Text } from "react-email";

import { mileyoEmailColors } from "./mileyoEmailTokens";

export type MileyoInfoItem = {
  label: string;
  value: string;
};

export type MileyoInfoCardProps = {
  items: MileyoInfoItem[];
};

/**
 * Compact summary card — tight label/value pairs, ~16px between groups.
 * Spacing is controlled here only (no per-template overrides).
 */
export const MileyoInfoCard = ({ items }: MileyoInfoCardProps) => {
  const usable = items.filter(
    (item) => item.label.trim() && item.value.trim(),
  );

  if (usable.length === 0) {
    return null;
  }

  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={card}
    >
      <tbody>
        <tr>
          <td style={inner}>
            {usable.map((item, index) => (
              <table
                key={`${item.label}-${index}`}
                role="presentation"
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                style={{
                  margin: 0,
                  marginBottom:
                    index === usable.length - 1 ? "0" : "16px",
                  width: "100%",
                }}
              >
                <tbody>
                  <tr>
                    <td style={{ padding: 0 }}>
                      <Text style={label}>{item.label}</Text>
                      <Text style={value}>{item.value}</Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            ))}
          </td>
        </tr>
      </tbody>
    </table>
  );
};

const card: React.CSSProperties = {
  backgroundColor: mileyoEmailColors.infoCardBg,
  border: `1px solid ${mileyoEmailColors.border}`,
  borderRadius: "12px",
  margin: "2px 0 14px",
  width: "100%",
};

const inner: React.CSSProperties = {
  padding: "12px 14px",
};

const label: React.CSSProperties = {
  color: mileyoEmailColors.muted,
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  lineHeight: "14px",
  margin: "0 0 2px",
  padding: 0,
  textTransform: "uppercase",
};

const value: React.CSSProperties = {
  color: mileyoEmailColors.title,
  fontSize: "15px",
  fontWeight: 700,
  lineHeight: "20px",
  margin: 0,
  padding: 0,
};

export default MileyoInfoCard;
