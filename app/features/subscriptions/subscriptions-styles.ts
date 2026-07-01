export const listStyle = {
  margin: 0,
  paddingLeft: "1.25rem",
} as const;

export const buttonRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  marginTop: "0.5rem",
} as const;

export const primaryButtonStyle = {
  background: "#111827",
  border: 0,
  borderRadius: "999px",
  color: "white",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  padding: "0.65rem 1rem",
} as const;

export const secondaryButtonStyle = {
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: "999px",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  padding: "0.65rem 1rem",
} as const;

export const bannerStyle = (variant: "error" | "success" | "warning") =>
  ({
    background:
      variant === "success"
        ? "#dcfce7"
        : variant === "warning"
          ? "#fef3c7"
          : "#fee2e2",
    borderRadius: "12px",
    color:
      variant === "success"
        ? "#166534"
        : variant === "warning"
          ? "#92400e"
          : "#991b1b",
    padding: "12px 16px",
  }) as const;

export const billingWarningColumnStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
} as const;
