/**
 * Admin email observability (EMAIL-6G-A) — styles.
 * Dense ops UI; matches existing admin chrome (cards / badges / banners).
 */

/**
 * Responsive overrides (media queries can't live in React style objects).
 * Table minWidth must not widen the page — contain + overflow on the shell.
 */
export const emailsLayoutCss = `
.emails-page-shell {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  width: 100%;
}
.emails-page-shell > * {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
}
.emails-metrics-grid,
.emails-cron-meta-grid {
  box-sizing: border-box;
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  max-width: 100%;
  min-width: 0;
  width: 100%;
}
.emails-cron-meta-grid {
  gap: 0.65rem;
}
.emails-table-wrap {
  box-sizing: border-box;
  contain: inline-size;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  width: 100%;
}
@media (min-width: 900px) {
  .emails-metrics-grid,
  .emails-cron-meta-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 520px) {
  .emails-metrics-grid,
  .emails-cron-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 360px) {
  .emails-metrics-grid,
  .emails-cron-meta-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
`;

export const pageShellStyle = {
  boxSizing: "border-box" as const,
  display: "grid",
  gap: "24px",
  margin: "0 auto",
  maxWidth: "100%",
  minWidth: 0,
  overflowX: "auto" as const,
  width: "100%",
} as const;

export const introStyle = {
  color: "#4b5563",
  margin: 0,
} as const;

export const introSubStyle = {
  color: "#9ca3af",
  fontSize: "0.8rem",
  margin: "0.35rem 0 0",
} as const;

/**
 * Column count lives in emailsLayoutCss (media queries).
 * Inline styles only set box model — avoid overriding MQ with gridTemplateColumns.
 */
export const summaryGridStyle = {
  boxSizing: "border-box" as const,
  maxWidth: "100%",
  minWidth: 0,
  width: "100%",
} as const;

export const summaryCardStyle = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  boxSizing: "border-box" as const,
  minWidth: 0,
  overflow: "hidden" as const,
  padding: "0.9rem 1rem",
} as const;

export const summaryCardIncidentStyle = {
  ...summaryCardStyle,
  background: "#fef2f2",
  borderColor: "#fecaca",
} as const;

export const summaryLabelStyle = {
  color: "#6b7280",
  fontSize: "0.8rem",
  fontWeight: 600,
  lineHeight: 1.3,
  margin: 0,
  overflow: "hidden" as const,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
} as const;

export const summarySubLabelStyle = {
  color: "#9ca3af",
  fontSize: "0.7rem",
  margin: "0.1rem 0 0",
} as const;

export const summaryValueStyle = {
  fontSize: "1.35rem",
  fontWeight: 700,
  letterSpacing: "-0.01em",
  margin: "0.35rem 0 0",
} as const;

export const summaryValueMutedStyle = {
  ...summaryValueStyle,
  color: "#9ca3af",
  fontSize: "1rem",
  fontWeight: 600,
} as const;

export const filtersFormStyle = {
  alignItems: "end",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.75rem",
} as const;

export const filterFieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.25rem",
  minWidth: "140px",
} as const;

export const filterLabelStyle = {
  color: "#6b7280",
  fontSize: "0.75rem",
  fontWeight: 600,
} as const;

export const filterControlStyle = {
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  font: "inherit",
  padding: "0.45rem 0.6rem",
} as const;

/** Softer than primary — filters must not dominate the data. */
export const filterSubmitButtonStyle = {
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: "999px",
  color: "#374151",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  padding: "0.5rem 0.95rem",
} as const;

export const primaryButtonStyle = {
  background: "#111827",
  border: 0,
  borderRadius: "999px",
  color: "white",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  padding: "0.55rem 1rem",
} as const;

export const secondaryButtonStyle = {
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: "999px",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  padding: "0.5rem 0.9rem",
  textDecoration: "none",
} as const;

export const tableWrapStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  boxSizing: "border-box" as const,
  contain: "inline-size" as const,
  maxWidth: "100%",
  minWidth: 0,
  overflowX: "auto" as const,
  width: "100%",
} as const;

export const tableStyle = {
  borderCollapse: "collapse" as const,
  fontSize: "0.875rem",
  minWidth: "1120px",
  width: "100%",
  tableLayout: "fixed" as const,
} as const;

export const thStyle = {
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
  color: "#4b5563",
  fontSize: "0.75rem",
  fontWeight: 700,
  padding: "0.65rem 0.75rem",
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
} as const;

export const tdStyle = {
  borderBottom: "1px solid #f3f4f6",
  padding: "0.65rem 0.75rem",
  verticalAlign: "top" as const,
} as const;

/** Ellipsis respects column % from fixed table layout. */
export const truncateCellStyle = {
  maxWidth: "100%",
  overflow: "hidden" as const,
  textOverflow: "ellipsis" as const,
  whiteSpace: "nowrap" as const,
} as const;

