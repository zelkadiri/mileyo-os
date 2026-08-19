export const portalStyles = `
:root {
  --mileyo-purple: #B98AD7;
  --mileyo-purple-dark: #9B6FC2;
  --mileyo-lilac: #DCC2F0;
  --mileyo-purple-black: #5A1B69;
  --mileyo-purple-dark-black: #2A0B33;
  --mileyo-pink: #EFC4D6;
  --mileyo-peach: #F3CBB8;
  --mileyo-white: #ffffff;
  --mileyo-cream: #FCF8F6;
  --mileyo-gold: #E6C08A;
  --mileyo-green: #7CC9A7;
  --mileyo-text: #3A2C45;
  --mileyo-muted: rgba(58, 44, 69, 0.62);
  --mileyo-glass: rgba(255, 255, 255, 0.22);
  --mileyo-radius-xl: 34px;
  --mileyo-radius-lg: 24px;
  --mileyo-shadow: 0 24px 70px rgba(185, 138, 215, 0.18);
  --mileyo-shadow-soft: 0 8px 28px rgba(90, 27, 105, 0.08);
}

* { box-sizing: border-box; }

body {
  background: linear-gradient(180deg, var(--mileyo-cream) 0%, #fff 42%, var(--mileyo-cream) 100%);
  color: var(--mileyo-text);
  font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  margin: 0;
}

.portal-shell {
  margin: 0 auto;
  max-width: 960px;
  padding: 28px 16px 56px;
}

.portal-card {
  background: var(--mileyo-white);
  border: 1px solid rgba(220, 194, 240, 0.55);
  border-radius: var(--mileyo-radius-lg);
  box-shadow: var(--mileyo-shadow-soft);
  margin-bottom: 20px;
  padding: 24px;
}

.portal-card h1,
.portal-card h2,
.portal-card h3 {
  color: var(--mileyo-purple-black);
  font-family: Georgia, "Times New Roman", serif;
  margin: 0 0 10px;
}

.portal-card p,
.portal-card li {
  line-height: 1.55;
  margin: 0;
}

.portal-header {
  background: linear-gradient(135deg, var(--mileyo-white) 0%, rgba(252, 248, 246, 0.95) 55%, rgba(239, 196, 214, 0.18) 100%);
  border-radius: var(--mileyo-radius-xl);
  box-shadow: var(--mileyo-shadow);
  padding: 32px 28px;
}

.portal-header h1 {
  font-size: clamp(1.85rem, 4vw, 2.45rem);
  letter-spacing: -0.02em;
  margin-bottom: 12px;
}

.eyebrow {
  color: var(--mileyo-purple-dark);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  margin-bottom: 10px;
  text-transform: uppercase;
}

.intro {
  color: var(--mileyo-muted);
  font-size: 1.02rem;
  line-height: 1.65;
  max-width: 52ch;
}

.muted {
  color: var(--mileyo-muted);
  font-size: 0.92rem;
}

.hidden { display: none; }

.portal-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 8px 0 22px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 4px;
}

.portal-tab {
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(220, 194, 240, 0.7);
  border-radius: 999px;
  color: var(--mileyo-text);
  cursor: pointer;
  flex: 1 0 auto;
  font: inherit;
  font-size: 0.92rem;
  font-weight: 600;
  min-width: max-content;
  padding: 11px 18px;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
  white-space: nowrap;
}

.portal-tab:hover {
  border-color: var(--mileyo-purple);
  transform: translateY(-1px);
}

.portal-tab.active {
  background: linear-gradient(135deg, var(--mileyo-purple) 0%, var(--mileyo-purple-dark) 100%);
  border-color: transparent;
  box-shadow: 0 10px 24px rgba(185, 138, 215, 0.28);
  color: var(--mileyo-white);
}

.status-badge {
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin-bottom: 14px;
  padding: 7px 14px;
}

.status-badge.active {
  background: rgba(124, 201, 167, 0.18);
  color: #2f6f57;
}

.status-badge.paused {
  background: rgba(230, 192, 138, 0.22);
  color: #7a5a24;
}

.status-badge.processing {
  background: rgba(243, 203, 184, 0.35);
  color: #8b4f2f;
}

.status-badge.cancelled {
  background: rgba(58, 44, 69, 0.08);
  color: var(--mileyo-muted);
}

.status-badge.expired {
  background: rgba(220, 194, 240, 0.35);
  color: var(--mileyo-purple-black);
}

.status-badge.failed {
  background: rgba(239, 196, 214, 0.45);
  color: #8b3058;
}

.card-top {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 18px;
}

.card-top h2 {
  font-size: 1.45rem;
  margin: 0;
}

.key-info-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
  margin-bottom: 22px;
}

.key-info-item {
  background: rgba(252, 248, 246, 0.9);
  border: 1px solid rgba(220, 194, 240, 0.45);
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
}

.key-info-item--highlight {
  background: linear-gradient(135deg, rgba(185, 138, 215, 0.14) 0%, rgba(239, 196, 214, 0.2) 100%);
  border-color: rgba(185, 138, 215, 0.45);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}

.key-info-label {
  color: var(--mileyo-muted);
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.key-info-value {
  color: var(--mileyo-purple-black);
  font-size: 1.08rem;
  font-weight: 700;
  line-height: 1.35;
}

.key-info-item--highlight .key-info-value {
  font-size: 1.2rem;
}

.key-info-value--pending {
  color: var(--mileyo-muted);
  font-size: 0.98rem;
  font-style: italic;
  font-weight: 600;
}

.section-heading {
  color: var(--mileyo-purple-black);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.05rem;
  margin: 0 0 12px;
}

.meal-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
}

.meal-chip {
  background: rgba(220, 194, 240, 0.22);
  border: 1px solid rgba(185, 138, 215, 0.28);
  border-radius: 999px;
  color: var(--mileyo-text);
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.3;
  padding: 8px 14px;
}

.meal-list {
  margin: 8px 0 16px;
  padding-left: 1.25rem;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}

.card-actions .portal-button {
  margin-top: 0;
}

.objective-support {
  border-top: 1px solid rgba(220, 194, 240, 0.45);
  margin-top: 16px;
  padding-top: 16px;
}

.change-objective-button {
  background: transparent;
  border-color: rgba(185, 138, 215, 0.45);
  box-shadow: none;
  color: var(--mileyo-purple-dark);
  margin-top: 0;
}

.change-objective-button:hover:not(:disabled) {
  background: rgba(220, 194, 240, 0.12);
  border-color: var(--mileyo-purple-dark);
}

.objective-support-panel {
  margin-top: 12px;
}

.objective-support-message {
  color: var(--mileyo-text);
  font-size: 0.95rem;
  line-height: 1.55;
  margin: 0 0 12px;
}

.objective-support-contact {
  margin-top: 0;
  text-align: center;
  text-decoration: none;
}

.success {
  background: rgba(124, 201, 167, 0.16);
  border: 1px solid rgba(124, 201, 167, 0.35);
  border-radius: 16px;
  color: #2f6f57;
  margin-top: 14px;
  padding: 14px 16px;
}

.processing-notice {
  background: rgba(243, 203, 184, 0.28);
  border: 1px solid rgba(243, 203, 184, 0.55);
  border-radius: 16px;
  color: #8b4f2f;
  margin-top: 14px;
  padding: 14px 16px;
}

.cutoff-notice {
  border-radius: 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
  margin: -8px 0 18px;
  padding: 14px 16px;
}

.cutoff-notice--open {
  background: rgba(124, 201, 167, 0.14);
  border: 1px solid rgba(124, 201, 167, 0.32);
  color: #2f6f57;
}

.cutoff-notice--closed {
  background: linear-gradient(
    135deg,
    rgba(243, 203, 184, 0.28) 0%,
    rgba(220, 194, 240, 0.22) 100%
  );
  border: 1px solid rgba(243, 203, 184, 0.58);
  color: #7a3f22;
}

.cutoff-title {
  font-weight: 800;
  margin: 0 0 6px;
}

.cutoff-message {
  font-weight: 650;
  margin: 0;
}

.processing-inline {
  color: #8b4f2f;
  font-weight: 600;
}

.error {
  background: rgba(239, 196, 214, 0.35);
  border: 1px solid rgba(239, 196, 214, 0.65);
  border-radius: 16px;
  color: #8b3058;
  margin-bottom: 14px;
  padding: 14px 16px;
}

.portal-button,
.quantity-row button {
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 700;
  padding: 12px 18px;
  text-decoration: none;
  transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.portal-button {
  background: linear-gradient(135deg, var(--mileyo-purple) 0%, var(--mileyo-purple-dark) 100%);
  box-shadow: 0 10px 24px rgba(185, 138, 215, 0.24);
  color: var(--mileyo-white);
  margin-top: 8px;
}

.portal-button:hover:not(:disabled) {
  box-shadow: 0 14px 28px rgba(185, 138, 215, 0.32);
  transform: translateY(-1px);
}

.portal-button.secondary {
  background: var(--mileyo-white);
  border: 1px solid rgba(220, 194, 240, 0.85);
  box-shadow: none;
  color: var(--mileyo-purple-black);
}

.portal-button.secondary:hover:not(:disabled) {
  background: rgba(220, 194, 240, 0.14);
  border-color: var(--mileyo-purple);
}

button:disabled,
.portal-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.editor { margin-top: 18px; }

.editor-notice {
  color: var(--mileyo-muted);
  font-size: 0.9rem;
  line-height: 1.55;
  margin: 0 0 12px;
}

.editor-notice.paused-notice {
  color: #8b4f2f;
}

.next-box-notice {
  margin: 0 0 16px;
}

.recovery-block {
  background: rgba(243, 203, 184, 0.22);
  border: 1px solid rgba(243, 203, 184, 0.55);
  border-radius: 18px;
  margin: 16px 0;
  padding: 16px;
}

.recovery-title {
  color: #8b4f2f;
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
  color: #8b4f2f;
  font-weight: 600;
  margin: 0 0 8px;
}

.recovery-retry { margin: 0 0 12px; }

.recovery-note,
.resume-note {
  color: var(--mileyo-muted);
  font-size: 0.85rem;
  line-height: 1.45;
  margin: 8px 0 0;
}

.portal-error { margin-top: 12px; }

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
  background: var(--mileyo-white);
  border: 1px solid rgba(220, 194, 240, 0.55);
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
  background: var(--mileyo-purple-black);
  color: var(--mileyo-white);
  height: 40px;
  padding: 0;
  width: 40px;
}

.back-link {
  margin-top: 12px;
  text-align: center;
}

.back-link a {
  color: var(--mileyo-purple-dark);
  font-weight: 600;
  text-decoration: none;
}

.back-link a:hover {
  color: var(--mileyo-purple-black);
  text-decoration: underline;
}

.terminal-selection-card {
  background: rgba(252, 248, 246, 0.92);
  border-color: rgba(220, 194, 240, 0.35);
}

.terminal-notice {
  line-height: 1.55;
  margin: 0 0 14px;
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
  background: rgba(220, 194, 240, 0.35);
  border-radius: 999px;
  color: var(--mileyo-purple-black);
  font-size: 0.78rem;
  font-weight: 700;
  padding: 5px 11px;
}

.forecast-label { margin-bottom: 8px; }

.history-order-link {
  display: inline-flex;
  margin-top: 12px;
}

.box-change-editor {
  border-top: 1px solid rgba(220, 194, 240, 0.45);
  margin-top: 18px;
  padding-top: 18px;
}

.box-change-step h3 { margin: 0 0 8px; }

.box-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
  margin: 16px 0;
}

.box-card {
  background: var(--mileyo-white);
  border: 2px solid rgba(220, 194, 240, 0.55);
  border-radius: 18px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  text-align: left;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.box-card.selected {
  border-color: var(--mileyo-purple);
  box-shadow: 0 0 0 1px var(--mileyo-purple);
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

.box-card-title { font-weight: 700; }

.box-card-meta,
.box-card-price {
  color: var(--mileyo-muted);
  font-size: 14px;
}

.box-card-badge {
  color: var(--mileyo-purple-dark);
  font-size: 13px;
  font-weight: 600;
}

.box-change-blocked { margin-top: 8px; }

.box-change-step .portal-button { margin-right: 8px; }

@media (min-width: 560px) {
  .key-info-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .key-info-item--highlight {
    grid-column: 1 / -1;
  }
}

@media (min-width: 640px) {
  .meal-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .box-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (min-width: 960px) {
  .meal-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .box-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
`;
