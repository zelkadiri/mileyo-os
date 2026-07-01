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

export const productImageStyle = {
  borderRadius: "0.5rem",
  height: "96px",
  objectFit: "cover",
  width: "96px",
} as const;
