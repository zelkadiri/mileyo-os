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
  --tunnel-footer-height: 84px;
  --box-rail-gap: 14px;
  --box-rail-card-width-mobile: 82%;
  --box-rail-card-width-desktop: calc((100% - (3 * var(--box-rail-gap))) / 4.15);
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
  background: linear-gradient(90deg, rgba(124, 201, 167, 0.22), rgba(220, 194, 240, 0.35));
  border-bottom: 1px solid rgba(185, 138, 215, 0.14);
  padding: 8px 16px;
  text-align: center;
}

.tunnel-promo-title {
  color: var(--mileyo-purple-black);
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
}

.tunnel-promo-subtitle {
  color: var(--mileyo-muted);
  font-size: 0.76rem;
  line-height: 1.3;
  margin: 2px 0 0;
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
  background: var(--mileyo-cream);
  border-bottom: 1px solid rgba(185, 138, 215, 0.18);
  padding: 12px 16px 14px;
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
  font-size: 0.92rem;
  font-weight: 600;
  padding: 4px 0;
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
  font-size: 1.55rem;
  font-style: italic;
  font-weight: 600;
  letter-spacing: 0.04em;
  margin: 6px 0 12px;
  text-align: center;
}

.tunnel-progress-block {
  margin: 0 auto;
  max-width: 280px;
}

.tunnel-step-label {
  color: var(--mileyo-muted);
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  margin: 0 0 8px;
  text-align: center;
  text-transform: uppercase;
}

.tunnel-progress {
  background: var(--mileyo-lilac);
  border-radius: 999px;
  height: 6px;
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
  padding: 20px 16px calc(var(--tunnel-footer-height) + 24px);
}

.tunnel-body:not(.is-step-meals) .builder-shell {
  max-width: 1240px;
  padding-bottom: calc(var(--tunnel-footer-height) + 32px);
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
  margin-bottom: 22px;
  text-align: center;
}

.formula-intro h1,
.meals-intro h1,
.setup-card h1 {
  color: var(--mileyo-purple-black);
  font-size: clamp(1.35rem, 4.2vw, 1.95rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
  margin: 0 0 14px;
}

.formula-reassurance {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  justify-content: center;
  list-style: none;
  margin: 0;
  padding: 0;
}

.formula-reassurance li {
  align-items: center;
  color: var(--mileyo-text);
  display: inline-flex;
  font-size: 0.92rem;
  font-weight: 600;
  gap: 6px;
}

.formula-reassurance-icon {
  align-items: center;
  color: var(--mileyo-green);
  display: inline-flex;
  font-size: 0.95rem;
  justify-content: center;
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
  margin-bottom: 22px;
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
  font-size: 0.82rem;
  line-height: 1.25;
  padding: 12px 10px;
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
  gap: 8px;
  grid-template-columns: 1fr;
  margin-bottom: 8px;
  position: relative;
}

.box-rail-viewport {
  -ms-overflow-style: none;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-behavior: smooth;
  scroll-padding-inline: 16px;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  width: 100%;
}

.box-rail-viewport::-webkit-scrollbar {
  display: none;
}

#box-grid.box-rail-track {
  display: flex;
  gap: var(--box-rail-gap);
  grid-template-columns: unset;
  padding: 4px 16px 8px;
  width: max-content;
}

#box-grid .product-card {
  flex: 0 0 var(--box-rail-card-width-mobile);
  max-width: 320px;
  scroll-snap-align: center;
  scroll-snap-stop: always;
}

.box-rail-nav {
  align-items: center;
  appearance: none;
  background: var(--mileyo-white);
  border: 1px solid rgba(185, 138, 215, 0.28);
  border-radius: 999px;
  box-shadow: var(--mileyo-shadow-soft);
  color: var(--mileyo-purple-black);
  cursor: pointer;
  display: none;
  font-size: 1.35rem;
  height: 42px;
  justify-content: center;
  line-height: 1;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 42px;
  z-index: 2;
}

.box-rail-nav-prev { left: 0; }
.box-rail-nav-next { right: 0; }

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
  font-size: 0.75rem;
  font-weight: 700;
  justify-self: start;
  letter-spacing: 0.02em;
  padding: 5px 12px;
}

.box-meal-count {
  color: var(--mileyo-purple-black);
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
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

.product-card img {
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
  margin: 20px 0 0;
  text-align: center;
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
  background: linear-gradient(180deg, rgba(252, 248, 246, 0) 0%, var(--mileyo-cream) 28%);
  bottom: 0;
  left: 0;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  position: fixed;
  right: 0;
  z-index: 30;
}

.tunnel-cta {
  background: var(--mileyo-purple);
  box-shadow: 0 4px 20px rgba(185, 138, 215, 0.4);
  color: var(--mileyo-white);
  font-size: 1rem;
  padding: 16px 20px;
  width: 100%;
}

.tunnel-cta:not(:disabled):hover {
  background: var(--mileyo-purple-dark);
}

.tunnel-cta:disabled {
  background: var(--mileyo-lilac);
  box-shadow: none;
  color: rgba(255, 255, 255, 0.85);
  cursor: not-allowed;
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
  }

  .box-rail {
    gap: 0;
    grid-template-columns: auto 1fr auto;
    padding: 0 8px;
  }

  .box-rail-nav {
    display: inline-flex;
    position: static;
    transform: none;
  }

  .box-rail-viewport {
    scroll-padding-inline: 0;
  }

  #box-grid.box-rail-track {
    padding-inline: 0;
  }

  #box-grid .product-card {
    flex-basis: var(--box-rail-card-width-desktop);
    max-width: none;
    scroll-snap-align: start;
  }

  #meal-grid.card-grid {
    gap: 18px;
  }
}
`;
