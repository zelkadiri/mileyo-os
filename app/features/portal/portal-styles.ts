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
  --mileyo-font-sans: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
}

* { box-sizing: border-box; }

body {
  background: linear-gradient(180deg, var(--mileyo-cream) 0%, #fff 42%, var(--mileyo-cream) 100%);
  color: var(--mileyo-text);
  font-family: var(--mileyo-font-sans);
  margin: 0;
}

.portal-shell {
  margin: 0 auto;
  max-width: 960px;
  padding: 18px 16px 56px;
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
  font-family: var(--mileyo-font-sans);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 10px;
}

.portal-card p,
.portal-card li {
  line-height: 1.55;
  margin: 0;
}

.portal-header {
  align-items: center;
  background: transparent;
  border: 0;
  box-shadow: none;
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  justify-content: space-between;
  margin: 0 0 8px;
  padding: 4px 0 10px;
}

.portal-logo {
  display: block;
  height: 28px;
  margin: 0;
  object-fit: contain;
  width: auto;
}

.portal-header-flash {
  display: grid;
  flex: 1 1 100%;
  gap: 10px;
  margin-top: 4px;
}

.portal-header .success,
.portal-header .processing-notice,
.portal-header .error {
  margin: 0;
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
  border-bottom: 1px solid rgba(220, 194, 240, 0.55);
  display: flex;
  flex-wrap: nowrap;
  gap: 2px;
  margin: 0 0 20px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0;
  scrollbar-width: thin;
}

.portal-tab {
  appearance: none;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--mileyo-muted);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: -1px;
  min-height: 40px;
  min-width: max-content;
  padding: 10px 14px;
  transition: color 0.18s ease, border-color 0.18s ease;
  white-space: nowrap;
}

.portal-tab:hover {
  color: var(--mileyo-purple-black);
}

.portal-tab:focus-visible {
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 2px;
}

