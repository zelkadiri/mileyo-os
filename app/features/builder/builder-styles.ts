export const builderStyles = `
:root {
  --mileyo-purple: #B98AD7;
  --mileyo-purple-dark: #9B6FC2;
  --mileyo-lilac: #DCC2F0;
  --mileyo-purple-black: #5A1B69;
  --mileyo-purple-dark-black: #2A0B33;
  --mileyo-pink: #EFC4D6;
  --mileyo-peach: #F3CBB8;
  --mileyo-white: #FFFFFF;
  --mileyo-cream: #FCF8F6;
  --mileyo-gold: #E6C08A;
  --mileyo-green: #7CC9A7;
  --mileyo-text: #3A2C45;
  --mileyo-muted: rgba(58, 44, 69, 0.62);
  --mileyo-shadow: 0 4px 24px rgba(90, 27, 105, 0.08);
  --mileyo-shadow-soft: 0 2px 12px rgba(90, 27, 105, 0.06);
  --tunnel-footer-height: 108px;
  --meals-gauge-footer-height: 164px;
  --meals-toolbar-sticky-top: 72px;
  --formula-step-max-width: 1120px;
  --objective-step-max-width: 880px;
  --delivery-step-max-width: 720px;
  --meals-step-max-width: 1440px;
  --meals-step-gutter: 16px;
  --box-rail-gap: 12px;
  --box-rail-card-width-mobile: 78%;
  --box-rail-card-width-desktop: calc((100% - (3 * var(--box-rail-gap))) / 4.28);
}

* { box-sizing: border-box; }

body {
  background: var(--mileyo-cream);
  color: var(--mileyo-text);
  font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  line-height: 1.45;
  margin: 0;
  -webkit-font-smoothing: antialiased;
}

.tunnel-body {
  min-height: 100dvh;
}

.tunnel-promo {
  background: linear-gradient(90deg, rgba(124, 201, 167, 0.2), rgba(220, 194, 240, 0.28));
  border-bottom: 1px solid rgba(185, 138, 215, 0.12);
  padding: 6px 16px;
  text-align: center;
}

.tunnel-promo-title {
  color: var(--mileyo-purple-black);
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
}

.tunnel-promo-subtitle {
  color: var(--mileyo-muted);
  font-size: 0.72rem;
  line-height: 1.25;
  margin: 1px 0 0;
}

.visually-hidden {
  border: 0;
  clip: rect(0 0 0 0);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.tunnel-header {
  align-items: center;
  background: var(--mileyo-cream);
  border-bottom: 1px solid rgba(185, 138, 215, 0.14);
  display: grid;
  gap: 6px 12px;
  grid-template-columns: 1fr auto 1fr;
  grid-template-rows: auto auto;
  padding: 8px 16px 10px;
  position: sticky;
  top: 0;
  z-index: 20;
}

.tunnel-back {
  appearance: none;
  background: none;
  border: 0;
  color: var(--mileyo-purple-black);
  cursor: pointer;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  grid-column: 1;
  grid-row: 1;
  justify-self: start;
  padding: 2px 0;
  text-align: left;
  text-decoration: none;
  white-space: nowrap;
}

.tunnel-back-text {
  display: none;
}

.tunnel-back:not(.is-formula-step):not(.is-delivery-step):not(.is-meals-step) .tunnel-back-text--objective {
  display: inline;
}

.tunnel-back.is-formula-step .tunnel-back-text--formula {
  display: inline;
}

.tunnel-back.is-delivery-step .tunnel-back-text--delivery {
  display: inline;
}

.tunnel-back.is-meals-step .tunnel-back-text--meals-long {
  display: inline;
}

.tunnel-back:hover,
.tunnel-back:focus-visible {
  color: var(--mileyo-purple-dark);
  outline: 2px solid var(--mileyo-lilac);
  outline-offset: 2px;
}

.tunnel-wordmark {
  color: var(--mileyo-purple-black);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.28rem;
  font-style: italic;
  font-weight: 600;
  grid-column: 2;
  grid-row: 1;
  letter-spacing: 0.04em;
  margin: 0;
  text-align: center;
}

.tunnel-progress-block {
  grid-column: 1 / -1;
  grid-row: 2;
  margin: 0 auto;
  max-width: 260px;
  width: 100%;
}

.tunnel-step-label {
  color: var(--mileyo-muted);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  margin: 0 0 5px;
  text-align: center;
  text-transform: uppercase;
}

.tunnel-progress {
  background: var(--mileyo-lilac);
  border-radius: 999px;
  height: 5px;
  overflow: hidden;
}

.tunnel-progress-fill {
  background: linear-gradient(90deg, var(--mileyo-purple), var(--mileyo-purple-dark));
  border-radius: inherit;
  height: 100%;
  transition: width 0.28s ease;
  width: 25%;
}

.tunnel-progress-fill.is-step-1 {
  width: 25%;
}

.tunnel-progress-fill.is-step-2 {
  width: 50%;
}

.tunnel-progress-fill.is-step-3 {
  width: 75%;
}

.tunnel-progress-fill.is-step-4 {
  width: 100%;
}

.builder-shell {
  margin: 0 auto;
  padding: 16px var(--meals-step-gutter) calc(var(--tunnel-footer-height) + 20px);
  width: 100%;
}

.builder-step--objective {
  margin: 0 auto;
  max-width: var(--objective-step-max-width);
  width: 100%;
}

.builder-step--formula {
  margin: 0 auto;
  max-width: var(--formula-step-max-width);
  width: 100%;
}

.builder-step--delivery {
  margin: 0 auto;
  max-width: var(--delivery-step-max-width);
  width: 100%;
}

.builder-step--meals {
  margin: 0 auto;
  max-width: none;
  width: 100%;
}

.tunnel-body:not(.is-step-meals):not(.is-step-livraison) .builder-shell {
  max-width: calc(var(--formula-step-max-width) + 80px);
  padding-bottom: calc(var(--tunnel-footer-height) + 16px);
}

.tunnel-body.is-step-objective .builder-shell {
  max-width: calc(var(--objective-step-max-width) + 80px);
}

.tunnel-body.is-step-livraison .builder-shell {
  max-width: calc(var(--delivery-step-max-width) + 80px);
  padding-bottom: calc(var(--tunnel-footer-height) + 16px);
}

.tunnel-body.is-step-meals #objective-footer,
.tunnel-body.is-step-meals #formula-footer,
.tunnel-body.is-step-meals #delivery-footer,
.tunnel-body.is-step-livraison #objective-footer,
.tunnel-body.is-step-livraison #formula-footer,
.tunnel-body.is-step-livraison #meals-gauge-footer,
.tunnel-body.is-step-formule #objective-footer,
.tunnel-body.is-step-formule #delivery-footer,
.tunnel-body.is-step-formule #meals-gauge-footer,
.tunnel-body.is-step-objective #formula-footer,
.tunnel-body.is-step-objective #delivery-footer,
.tunnel-body.is-step-objective #meals-gauge-footer,
.tunnel-footer.hidden {
  display: none;
}

.tunnel-body.is-step-meals .builder-shell {
  box-sizing: border-box;
  margin-left: auto;
  margin-right: auto;
  max-width: var(--meals-step-max-width);
  padding-bottom: calc(var(--meals-gauge-footer-height) + 28px);
  padding-left: var(--meals-step-gutter);
  padding-right: var(--meals-step-gutter);
  padding-top: 12px;
  width: 100%;
}

.tunnel-body.is-step-meals .tunnel-header {
  padding-bottom: 8px;
}

.formula-intro,
.objective-intro,
.meals-intro {
  margin-bottom: 0;
  text-align: center;
}

.meals-toolbar-sticky {
  background: linear-gradient(180deg, var(--mileyo-cream) 78%, rgba(252, 248, 246, 0));
  margin: 0 0 14px;
  padding-bottom: 10px;
  position: sticky;
  top: var(--meals-toolbar-sticky-top);
  z-index: 12;
}

.meals-toolbar-sticky .meals-intro {
  margin-bottom: 12px;
}

.meal-filters-panel {
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.22);
  border-radius: 16px;
  box-shadow: var(--mileyo-shadow-soft);
  display: grid;
  gap: 10px;
  margin-bottom: 10px;
  padding: 12px 14px;
}

.meal-filters-panel-head {
  align-items: center;
  display: flex;
  gap: 10px;
  justify-content: space-between;
}

.meal-filters-title {
  color: var(--mileyo-purple-black);
  font-size: 0.82rem;
  font-weight: 700;
  margin: 0;
}

.meal-filter-row {
  align-items: flex-start;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(68px, 76px) minmax(0, 1fr);
}

.meal-filter-label {
  color: var(--mileyo-purple-black);
  font-size: 0.76rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 8px 0 0;
}

.meals-progress-strip {
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.18);
  border-radius: 14px;
  box-shadow: var(--mileyo-shadow-soft);
  display: grid;
  gap: 8px;
  padding: 10px 14px;
}

.meals-progress-strip.is-complete {
  border-color: rgba(124, 201, 167, 0.45);
}

.meals-progress-copy {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  justify-content: space-between;
}

.meals-progress-box {
  color: var(--mileyo-purple-black);
  font-size: 0.82rem;
  font-weight: 800;
  margin: 0;
}

.meals-progress-count {
  color: var(--mileyo-muted);
  font-size: 0.78rem;
  font-weight: 600;
  margin: 0;
}

.meals-progress-bar {
  background: rgba(185, 138, 215, 0.22);
  border-radius: 999px;
  height: 8px;
  overflow: hidden;
  width: 100%;
}

.meals-progress-fill {
  background: linear-gradient(90deg, var(--mileyo-purple), var(--mileyo-purple-dark));
  border-radius: inherit;
  height: 100%;
  transition: width 0.24s ease;
  width: 0;
}

.meals-progress-strip.is-complete .meals-progress-fill {
  background: linear-gradient(90deg, var(--mileyo-green), #5fbf98);
}

.meals-progress-strip.is-complete .meals-progress-count {
  color: var(--mileyo-purple-black);
  font-weight: 700;
}

.formula-lead {
  color: var(--mileyo-muted);
  font-size: 0.92rem;
  line-height: 1.4;
  margin: 0 auto;
  max-width: 34rem;
}

.formula-benefits {
  color: var(--mileyo-text);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.82rem;
  font-weight: 600;
  gap: 0;
  justify-content: center;
  margin: 0 0 12px;
  text-align: center;
}

.formula-benefits span {
  display: inline-flex;
  align-items: center;
}

.formula-benefits span + span::before {
  color: var(--mileyo-muted);
  content: "·";
  margin: 0 7px;
}

.formula-hint {
  color: var(--mileyo-muted);
  font-size: 0.82rem;
  margin: 0 0 10px;
  text-align: center;
}

.formula-decision {
  margin: 0;
}

.formula-secondary {
  margin-top: 12px;
}

.delivery-decision {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(252, 248, 246, 0.96));
  border: 1px solid rgba(185, 138, 215, 0.14);
  border-radius: 24px;
  box-shadow: var(--mileyo-shadow-soft);
  margin: 0 auto;
  max-width: var(--delivery-step-max-width);
  padding: 28px 22px 24px;
}

.delivery-intro {
  margin-bottom: 22px;
  text-align: center;
}

.delivery-intro h1 {
  margin-bottom: 10px;
}

.delivery-lead {
  font-size: 0.95rem;
  line-height: 1.5;
  margin: 0 auto;
  max-width: 34rem;
}

.delivery-window-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0 auto;
  max-width: 640px;
}

.delivery-window-card {
  appearance: none;
  background: var(--mileyo-white);
  border: 2px solid rgba(185, 138, 215, 0.22);
  border-radius: 18px;
  color: var(--mileyo-text);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font: inherit;
  gap: 8px;
  line-height: 1.35;
  min-height: 120px;
  padding: 16px 14px;
  text-align: left;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}

.delivery-window-card:hover,
.delivery-window-card:focus-visible {
  border-color: rgba(185, 138, 215, 0.55);
  box-shadow: 0 4px 16px rgba(90, 27, 105, 0.08);
  outline: none;
}

.delivery-window-card.selected {
  background: rgba(220, 194, 240, 0.28);
  border-color: var(--mileyo-purple);
  box-shadow: 0 4px 18px rgba(185, 138, 215, 0.18);
}

.delivery-window-card-title {
  font-size: 0.98rem;
  font-weight: 700;
}

.delivery-window-card-range {
  color: rgba(45, 27, 54, 0.82);
  font-size: 0.88rem;
  font-weight: 500;
}

.delivery-date-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0 auto;
  max-width: 520px;
}

.delivery-date-chip {
  appearance: none;
  background: var(--mileyo-white);
  border: 2px solid rgba(185, 138, 215, 0.22);
  border-radius: 16px;
  color: var(--mileyo-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.35;
  min-height: 56px;
  padding: 12px 14px;
  text-align: center;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}

.delivery-date-chip:hover,
.delivery-date-chip:focus-visible {
  border-color: rgba(185, 138, 215, 0.55);
  box-shadow: 0 4px 16px rgba(90, 27, 105, 0.08);
  outline: none;
}

.delivery-date-chip.selected {
  background: rgba(220, 194, 240, 0.28);
  border-color: var(--mileyo-purple);
  box-shadow: 0 4px 18px rgba(185, 138, 215, 0.18);
}

.delivery-footer .tunnel-cta {
  width: 100%;
}

.objective-decision {
  margin: 0 auto;
  max-width: var(--objective-step-max-width);
}

.objective-intro {
  margin-bottom: 22px;
  text-align: center;
}

.objective-intro h1 {
  margin-bottom: 10px;
}

.objective-lead {
  font-size: 0.95rem;
  line-height: 1.5;
  margin: 0 auto;
  max-width: 34rem;
}

.objective-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
  margin: 0 auto;
  max-width: 520px;
}

.objective-card {
  appearance: none;
  background: var(--mileyo-white);
  border: 2px solid rgba(185, 138, 215, 0.22);
  border-radius: 16px;
  color: var(--mileyo-text);
  cursor: pointer;
  display: grid;
  gap: 6px;
  font: inherit;
  padding: 16px 18px;
  position: relative;
  text-align: left;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}

.objective-card:hover,
.objective-card:focus-visible {
  border-color: rgba(185, 138, 215, 0.55);
  box-shadow: 0 4px 16px rgba(90, 27, 105, 0.08);
  outline: none;
}

.objective-card.selected {
  background: rgba(220, 194, 240, 0.28);
  border-color: var(--mileyo-purple);
  box-shadow: 0 4px 18px rgba(185, 138, 215, 0.18);
}

.objective-card-label {
  color: var(--mileyo-purple-black);
  font-size: 1.02rem;
  font-weight: 700;
  line-height: 1.3;
}

.objective-card-description {
  color: var(--mileyo-muted);
  font-size: 0.88rem;
  font-weight: 500;
  line-height: 1.4;
}

.objective-card-starting-price {
  color: var(--mileyo-muted);
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.35;
  margin-top: 2px;
}

.objective-card .selected-badge {
  position: absolute;
  right: 12px;
  top: 12px;
}

#objective-footer .tunnel-cta {
  width: 100%;
}

.formula-intro h1,
.objective-intro h1,
.delivery-intro h1,
.meals-intro h1,
.setup-card h1 {
  color: var(--mileyo-purple-black);
  font-size: clamp(1.2rem, 3.2vw, 1.55rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.22;
  margin: 0 0 8px;
}

.formula-reassurance {
  color: var(--mileyo-text);
  font-size: 0.88rem;
  font-weight: 600;
  margin: 0;
}

.formula-reassurance span {
  color: var(--mileyo-muted);
  margin: 0 8px;
}

.formula-lead,
.objective-lead,
.delivery-lead,
.meals-lead,
.setup-card p {
  color: var(--mileyo-muted);
  font-size: 1rem;
  margin: 0;
}

.setup-card {
  background: var(--mileyo-white);
  border-radius: 20px;
  box-shadow: var(--mileyo-shadow-soft);
  margin-top: 12px;
  padding: 24px 20px;
}

.toggle-row {
  display: none;
}

.toggle,
.tunnel-cta,
.add-button,
.quantity-row button {
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}

.toggle {
  background: transparent;
  color: var(--mileyo-muted);
  font-size: 0.78rem;
  line-height: 1.2;
  padding: 10px 8px;
}

.toggle.active {
  background: var(--mileyo-purple);
  box-shadow: 0 2px 10px rgba(185, 138, 215, 0.35);
  color: var(--mileyo-white);
}

.toggle:focus-visible,
.tunnel-cta:focus-visible,
.add-button:focus-visible,
.quantity-row button:focus-visible,
.box-rail-nav:focus-visible {
  outline: 2px solid var(--mileyo-purple-dark);
  outline-offset: 2px;
}

.box-rail {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr;
  margin-bottom: 6px;
}

.box-rail-viewport {
  -ms-overflow-style: none;
  overflow: visible;
  scroll-behavior: smooth;
  scroll-padding-inline: 0;
  scroll-snap-type: none;
  scrollbar-width: none;
  width: 100%;
}

.box-rail-viewport::-webkit-scrollbar {
  display: none;
}

#box-grid.box-rail-track {
  display: grid;
  gap: var(--box-rail-gap);
  grid-template-columns: 1fr;
  padding: 2px 0 4px;
  width: 100%;
}

#box-grid .formula-card {
  gap: 5px;
  max-width: none;
  min-height: 0;
  padding: 13px 15px;
  scroll-snap-align: none;
  scroll-snap-stop: normal;
}

#box-grid .formula-card.selectable:not(.selected) {
  opacity: 0.94;
}

.card-badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 2px;
}

.recommended-badge {
  background: rgba(230, 192, 138, 0.28);
  border-radius: 999px;
  color: var(--mileyo-purple-black);
  display: inline-flex;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 3px 9px;
}

.box-promo-badge {
  align-items: center;
  background: rgba(124, 201, 167, 0.24);
  border-radius: 999px;
  color: var(--mileyo-purple-black);
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 700;
  justify-self: start;
  letter-spacing: 0.01em;
  margin-top: 4px;
  padding: 4px 10px;
}

.box-rail-nav {
  align-items: center;
  appearance: none;
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.22);
  border-radius: 999px;
  box-shadow: var(--mileyo-shadow-soft);
  color: var(--mileyo-purple-black);
  cursor: pointer;
  display: none;
  flex-shrink: 0;
  font-size: 1.1rem;
  height: 36px;
  justify-content: center;
  line-height: 1;
  width: 36px;
  z-index: 2;
}

.box-rail-nav-prev { left: auto; }
.box-rail-nav-next { right: auto; }

.box-rail-nav:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.card-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
}

#meal-grid.meal-grid {
  align-items: stretch;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.product-card.meal-card {
  padding: 18px;
}

.product-card {
  appearance: none;
  background: var(--mileyo-white);
  border: 2px solid transparent;
  border-radius: 20px;
  box-shadow: var(--mileyo-shadow-soft);
  color: inherit;
  display: grid;
  gap: 10px;
  padding: 16px;
  text-align: left;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
  width: 100%;
}

.product-card.meal-card {
  display: grid;
  gap: 10px;
  grid-template-rows: auto 1fr auto;
  height: 100%;
}

.product-card.selectable {
  cursor: pointer;
}

.product-card.selectable:hover:not(.selected):not(.unavailable) {
  border-color: var(--mileyo-lilac);
  box-shadow: var(--mileyo-shadow);
}

.product-card.selectable:active:not(.unavailable) {
  transform: scale(0.99);
}

.product-card.unavailable {
  cursor: not-allowed;
  opacity: 0.6;
}

.product-card.selected {
  background: linear-gradient(180deg, var(--mileyo-white) 0%, #faf4fc 100%);
  border-color: var(--mileyo-purple);
  box-shadow: 0 0 0 1px var(--mileyo-purple), var(--mileyo-shadow);
}

#box-grid .formula-card.selected {
  opacity: 1;
}

.selected-badge {
  background: var(--mileyo-purple);
  border-radius: 999px;
  color: var(--mileyo-white);
  display: inline-flex;
  font-size: 0.68rem;
  font-weight: 700;
  justify-self: start;
  letter-spacing: 0.02em;
  padding: 3px 10px;
}

#box-grid .formula-card .box-meal-count {
  color: var(--mileyo-purple-black);
  font-size: 1.2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.box-meal-count {
  color: var(--mileyo-purple-black);
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

#box-grid .formula-card .box-tagline {
  color: var(--mileyo-muted);
  font-size: 0.78rem;
  font-weight: 500;
  line-height: 1.25;
}

.box-tagline {
  color: var(--mileyo-text);
  font-size: 0.95rem;
  font-weight: 600;
}

.box-price-row {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.box-price-per-meal {
  color: var(--mileyo-purple-black);
  font-size: 1.1rem;
  font-weight: 800;
}

.box-price-total {
  color: var(--mileyo-muted);
  font-size: 0.9rem;
}

#box-grid .formula-card .box-price-per-meal {
  font-size: 0.95rem;
}

#box-grid .formula-card .box-promo-price {
  font-size: 0.9rem;
  line-height: 1.2;
}

#box-grid .formula-card .box-promo-price strong {
  font-size: 1.22rem;
}

#box-grid .formula-card .box-crossed-price {
  font-size: 0.8rem;
}

#box-grid .formula-card .box-weekly-price {
  font-size: 0.8rem;
}

#box-grid .formula-card .box-price-total {
  font-size: 0.82rem;
}

.box-promo-price {
  color: var(--mileyo-purple-black);
  font-size: 0.95rem;
  line-height: 1.2;
  margin: 0;
}

.box-promo-price strong {
  font-size: 1.05rem;
  font-weight: 800;
}

.box-promo-price s {
  color: var(--mileyo-muted);
  font-weight: 500;
}

.box-crossed-price {
  color: var(--mileyo-muted);
  font-size: 0.86rem;
  margin: 0;
}

.box-crossed-price s {
  color: var(--mileyo-muted);
}

.box-weekly-price {
  color: var(--mileyo-text);
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0;
}

.box-promo-note {
  color: var(--mileyo-muted);
  font-size: 0.7rem;
  line-height: 1.3;
  margin: 2px 0 0;
}

.box-micro-reassurance {
  display: none;
}

.box-subscription-price {
  color: var(--mileyo-purple-dark);
  font-size: 0.88rem;
  font-weight: 600;
}

#meal-grid .product-card img {
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  object-fit: cover;
  width: 100%;
}

.meal-card-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.meal-title {
  color: var(--mileyo-purple-black);
  display: -webkit-box;
  font-size: 1rem;
  font-weight: 700;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.25;
  margin: 0;
  min-height: calc(2 * 1.25 * 1em);
  overflow: hidden;
  text-align: center;
}

.meal-kcal {
  color: var(--mileyo-text);
  font-size: 0.84rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
  text-align: center;
}

.meal-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin: 0;
}

.meal-badge {
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1.2;
  padding: 3px 8px;
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
  font-size: 0.72rem;
  line-height: 1.35;
  margin: 0;
  text-align: center;
}

.meal-card .quantity-row {
  align-self: stretch;
  margin-top: 0;
  padding-top: 8px;
}

.meal-quantity {
  font-size: 1rem;
  font-weight: 700;
  min-width: 1.5rem;
  text-align: center;
}

.meal-filter-chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0 4px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.meal-filter-chips::-webkit-scrollbar {
  display: none;
}

.filter-chip {
  background: var(--mileyo-white);
  border: 1.5px solid rgba(185, 138, 215, 0.24);
  border-radius: 999px;
  color: var(--mileyo-text);
  flex: 0 0 auto;
  font-size: 0.78rem;
  font-weight: 600;
  min-height: 38px;
  padding: 8px 14px;
  white-space: nowrap;
}

.filter-chip--allergen.active {
  background: #f5ddd5;
  border-color: #e8b8a8;
  color: #6b3a2e;
}

.filter-chip--badge.active {
  border-color: transparent;
}

.filter-chip--badge-poulet.active {
  background: #f8e8d4;
  color: #7a4a12;
}

.filter-chip--badge-boeuf.active {
  background: #edd9cf;
  color: #5c3a2e;
}

.filter-chip--badge-poisson.active {
  background: #d9e8f5;
  color: #2f4f6d;
}

.filter-chip--badge-vegetarien.active {
  background: #d9f0e3;
  color: #2f6b4f;
}

.filter-chip--badge-epice.active {
  background: #f5ddd0;
  color: #8b4528;
}

.filter-chip--badge-doux.active {
  background: #ebe0f5;
  color: #5a3f7a;
}

.filter-chip--badge-leger.active {
  background: #d9f2eb;
  color: #2d6b5a;
}

.filter-chip--badge-gourmand.active {
  background: #f5ecd4;
  color: #7a5c1e;
}

.filter-chip--badge-equilibre.active {
  background: #ebe2f8;
  color: #5a3f7a;
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
  text-decoration: underline;
  text-underline-offset: 3px;
}

.meals-empty {
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.18);
  border-radius: 16px;
  margin: 0 0 16px;
  padding: 24px 20px;
  text-align: center;
}

.meals-empty p {
  color: var(--mileyo-muted);
  font-size: 0.88rem;
  line-height: 1.45;
  margin: 0 0 12px;
}

.meals-gauge-footer {
  background: linear-gradient(180deg, rgba(252, 248, 246, 0) 0%, var(--mileyo-cream) 24%);
  border-top: 1px solid rgba(185, 138, 215, 0.12);
}

.meals-gauge {
  box-sizing: border-box;
  display: grid;
  gap: 8px;
  margin: 0 auto;
  max-width: var(--meals-step-max-width);
  padding-left: var(--meals-step-gutter);
  padding-right: var(--meals-step-gutter);
  width: 100%;
}

.meals-gauge-count {
  color: var(--mileyo-purple-black);
  font-size: 0.88rem;
  font-weight: 800;
  margin: 0;
  text-align: center;
}

.meals-gauge-bar {
  background: rgba(185, 138, 215, 0.28);
  border-radius: 999px;
  height: 8px;
  overflow: hidden;
  width: 100%;
}

.meals-gauge-fill {
  background: linear-gradient(90deg, var(--mileyo-purple), var(--mileyo-purple-dark));
  border-radius: 999px;
  height: 100%;
  transition: width 0.24s ease;
  width: 0;
}

.meals-gauge-footer.is-complete .meals-gauge-fill {
  background: linear-gradient(90deg, var(--mileyo-green), #5fbf98);
}

.meals-gauge-cta {
  background: #efe4f7;
  border: 1.5px solid rgba(90, 27, 105, 0.28);
  box-shadow: 0 2px 10px rgba(90, 27, 105, 0.1);
  color: var(--mileyo-purple-black);
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  padding: 15px 20px;
  width: 100%;
}

.meals-gauge-cta:disabled {
  cursor: not-allowed;
  opacity: 1;
}

.meals-gauge-footer.is-complete .meals-gauge-cta:not(:disabled) {
  background: var(--mileyo-purple-black);
  border-color: transparent;
  box-shadow: 0 6px 22px rgba(90, 27, 105, 0.34);
  color: var(--mileyo-white);
}

.meals-gauge-cta:not(:disabled):hover {
  background: var(--mileyo-purple-dark-black);
}

.product-title { font-weight: 700; }

.muted,
.portal-link {
  color: var(--mileyo-muted);
  font-size: 0.88rem;
}

.portal-link {
  margin: 8px 0 0;
  text-align: center;
}

.portal-link-inline {
  margin-top: 10px;
}

.tunnel-footer .portal-link {
  margin-top: 8px;
}

.portal-link a {
  color: var(--mileyo-purple-dark);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.portal-link a:hover,
.portal-link a:focus-visible {
  color: var(--mileyo-purple-black);
}

.hidden { display: none !important; }

.trust-section {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr;
  margin-top: 16px;
}

.trust-card {
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.18);
  border-radius: 14px;
  padding: 10px 12px 11px;
}

.trust-icon {
  display: inline-flex;
  font-size: 1rem;
  line-height: 1;
  margin: 0 0 6px;
}

.trust-card h2 {
  color: var(--mileyo-purple-black);
  font-size: 0.86rem;
  line-height: 1.25;
  margin: 0 0 4px;
}

.trust-card p {
  color: var(--mileyo-muted);
  font-size: 0.76rem;
  line-height: 1.35;
  margin: 0;
}

.faq-section {
  margin-top: 16px;
}

.faq-item {
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.18);
  border-radius: 12px;
  margin-bottom: 8px;
  padding: 0;
}

.faq-item summary {
  color: var(--mileyo-purple-black);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 700;
  list-style: none;
  padding: 10px 12px;
}

.faq-item summary::-webkit-details-marker {
  display: none;
}

.faq-item summary::after {
  color: var(--mileyo-muted);
  content: "+";
  float: right;
  font-weight: 700;
}

.faq-item[open] summary::after {
  content: "−";
}

.faq-item p {
  color: var(--mileyo-muted);
  font-size: 0.76rem;
  line-height: 1.35;
  margin: 0;
  padding: 0 12px 10px;
}

.tunnel-footer {
  background: linear-gradient(180deg, rgba(252, 248, 246, 0) 0%, var(--mileyo-cream) 28%);
  bottom: 0;
  left: 0;
  margin: 0 auto;
  max-width: 1180px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  position: fixed;
  right: 0;
  z-index: 30;
}

.tunnel-footer-inner {
  margin: 0 auto;
  max-width: 520px;
  width: 100%;
}

.tunnel-cta {
  background: var(--mileyo-purple-black);
  box-shadow: 0 4px 18px rgba(90, 27, 105, 0.28);
  color: var(--mileyo-white);
  font-size: 0.98rem;
  letter-spacing: 0.01em;
  padding: 14px 20px;
  width: 100%;
}

.tunnel-cta:not(:disabled):hover {
  background: var(--mileyo-purple-dark-black);
}

.tunnel-cta:disabled {
  background: #e6d9ef;
  border: 1px solid rgba(90, 27, 105, 0.14);
  box-shadow: none;
  color: #6f5a7d;
  cursor: not-allowed;
  font-weight: 600;
  opacity: 1;
}

button:disabled {
  cursor: not-allowed;
}

.section {
  margin-top: 8px;
}

.section-heading {
  align-items: start;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 16px;
}

.sticky-count { align-items: center; }

.toggle.active,
.add-button {
  background: var(--mileyo-purple);
  color: var(--mileyo-white);
}

.add-button {
  padding: 12px 18px;
}

.add-button:disabled {
  opacity: 0.55;
}

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
  height: 44px;
  min-width: 44px;
  padding: 0;
  width: 44px;
}

.error {
  background: #fde8ef;
  border-radius: 12px;
  color: #8b2252;
  margin-bottom: 14px;
  padding: 12px 14px;
}

@media (max-width: 639px) {
  :root {
    --meals-gauge-footer-height: 178px;
    --meals-toolbar-sticky-top: 54px;
  }

  .tunnel-header {
    gap: 3px 8px;
    padding: 5px 12px 7px;
  }

  .tunnel-body.is-step-meals .tunnel-header {
    padding-bottom: 5px;
  }

  .tunnel-back {
    font-size: 0.78rem;
  }

  .tunnel-back.is-meals-step .tunnel-back-text--meals-long {
    display: none;
  }

  .tunnel-back.is-meals-step .tunnel-back-text--meals-short {
    display: inline;
  }

  .tunnel-wordmark {
    font-size: 1.1rem;
  }

  .tunnel-step-label {
    font-size: 0.64rem;
    margin-bottom: 2px;
  }

  .tunnel-progress {
    height: 4px;
  }

  .tunnel-progress-block {
    max-width: 190px;
  }

  .tunnel-body.is-step-meals .builder-shell {
    padding-bottom: calc(var(--meals-gauge-footer-height) + 40px);
    padding-top: 10px;
  }

  .meals-toolbar-sticky {
    margin-bottom: 8px;
    padding-bottom: 4px;
    top: var(--meals-toolbar-sticky-top);
  }

  .meals-toolbar-sticky .meals-intro {
    margin-bottom: 8px;
  }

  .meals-intro h1 {
    font-size: 1.14rem;
    margin-bottom: 4px;
  }

  .meals-lead {
    font-size: 0.84rem;
  }

  .meal-filters-panel {
    gap: 5px;
    margin-bottom: 6px;
    padding: 9px 11px;
  }

  .meal-filters-panel-head {
    gap: 8px;
  }

  .meal-filters-title {
    font-size: 0.76rem;
  }

  .meal-filter-row {
    gap: 3px;
  }

  .meal-filter-label {
    font-size: 0.72rem;
    margin-top: 0;
  }

  .meal-filter-chips {
    gap: 6px;
    padding-bottom: 2px;
  }

  .filter-chip {
    font-size: 0.72rem;
    min-height: 32px;
    padding: 6px 10px;
  }

  .meals-progress-strip {
    gap: 6px;
    padding: 8px 11px;
  }

  .meals-progress-box {
    font-size: 0.78rem;
  }

  .meals-progress-count {
    font-size: 0.72rem;
  }

  #meal-grid.meal-grid {
    gap: 12px;
  }

  .product-card.meal-card {
    padding: 14px;
  }

  .meal-title {
    font-size: 0.9rem;
    min-height: calc(2 * 1.25 * 0.9em);
  }

  .meals-gauge-footer {
    background: linear-gradient(180deg, rgba(252, 248, 246, 0.94) 0%, var(--mileyo-cream) 40%);
    box-shadow: 0 -10px 28px rgba(90, 27, 105, 0.1);
    padding-top: 8px;
  }

  .meals-gauge {
    background: var(--mileyo-white);
    border: 1px solid rgba(185, 138, 215, 0.18);
    border-bottom: 0;
    border-radius: 16px 16px 0 0;
    gap: 6px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  }

  .meals-gauge-count {
    font-size: 0.84rem;
    line-height: 1.2;
  }

  .meals-gauge-bar {
    height: 7px;
  }

  .meals-gauge-cta {
    font-size: 0.96rem;
    padding: 14px 16px;
  }
}

@media (min-width: 640px) {
  .tunnel-header {
    padding: 16px 24px 18px;
  }

  .tunnel-promo {
    padding: 10px 24px;
  }

  .tunnel-promo-title {
    font-size: 0.92rem;
  }

  .tunnel-promo-subtitle {
    font-size: 0.8rem;
  }

  .builder-shell {
    padding-left: 24px;
    padding-right: 24px;
  }

  .delivery-window-grid,
  .delivery-date-grid {
    gap: 14px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: 640px;
  }

  .delivery-decision {
    padding: 32px 28px 28px;
  }

  #meal-grid.meal-grid {
    gap: 16px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .meal-filter-row {
    grid-template-columns: 1fr;
  }

  .meal-filter-label {
    margin-top: 0;
  }

  .tunnel-body.is-step-meals .builder-shell {
    --meals-step-gutter: 20px;
    padding-left: var(--meals-step-gutter);
    padding-right: var(--meals-step-gutter);
  }

  .toggle {
    font-size: 0.9rem;
    padding: 13px 14px;
  }

  .trust-section {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 768px) {
  #meal-grid.meal-grid {
    gap: 18px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .objective-grid {
    gap: 14px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    max-width: none;
  }

  .objective-card {
    min-height: 132px;
    padding: 18px 16px 16px;
  }

  .objective-card .selected-badge {
    position: static;
    width: fit-content;
  }

  .meal-filter-row {
    align-items: center;
    grid-template-columns: minmax(68px, 76px) minmax(0, 1fr);
  }

  .meal-filter-label {
    margin-top: 0;
  }

  .tunnel-body.is-step-meals .builder-shell {
    --meals-step-gutter: 24px;
    padding-left: var(--meals-step-gutter);
    padding-right: var(--meals-step-gutter);
    padding-top: 14px;
  }

  .meals-gauge-footer {
    padding-left: 0;
    padding-right: 0;
  }
}

@media (min-width: 960px) {
  .tunnel-header {
    padding: 14px 40px 16px;
  }

  .tunnel-body.is-step-meals .tunnel-header {
    padding-bottom: 10px;
  }

  .tunnel-progress-block {
    max-width: 220px;
  }

  .tunnel-step-label {
    font-size: 0.68rem;
    margin-bottom: 4px;
  }

  .builder-shell {
    padding-top: 24px;
  }

  .tunnel-body:not(.is-step-meals):not(.is-step-livraison) .builder-shell {
    max-width: calc(var(--formula-step-max-width) + 96px);
    padding-bottom: calc(var(--tunnel-footer-height) + 28px);
    padding-left: 48px;
    padding-right: 48px;
    padding-top: 20px;
  }

  .tunnel-body.is-step-objective .builder-shell {
    max-width: calc(var(--objective-step-max-width) + 96px);
  }

  .tunnel-body.is-step-livraison .builder-shell {
    max-width: calc(var(--delivery-step-max-width) + 96px);
    padding-bottom: calc(var(--tunnel-footer-height) + 28px);
    padding-left: 48px;
    padding-right: 48px;
    padding-top: 20px;
  }

  .delivery-date-grid {
    gap: 16px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    max-width: 720px;
  }

  .tunnel-body.is-step-meals .builder-shell {
    --meals-step-gutter: 32px;
    padding-left: var(--meals-step-gutter);
    padding-right: var(--meals-step-gutter);
    padding-top: 16px;
  }

  #meal-grid.meal-grid {
    gap: 22px;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }

  .meal-filter-chips {
    flex-wrap: wrap;
    overflow-x: visible;
  }

  .meals-toolbar-sticky {
    top: 78px;
  }

  .meals-intro h1 {
    font-size: 1.72rem;
  }

  .meals-lead {
    font-size: 1rem;
  }

  .formula-decision {
    margin: 0 auto;
    max-width: 1040px;
  }

  .formula-intro {
    margin-bottom: 20px;
    margin-top: 4px;
  }

  .formula-intro h1 {
    font-size: 1.72rem;
    margin-bottom: 10px;
  }

  .formula-lead {
    font-size: 1rem;
    max-width: 36rem;
  }

  .formula-benefits {
    font-size: 0.88rem;
    margin-bottom: 22px;
  }

  .toggle-row {
    display: none;
  }

  .formula-hint {
    display: none;
  }

  .box-rail {
    gap: 0;
    margin-bottom: 0;
  }

  .box-rail-nav {
    display: none;
  }

  .box-rail-viewport {
    overflow: visible;
    scroll-snap-type: none;
  }

  #box-grid.box-rail-track {
    display: grid;
    gap: 22px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 0 auto;
    max-width: 1040px;
    padding: 6px 0 4px;
    width: 100%;
  }

  #box-grid .formula-card {
    gap: 7px;
    padding: 20px 18px 18px;
    scroll-snap-align: unset;
  }

  #box-grid .formula-card .box-meal-count {
    font-size: 1.38rem;
    margin-bottom: 2px;
  }

  #box-grid .formula-card .box-price-per-meal {
    font-size: 1.04rem;
    margin-bottom: 2px;
  }

  #box-grid .formula-card .box-promo-badge {
    font-size: 0.8rem;
    margin-bottom: 4px;
    margin-top: 6px;
    padding: 5px 12px;
  }

  #box-grid .formula-card .box-promo-price {
    margin-top: 2px;
  }

  #box-grid .formula-card .box-promo-price strong {
    font-size: 1.42rem;
  }

  #box-grid .formula-card .box-crossed-price {
    font-size: 0.82rem;
    margin-top: -2px;
  }

  #box-grid .formula-card .box-weekly-price {
    color: var(--mileyo-muted);
    font-size: 0.84rem;
    font-weight: 500;
    margin-top: 2px;
  }

  #box-grid .formula-card .box-promo-note {
    font-size: 0.68rem;
    margin-top: 6px;
  }

  #box-grid .formula-card.selected {
    border-width: 2px;
    box-shadow: 0 10px 32px rgba(90, 27, 105, 0.14), 0 0 0 2px var(--mileyo-purple);
    transform: translateY(-3px);
  }

  #box-grid .formula-card.is-recommended.selected {
    background: linear-gradient(180deg, var(--mileyo-white) 0%, #f7f0fb 100%);
  }

  .formula-secondary {
    border-top: 1px solid rgba(185, 138, 215, 0.14);
    margin: 72px auto 0;
    max-width: 1040px;
    padding-top: 36px;
  }

  .portal-link-inline {
    font-size: 0.84rem;
    margin-bottom: 8px;
    margin-top: 0;
  }

  .trust-section {
    gap: 16px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 28px;
  }

  .trust-card {
    background: rgba(255, 255, 255, 0.72);
    border-color: rgba(185, 138, 215, 0.14);
    padding: 16px;
  }

  .trust-card h2 {
    font-size: 0.9rem;
    margin-bottom: 6px;
  }

  .trust-card p {
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .faq-section {
    margin: 40px auto 0;
    max-width: 680px;
    opacity: 0.95;
  }

  .faq-item {
    background: transparent;
    border: 0;
    border-bottom: 1px solid rgba(185, 138, 215, 0.14);
    border-radius: 0;
    margin-bottom: 0;
  }

  .faq-item summary {
    font-size: 0.8rem;
    font-weight: 600;
    padding: 12px 4px;
  }

  .faq-item p {
    font-size: 0.76rem;
    padding: 0 4px 12px;
  }

  .tunnel-footer {
    background: linear-gradient(180deg, rgba(252, 248, 246, 0) 0%, var(--mileyo-cream) 35%);
    display: flex;
    justify-content: center;
    padding: 14px 48px calc(14px + env(safe-area-inset-bottom, 0px));
  }

  .tunnel-cta {
    font-size: 1.02rem;
    max-width: 520px;
    padding: 15px 24px;
  }

  .meals-gauge-footer {
    display: flex;
    justify-content: center;
    padding: 14px 0 calc(14px + env(safe-area-inset-bottom, 0px));
  }

  .meals-gauge-cta {
    font-size: 1.02rem;
    max-width: none;
    padding: 15px 24px;
  }
}

@media (min-width: 1440px) {
  #meal-grid.meal-grid {
    gap: 24px;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  }
}
`;
