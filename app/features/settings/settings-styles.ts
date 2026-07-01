export const fieldStyle = {
  display: "grid",
  gap: "0.25rem",
} as const;

export const selectStyle = {
  border: "1px solid #c9cccf",
  borderRadius: "0.5rem",
  font: "inherit",
  padding: "0.6rem 0.75rem",
} as const;

export const productGridStyle = {
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
} as const;

export const numberInputStyle = {
  border: "1px solid #c9cccf",
  borderRadius: "0.5rem",
  font: "inherit",
  maxWidth: "8rem",
  padding: "0.6rem 0.75rem",
} as const;

export const warningBadgeStyle = {
  background: "#fef3c7",
  borderRadius: "999px",
  color: "#92400e",
  display: "inline-block",
  fontSize: "0.85rem",
  fontWeight: 600,
  padding: "0.2rem 0.6rem",
} as const;

export const productImageStyle = {
  borderRadius: "0.5rem",
  height: "96px",
  objectFit: "cover",
  width: "96px",
} as const;