.portal-tab.active {
  background: transparent;
  border-bottom-color: var(--mileyo-purple);
  box-shadow: none;
  color: var(--mileyo-purple-black);
  font-weight: 700;
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

.selection-card {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

/* Shell becomes a quiet frame so the 5 blocks carry the surface. */
.selection-card:has(.portal-layout) {
  background: transparent;
  border: 0;
  box-shadow: none;
  gap: 16px;
  padding: 0;
}

.portal-section {
  min-width: 0;
}

.portal-layout,
.portal-main-column,
.portal-side-column {
  display: flex;
  flex-direction: column;
  gap: inherit;
  min-width: 0;
}

.portal-layout {
  gap: 16px;
  width: 100%;
}

.portal-main-column {
  gap: 16px;
}

.portal-side-column {
  gap: 20px;
}

/* Bloc 1 — expérience principale */
.next-box-section {
  background: linear-gradient(
    165deg,
    rgba(255, 255, 255, 0.97) 0%,
    rgba(252, 248, 246, 0.99) 55%,
    rgba(246, 240, 248, 0.55) 100%
  );
  border: 1px solid rgba(220, 194, 240, 0.42);
  border-radius: 22px;
  padding: 24px 20px 22px;
}

/* Bloc 2 — zone produit dominante (visible seulement à l'édition) */
.meal-preparation-section {
  background: transparent;
  border: 0;
  border-radius: 22px;
  box-shadow: none;
  padding: 0;
}

.meal-preparation-section:has(.editor.hidden) {
  display: none;
}

/* Box-change flow — same main-column host as meal editor (not sidebar) */
.box-change-section {
  background: transparent;
  border: 0;
  border-radius: 22px;
  box-shadow: none;
  padding: 0;
}

.box-change-section:has(.box-change-editor.hidden) {
  display: none;
}

/* Surface premium partagée — blocs secondaires (hors hero) */
.subscription-section,
.manage-section,
.dietitian-section {
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid rgba(220, 194, 240, 0.38);
  border-radius: 22px;
  box-shadow: 0 8px 30px rgba(80, 40, 120, 0.06);
}

/* Bloc 3 — formule lifestyle, calme */
.subscription-section {
  padding: 18px 18px 16px;
}

/* Bloc 4 — accent uniquement si contenu utile */
.recovery-section:has(.recovery-block, .processing-notice, .modification-blocked) {
  background: rgba(243, 203, 184, 0.14);
  border: 1px solid rgba(243, 203, 184, 0.55);
  border-left: 3px solid rgba(243, 203, 184, 0.95);
  border-radius: 16px;
  padding: 12px 14px 12px 12px;
}

/* Bloc 5 — paramètres application */
.manage-section {
  padding: 14px 12px;
}

/* Bloc 6 — diététicienne (lien externe via merchantSupport, pas de JS métier) */
.dietitian-section {
  padding: 18px 18px 16px;
}

.dietitian-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dietitian-title {
  color: var(--mileyo-muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0 0 8px;
  opacity: 0.88;
  text-transform: uppercase;
}

.dietitian-lead {
  color: var(--mileyo-purple-black);
  font-family: var(--mileyo-font-sans);
  font-size: 1.08rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.3;
  margin: 0;
}

.dietitian-copy {
  color: var(--mileyo-muted);
  font-size: 0.9rem;
  font-weight: 550;
  line-height: 1.45;
  margin: 0 0 12px;
}

.dietitian-chat-button {
  align-self: stretch;
  margin-top: 2px;
  width: 100%;
}

.selection-card.is-meal-editing .recovery-section:not(
  :has(.recovery-block, .processing-notice, .modification-blocked)
) {
  display: none;
}

.next-box-hero {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 0;
}

.hero-intro {
  margin-bottom: 20px;
}

.hero-header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  justify-content: space-between;
  margin-bottom: 6px;
}

.hero-kicker {
  color: var(--mileyo-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0;
  text-transform: uppercase;
}

.hero-header .status-badge {
  margin-bottom: 0;
}

.next-box-hero .hero-week-title {
  color: var(--mileyo-purple-black);
  font-family: var(--mileyo-font-sans);
  font-size: clamp(1.52rem, 4vw, 2.05rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.15;
  margin: 0 0 10px;
}

.hero-delivery {
  align-items: baseline;
  background: transparent;
  border: 0;
  border-radius: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-bottom: 0;
  padding: 0;
}

.hero-delivery-label {
  color: var(--mileyo-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.hero-delivery-label::after {
  content: none;
}

.hero-delivery-value {
  color: var(--mileyo-purple-black);
  font-family: var(--mileyo-font-sans);
  font-size: clamp(1.02rem, 2.6vw, 1.18rem);
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.hero-delivery-value--pending {
  color: var(--mileyo-muted);
  font-family: inherit;
  font-size: 0.95rem;
  font-style: italic;
  font-weight: 600;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
}

.hero-meta-item {
  background: rgba(252, 248, 246, 0.92);
  border: 1px solid rgba(220, 194, 240, 0.4);
  border-radius: 999px;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 14px;
}

.hero-meta-label {
  color: var(--mileyo-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.hero-meta-value {
  color: var(--mileyo-purple-black);
  font-size: 0.98rem;
  font-weight: 700;
  line-height: 1.2;
}

.hero-primary-actions {
  display: flex;
  justify-content: stretch;
  margin: 4px 0 0;
}

.hero-primary-actions:has(.edit-button.hidden) {
  display: none;
}

.hero-primary-actions .edit-button {
  box-shadow: 0 14px 32px rgba(185, 138, 215, 0.34);
  font-size: 1.02rem;
  justify-content: center;
  letter-spacing: -0.01em;
  margin-top: 0;
  min-height: 54px;
  padding: 14px 28px;
  width: 100%;
}

.hero-primary-actions .edit-button:hover:not(:disabled) {
  box-shadow: 0 18px 36px rgba(185, 138, 215, 0.4);
}

.next-box-hero .cutoff-notice {
  margin: 18px 0 0;
  opacity: 0.92;
}

.next-box-hero .cutoff-notice--open,
.next-box-hero .cutoff-notice--closed {
  box-shadow: none;
}

.subscription-secondary {
  margin-top: 0;
  padding-top: 0;
}

.subscription-secondary-title {
  color: var(--mileyo-muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0 0 14px;
  opacity: 0.88;
  text-transform: uppercase;
}

.subscription-secondary-facts {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
  margin-bottom: 0;
}

.subscription-plan-group,
.subscription-billing-group {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.subscription-plan-group {
  background: transparent;
  border: 0;
  border-radius: 0;
  overflow: visible;
  padding: 0;
}

.subscription-plan-box {
  color: var(--mileyo-purple-black);
  font-family: var(--mileyo-font-sans);
  font-size: 1.18rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
  margin: 0;
}

.subscription-plan-objective {
  color: var(--mileyo-muted);
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.4;
  margin: 0;
}

.subscription-billing-group {
  border-top: 1px solid rgba(220, 194, 240, 0.38);
  gap: 12px;
  padding-top: 14px;
}

.subscription-plan-price {
  color: var(--mileyo-purple-black);
  font-family: var(--mileyo-font-sans);
  font-size: 1.28rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.2;
  margin: 0;
}

.subscription-billing-next {
  display: grid;
  gap: 3px;
}

.subscription-secondary-label {
  color: var(--mileyo-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.subscription-secondary-value {
  color: var(--mileyo-text);
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.35;
  text-align: left;
}

.subscription-secondary-value--pending {
  color: var(--mileyo-muted);
  font-style: italic;
  font-weight: 600;
}

.subscription-manage {
  margin-top: 0;
  padding-top: 0;
}

.subscription-manage-title {
  color: var(--mileyo-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0 0 10px;
  opacity: 0.78;
  padding: 0 8px;
  text-transform: uppercase;
}

.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.settings-row {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 14px;
  justify-content: space-between;
  margin: 0;
  min-height: 58px;
  padding: 13px 10px;
  position: relative;
  text-align: left;
  transition: background 0.16s ease;
  width: 100%;
}

.settings-menu > .settings-row + .settings-row {
  border-top: 1px solid rgba(220, 194, 240, 0.32);
}

.settings-menu > .settings-row + .objective-support > .settings-row,
.settings-menu > .objective-support + .settings-row,
.settings-menu > .settings-address-block + .settings-payment-block,
.settings-menu > .settings-payment-block + .settings-row,
.settings-menu > .settings-payment-block + .objective-support > .settings-row,
.settings-menu > .settings-address-block + .settings-row {
  border-top: 1px solid rgba(220, 194, 240, 0.32);
}

.settings-row:first-child {
  border-radius: 14px 14px 0 0;
}

.settings-menu > :last-child.settings-row,
.settings-menu > .objective-support:last-child .settings-row {
  border-radius: 0 0 14px 14px;
}

.settings-menu > .settings-row:only-child {
  border-radius: 14px;
}

.settings-row:hover:not(:disabled) {
  background: rgba(252, 248, 246, 0.92);
}

.settings-row:focus-visible {
  border-radius: 14px;
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 2px;
}

.settings-row-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.settings-row-label {
  color: var(--mileyo-purple-black);
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.25;
}

.settings-row-hint {
  color: var(--mileyo-muted);
  font-size: 0.78rem;
  font-weight: 550;
  letter-spacing: 0.005em;
  line-height: 1.35;
  opacity: 0.92;
}

.settings-row--static {
  cursor: default;
}

.settings-row--static:hover {
  background: transparent;
}

.settings-row-action {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--mileyo-lilac-deep, #6b4f8a);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  padding: 6px 4px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.settings-row-action:hover {
  color: var(--mileyo-purple-black);
}

.settings-row-action:focus-visible {
  border-radius: 8px;
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 2px;
}

.settings-address-block,
.settings-payment-block {
  display: flex;
  flex-direction: column;
}

.settings-address-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
}

.settings-address-line {
  color: var(--mileyo-muted);
  font-size: 0.8rem;
  line-height: 1.4;
  margin: 0;
}

.settings-address-blocked {
  margin: 0;
  padding: 0 10px 10px;
}

.settings-address-support {
  color: var(--mileyo-lilac-deep, #6b4f8a);
  display: inline-block;
  font-size: 0.82rem;
  font-weight: 600;
  margin: 0 10px 12px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.settings-address-panel {
  padding: 4px 10px 14px;
}

.settings-address-fields {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr 1fr;
}

.settings-address-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 0.78rem;
  font-weight: 600;
}

.settings-address-field--full {
  grid-column: 1 / -1;
}

.settings-address-field input {
  border: 1px solid rgba(180, 150, 200, 0.45);
  border-radius: 10px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 500;
  padding: 10px 12px;
}

.settings-address-field input[readonly] {
  background: rgba(252, 248, 246, 0.92);
  color: var(--mileyo-muted);
}

.settings-address-optional {
  color: var(--mileyo-muted);
  font-weight: 500;
}

.settings-address-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.settings-address-error {
  margin: 8px 0 0;
}

.settings-logout-row {
  border-top: 1px solid rgba(220, 194, 240, 0.32);
  display: flex;
  justify-content: center;
  padding: 14px 10px 6px;
}

.settings-logout-link {
  color: var(--mileyo-muted);
  font-size: 0.82rem;
  font-weight: 500;
  text-decoration: none;
}

.settings-logout-link:hover {
  color: var(--mileyo-purple-black);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.settings-logout-link:focus-visible {
  border-radius: 6px;
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 2px;
}

.settings-row-chevron {
  border-right: 1.5px solid rgba(90, 27, 105, 0.32);
  border-top: 1.5px solid rgba(90, 27, 105, 0.32);
  flex: 0 0 auto;
  height: 7px;
  margin-right: 6px;
  opacity: 0.72;
  transform: rotate(45deg);
  width: 7px;
}

.subscription-manage .card-actions {
  gap: 2px 16px;
  margin-top: 0;
}

.subscription-manage .card-actions .portal-button,
.subscription-manage .change-objective-button.portal-button {
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  color: var(--mileyo-purple-dark);
  font-size: 0.86rem;
  font-weight: 650;
  margin-top: 0;
  min-height: 0;
  opacity: 0.9;
  padding: 5px 0;
}

.subscription-manage .objective-support {
  border-top: 0;
  margin-top: 0;
  padding-top: 0;
}

.subscription-manage .objective-support-panel {
  background: rgba(252, 248, 246, 0.9);
  border-radius: 14px;
  margin: 2px 4px 8px;
  padding: 14px 14px;
}

.subscription-manage .objective-support-contact {
  font-size: 0.88rem;
  margin-top: 0;
  padding: 10px 16px;
}

.recovery-section .recovery-block,
.recovery-section .processing-notice,
.recovery-section .modification-blocked {
  margin: 0;
}

.recovery-section > * + * {
  margin-top: 10px;
}

.recovery-section .modification-blocked {
  background: rgba(243, 203, 184, 0.16);
  border-radius: 14px;
  color: #8b4f2f;
  padding: 12px 14px;
}

.recovery-section .recovery-block {
  background: transparent;
  border: 0;
  border-radius: 0;
  margin: 0;
  padding: 0;
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
  font-family: var(--mileyo-font-sans);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 12px;
}

.meal-summary {
  margin: 0 0 20px;
}

.selection-preview {
  display: grid;
  gap: 14px;
}

.selection-preview-head {
  min-width: 0;
}

.selection-preview-empty {
  background: rgba(252, 248, 246, 0.92);
  border: 1px dashed rgba(185, 138, 215, 0.42);
  border-radius: 18px;
  margin: 0;
  padding: 18px 16px;
  text-align: center;
}

.selection-preview-overflow {
  color: var(--mileyo-muted);
  font-size: 0.84rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  margin: 0;
}

.hero-meal-preview {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
}

.hero-meal-preview-item {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hero-meal-preview-media {
  background: rgba(252, 248, 246, 0.96);
  border-radius: 20px;
  box-shadow:
    0 12px 28px rgba(90, 27, 105, 0.1),
    0 2px 6px rgba(90, 27, 105, 0.04);
  display: block;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.hero-meal-preview-media img,
.hero-meal-preview-placeholder {
  aspect-ratio: 4 / 5;
  display: block;
  object-fit: cover;
  transition: transform 0.35s ease;
  width: 100%;
}

.hero-meal-preview-placeholder {
  background: linear-gradient(
    145deg,
    rgba(220, 194, 240, 0.4) 0%,
    rgba(239, 196, 214, 0.32) 55%,
    rgba(243, 203, 184, 0.28) 100%
  );
}

.hero-meal-preview-qty,
.hero-meal-preview-more {
  align-items: center;
  background: rgba(42, 11, 51, 0.72);
  border-radius: 999px;
  bottom: 10px;
  color: var(--mileyo-white);
  display: inline-flex;
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  justify-content: center;
  letter-spacing: 0.02em;
  line-height: 1;
  min-height: 26px;
  min-width: 26px;
  padding: 5px 9px;
  position: absolute;
  right: 10px;
}

.hero-meal-preview-more {
  background: rgba(42, 11, 51, 0.84);
  font-size: 0.78rem;
  left: 10px;
  right: auto;
}

.hero-meal-preview-title {
  color: var(--mileyo-purple-black);
  display: -webkit-box;
  font-size: 0.84rem;
  font-weight: 700;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  letter-spacing: -0.01em;
  line-height: 1.3;
  margin: 10px 0 0;
  min-height: calc(2 * 1.3em);
  overflow: hidden;
}

.hero-week-caption {
  align-items: baseline;
  color: var(--mileyo-muted);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.9rem;
  font-weight: 650;
  gap: 6px 8px;
  letter-spacing: 0.01em;
  margin: 0;
}

.hero-week-count {
  color: var(--mileyo-purple-black);
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.hero-week-caption-copy {
  color: var(--mileyo-muted);
  font-weight: 600;
}

/* Keep permanent selection preview quiet while the meal editor owns the focus. */
.selection-card.is-meal-editing .selection-preview {
  margin-bottom: 0;
  opacity: 0.55;
  pointer-events: none;
}

.selection-card.is-meal-editing .hero-primary-actions {
  display: none;
}

.selection-card.is-meal-editing .hero-intro {
  margin-bottom: 14px;
}

.meal-summary-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  justify-content: space-between;
  margin-bottom: 12px;
}

.meal-summary-heading-row {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  min-width: 0;
}

.meal-summary-head .section-heading {
  margin: 0;
}

.meal-summary-toggle {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--mileyo-purple-dark);
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  padding: 4px 0;
  text-decoration: underline;
  text-decoration-color: rgba(155, 111, 194, 0.35);
  text-underline-offset: 3px;
}

.meal-summary-toggle:hover {
  color: var(--mileyo-purple-black);
  text-decoration-color: rgba(90, 27, 105, 0.45);
}

.meal-summary-toggle:focus-visible {
  border-radius: 6px;
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 3px;
}

.meal-summary-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.meal-summary-chip {
  align-items: baseline;
  background: rgba(252, 248, 246, 0.95);
  border: 1px solid rgba(220, 194, 240, 0.55);
  border-radius: 16px;
  box-shadow: 0 4px 14px rgba(90, 27, 105, 0.04);
  color: var(--mileyo-text);
  display: inline-flex;
  gap: 12px;
  justify-content: space-between;
  line-height: 1.35;
  max-width: 100%;
  min-width: min(100%, 168px);
  padding: 11px 14px;
}

.meal-summary-title {
  font-size: 0.92rem;
  font-weight: 600;
  min-width: 0;
}

.meal-summary-qty {
  color: var(--mileyo-purple-black);
  flex-shrink: 0;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.meal-summary-more {
  align-items: center;
  background: rgba(220, 194, 240, 0.18);
  border: 1px dashed rgba(185, 138, 215, 0.45);
  border-radius: 16px;
  color: var(--mileyo-muted);
  display: inline-flex;
  font-size: 0.88rem;
  font-weight: 700;
  padding: 11px 14px;
}

.meal-summary:not(.is-expanded) .meal-summary-chip--extra {
  display: none;
}

.meal-summary.is-expanded .meal-summary-more {
  display: none;
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

.editor { margin-top: 0; }

.selection-card.is-meal-editing {
  border: 0;
  box-shadow: none;
}

.selection-card.is-meal-editing .meal-preparation-section {
  border: 0;
  box-shadow: none;
}

.selection-card.is-meal-editing .editor {
  background: linear-gradient(
    180deg,
    rgba(252, 248, 246, 0.96) 0%,
    rgba(255, 255, 255, 0.98) 100%
  );
  border: 0;
  border-radius: 18px;
  margin-top: 0;
  padding: 18px 16px 16px;
}

.editor-notice {
  color: var(--mileyo-muted);
  font-size: 0.9rem;
  line-height: 1.55;
  margin: 0;
}

.editor-notice.paused-notice {
  color: #8b4f2f;
}

.next-box-notice {
  margin: 0;
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
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 16px;
}

.editor-heading-copy {
  display: grid;
  flex: 1 1 220px;
  gap: 12px;
  min-width: 0;
}

.editor-heading-copy h3 {
  margin: 0;
}

.meal-week-progress {
  display: grid;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.meal-week-progress-copy {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  justify-content: space-between;
}

.meal-week-progress-label {
  color: var(--mileyo-purple-black);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin: 0;
  text-transform: uppercase;
}

.meal-week-progress .meal-editor-count {
  color: var(--mileyo-text);
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
}

.meal-week-progress-track {
  background: rgba(220, 194, 240, 0.35);
  border-radius: 999px;
  height: 10px;
  overflow: hidden;
  width: 100%;
}

.meal-week-progress-fill {
  background: linear-gradient(
    90deg,
    var(--mileyo-purple) 0%,
    var(--mileyo-purple-dark) 100%
  );
  border-radius: inherit;
  height: 100%;
  transition: width 0.22s ease, background 0.22s ease;
  width: 0%;
}

.meal-week-progress.is-complete .meal-week-progress-fill {
  background: linear-gradient(90deg, var(--mileyo-green) 0%, #5fb892 100%);
}

.meal-week-progress.is-complete .meal-week-progress-label,
.editor.is-week-complete .meal-week-progress .meal-editor-count {
  color: #2f6f57;
}

.editor.is-week-complete .save-button:not(:disabled) {
  box-shadow: 0 10px 24px rgba(124, 201, 167, 0.28);
}

.meal-editor-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}

.meal-editor-actions .portal-button {
  margin-top: 0;
}

.meal-editor-filters {
  margin: 24px 0;
  width: max-content;
  max-width: 100%;
}

.meal-filters-panel {
  background: transparent;
  border: 0;
  box-shadow: none;
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  width: max-content;
  max-width: 100%;
}

.meal-filters-panel-head {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: flex-start;
  margin: 12px 0;
  padding: 0;
  width: max-content;
}

.meal-filters-toggle {
  align-items: center;
  appearance: none;
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.4);
  border-radius: 999px;
  box-shadow: 0 2px 10px rgba(42, 11, 51, 0.08);
  color: var(--mileyo-purple-black);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  gap: 8px;
  min-height: 36px;
  padding: 7px 14px 7px 12px;
}

.meal-filters-toggle.is-open {
  border-color: var(--mileyo-purple);
  box-shadow: 0 4px 12px rgba(42, 11, 51, 0.12);
}

.meal-filters-toggle-icon {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  height: 14px;
  width: 14px;
}

.meal-filters-toggle-icon svg {
  display: block;
  height: 14px;
  width: 14px;
}

.meal-filters-toggle-label {
  line-height: 1;
}

.meal-filters-toggle-count {
  align-items: center;
  background: var(--mileyo-purple-black);
  border-radius: 999px;
  color: var(--mileyo-white);
  display: inline-flex;
  font-size: 0.68rem;
  font-weight: 800;
  justify-content: center;
  line-height: 1;
  min-height: 1.15rem;
  min-width: 1.15rem;
  padding: 2px 6px;
}

.meal-filters-toggle-count.hidden {
  display: none;
}

.meal-filters-drawer {
  bottom: 0;
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 90;
}

.meal-filters-drawer.hidden {
  display: none;
}

.meal-filters-drawer-backdrop {
  appearance: none;
  background: rgba(42, 11, 51, 0.28);
  border: 0;
  cursor: pointer;
  inset: 0;
  opacity: 0;
  padding: 0;
  position: absolute;
  transition: opacity 0.28s ease;
}

.meal-filters-drawer.is-open .meal-filters-drawer-backdrop {
  opacity: 1;
}

.meal-filters-drawer-panel {
  background: var(--mileyo-white);
  border-radius: 22px 0 0 22px;
  box-shadow: -12px 0 40px rgba(42, 11, 51, 0.18);
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 400px;
  min-height: 100%;
  min-width: 0;
  padding: 0;
  position: absolute;
  right: 0;
  top: 0;
  transform: translateX(100%);
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  width: min(400px, 100%);
  z-index: 1;
}

.meal-filters-drawer.is-open .meal-filters-drawer-panel {
  transform: translateX(0);
}

.meal-filters-drawer-head {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 12px;
  justify-content: space-between;
  padding: 14px 14px 10px 22px;
}

.meal-filters-drawer-title {
  color: var(--mileyo-purple-black);
  font-family: var(--mileyo-font-sans);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
  margin: 0;
}

.meal-filters-drawer-close {
  appearance: none;
  background: rgba(220, 194, 240, 0.32);
  border: 0;
  border-radius: 999px;
  color: var(--mileyo-purple-black);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 1.35rem;
  height: 36px;
  line-height: 1;
  margin: 0;
  padding: 0;
  width: 36px;
  z-index: 2;
}

.meal-filters-drawer-scroll {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 22px 18px;
}

.meal-filters-drawer-footer {
  background: var(--mileyo-white);
  border-top: 1px solid rgba(185, 138, 215, 0.18);
  box-shadow: 0 -6px 18px rgba(42, 11, 51, 0.04);
  flex: 0 0 auto;
  padding: 14px 22px calc(16px + env(safe-area-inset-bottom, 0px));
}

.meal-filters-apply {
  appearance: none;
  background: var(--mileyo-purple);
  border: 0;
  border-radius: 14px;
  color: var(--mileyo-white);
  cursor: pointer;
  display: block;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 800;
  min-height: 48px;
  padding: 12px 16px;
  width: 100%;
}

.meal-filters-apply:hover {
  background: var(--mileyo-purple-dark);
}

.meal-filter-row {
  display: grid;
  gap: 10px;
}

.meal-filter-label {
  color: var(--mileyo-purple-black);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
}

.meal-filter-options {
  display: grid;
  gap: 10px 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.meal-filter-option {
  align-items: flex-start;
  background: rgba(252, 248, 246, 0.9);
  border: 1px solid rgba(185, 138, 215, 0.22);
  border-radius: 14px;
  color: var(--mileyo-text);
  cursor: pointer;
  display: flex;
  font-size: 0.82rem;
  font-weight: 600;
  gap: 8px;
  line-height: 1.3;
  min-height: 44px;
  padding: 11px 12px;
}

.meal-filter-option.is-active {
  background: rgba(185, 138, 215, 0.16);
  border-color: rgba(185, 138, 215, 0.55);
  color: var(--mileyo-purple-black);
}

.meal-filter-option input {
  accent-color: var(--mileyo-purple-dark);
  flex: 0 0 auto;
  height: 16px;
  margin: 1px 0 0;
  width: 16px;
}

.meal-filters-reset,
.meals-empty-reset {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--mileyo-purple-dark);
  cursor: pointer;
  flex-shrink: 0;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  padding: 4px 2px;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 3px;
  width: fit-content;
}

.meals-empty.meal-editor-empty {
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.18);
  border-radius: 16px;
  margin: 0 0 8px;
  padding: 24px 20px;
  text-align: center;
}

.meals-empty.meal-editor-empty p {
  color: var(--mileyo-muted);
  font-size: 0.88rem;
  line-height: 1.45;
  margin: 0 0 12px;
}

.meal-editor-actions .cancel-button,
.meal-editor-actions .save-button,
.meal-editor-actions .resume-button {
  flex: 1 1 auto;
  justify-content: center;
  min-height: 44px;
}

.meal-grid {
  align-items: stretch;
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 12px;
}

.meal-card {
  background: var(--mileyo-white);
  border: 1.5px solid rgba(220, 194, 240, 0.55);
  border-radius: 20px;
  box-shadow: var(--mileyo-shadow-soft);
  display: grid;
  gap: 10px;
  grid-template-rows: auto 1fr auto;
  height: 100%;
  min-width: 0;
  padding: 12px;
  position: relative;
  transition:
    border-color 0.28s ease,
    box-shadow 0.28s ease,
    background 0.28s ease,
    transform 0.22s ease;
}

.meal-card.is-selected {
  background: linear-gradient(
    180deg,
    var(--mileyo-white) 0%,
    #faf4fc 48%,
    #f6eef9 100%
  );
  border-color: var(--mileyo-purple);
  box-shadow:
    0 0 0 1.5px rgba(185, 138, 215, 0.42),
    0 18px 40px rgba(185, 138, 215, 0.22);
}

.meal-card.is-selected .meal-title {
  color: var(--mileyo-purple-dark-black);
}

.meal-card img {
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  display: block;
  object-fit: cover;
  transition: transform 0.35s ease;
  width: 100%;
}

.meal-card-media {
  border-radius: 14px;
  isolation: isolate;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.meal-card.is-selected .meal-card-media {
  box-shadow: 0 0 0 1px rgba(185, 138, 215, 0.22);
}

.meal-card-media--empty {
  aspect-ratio: 4 / 3;
  background: linear-gradient(
    135deg,
    rgba(220, 194, 240, 0.28) 0%,
    rgba(239, 196, 214, 0.22) 100%
  );
  border-radius: 14px;
}

.meal-card-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 7px;
  min-height: 0;
  min-width: 0;
}

.meal-title {
  color: var(--mileyo-purple-black);
  display: -webkit-box;
  font-size: 0.92rem;
  font-weight: 700;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  letter-spacing: -0.01em;
  line-height: 1.28;
  margin: 0;
  min-height: calc(2 * 1.28em);
  overflow: hidden;
  word-break: break-word;
}

.meal-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 0;
  max-width: 100%;
}

.meal-badge {
  border-radius: 999px;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  padding: 3px 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meal-badge--neutral {
  background: rgba(220, 194, 240, 0.35);
  color: var(--mileyo-purple-black);
}

.meal-badge--poulet {
  background: #f8e8d4;
  color: #7a4a12;
}

.meal-badge--boeuf {
  background: #edd9cf;
  color: #5c3a2e;
}

.meal-badge--poisson,
.meal-badge--merlan {
  background: #d9e8f5;
  color: #2f4f6d;
}

.meal-badge--saumon {
  background: #f5d5cf;
  color: #8b4a42;
}

.meal-badge--crevettes {
  background: #f5cfc9;
  color: #7a3f38;
}

.meal-badge--vegetarien {
  background: #d9f0e3;
  color: #2f6b4f;
}

.meal-badge--epice {
  background: #f5ddd0;
  color: #8b4528;
}

.meal-badge--doux {
  background: #ebe0f5;
  color: #5a3f7a;
}

.meal-badge--leger {
  background: #d9f2eb;
  color: #2d6b5a;
}

.meal-badge--gourmand {
  background: #f5ecd4;
  color: #7a5c1e;
}

.meal-badge--equilibre {
  background: #ebe2f8;
  color: #5a3f7a;
}

.meal-allergenes {
  color: var(--mileyo-muted);
  display: -webkit-box;
  font-size: 0.68rem;
  font-weight: 500;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.35;
  margin: 0;
  opacity: 0.82;
  overflow: hidden;
  word-break: break-word;
}

.meal-nutrition-badge {
  appearance: none;
  align-items: center;
  backdrop-filter: blur(10px);
  background: rgba(28, 12, 36, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  bottom: 9px;
  box-shadow: 0 7px 16px rgba(28, 12, 36, 0.26);
  color: var(--mileyo-white);
  cursor: pointer;
  display: inline-flex;
  flex-direction: row;
  gap: 7px;
  left: 9px;
  max-width: calc(100% - 18px);
  padding: 6px 10px 6px 8px;
  position: absolute;
  text-align: left;
  z-index: 2;
}

.meal-nutrition-badge-icon {
  display: inline-flex;
  flex: 0 0 auto;
  line-height: 0;
}

.meal-nutrition-badge-icon svg {
  display: block;
  height: 18px;
  width: 18px;
}

.meal-nutrition-badge-copy {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.meal-nutrition-badge-calories {
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  line-height: 1.1;
  white-space: nowrap;
}

.meal-nutrition-badge-caption {
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.62rem;
  font-weight: 600;
  line-height: 1.1;
  white-space: nowrap;
}

.meal-nutrition-badge:hover {
  background: rgba(28, 12, 36, 0.82);
  box-shadow: 0 9px 20px rgba(28, 12, 36, 0.32);
}

.meal-nutrition-badge:focus-visible {
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 2px;
}

.meal-nutrition-modal {
  align-items: flex-end;
  bottom: 0;
  display: flex;
  justify-content: center;
  left: 0;
  padding: 16px;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 80;
}

.meal-nutrition-modal.hidden {
  display: none;
}

.meal-nutrition-modal-backdrop {
  appearance: none;
  background: rgba(42, 11, 51, 0.42);
  border: 0;
  cursor: pointer;
  inset: 0;
  padding: 0;
  position: absolute;
}

.meal-nutrition-modal-panel {
  background: var(--mileyo-white);
  border-radius: 22px 22px 18px 18px;
  box-shadow: 0 18px 48px rgba(42, 11, 51, 0.22);
  max-height: min(78vh, 560px);
  max-width: 420px;
  overflow: auto;
  padding: 18px 18px 20px;
  position: relative;
  width: 100%;
  z-index: 1;
}

.meal-nutrition-modal-head {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 4px;
}

.meal-nutrition-modal-head h2 {
  color: var(--mileyo-purple-black);
  font-family: var(--mileyo-font-sans);
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}

.meal-nutrition-modal-close {
  appearance: none;
  background: rgba(220, 194, 240, 0.28);
  border: 0;
  border-radius: 999px;
  color: var(--mileyo-purple-black);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 1.35rem;
  height: 36px;
  line-height: 1;
  padding: 0;
  width: 36px;
}

.meal-nutrition-modal-meal {
  color: var(--mileyo-muted);
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0 0 14px;
}

.meal-nutrition-modal-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.meal-nutrition-modal-row {
  align-items: center;
  background: rgba(246, 240, 248, 0.92);
  border-radius: 14px;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 12px 14px;
}

.meal-nutrition-modal-row-label {
  color: var(--mileyo-muted);
  font-size: 0.88rem;
  font-weight: 600;
}

.meal-nutrition-modal-row-value {
  color: var(--mileyo-purple-black);
  font-size: 0.95rem;
  font-weight: 800;
  text-align: right;
}

.meal-card-media--interactive,
.meal-card-content--interactive {
  cursor: pointer;
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.meal-card-media--interactive:active,
.meal-card-content--interactive:active {
  opacity: 0.9;
  transform: scale(0.985);
}

.meal-card-media--interactive:focus-visible,
.meal-card-content--interactive:focus-visible {
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 2px;
}

.meal-detail-overlay {
  bottom: 0;
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 85;
}

.meal-detail-overlay.hidden {
  display: none;
}

.meal-detail-overlay-backdrop {
  appearance: none;
  background: rgba(42, 11, 51, 0.42);
  border: 0;
  cursor: pointer;
  inset: 0;
  opacity: 0;
  padding: 0;
  position: absolute;
  transition: opacity 0.28s ease;
}

.meal-detail-overlay.is-open .meal-detail-overlay-backdrop {
  opacity: 1;
}

.meal-detail-drawer {
  background: var(--mileyo-white);
  border-radius: 24px 24px 0 0;
  bottom: 0;
  box-shadow: 0 -18px 48px rgba(42, 11, 51, 0.2);
  display: flex;
  flex-direction: column;
  left: 0;
  max-height: min(90vh, 760px);
  overflow: hidden;
  padding: 0;
  position: absolute;
  right: 0;
  transform: translateY(100%);
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  width: 100%;
  z-index: 1;
}

.meal-detail-overlay.is-open .meal-detail-drawer {
  transform: translateY(0);
}

.meal-detail-handle {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  justify-content: center;
  padding: 10px 0 6px;
  pointer-events: none;
  position: relative;
  z-index: 2;
}

.meal-detail-handle-bar {
  background: rgba(90, 27, 105, 0.22);
  border-radius: 999px;
  display: block;
  height: 4px;
  width: 42px;
}

.meal-detail-close {
  appearance: none;
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  box-shadow: 0 8px 20px rgba(42, 11, 51, 0.12);
  color: var(--mileyo-purple-black);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 1.2rem;
  height: 34px;
  line-height: 1;
  opacity: 0.92;
  padding: 0;
  position: absolute;
  right: 12px;
  top: 8px;
  transition: opacity 0.18s ease, background 0.18s ease, transform 0.18s ease;
  width: 34px;
  z-index: 3;
}

.meal-detail-close:hover {
  background: rgba(255, 255, 255, 0.78);
  opacity: 1;
}

.meal-detail-close:active {
  transform: scale(0.94);
}

.meal-detail-close:focus-visible {
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 2px;
}

.meal-detail-scroll {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 0 calc(26px + env(safe-area-inset-bottom, 0px));
}

.meal-detail-media {
  aspect-ratio: 16 / 9;
  background: linear-gradient(
    135deg,
    rgba(220, 194, 240, 0.28) 0%,
    rgba(239, 196, 214, 0.22) 100%
  );
  border-radius: 18px;
  flex: 0 0 auto;
  margin: 0 16px;
  max-height: min(36vh, 260px);
  overflow: hidden;
  position: relative;
  width: auto;
}

.meal-detail-media::after {
  background: linear-gradient(
    180deg,
    rgba(42, 11, 51, 0) 48%,
    rgba(42, 11, 51, 0.18) 100%
  );
  content: "";
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 1;
}

.meal-detail-media--empty::after {
  opacity: 0.35;
}

.meal-detail-media img {
  display: block;
  height: 100%;
  object-fit: cover;
  width: 100%;
}

.meal-detail-title {
  color: var(--mileyo-purple-black);
  font-family: var(--mileyo-font-sans);
  font-size: 1.38rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.22;
  margin: 0;
  padding: 2px 20px 0;
}

.meal-detail-badges {
  gap: 7px;
  justify-content: flex-start;
  padding: 0 20px;
}

.meal-detail-badges .meal-badge {
  font-size: 0.72rem;
  padding: 5px 10px;
}

.meal-detail-section-heading {
  color: var(--mileyo-purple-black);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  margin: 0;
  text-transform: uppercase;
}

.meal-detail-nutrition,
.meal-detail-allergens,
.meal-detail-ingredients {
  border-top: 1px solid rgba(220, 194, 240, 0.5);
  display: flex;
  flex-direction: column;
  margin: 2px 20px 0;
  padding: 16px 0 0;
}

.meal-detail-nutrition {
  gap: 12px;
}

.meal-detail-nutrition-heading {
  margin: 0;
}

.meal-detail-nutrition-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.meal-detail-nutrition-card {
  align-items: flex-start;
  background: rgba(252, 248, 246, 0.96);
  border: 1px solid rgba(220, 194, 240, 0.48);
  border-radius: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 12px 12px 11px;
}

.meal-detail-nutrition-value {
  color: var(--mileyo-purple-black);
  font-size: 1.12rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.meal-detail-nutrition-unit {
  color: var(--mileyo-muted);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.25;
  max-width: 100%;
  overflow-wrap: anywhere;
  text-transform: lowercase;
  word-break: break-word;
}

.meal-detail-allergens {
  gap: 6px;
}

.meal-detail-allergens-lead {
  color: var(--mileyo-muted);
  font-size: 0.82rem;
  font-weight: 600;
  margin: 0;
}

.meal-detail-allergens-copy {
  color: var(--mileyo-text);
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.45;
  margin: 0;
}

.meal-detail-ingredients {
  gap: 8px;
}

.meal-detail-ingredients-heading {
  margin: 0;
}

.meal-detail-ingredients-copy {
  color: var(--mileyo-text);
  font-size: 0.94rem;
  line-height: 1.55;
  margin: 0;
}

.quantity-row {
  align-items: center;
  align-self: stretch;
  background: rgba(252, 248, 246, 0.96);
  border: 1px solid rgba(220, 194, 240, 0.5);
  border-radius: 999px;
  display: flex;
  gap: 2px;
  justify-content: space-between;
  margin-top: auto;
  min-width: 0;
  padding: 4px;
}

.meal-card.is-selected .quantity-row {
  background: rgba(185, 138, 215, 0.12);
  border-color: rgba(185, 138, 215, 0.38);
}

.meal-card .quantity-row button {
  align-items: center;
  background: rgba(90, 27, 105, 0.06);
  border: 1px solid transparent;
  box-shadow: none;
  color: var(--mileyo-purple-black);
  flex: 0 0 auto;
  font-size: 1.15rem;
  font-weight: 700;
  height: 40px;
  justify-content: center;
  line-height: 1;
  min-width: 40px;
  padding: 0;
  touch-action: manipulation;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease,
    transform 0.16s ease;
  width: 40px;
}

.meal-card .quantity-row button:hover:not(:disabled) {
  background: rgba(185, 138, 215, 0.18);
  border-color: rgba(185, 138, 215, 0.35);
  box-shadow: none;
  transform: none;
}

.meal-card .quantity-row button:focus-visible {
  outline: 2px solid var(--mileyo-purple-dark);
  outline-offset: 2px;
}

.meal-card .quantity-row button:active:not(:disabled) {
  background: rgba(185, 138, 215, 0.26);
  transform: scale(0.96);
}

.meal-card.is-selected .quantity-row button:not(:disabled) {
  background: linear-gradient(135deg, var(--mileyo-purple) 0%, var(--mileyo-purple-dark) 100%);
  border-color: transparent;
  color: var(--mileyo-white);
}

.meal-card.is-selected .quantity-row button:hover:not(:disabled) {
  box-shadow: 0 6px 14px rgba(185, 138, 215, 0.28);
}

.meal-quantity {
  color: var(--mileyo-purple-black);
  display: inline-flex;
  flex: 1 1 auto;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  justify-content: center;
  letter-spacing: -0.02em;
  min-width: 1.5rem;
  text-align: center;
}

.meal-card.is-selected .meal-quantity {
  color: var(--mileyo-purple-dark);
}

@keyframes meal-quantity-pulse {
  0% {
    opacity: 0.72;
    transform: scale(1);
  }
  45% {
    opacity: 1;
    transform: scale(1.16);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.meal-quantity.is-pulsing {
  animation: meal-quantity-pulse 0.28s ease-out;
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
  margin-top: 0;
  padding: 0;
}

.selection-card.is-box-editing .box-change-section {
  border: 0;
  box-shadow: none;
}

.selection-card.is-box-editing .box-change-editor {
  background: linear-gradient(
    180deg,
    rgba(252, 248, 246, 0.96) 0%,
    rgba(255, 255, 255, 0.98) 100%
  );
  border: 0;
  border-radius: 18px;
  margin-top: 0;
  padding: 18px 16px 16px;
}

.selection-card.is-box-editing .hero-primary-actions {
  display: none;
}

.box-change-step h3 { margin: 0 0 8px; }

.box-change-step .editor-notice + .editor-notice {
  margin-top: 6px;
}

.box-change-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.pending-box-notice {
  background: rgba(124, 201, 167, 0.1);
  border: 1px solid rgba(124, 201, 167, 0.28);
  border-radius: 16px;
  display: grid;
  gap: 4px;
  margin-top: 16px;
  padding: 14px 14px 12px;
}

.pending-box-notice-kicker {
  color: var(--mileyo-muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0;
  text-transform: uppercase;
}

.pending-box-notice-meals {
  color: var(--mileyo-purple-black);
  font-size: 1.12rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
  margin: 0;
}

.pending-box-notice-timing,
.pending-box-notice-price {
  color: var(--mileyo-purple-black);
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
}

.pending-box-notice-copy {
  color: var(--mileyo-muted);
  font-size: 0.86rem;
  line-height: 1.5;
  margin: 4px 0 0;
}

.subscription-current-label {
  color: var(--mileyo-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  margin: 0;
  text-transform: uppercase;
}

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

.box-change-step .portal-button { margin-right: 0; }

@media (min-width: 560px) {
  .selection-card {
    gap: 28px;
    padding: 28px 28px 32px;
  }

  .selection-card:has(.portal-layout) {
    gap: 20px;
    padding: 0;
  }

  .portal-layout,
  .portal-main-column {
    gap: 20px;
  }

  .portal-side-column {
    gap: 24px;
  }

  .next-box-section {
    padding: 28px 24px 26px;
  }

  .meal-preparation-section {
    padding: 0;
  }

  .subscription-section {
    padding: 20px 20px 18px;
  }

  .manage-section {
    padding: 16px 14px;
  }

  .dietitian-section {
    padding: 20px 20px 18px;
  }

  .hero-header {
    margin-bottom: 8px;
  }

  .hero-intro {
    margin-bottom: 22px;
  }

  .next-box-hero .hero-week-title {
    margin-bottom: 12px;
  }

  .hero-meal-preview {
    gap: 16px;
  }

  .hero-meal-preview-media {
    border-radius: 22px;
  }

  .hero-meal-preview-title {
    font-size: 0.88rem;
    margin-top: 12px;
  }

  .hero-meta {
    margin-bottom: 22px;
  }

  .hero-primary-actions {
    margin-top: 8px;
  }

  .selection-card.is-meal-editing .editor {
    padding: 22px 20px 20px;
  }

  .key-info-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .key-info-item--highlight {
    grid-column: 1 / -1;
  }

  .subscription-secondary-facts {
    gap: 18px;
  }

  .subscription-plan-box {
    font-size: 1.24rem;
  }

  .subscription-plan-price {
    font-size: 1.36rem;
  }

  .hero-primary-actions .edit-button {
    font-size: 1.05rem;
    min-height: 56px;
    min-width: 280px;
    width: auto;
  }

  .meal-nutrition-modal {
    align-items: center;
  }

  .meal-nutrition-modal-panel {
    border-radius: 22px;
  }

  .meal-detail-overlay {
    align-items: stretch;
    display: block;
  }

  .meal-detail-drawer {
    border-radius: 24px 0 0 24px;
    bottom: 0;
    box-shadow: -16px 0 44px rgba(42, 11, 51, 0.16);
    height: 100%;
    left: auto;
    max-height: none;
    max-width: 480px;
    right: 0;
    top: 0;
    transform: translateX(100%);
    width: clamp(380px, 44vw, 480px);
  }

  .meal-detail-overlay.is-open .meal-detail-drawer {
    transform: translateX(0);
  }

  .meal-detail-handle {
    display: none;
  }

  .meal-detail-close {
    right: 16px;
    top: 16px;
  }

  .meal-detail-scroll {
    gap: 18px;
    padding: 0 0 calc(32px + env(safe-area-inset-bottom, 0px));
  }

  .meal-detail-media {
    aspect-ratio: 16 / 10;
    border-radius: 18px;
    margin: 16px 24px 0;
    max-height: 220px;
  }

  .meal-detail-title {
    font-size: 1.52rem;
    padding: 4px 28px 0;
  }

  .meal-detail-badges {
    padding-left: 28px;
    padding-right: 28px;
  }

  .meal-detail-nutrition,
  .meal-detail-allergens,
  .meal-detail-ingredients {
    margin-left: 28px;
    margin-right: 28px;
    padding-top: 18px;
  }

  .meal-detail-nutrition-grid {
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .meal-detail-nutrition-card {
    padding: 13px 13px 12px;
  }

  .meal-detail-nutrition-value {
    font-size: 1.16rem;
  }

  .meal-detail-nutrition-unit {
    font-size: 0.72rem;
  }
}

@media (max-width: 559px) {
  .portal-shell {
    padding: 12px 12px 48px;
  }

  .portal-tabs {
    margin-bottom: 14px;
  }

  .selection-card {
    gap: 16px;
    padding: 18px 16px 22px;
  }

  .selection-card:has(.portal-layout) {
    gap: 12px;
    padding: 0;
  }

  .portal-layout,
  .portal-main-column {
    gap: 12px;
  }

  .portal-side-column {
    gap: 16px;
  }

  .next-box-section {
    border-radius: 18px;
    padding: 20px 16px 18px;
  }

  .meal-preparation-section {
    border-radius: 18px;
    padding: 0;
  }

  .subscription-section,
  .manage-section,
  .dietitian-section {
    border-radius: 18px;
  }

  .subscription-section {
    padding: 16px 16px 14px;
  }

  .manage-section {
    padding: 12px 10px;
  }

  .dietitian-section {
    padding: 16px 16px 14px;
  }

  .hero-header {
    margin-bottom: 4px;
  }

  .hero-intro {
    margin-bottom: 16px;
  }

  .next-box-hero .hero-week-title {
    font-size: 1.4rem;
    margin-bottom: 8px;
  }

  .hero-delivery-value {
    font-size: 1.02rem;
  }

  .hero-meal-preview {
    gap: 10px;
  }

  .hero-meal-preview-media {
    border-radius: 16px;
  }

  .hero-meal-preview-media img,
  .hero-meal-preview-placeholder {
    aspect-ratio: 5 / 6;
  }

  .hero-meal-preview-qty,
  .hero-meal-preview-more {
    bottom: 8px;
    font-size: 0.7rem;
    min-height: 24px;
    min-width: 24px;
    padding: 4px 8px;
    right: 8px;
  }

  .hero-meal-preview-more {
    left: 8px;
    right: auto;
  }

  .hero-meal-preview-title {
    font-size: 0.74rem;
    margin-top: 8px;
    min-height: calc(2 * 1.28em);
  }

  .hero-week-caption {
    font-size: 0.84rem;
  }

  .hero-week-count {
    font-size: 0.98rem;
  }

  .meal-summary {
    margin-bottom: 16px;
  }

  .selection-preview {
    gap: 12px;
  }

  .selection-preview-overflow {
    font-size: 0.8rem;
  }

  .hero-primary-actions {
    margin-top: 2px;
  }

  .hero-primary-actions .edit-button {
    font-size: 0.98rem;
    min-height: 52px;
  }

  .settings-row {
    min-height: 56px;
    padding: 12px 8px;
  }

  .settings-row-label {
    font-size: 0.9rem;
  }

  .settings-row-hint {
    font-size: 0.76rem;
  }

  .settings-address-fields {
    grid-template-columns: 1fr;
  }

  .subscription-plan-box {
    font-size: 1.1rem;
  }

  .subscription-plan-price {
    font-size: 1.18rem;
  }

  .subscription-billing-group {
    gap: 10px;
    padding-top: 12px;
  }

  .portal-tab {
    font-size: 0.86rem;
    padding: 10px 12px;
  }

  .meal-summary-chip {
    flex: 1 1 100%;
    min-width: 0;
  }

  .meal-summary-more {
    flex: 1 1 auto;
  }

  /* Sticky footer: active meal edit only (not paused resume flow). */
  .selection-card.is-meal-editing .editor:not(.paused-editor) {
    padding: 14px 12px 12px;
  }

  .selection-card.is-meal-editing:has(.editor:not(.paused-editor)) {
    padding-bottom: calc(22px + 76px + env(safe-area-inset-bottom, 0px));
  }

  .selection-card.is-meal-editing:has(.portal-layout):has(.editor:not(.paused-editor)) {
    padding-bottom: calc(12px + 76px + env(safe-area-inset-bottom, 0px));
  }

  .selection-card.is-meal-editing .editor:not(.paused-editor) .meal-editor-actions {
    background: linear-gradient(
      180deg,
      rgba(252, 248, 246, 0.97) 0%,
      var(--mileyo-white) 100%
    );
    border-top: 1px solid rgba(220, 194, 240, 0.55);
    bottom: 0;
    box-shadow: 0 -10px 28px rgba(90, 27, 105, 0.12);
    left: 0;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
    position: fixed;
    right: 0;
    z-index: 40;
  }

  .selection-card.is-meal-editing .editor:not(.paused-editor) .meal-editor-actions .portal-button {
    flex: 1 1 0;
    min-width: 0;
  }

  /* Paused: actions stay in document flow (no fixed footer). */
  .selection-card.is-meal-editing .editor.paused-editor {
    padding: 12px;
  }

  .selection-card.is-meal-editing .editor.paused-editor .meal-editor-actions {
    flex-direction: column;
  }

  .selection-card.is-meal-editing .editor.paused-editor .meal-editor-actions .portal-button {
    flex: 1 1 auto;
    width: 100%;
  }

  .meal-week-progress-track {
    height: 9px;
  }

  .meal-nutrition-modal {
    align-items: flex-end;
    padding: 0;
  }

  .meal-nutrition-modal-panel {
    border-radius: 22px 22px 0 0;
    max-height: min(82vh, 640px);
    max-width: none;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  }

  .meal-detail-close {
    right: 12px;
    top: calc(8px + env(safe-area-inset-top, 0px));
  }

  .meal-detail-handle {
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
  }

  .meal-detail-scroll {
    gap: 13px;
    padding: 0 0 calc(22px + env(safe-area-inset-bottom, 0px));
  }

  .meal-detail-media {
    aspect-ratio: 16 / 9;
    border-radius: 16px;
    margin: 0 14px;
    max-height: min(34vh, 240px);
  }

  .meal-detail-title {
    font-size: 1.26rem;
    padding-left: 16px;
    padding-right: 16px;
  }

  .meal-detail-badges {
    padding-left: 16px;
    padding-right: 16px;
  }

  .meal-detail-nutrition,
  .meal-detail-allergens,
  .meal-detail-ingredients {
    margin-left: 16px;
    margin-right: 16px;
  }

  .meal-detail-nutrition-card {
    padding: 11px 11px 10px;
  }

  .meal-detail-nutrition-value {
    font-size: 1.05rem;
  }

  .meal-detail-nutrition-unit {
    font-size: 0.68rem;
  }

  .meal-grid {
    gap: 12px;
  }

  .meal-card {
    border-radius: 18px;
    box-shadow: 0 6px 18px rgba(90, 27, 105, 0.07);
    gap: 7px;
    padding: 8px;
  }

  .meal-card.is-selected {
    box-shadow:
      0 0 0 1.5px rgba(185, 138, 215, 0.4),
      0 12px 28px rgba(185, 138, 215, 0.18);
  }

  .meal-card img,
  .meal-card-media,
  .meal-card-media--empty {
    border-radius: 12px;
  }

  .meal-card img,
  .meal-card-media--empty {
    aspect-ratio: 5 / 4;
  }

  .meal-card-content {
    gap: 5px;
  }

  .meal-title {
    font-size: 0.8rem;
    letter-spacing: -0.015em;
    line-height: 1.22;
    min-height: calc(2 * 1.22em);
  }

  .meal-badges {
    gap: 4px;
    max-height: calc((0.58rem * 1.2 + 4px) * 2 + 4px);
    overflow: hidden;
  }

  .meal-badge {
    font-size: 0.58rem;
    max-width: 100%;
    padding: 2px 6px;
  }

  .meal-allergenes {
    font-size: 0.6rem;
    -webkit-line-clamp: 1;
    line-height: 1.3;
    opacity: 0.72;
  }

  .meal-nutrition-badge {
    border-radius: 10px;
    bottom: 6px;
    gap: 5px;
    left: 6px;
    max-width: calc(100% - 12px);
    min-height: 34px;
    padding: 4px 8px 4px 6px;
    touch-action: manipulation;
  }

  .meal-nutrition-badge-icon svg {
    height: 15px;
    width: 15px;
  }

  .meal-nutrition-badge-calories {
    font-size: 0.72rem;
  }

  .meal-nutrition-badge-caption {
    font-size: 0.56rem;
  }

  .meal-card .quantity-row {
    gap: 0;
    margin-top: 1px;
    padding: 2px;
  }

  .meal-card .quantity-row button {
    height: 40px;
    min-width: 40px;
    width: 40px;
  }

  .meal-quantity {
    flex: 1 1 auto;
    font-size: 0.94rem;
    min-width: 1.35rem;
    padding: 0 2px;
  }
}

@media (hover: hover) and (pointer: fine) {
  .meal-card:hover {
    border-color: rgba(185, 138, 215, 0.55);
    box-shadow: 0 14px 34px rgba(185, 138, 215, 0.16);
  }

  .meal-card.is-selected {
    transform: translateY(-1px);
  }

  .meal-card:hover .meal-card-media img {
    transform: scale(1.035);
  }

  .meal-card.is-selected:hover .meal-card-media img {
    transform: scale(1.045);
  }

  .hero-meal-preview-item:hover .hero-meal-preview-media img {
    transform: scale(1.04);
  }
}

@media (prefers-reduced-motion: reduce) {
  .meal-card,
  .meal-card img,
  .hero-meal-preview-media img,
  .meal-week-progress-fill,
  .portal-tab,
  .portal-button,
  .quantity-row button,
  .box-card,
  .meal-detail-overlay-backdrop,
  .meal-detail-drawer,
  .meal-detail-close,
  .meal-card-media--interactive,
  .meal-card-content--interactive {
    transition: none !important;
  }

  .meal-card:hover,
  .meal-card.is-selected,
  .meal-card .quantity-row button:active:not(:disabled),
  .meal-card:hover .meal-card-media img,
  .meal-card.is-selected:hover .meal-card-media img,
  .hero-meal-preview-item:hover .hero-meal-preview-media img,
  .meal-card-media--interactive:active,
  .meal-card-content--interactive:active,
  .meal-detail-close:active {
    transform: none;
  }

  .meal-quantity.is-pulsing {
    animation: none;
  }
}

@media (min-width: 640px) {
  .box-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (min-width: 900px) {
  .portal-shell {
    max-width: 1120px;
  }

  .portal-layout {
    align-items: start;
    display: grid;
    /* row column — gap shorthand was resetting column-gap to 0 */
    gap: 0 20px;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }

  .portal-main-column {
    gap: 20px;
  }

  .portal-side-column {
    gap: 24px;
  }

  .next-box-section {
    padding: 30px 28px 28px;
  }

  .portal-side-column .subscription-secondary-facts {
    grid-template-columns: 1fr;
  }

  .portal-side-column .subscription-billing-group {
    gap: 12px;
  }

  .portal-main-column .box-change-editor .box-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .portal-main-column .box-change-editor .meal-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .selection-card.is-box-editing .box-change-editor {
    padding: 22px 20px 18px;
  }

  .hero-meal-preview {
    gap: 18px;
  }

  .hero-meal-preview-media img,
  .hero-meal-preview-placeholder {
    aspect-ratio: 4 / 5;
  }

  .hero-primary-actions .edit-button {
    min-width: 300px;
  }
}

@media (min-width: 960px) {
  .meal-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .box-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }

  .portal-main-column .box-change-editor .box-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .portal-main-column .box-change-editor .meal-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
`;
