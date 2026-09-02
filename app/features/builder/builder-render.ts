import { builderClientScript } from "./builder-client";
import { getObjectiveStartingPriceLabels } from "./builder-box-selection";
import { FIRST_BOX_LAUNCH_DISCOUNT_EUR } from "../../constants/firstBoxLaunchDiscount";
import { escapeHtml, scriptJson } from "./builder-formatters";
import { BUILDER_OBJECTIVE_OPTIONS } from "./builder-objective-options";
import { builderStyles } from "./builder-styles";
import type { BuilderBoxOption, BuilderDeliveryConfig, BuilderMealOption } from "./builder-types";
import { renderMileyoLogoImg } from "../../utils/mileyoLogo";

const htmlResponse = (html: string) =>
  new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

export const renderMessage = (message: string, shop?: string) =>
  htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Composez votre box Mileyo</title>
  <style>${builderStyles}</style>
</head>
<body class="tunnel-body">
  <header class="tunnel-header">
    <a class="tunnel-back" href="/">← Retour</a>
    ${renderMileyoLogoImg("tunnel-logo")}
  </header>
  <main class="builder-shell">
    <section class="setup-card">
      <h1>Composez votre box Mileyo</h1>
      <p>${escapeHtml(message)}</p>
      ${shop ? `<p class="muted">Shop : ${escapeHtml(shop)}</p>` : ""}
    </section>
  </main>
