export const builderStyles = `
* { box-sizing: border-box; }
body { background: #fff; margin: 0; }
.builder-shell {
  color: #1f2933;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0 auto;
  max-width: 1120px;
  padding: 24px 16px 48px;
}
.hero, .setup-card, .section {
  background: #fffaf4;
  border: 1px solid #f0dfca;
  border-radius: 20px;
  margin-bottom: 18px;
  padding: 20px;
}
.hero h1, .setup-card h1, .section h2 { margin: 0 0 8px; }
.hero p, .setup-card p, .section p { margin: 0; }
.portal-link { margin-top: 12px; }
.portal-link a { color: #111827; font-weight: 700; }
.eyebrow, .muted { color: #6b7280; font-size: 0.9rem; }
.hidden { display: none; }
.toggle-row {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr;
  margin-bottom: 18px;
}
.toggle, .add-button, .quantity-row button {
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 12px 16px;
}
.toggle { background: #f3f4f6; color: #374151; }
.toggle.active, .add-button { background: #111827; color: white; }
button:disabled { cursor: not-allowed; opacity: 0.55; }
.section-heading {
  align-items: start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 16px;
}
.sticky-count { align-items: center; flex-wrap: wrap; }
.card-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
}
.product-card {
  appearance: none;
  background: white;
  border: 1px solid #ead8c0;
  border-radius: 18px;
  color: inherit;
  display: grid;
  gap: 8px;
  padding: 14px;
  text-align: left;
  width: 100%;
}
.product-card.selectable { cursor: pointer; }
.product-card.selected {
  background: #f7eadb;
  border-color: #111827;
  box-shadow: 0 0 0 2px #111827;
}
.selected-badge {
  background: #111827;
  border-radius: 999px;
  color: white;
  display: inline-flex;
  font-size: 0.8rem;
  font-weight: 800;
  justify-self: start;
  padding: 4px 10px;
}
.product-card img {
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  object-fit: cover;
  width: 100%;
}
.product-title { font-weight: 800; }
.quantity-row {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-top: 8px;
}
.quantity-row button {
  background: #111827;
  color: white;
  height: 40px;
  padding: 0;
  width: 40px;
}
.error {
  background: #fee2e2;
  border-radius: 12px;
  color: #991b1b;
  margin-bottom: 14px;
  padding: 12px;
}
@media (min-width: 640px) {
  .toggle-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 960px) {
  .card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
`;
