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
  <title>Compose ta box</title>
  <style>${builderStyles}</style>
</head>
<body>
  <main class="builder-shell">
    <section class="setup-card">
      <h1>Compose ta box</h1>
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
  <title>Compose ta box</title>
  <style>${builderStyles}</style>
</head>
<body>
  <main class="builder-shell">
    <section class="hero">
      <p class="eyebrow">Mileyo</p>
      <h1>Compose ta box</h1>
      <p>Choisis ta box, puis sélectionne exactement le nombre de plats inclus.</p>
      <p class="portal-link"><a href="/apps/box-builder/portal">Déjà abonné ? Modifier mes prochaines box</a></p>
    </section>

    <section class="toggle-row" aria-label="Type de commande">
      <button class="toggle active" id="one-time-toggle" type="button">Commande unique</button>
      <button class="toggle" id="subscription-toggle" type="button">Abonnement hebdomadaire</button>
    </section>

    <section class="section">
      <div class="section-heading">
        <h2>Choisis ta box</h2>
        <p id="box-helper">Sélectionne une box pour commencer.</p>
      </div>
      <div class="card-grid" id="box-grid"></div>
    </section>

    <section class="section hidden" id="meals-section">
      <div class="section-heading sticky-count">
        <div>
          <h2>Choisis tes plats</h2>
          <p id="selected-count">0 / 0 plats sélectionnés</p>
        </div>
        <button class="add-button" disabled id="add-to-cart" type="button">Ajouter au panier</button>
      </div>
      <p class="error hidden" id="error-message"></p>
      <div class="card-grid" id="meal-grid"></div>
    </section>
  </main>

  <script>window.__MILEYO_BOX_BUILDER__ = ${scriptJson({ boxes, meals })};</script>
  <script>${builderClientScript}</script>
</body>
</html>`);
