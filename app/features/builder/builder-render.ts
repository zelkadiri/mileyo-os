import { builderClientScript } from "./builder-client";
import { getObjectiveStartingPriceLabels } from "./builder-box-selection";
import { escapeHtml, scriptJson } from "./builder-formatters";
import { BUILDER_OBJECTIVE_OPTIONS } from "./builder-objective-options";
import { builderStyles } from "./builder-styles";
import type { BuilderBoxOption, BuilderDeliveryConfig, BuilderMeal } from "./builder-types";

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
    <!-- Wordmark temporaire : aucun asset logo Mileyo trouvé dans le projet -->
    <p class="tunnel-wordmark" aria-label="Mileyo">Mileyo</p>
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
  meals: BuilderMeal[];
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
  <header class="tunnel-header">
    <button class="tunnel-back" id="tunnel-back" type="button">
      <span class="tunnel-back-text tunnel-back-text--objective">← Retour</span>
      <span class="tunnel-back-text tunnel-back-text--formula">← Objectif</span>
      <span class="tunnel-back-text tunnel-back-text--delivery">← Box</span>
      <span class="tunnel-back-text tunnel-back-text--meals-long">← Livraison</span>
      <span class="tunnel-back-text tunnel-back-text--meals-short">← Livraison</span>
    </button>
    <!-- Wordmark temporaire : aucun asset logo Mileyo trouvé dans le projet -->
    <p class="tunnel-wordmark" aria-label="Mileyo">Mileyo</p>
    <div class="tunnel-progress-block">
      <p class="tunnel-step-label" id="tunnel-step-label">Étape 1 sur 4</p>
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
        <div class="objective-grid" id="objective-grid" role="group" aria-label="Objectifs disponibles"></div>
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
          <h1>Choisissez votre première livraison</h1>
          <p class="delivery-lead">Votre abonnement démarre aujourd'hui. Votre première box sera livrée à la date choisie.</p>
        </div>
        <div class="delivery-date-grid" id="delivery-date-grid" role="group" aria-label="Dates de livraison disponibles"></div>
      </div>
    </section>

    <section class="builder-step builder-step--meals hidden" id="step-meals">
      <div class="meals-toolbar-sticky" id="meals-toolbar-sticky">
        <div class="meals-intro">
          <h1>Choisissez vos repas</h1>
          <p class="meals-lead" id="meals-lead">Pour votre box</p>
        </div>

        <div class="meal-filters-panel" id="meal-filters">
          <div class="meal-filters-panel-head">
            <p class="meal-filters-title">Affinez votre sélection</p>
            <button class="meal-filters-reset hidden" id="meal-filters-reset" type="button">Réinitialiser</button>
          </div>
          <div class="meal-filter-row">
            <span class="meal-filter-label">J'évite</span>
            <div class="meal-filter-chips" id="allergen-filters" role="toolbar" aria-label="Allergènes à éviter"></div>
          </div>
          <div class="meal-filter-row">
            <span class="meal-filter-label">Mes envies</span>
            <div class="meal-filter-chips" id="badge-filters" role="toolbar" aria-label="Envies et badges"></div>
          </div>
        </div>

        <div class="meals-progress-strip" id="meals-progress-strip">
          <div class="meals-progress-copy">
            <p class="meals-progress-box" id="meals-progress-box">Box 12 repas</p>
            <p class="meals-progress-count" id="meals-progress-count">0 / 12 repas sélectionnés</p>
          </div>
          <div aria-hidden="true" class="meals-progress-bar">
            <div class="meals-progress-fill" id="meals-progress-fill"></div>
          </div>
        </div>
      </div>

      <section class="section" id="meals-section">
        <p class="visually-hidden" id="selected-count">0 / 0 plats sélectionnés</p>
        <div class="meals-empty hidden" id="meals-empty">
          <p>Aucun plat ne correspond à ces filtres.<br>Essayez de retirer un allergène ou une envie.</p>
          <button class="meals-empty-reset" id="meals-empty-reset" type="button">Réinitialiser les filtres</button>
        </div>
        <div class="card-grid meal-grid" id="meal-grid"></div>
      </section>
    </section>
  </main>

  <footer class="tunnel-footer" id="objective-footer">
    <button class="tunnel-cta" disabled id="objective-continue" type="button">Choisissez votre objectif</button>
  </footer>

  <footer class="tunnel-footer hidden" id="formula-footer">
    <button class="tunnel-cta" disabled id="formula-continue" type="button">Choisissez votre box</button>
  </footer>

  <footer class="tunnel-footer delivery-footer hidden" id="delivery-footer">
    <button class="tunnel-cta" id="delivery-continue" type="button">Continuer vers mes repas →</button>
  </footer>

  <footer class="tunnel-footer meals-gauge-footer hidden" id="meals-gauge-footer">
    <div class="meals-gauge">
      <p class="meals-gauge-count" id="meals-gauge-count">0 / 12 plats</p>
      <div aria-hidden="true" class="meals-gauge-bar">
        <div class="meals-gauge-fill" id="meals-gauge-fill"></div>
      </div>
      <button class="meals-gauge-cta" disabled id="add-to-cart" type="button">Encore 12 plats</button>
    </div>
  </footer>

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
