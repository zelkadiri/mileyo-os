export const introStyle = {
  color: "#4b5563",
  margin: 0,
} as const;

export const warningBannerStyle = {
  background: "#fef3c7",
  borderRadius: "12px",
  color: "#92400e",
  padding: "12px 16px",
} as const;

export const infoBannerStyle = {
  background: "#eff6ff",
  borderRadius: "12px",
  color: "#1e40af",
  padding: "12px 16px",
} as const;

export const successBannerStyle = {
  background: "#dcfce7",
  borderRadius: "12px",
  color: "#166534",
  padding: "12px 16px",
} as const;

export const summaryGridStyle = {
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
} as const;

export const summaryCardStyle = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  padding: "0.9rem 1rem",
} as const;

export const summaryLabelStyle = {
  color: "#6b7280",
  fontSize: "0.875rem",
  margin: 0,
} as const;

export const summaryValueStyle = {
  fontSize: "1.25rem",
  fontWeight: 700,
  margin: "0.25rem 0 0",
} as const;

export const envPanelStyle = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  padding: "1rem",
} as const;

export const listStyle = {
  margin: 0,
  paddingLeft: "1.25rem",
} as const;

export const primaryButtonStyle = {
  background: "#111827",
  border: 0,
  borderRadius: "999px",
  color: "white",
  cursor: "pointer",
  display: "inline-block",
  font: "inherit",
  fontWeight: 700,
  padding: "0.65rem 1rem",
  textDecoration: "none",
} as const;

export const secondaryButtonStyle = {
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: "999px",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  padding: "0.55rem 0.95rem",
  textDecoration: "none",
} as const;

export const buttonRowStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.5rem",
} as const;

export const statusBadgeStyle = (tone: "ready" | "todo" | "system") =>
  ({
    background:
      tone === "ready" ? "#dcfce7" : tone === "system" ? "#e0e7ff" : "#fef3c7",
    borderRadius: "999px",
    color:
      tone === "ready" ? "#166534" : tone === "system" ? "#3730a3" : "#92400e",
    display: "inline-block",
    fontSize: "0.8rem",
    fontWeight: 700,
    padding: "0.2rem 0.65rem",
  }) as const;

export const codeBlockStyle = {
  background: "#111827",
  borderRadius: "12px",
  boxSizing: "border-box" as const,
  color: "#f9fafb",
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: "0.75rem",
  lineHeight: 1.45,
  maxHeight: "min(420px, 55vh)",
  maxWidth: "100%",
  overflow: "auto",
  overflowX: "auto" as const,
  padding: "1rem",
  whiteSpace: "pre" as const,
  width: "100%",
} as const;

export const pageShellStyle = {
  maxWidth: "100%",
  minWidth: 0,
  overflowX: "hidden" as const,
} as const;

export const mutedStyle = {
  color: "#6b7280",
  margin: 0,
} as const;