export const providerCellStyle = {
  maxWidth: "100%",
  overflow: "hidden" as const,
  textOverflow: "ellipsis" as const,
  whiteSpace: "nowrap" as const,
} as const;

/** Short error snippet — avoid multi-line crush in a narrow column. */
export const errorCellStyle = {
  maxWidth: "100%",
  overflow: "hidden" as const,
  overflowWrap: "anywhere" as const,
  whiteSpace: "normal" as const,
  wordBreak: "break-word" as const,
} as const;

/** Neutral open trigger — admin table, not a link farm. */
export const rowOpenStyle = {
  background: "none",
  border: 0,
  color: "#374151",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 500,
  padding: 0,
  textAlign: "left" as const,
  textDecoration: "none",
} as const;

/** @deprecated kept for any residual import; prefer rowOpenStyle */
export const rowLinkStyle = rowOpenStyle;

export const mutedStyle = {
  color: "#6b7280",
  margin: 0,
} as const;

export const emptyStateStyle = {
  background: "#f9fafb",
  border: "1px dashed #d1d5db",
  borderRadius: "12px",
  color: "#4b5563",
  padding: "1.25rem 1rem",
  textAlign: "center" as const,
} as const;

export const warningBannerStyle = {
  background: "#fef3c7",
  borderRadius: "8px",
  color: "#92400e",
  margin: "0.35rem 0 0",
  padding: "0.35rem 0.55rem",
  fontSize: "0.75rem",
  fontWeight: 600,
} as const;

export const paginationRowStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.75rem",
  justifyContent: "space-between",
} as const;

export const statusBadgeStyle = (
  tone:
    | "pending"
    | "processing"
    | "sent"
    | "failed"
    | "exhausted"
    | "cancelled"
    | "other",
) => {
  const isIncident = tone === "failed" || tone === "exhausted";
  const isNeutral =
    tone === "sent" || tone === "pending" || tone === "cancelled" || tone === "other";

  return {
    background:
      tone === "sent"
        ? "#f0fdf4"
        : tone === "pending"
          ? "#fffbeb"
          : tone === "processing"
            ? "#eff6ff"
            : tone === "failed"
              ? "#fee2e2"
              : tone === "exhausted"
                ? "#fecaca"
                : tone === "cancelled"
                  ? "#f3f4f6"
                  : "#f3f4f6",
    border: isIncident
      ? tone === "exhausted"
        ? "1px solid #f87171"
        : "1px solid #fca5a5"
      : "1px solid transparent",
    borderRadius: "999px",
    color:
      tone === "sent"
        ? "#15803d"
        : tone === "pending"
          ? "#a16207"
          : tone === "processing"
            ? "#1d4ed8"
            : tone === "failed"
              ? "#b91c1c"
              : tone === "exhausted"
                ? "#7f1d1d"
                : tone === "cancelled"
                  ? "#6b7280"
                  : "#6b7280",
    display: "inline-block",
    fontSize: "0.75rem",
    fontWeight: isIncident ? 700 : isNeutral ? 600 : 600,
    padding: "0.2rem 0.6rem",
    whiteSpace: "nowrap" as const,
  } as const;
};

export const drawerBackdropStyle = {
  background: "rgba(17, 24, 39, 0.45)",
  bottom: 0,
  left: 0,
  position: "fixed" as const,
  right: 0,
  top: 0,
  zIndex: 40,
} as const;

export const drawerPanelStyle = {
  background: "#ffffff",
  bottom: 0,
  boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
  display: "flex",
  flexDirection: "column" as const,
  maxWidth: "100%",
  overflowY: "auto" as const,
  padding: "1.25rem 1.35rem",
  position: "fixed" as const,
  right: 0,
  top: 0,
  width: "min(460px, 100vw)",
  zIndex: 50,
} as const;

export const drawerHeaderStyle = {
  alignItems: "flex-start",
  display: "flex",
  gap: "0.75rem",
  justifyContent: "space-between",
  marginBottom: "1.15rem",
  paddingBottom: "1rem",
  borderBottom: "1px solid #e5e7eb",
} as const;

export const drawerTitleStyle = {
  fontSize: "1.15rem",
  fontWeight: 700,
  lineHeight: 1.3,
  margin: 0,
} as const;

export const drawerHeaderMetaStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.5rem",
  marginTop: "0.45rem",
} as const;

export const drawerSummaryStyle = {
  color: "#6b7280",
  fontSize: "0.8rem",
  lineHeight: 1.45,
  margin: "0.55rem 0 0",
} as const;

export const detailGridStyle = {
  display: "grid",
  gap: "1.1rem",
} as const;

export const detailSectionStyle = {
  display: "grid",
  gap: "0.55rem",
} as const;

