import { builderClientScript } from "./builder-client";
import { escapeHtml, scriptJson } from "./builder-formatters";
import { builderStyles } from "./builder-styles";
import type { BuilderProduct } from "./builder-types";

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
  <div class="tunnel-promo" id="tunnel-promo" role="note">
    <p class="tunnel-promo-title">🎁 20 € offerts sur votre 1ʳᵉ box d'abonnement</p>
    <p class="tunnel-promo-subtitle">Appliqué automatiquement au paiement</p>
  </div>
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
  meals,
}: {
  boxes: BuilderProduct[];
  meals: BuilderProduct[];
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
    <p class="tunnel-promo-title">🎁 20 € offerts sur votre 1ʳᵉ box d'abonnement</p>
    <p class="tunnel-promo-subtitle">Appliqué automatiquement au paiement</p>
  </div>
  <header class="tunnel-header">
    <button class="tunnel-back" id="tunnel-back" type="button">← Retour</button>
    <!-- Wordmark temporaire : aucun asset logo Mileyo trouvé dans le projet -->
    <p class="tunnel-wordmark" aria-label="Mileyo">Mileyo</p>
    <div class="tunnel-progress-block">
      <p class="tunnel-step-label" id="tunnel-step-label">Étape 1 sur 2</p>
      <div aria-hidden="true" class="tunnel-progress">
        <div class="tunnel-progress-fill" id="tunnel-progress-fill"></div>
      </div>
    </div>
  </header>

  <main class="builder-shell">
    <p class="error hidden" id="error-message"></p>

    <section id="step-formula">
      <div class="formula-intro">
        <h1>Choisissez votre formule</h1>
        <p class="formula-lead">Des repas halal, cuisinés et livrés chez vous. Modifiable chaque semaine.</p>
      </div>

      <ul class="formula-benefits" aria-label="Avantages Mileyo">
        <li>Repas halal</li>
        <li>Sans engagement</li>
        <li>Modifiable chaque semaine</li>
        <li>Livraison offerte</li>
      </ul>

      <section class="toggle-row" aria-label="Type de commande">
        <button class="toggle active" id="subscription-toggle" type="button">Abonnement hebdomadaire</button>
        <button class="toggle" id="one-time-toggle" type="button">Commande unique</button>
      </section>

      <p class="formula-hint">Vous choisissez vos plats à l'étape suivante.</p>
      <p class="visually-hidden" id="box-helper">12 repas à sélectionner</p>
      <div class="box-rail">
        <button aria-label="Formule précédente" class="box-rail-nav box-rail-nav-prev" id="box-rail-prev" type="button">‹</button>
        <div class="box-rail-viewport" id="box-rail-viewport">
          <div class="card-grid box-rail-track" id="box-grid"></div>
        </div>
        <button aria-label="Formule suivante" class="box-rail-nav box-rail-nav-next" id="box-rail-next" type="button">›</button>
      </div>
    </section>

    <section class="hidden" id="step-meals">
      <div class="meals-intro">
        <h1>Choisissez vos repas</h1>
        <p class="meals-lead" id="meals-lead">Pour votre box</p>
      </div>

      <section class="section hidden" id="meals-section">
        <div class="section-heading sticky-count">
          <div>
            <h2 class="visually-hidden">Liste des repas</h2>
            <p id="selected-count">0 / 0 plats sélectionnés</p>
          </div>
          <button class="add-button" disabled id="add-to-cart" type="button">Ajouter au panier</button>
        </div>
        <div class="card-grid" id="meal-grid"></div>
      </section>
    </section>
  </main>

  <footer class="tunnel-footer" id="formula-footer">
    <button class="tunnel-cta" id="formula-continue" type="button">Continuer avec 12 repas →</button>
    <p class="portal-link">
      <a href="/apps/box-builder/portal">Déjà abonné(e) ? Gérer mon abonnement</a>
    </p>
  </footer>

  <script>window.__MILEYO_BOX_BUILDER__ = ${scriptJson({ boxes, meals })};</script>
  <script>${builderClientScript}</script>
</body>
</html>`);
