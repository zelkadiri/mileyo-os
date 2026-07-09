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
  width: 50%;
}

.tunnel-progress-fill.is-step-2 {
  width: 100%;
}

.builder-shell {
  margin: 0 auto;
  max-width: 720px;
  padding: 16px 16px calc(var(--tunnel-footer-height) + 20px);
}

.tunnel-body:not(.is-step-meals) .builder-shell {
  max-width: 1180px;
  padding-bottom: calc(var(--tunnel-footer-height) + 16px);
}

.tunnel-body.is-step-meals .tunnel-footer,
.tunnel-footer.hidden {
  display: none;
}

.tunnel-body.is-step-meals .builder-shell {
  padding-bottom: 24px;
}

.formula-intro,
.meals-intro {
  margin-bottom: 10px;
  text-align: center;
}

.formula-lead {
  color: var(--mileyo-muted);
  font-size: 0.92rem;
  line-height: 1.4;
  margin: 0 auto;
  max-width: 34rem;
}

.formula-benefits {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
}

.formula-benefits li {
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.16);
  border-radius: 999px;
  color: var(--mileyo-text);
  font-size: 0.76rem;
  font-weight: 600;
  padding: 5px 10px;
}

.formula-hint {
  color: var(--mileyo-muted);
  font-size: 0.82rem;
  margin: 0 0 10px;
  text-align: center;
}

.formula-intro h1,
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
  background: var(--mileyo-white);
  border-radius: 999px;
  box-shadow: var(--mileyo-shadow-soft);
  display: grid;
  gap: 4px;
  grid-template-columns: 1fr 1fr;
  margin: 0 auto 14px;
  max-width: 520px;
  padding: 4px;
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
  gap: 6px;
  max-width: none;
  min-height: 0;
  padding: 14px 16px;
  scroll-snap-align: none;
  scroll-snap-stop: normal;
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
  font-size: 1.02rem;
}

#box-grid .formula-card .box-promo-price {
  font-size: 0.82rem;
  line-height: 1.3;
}

#box-grid .formula-card .box-promo-price strong {
  font-size: 0.9rem;
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
  line-height: 1.35;
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

.box-weekly-price {
  color: var(--mileyo-text);
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0;
}

.box-promo-note {
  color: var(--mileyo-muted);
  font-size: 0.78rem;
  line-height: 1.35;
  margin: 0;
}

.box-subscription-price {
  color: var(--mileyo-purple-dark);
  font-size: 0.88rem;
  font-weight: 600;
}

#box-grid .formula-card .box-benefits li {
  font-size: 0.78rem;
}

.box-benefits {
  display: grid;
  gap: 4px;
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}

.box-benefits li {
  color: var(--mileyo-muted);
  font-size: 0.85rem;
  padding-left: 1.1em;
  position: relative;
}

.box-benefits li::before {
  color: var(--mileyo-green);
  content: "✓";
  font-weight: 700;
  left: 0;
  position: absolute;
}

#meal-grid .product-card img {
  aspect-ratio: 16 / 10;
  border-radius: 14px;
  object-fit: cover;
  width: 100%;
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

.tunnel-footer {
  background: linear-gradient(180deg, rgba(252, 248, 246, 0) 0%, var(--mileyo-cream) 22%);
  bottom: 0;
  left: 0;
  margin: 0 auto;
  max-width: 1180px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
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

  #meal-grid.card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .toggle {
    font-size: 0.9rem;
    padding: 13px 14px;
  }
}

@media (min-width: 960px) {
  .builder-shell {
    padding-left: 32px;
    padding-right: 32px;
    padding-top: 12px;
  }

  .tunnel-body:not(.is-step-meals) .builder-shell {
    padding-top: 10px;
  }

  .formula-intro {
    margin-bottom: 8px;
  }

  .formula-intro h1 {
    font-size: 1.48rem;
    margin-bottom: 6px;
  }

  .formula-benefits {
    margin-bottom: 10px;
  }

  .toggle-row {
    margin-bottom: 10px;
  }

  .box-rail {
    align-items: stretch;
    gap: 0;
    grid-template-columns: 1fr;
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
    gap: 14px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 2px 0 4px;
    width: 100%;
  }

  #box-grid .formula-card {
    flex: unset;
    scroll-snap-align: unset;
  }

  #meal-grid.card-grid {
    gap: 18px;
  }
}
`;
