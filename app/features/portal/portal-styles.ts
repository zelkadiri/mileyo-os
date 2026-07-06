export const portalStyles = `
* { box-sizing: border-box; }
body { background: #fff; margin: 0; }
.portal-shell {
  color: #1f2933;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0 auto;
  max-width: 920px;
  padding: 24px 16px 48px;
}
.portal-card {
  background: #fffaf4;
  border: 1px solid #f0dfca;
  border-radius: 20px;
  margin-bottom: 18px;
  padding: 20px;
}
.portal-card h1, .portal-card h2, .portal-card h3 { margin: 0 0 8px; }
.portal-card p, .portal-card li { margin: 0; }
.intro { line-height: 1.5; }
.eyebrow, .muted { color: #6b7280; font-size: 0.9rem; }
.hidden { display: none; }
.meal-list {
  margin: 8px 0 16px;
  padding-left: 1.25rem;
}
.success {
  background: #dcfce7;
  border-radius: 12px;
  color: #166534;
  margin-top: 12px;
  padding: 12px;
}
.status-badge {
  border-radius: 999px;
  display: inline-block;
  font-size: 0.85rem;
  font-weight: 700;
  margin-bottom: 8px;
  padding: 6px 12px;
}
.status-badge.paused {
  background: #fef3c7;
  color: #92400e;
}
.status-badge.active {
  background: #dcfce7;
  color: #166534;
}
.status-badge.processing {
  background: #fef3c7;
  color: #92400e;
}
.status-badge.cancelled {
  background: #f3f4f6;
  color: #4b5563;
}
.status-badge.expired {
  background: #e5e7eb;
  color: #374151;
}
.status-badge.failed {
  background: #fee2e2;
  color: #991b1b;
}
.terminal-selection-card {
  background: #f9fafb;
  border-color: #e5e7eb;
}
.terminal-selection-card h2 {
  color: #374151;
}
.terminal-notice {
  line-height: 1.5;
  margin: 0 0 12px;
}
.terminal-intro h2 {
  margin-bottom: 8px;
}
.processing-notice {
  background: #fef3c7;
  border-radius: 12px;
  color: #92400e;
  margin-top: 12px;
  padding: 12px;
}
.processing-inline {
  color: #92400e;
  font-weight: 600;
}
.error {
  background: #fee2e2;
  border-radius: 12px;
  color: #991b1b;
  margin-bottom: 14px;
  padding: 12px;
}
.portal-button, .quantity-row button {
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 700;
  padding: 12px 16px;
  text-decoration: none;
}
.portal-button {
  background: #111827;
  color: white;
  margin-top: 8px;
}
.portal-button.secondary {
  background: #f3f4f6;
  color: #374151;
}
button:disabled { cursor: not-allowed; opacity: 0.55; }
.editor { margin-top: 16px; }
.editor-notice {
  color: #6b7280;
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0 0 12px;
}
.editor-notice.paused-notice {
  color: #92400e;
}
.recovery-block {
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 14px;
  margin: 16px 0;
  padding: 14px;
}
.recovery-title {
  color: #92400e;
  font-size: 1rem;
  margin: 0 0 8px;
}
.recovery-contact-button {
  margin-top: 12px;
  text-align: center;
  text-decoration: none;
}
.recovery-block--contact .recovery-message {
  font-weight: 400;
}
.recovery-message {
  color: #92400e;
  font-weight: 600;
  margin: 0 0 8px;
}
.recovery-retry {
  margin: 0 0 12px;
}
.recovery-note {
  font-size: 0.85rem;
  line-height: 1.4;
  margin: 8px 0 0;
}
.resume-note {
  color: #6b7280;
  font-size: 0.85rem;
  line-height: 1.4;
  margin: 8px 0 0;
}
.portal-error {
  margin-top: 12px;
}
.editor-heading {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 16px;
}
.meal-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
  margin-bottom: 12px;
}
.meal-card {
  background: white;
  border: 1px solid #ead8c0;
  border-radius: 18px;
  display: grid;
  gap: 8px;
  padding: 14px;
}
.meal-card img {
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  object-fit: cover;
  width: 100%;
}
.meal-title { font-weight: 800; }
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
.back-link { margin-top: 8px; }
.back-link a { color: #111827; }
.portal-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 4px;
}
.portal-tab {
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  color: #374151;
  cursor: pointer;
  flex: 1 0 auto;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  min-width: max-content;
  padding: 10px 16px;
  white-space: nowrap;
}
.portal-tab.active {
  background: #111827;
  border-color: #111827;
  color: white;
}
.portal-header {
  margin-bottom: 0;
}
.next-box-notice {
  margin: 12px 0 16px;
}
.forecast-card-header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
  margin-bottom: 8px;
}
.forecast-badge {
  background: #e0e7ff;
  border-radius: 999px;
  color: #3730a3;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 4px 10px;
}
.forecast-label {
  margin-bottom: 8px;
}
.forecast-intro h2,
.history-intro h2 {
  margin-bottom: 8px;
}
.history-order-link {
  display: inline-flex;
  margin-top: 12px;
}
@media (min-width: 640px) {
  .meal-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 960px) {
  .meal-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.box-change-editor {
  border-top: 1px solid #eadfce;
  margin-top: 16px;
  padding-top: 16px;
}
.box-change-step h3 {
  margin: 0 0 8px;
}
.box-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
  margin: 16px 0;
}
.box-card {
  background: #fff;
  border: 2px solid #eadfce;
  border-radius: 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  text-align: left;
}
.box-card.selected {
  border-color: #c45d28;
  box-shadow: 0 0 0 1px #c45d28;
}
.box-card.unavailable {
  cursor: not-allowed;
  opacity: 0.65;
}
.box-card img {
  border-radius: 12px;
  height: 120px;
  object-fit: cover;
  width: 100%;
}
.box-card-title {
  font-weight: 700;
}
.box-card-meta,
.box-card-price {
  color: #52606d;
  font-size: 14px;
}
.box-card-badge {
  color: #c45d28;
  font-size: 13px;
  font-weight: 600;
}
.box-change-blocked {
  margin-top: 8px;
}
.box-change-step .portal-button {
  margin-right: 8px;
}
@media (min-width: 640px) {
  .box-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 960px) {
  .box-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
`;
