export const listStyle = {
  margin: 0,
  paddingLeft: "1.25rem",
} as const;

export const exportButtonStyle = {
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
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: "999px",
  color: "#111827",
  cursor: "pointer",
  display: "inline-block",
  font: "inherit",
  fontWeight: 600,
  padding: "0.5rem 0.9rem",
  textDecoration: "none",
} as const;

export const introStyle = {
  color: "#4b5563",
  margin: 0,
} as const;

export const datePickerRowStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.75rem",
};

export const dateInputStyle = {
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  font: "inherit",
  padding: "0.5rem 0.75rem",
} as const;

export const summaryGridStyle = {
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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

export const productionSectionStyle = {
  background: "#fff7ed",
  border: "2px solid #fdba74",
  borderRadius: "16px",
  padding: "1.25rem",
} as const;

export const productionHeadingStyle = {
  fontSize: "1.35rem",
  fontWeight: 800,
  margin: "0 0 1rem",
} as const;

export const mealRowStyle = {
  alignItems: "baseline",
  borderBottom: "1px solid #fed7aa",
  display: "flex",
  gap: "1rem",
  justifyContent: "space-between",
  padding: "0.85rem 0",
} as const;

export const mealTitleStyle = {
  fontSize: "1.1rem",
  fontWeight: 700,
  margin: 0,
} as const;

export const mealQuantityStyle = {
  color: "#9a3412",
  fontSize: "1.35rem",
  fontWeight: 800,
  margin: 0,
  whiteSpace: "nowrap" as const,
} as const;

export const warningBannerStyle = {
  background: "#fef3c7",
  borderRadius: "12px",
  color: "#92400e",
  padding: "12px 16px",
} as const;

export const emptyStateStyle = {
  color: "#6b7280",
  fontStyle: "italic" as const,
  margin: 0,
} as const;

export const orderMetaStyle = {
  color: "#4b5563",
  margin: 0,
} as const;

export const chipRowStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.5rem",
} as const;

export const chipLinkStyle = (active: boolean) =>
  ({
    background: active ? "#111827" : "#ffffff",
    border: "1px solid #d1d5db",
    borderRadius: "999px",
    color: active ? "#ffffff" : "#111827",
    display: "inline-block",
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 600,
    padding: "0.4rem 0.75rem",
    textDecoration: "none",
  }) as const;