export const detailSectionTitleStyle = {
  color: "#111827",
  fontSize: "0.8rem",
  fontWeight: 700,
  letterSpacing: "0.02em",
  margin: 0,
  textTransform: "uppercase" as const,
} as const;

export const detailRowStyle = {
  borderBottom: "1px solid #f3f4f6",
  display: "grid",
  gap: "0.15rem",
  paddingBottom: "0.5rem",
} as const;

export const detailKeyStyle = {
  color: "#6b7280",
  fontSize: "0.75rem",
  fontWeight: 600,
  margin: 0,
} as const;

export const detailValueStyle = {
  fontSize: "0.875rem",
  margin: 0,
  overflowWrap: "anywhere" as const,
  whiteSpace: "pre-wrap" as const,
} as const;

export const techIdBlockStyle = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: "0.72rem",
  lineHeight: 1.45,
  margin: 0,
  overflowWrap: "break-word" as const,
  padding: "0.45rem 0.55rem",
  wordBreak: "break-all" as const,
} as const;

export const errorPanelStyle = {
  background: "#fff7f7",
  border: "1px solid #fecaca",
  borderRadius: "10px",
  display: "grid",
  gap: "0.45rem",
  padding: "0.75rem 0.85rem",
} as const;

export const metaPairStyle = {
  display: "grid",
  gap: "0.1rem",
  marginBottom: "0.4rem",
} as const;

export const timelineListStyle = {
  margin: "0.35rem 0 0",
  paddingLeft: "1.1rem",
} as const;

export const timelineDisclaimerStyle = {
  color: "#9ca3af",
  fontSize: "0.7rem",
  lineHeight: 1.35,
  margin: "0.15rem 0 0",
} as const;

export const monoStyle = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: "0.8rem",
} as const;

/** EMAIL-6G-C — compact cron health + alerts */
export const healthPanelStyle = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  boxSizing: "border-box" as const,
  display: "grid",
  gap: "0.85rem",
  maxWidth: "100%",
  minWidth: 0,
  overflow: "hidden" as const,
  padding: "0.9rem 1rem",
  width: "100%",
} as const;

export const healthHeaderRowStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.65rem",
  justifyContent: "space-between",
  maxWidth: "100%",
  minWidth: 0,
  width: "100%",
} as const;

export const healthTitleStyle = {
  fontSize: "0.95rem",
  fontWeight: 700,
  margin: 0,
  minWidth: 0,
} as const;

export const healthMetaGridStyle = {
  boxSizing: "border-box" as const,
  maxWidth: "100%",
  minWidth: 0,
  width: "100%",
} as const;

export const healthMetaLabelStyle = {
  color: "#6b7280",
  fontSize: "0.7rem",
  fontWeight: 600,
  margin: 0,
} as const;

export const healthMetaValueStyle = {
  fontSize: "0.85rem",
  fontWeight: 600,
  margin: "0.15rem 0 0",
} as const;

export const healthLevelBadgeStyle = (
  level: "ok" | "attention" | "incident",
) =>
  ({
    background:
      level === "ok"
        ? "#f0fdf4"
        : level === "attention"
          ? "#fffbeb"
          : "#fef2f2",
    border:
      level === "ok"
        ? "1px solid #bbf7d0"
        : level === "attention"
          ? "1px solid #fde68a"
          : "1px solid #fecaca",
    borderRadius: "999px",
    color:
      level === "ok"
        ? "#15803d"
        : level === "attention"
          ? "#a16207"
          : "#b91c1c",
    display: "inline-block",
    flexShrink: 0,
    fontSize: "0.75rem",
    fontWeight: 700,
    padding: "0.2rem 0.65rem",
    whiteSpace: "nowrap" as const,
  }) as const;

export const alertsListStyle = {
  display: "grid",
  gap: "0.4rem",
  margin: 0,
  padding: 0,
} as const;

export const alertItemStyle = (severity: "attention" | "incident") =>
  ({
    background: severity === "incident" ? "#fef2f2" : "#fffbeb",
    border: `1px solid ${severity === "incident" ? "#fecaca" : "#fde68a"}`,
    borderRadius: "8px",
    color: severity === "incident" ? "#991b1b" : "#92400e",
    fontSize: "0.8rem",
    fontWeight: 600,
    listStyle: "none",
    margin: 0,
    padding: "0.45rem 0.65rem",
  }) as const;

export const alertLinkStyle = {
  color: "inherit",
  textDecoration: "underline",
} as const;

export const noAlertStyle = {
  color: "#6b7280",
  fontSize: "0.8rem",
  margin: 0,
} as const;

export const cronHistoryTableStyle = {
  borderCollapse: "collapse" as const,
  fontSize: "0.8rem",
  minWidth: "520px",
  width: "100%",
} as const;