</body>
</html>`);

export const renderBuilder = ({
  boxes,
  deliveryConfig,
  meals,
}: {
  boxes: BuilderBoxOption[];
  deliveryConfig: BuilderDeliveryConfig;
  meals: BuilderMealOption[];
}) =>
  htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Composez votre box Mileyo</title>
  <style>${builderStyles}</style>
</head>
<body class="tunnel-body">
  <div class="tunnel-promo" id="tunnel-promo" role="note">
    <p class="tunnel-promo-title">🎁 ${FIRST_BOX_LAUNCH_DISCOUNT_EUR} € offerts sur votre première box</p>
    <p class="tunnel-promo-subtitle">Appliqués automatiquement au paiement</p>
    <button
      aria-label="Fermer le bandeau promotionnel"
      class="tunnel-promo-dismiss"
      id="tunnel-promo-dismiss"
      type="button"
    >
      <svg aria-hidden="true" class="tunnel-promo-dismiss-icon" fill="none" height="14" viewBox="0 0 14 14" width="14" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 3l8 8M11 3L3 11" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/>
      </svg>
    </button>
  </div>
  <header class="tunnel-header">
    <button class="tunnel-back" id="tunnel-back" type="button">
      <span class="tunnel-back-text tunnel-back-text--objective">← Retour</span>
      <span class="tunnel-back-text tunnel-back-text--formula">← Objectif</span>
      <span class="tunnel-back-text tunnel-back-text--delivery">← Box</span>
      <span class="tunnel-back-text tunnel-back-text--meals-long">← Livraison</span>
      <span class="tunnel-back-text tunnel-back-text--meals-short">← Livraison</span>
      <span class="tunnel-back-text tunnel-back-text--email">← Repas</span>
    </button>
    ${renderMileyoLogoImg("tunnel-logo")}
    <div class="tunnel-progress-block">
      <p class="tunnel-step-label" id="tunnel-step-label">Étape 1 sur 5</p>
      <div aria-hidden="true" class="tunnel-progress">
        <div class="tunnel-progress-fill" id="tunnel-progress-fill"></div>
      </div>
    </div>
  </header>

  <main class="builder-shell">
    <p class="error hidden" id="error-message"></p>

    <section class="builder-step builder-step--objective" id="step-objective">
      <div class="objective-decision">
        <div class="objective-intro">
          <h1>Quel est votre objectif ?</h1>
          <p class="objective-lead">Choisissez l’objectif qui vous correspond.</p>
        </div>
        <div class="objective-highlights" aria-label="Avantages de l'abonnement">
          <span class="objective-highlight">
            <svg aria-hidden="true" class="objective-highlight-icon" fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3l7 3v6c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V6l7-3z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
            </svg>
            Sans engagement
          </span>
          <span class="objective-highlight">
            <svg aria-hidden="true" class="objective-highlight-icon" fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 7h11v8H3V7z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/>
              <path d="M14 10h4l3 3v2h-7v-5z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/>
              <circle cx="7" cy="17" r="1.8" stroke="currentColor" stroke-width="1.8"/>
              <circle cx="17" cy="17" r="1.8" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            Livraison offerte
          </span>
        </div>
        <div class="objective-grid" id="objective-grid" role="group" aria-label="Objectifs disponibles"></div>
        <p class="objective-launch-eligibility-note">
          *Offre de lancement pour les nouveaux clients éligibles.
        </p>
      </div>
    </section>

    <section class="builder-step builder-step--formula hidden" id="step-formula">
      <div class="formula-decision">
        <div class="formula-intro">
          <h1>Choisissez votre box</h1>
          <p class="formula-lead">Des repas halal, livrés chez vous et modifiables chaque semaine.</p>
        </div>

        <p class="formula-benefits" aria-label="Avantages Mileyo">
          <span>Repas halal</span>
          <span>Sans engagement</span>
          <span>Modifiable chaque semaine</span>
          <span>Livraison offerte</span>
        </p>

        <p class="formula-hint">Vous choisissez votre date de livraison à l'étape suivante.</p>
        <p class="visually-hidden" id="box-helper">Choisissez votre box</p>
        <div class="box-rail">
          <button aria-label="Box précédente" class="box-rail-nav box-rail-nav-prev" id="box-rail-prev" type="button">‹</button>
          <div class="box-rail-viewport" id="box-rail-viewport">
            <div class="card-grid box-rail-track" id="box-grid"></div>
          </div>
          <button aria-label="Box suivante" class="box-rail-nav box-rail-nav-next" id="box-rail-next" type="button">›</button>
        </div>
        <p class="box-launch-eligibility-note">
          * Offre de lancement réservée aux nouveaux clients éligibles. Une réduction de ${FIRST_BOX_LAUNCH_DISCOUNT_EUR} € est appliquée automatiquement au paiement.
        </p>
      </div>

      <div class="formula-secondary">
        <p class="portal-link portal-link-inline">
          <a href="/apps/box-builder/portal">Déjà abonné(e) ? Gérer mon abonnement</a>
        </p>

        <section class="trust-section" aria-label="Pourquoi choisir Mileyo">
        <article class="trust-card">
          <span class="trust-icon" aria-hidden="true">🍽️</span>
          <h2>Choisissez vos repas chaque semaine</h2>
          <p>Composez votre box selon vos envies et modifiez vos choix depuis votre espace Mileyo.</p>
        </article>
        <article class="trust-card">
          <span class="trust-icon" aria-hidden="true">🚚</span>
          <h2>Livraison offerte à domicile</h2>
          <p>Recevez vos repas frais à l’adresse de votre choix, selon les créneaux disponibles.</p>
        </article>
        <article class="trust-card">
          <span class="trust-icon" aria-hidden="true">🕊️</span>
          <h2>Sans engagement</h2>
          <p>Modifiez, mettez en pause ou résiliez votre abonnement facilement avant votre prochaine livraison.</p>
        </article>
      </section>

      <section class="faq-section" aria-label="Questions fréquentes">
        <details class="faq-item">
          <summary>Est-ce sans engagement ?</summary>
          <p>Oui, vous pouvez mettre en pause ou arrêter votre abonnement depuis votre espace Mileyo.</p>
        </details>
        <details class="faq-item">
          <summary>Quand puis-je modifier mes repas ?</summary>
          <p>Vous pouvez modifier vos repas pour les prochaines box depuis votre espace Mileyo, tant qu’aucun prélèvement n’est en cours.</p>
        </details>
        <details class="faq-item">
          <summary>Les repas sont-ils halal ?</summary>
          <p>Oui, les repas Mileyo sont halal.</p>
        </details>
      </section>
      </div>
    </section>

    <section class="builder-step builder-step--delivery hidden" id="step-delivery">
      <div class="delivery-decision">
        <div class="delivery-intro">
          <h1>Choisissez votre semaine de livraison</h1>
          <p class="delivery-lead">Votre box sera livrée entre jeudi et samedi.</p>
        </div>
        <div class="delivery-window-grid" id="delivery-window-grid" role="group" aria-label="Fenêtres de livraison disponibles"></div>
      </div>
    </section>

    <section class="builder-step builder-step--meals hidden" id="step-meals">
      <div class="meals-intro">
        <h1>Choisissez vos repas</h1>
        <p class="meals-lead" id="meals-lead">Pour votre box</p>
      </div>

      <div class="meals-toolbar-sticky" id="meals-toolbar-sticky">
        <div class="meal-filters-panel" id="meal-filters">
          <div class="meal-filters-panel-head">
            <button
              aria-controls="meal-filters-drawer"
              aria-expanded="false"
              aria-haspopup="dialog"
              aria-label="Filtres"
              class="meal-filters-toggle"
              id="meal-filters-toggle"
              type="button"
            >
              <span aria-hidden="true" class="meal-filters-toggle-icon">
                <svg fill="none" height="16" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-linecap="round" stroke-width="2.2"/>
                </svg>
              </span>
              <span class="meal-filters-toggle-label">Filtres</span>
              <span class="meal-filters-toggle-count hidden" id="meal-filters-active-count" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </div>

      <section class="section" id="meals-section">
        <p class="visually-hidden" id="selected-count">0 / 0 plats sélectionnés</p>
        <div class="meals-empty hidden" id="meals-empty">
          <p id="meals-empty-copy">Aucun plat ne correspond à ces filtres.<br>Essayez de retirer un allergène ou une envie.</p>
          <button class="meals-empty-reset" id="meals-empty-reset" type="button">Réinitialiser les filtres</button>
        </div>
        <div class="card-grid meal-grid" id="meal-grid"></div>
      </section>
    </section>

    <section class="builder-step builder-step--email hidden" id="step-email">
      <div class="email-decision">
        <div class="email-intro">
          <h1>Votre e-mail</h1>
          <p class="email-lead">Renseignez votre e-mail pour continuer.</p>
        </div>

        <label class="email-field" for="checkout-email">
          <span class="email-field-label">Votre adresse e-mail</span>
          <input
            autocomplete="email"
            id="checkout-email"
            maxlength="254"
            name="email"
            placeholder="vous@email.com"
            required
            type="email"
          />
        </label>

        <div
          aria-labelledby="email-mini-recap-title"
          class="email-mini-recap"
          id="email-mini-recap"
        >
          <h2 class="email-mini-recap-title" id="email-mini-recap-title">Votre sélection</h2>
          <dl class="email-mini-recap-list">
            <div class="email-mini-recap-row">
              <dt>Formule</dt>
              <dd id="email-mini-recap-box"></dd>
            </div>
            <div class="email-mini-recap-row">
              <dt>Objectif</dt>
              <dd id="email-mini-recap-objective"></dd>
            </div>
            <div class="email-mini-recap-row">
              <dt>Livraison</dt>
              <dd id="email-mini-recap-delivery"></dd>
            </div>
            <div class="email-mini-recap-row">
              <dt>Plats</dt>
              <dd id="email-mini-recap-meals"></dd>
            </div>
            <div class="email-mini-recap-row email-mini-recap-row--price">
              <dt>Première box</dt>
              <dd id="email-mini-recap-price"></dd>
            </div>
          </dl>
        </div>

        <aside class="email-offer-card" aria-label="Offre de lancement">
          <p class="email-offer-kicker">Offre de lancement</p>
          <p class="email-offer-title">Nouveaux clients : ${FIRST_BOX_LAUNCH_DISCOUNT_EUR} € de réduction sur votre première box.</p>
          <p class="email-offer-note">La remise est appliquée automatiquement au paiement si vous êtes éligible.</p>
        </aside>

        <p class="email-privacy">Nous utilisons votre e-mail pour vous accompagner dans votre commande et, si nécessaire, vous recontacter au sujet de celle-ci.</p>
      </div>
    </section>
  </main>

  <footer class="tunnel-footer" id="objective-footer">
    <button class="tunnel-cta" disabled id="objective-continue" type="button">Choisissez votre objectif</button>
  </footer>

  <footer class="tunnel-footer hidden" id="formula-footer">
    <button class="tunnel-cta" disabled id="formula-continue" type="button">Choisissez votre box</button>
  </footer>

  <footer class="tunnel-footer delivery-footer hidden" id="delivery-footer">
    <button class="tunnel-cta" disabled id="delivery-continue" type="button">Choisissez une fenêtre de livraison</button>
  </footer>

  <footer class="tunnel-footer meals-gauge-footer hidden" id="meals-gauge-footer">
    <button class="meals-gauge-cta" disabled id="add-to-cart" type="button">Encore 12 plats</button>
  </footer>

  <footer class="tunnel-footer email-footer hidden" id="email-footer">
    <button class="tunnel-cta" disabled id="email-continue" type="button">Entrez votre e-mail</button>
  </footer>

  <div
    aria-hidden="true"
    class="meal-filters-drawer hidden"
    id="meal-filters-drawer"
  >
    <button aria-label="Fermer les filtres" class="meal-filters-drawer-backdrop" type="button"></button>
    <aside
      aria-labelledby="meal-filters-drawer-title"
      class="meal-filters-drawer-panel"
      id="meal-filters-drawer-panel"
      role="dialog"
    >
      <div class="meal-filters-drawer-head">
        <h2 class="meal-filters-drawer-title" id="meal-filters-drawer-title">Filtres</h2>
        <button aria-label="Fermer" class="meal-filters-drawer-close" type="button">×</button>
      </div>
      <div class="meal-filters-drawer-scroll" id="meal-filters-body">
        <div class="meal-filter-row">
          <span class="meal-filter-label">J'évite</span>
          <div class="meal-filter-options" id="allergen-filters" role="group" aria-label="Allergènes à éviter"></div>
        </div>
        <div class="meal-filter-row">
          <span class="meal-filter-label">Mes envies</span>
          <div class="meal-filter-options" id="badge-filters" role="group" aria-label="Envies et badges"></div>
        </div>
        <button class="meal-filters-reset hidden" id="meal-filters-reset" type="button">Réinitialiser</button>
      </div>
      <div class="meal-filters-drawer-footer">
        <button class="meal-filters-apply" id="meal-filters-apply" type="button">Appliquer</button>
      </div>
    </aside>
  </div>

  <div
    aria-hidden="true"
    class="meal-detail-drawer hidden"
    id="meal-detail-drawer"
  >
    <button aria-label="Fermer" class="meal-detail-drawer-backdrop" type="button"></button>
    <aside
      aria-labelledby="meal-detail-drawer-title"
      class="meal-detail-drawer-panel"
      id="meal-detail-drawer-panel"
      role="dialog"
    >
      <button aria-label="Fermer" class="meal-detail-drawer-close" type="button">×</button>
      <div class="meal-detail-drawer-scroll">
        <div class="meal-detail-drawer-media" id="meal-detail-drawer-media"></div>
        <h2 class="meal-detail-drawer-title" id="meal-detail-drawer-title"></h2>
        <div class="meal-badges meal-detail-drawer-badges" id="meal-detail-drawer-badges"></div>
        <p class="meal-detail-drawer-allergens hidden" id="meal-detail-drawer-allergens"></p>
        <p class="meal-detail-drawer-description hidden" id="meal-detail-drawer-description"></p>
        <div class="meal-detail-drawer-nutrition" id="meal-detail-drawer-nutrition"></div>
      </div>
    </aside>
  </div>

  <script>window.__MILEYO_BOX_BUILDER__ = ${scriptJson({
    boxes,
    deliveryConfig,
    meals,
    objectiveStartingPriceLabels: getObjectiveStartingPriceLabels(boxes),
    objectives: BUILDER_OBJECTIVE_OPTIONS,
  })};</script>
  <script>${builderClientScript}</script>
</body>
</html>`);
