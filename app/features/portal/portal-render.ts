import { escapeHtml, scriptJson } from "../../utils/html";
import { renderMileyoLogoImg } from "../../utils/mileyoLogo";
import {
  formatFinancialStatus,
  formatFrenchDate,
  formatFrenchDateTime,
  formatFulfillmentStatus,
  formatOrderPrice,
  formatScheduledDeliveryLabel,
  formatSubscriptionPrice,
  getTerminalStatusBadgeClass,
  getUpcomingTabEmptyMessage,
  isPortalForecastEligible,
  titlesToQuantities,
} from "./portal-formatters";
import { portalClientScript } from "./portal-client";
import { portalStyles } from "./portal-styles";
import type {
  MerchantSupportContact,
  PortalForecastCycle,
  PortalHistoryOrder,
  PortalMeal,
  PortalRecovery,
  PortalSelection,
  PortalSubscriptionState,
  PortalTerminalSelection,
  PortalBoxProduct,
} from "./portal-types";

const htmlResponse = (html: string) =>
  new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

const renderRecoveryBlock = (
  recovery: PortalRecovery,
  merchantSupport: MerchantSupportContact,
) => {
  const retryLine =
    !recovery.isFinalFailed && recovery.nextRetryAt
      ? `<p class="recovery-retry muted">Prochaine tentative automatique : ${escapeHtml(formatFrenchDateTime(recovery.nextRetryAt))}</p>`
      : "";

  if (!recovery.paymentUpdateAvailable) {
    return `<div class="recovery-block recovery-block--contact">
      <h3 class="recovery-title">Votre moyen de paiement n’est plus disponible.</h3>
      <p class="recovery-message">Votre abonnement est en pause. Contactez-nous afin de mettre à jour votre moyen de paiement et reprendre votre abonnement.</p>
      ${retryLine}
      <a class="portal-button recovery-contact-button" href="${escapeHtml(merchantSupport.href)}">${escapeHtml(merchantSupport.label)}</a>
    </div>`;
  }

  const message = recovery.isFinalFailed
    ? "Votre abonnement est en pause en attendant la mise à jour de votre moyen de paiement."
    : "Le paiement de votre prochaine box n’a pas pu être effectué.";

  return `<div class="recovery-block">
      <p class="recovery-message">${escapeHtml(message)}</p>
      ${retryLine}
      <button class="portal-button secondary payment-update-button" type="button">Recevoir un lien sécurisé pour mettre à jour ma carte</button>
      <p class="recovery-note muted">Nous vous enverrons un email sécurisé Shopify — aucune carte n’est affichée ici.</p>
    </div>`;
};

export const renderMessage = (message: string, options?: { loginLink?: boolean }) =>
  htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mes box Mileyo</title>
  <style>${portalStyles}</style>
</head>
<body>
  <main class="portal-shell">
    <section class="portal-card">
      <h1>Mes box Mileyo</h1>
      <p>${escapeHtml(message)}</p>
      ${
        options?.loginLink
          ? `<p><a class="portal-button" href="/account/login">Se connecter</a></p>`
          : ""
      }
    </section>
  </main>
</body>
</html>`);

const renderBoxPickerCards = (
  boxes: PortalBoxProduct[],
  currentVariantId: string | null,
) =>
  boxes
    .map((box) => {
      const isCurrent = box.variantId === currentVariantId;

      return `<button
        class="box-card${isCurrent ? " selected" : ""}"
        data-available="true"
        data-variant-id="${escapeHtml(box.variantId)}"
        data-meal-count="${box.mealCount}"
        type="button"
      >
        ${
          box.imageUrl
            ? `<img alt="${escapeHtml(box.imageAlt)}" src="${escapeHtml(box.imageUrl)}" />`
            : ""
        }
        <span class="box-card-title">${escapeHtml(box.title)}</span>
        <span class="box-card-meta">${box.mealCount} repas</span>
        <span class="box-card-price">${escapeHtml(formatSubscriptionPrice(box.price))}</span>
        ${isCurrent ? `<span class="box-card-badge">Box actuelle</span>` : ""}
      </button>`;
    })
    .join("");

export const renderPortalSubscriptionStatus = (
  portalState: PortalSubscriptionState,
) => {
  switch (portalState) {
    case "active":
      return `<span class="status-badge active">Abonnement actif</span>`;
    case "paused":
      return `<span class="status-badge paused">En pause</span>`;
    case "resume_processing":
      return `<span class="status-badge processing">Reprise en cours</span>`;
    default:
      return "";
  }
};

const renderMealChips = (meals: string[], emptyMessage: string) => {
  if (meals.length === 0) {
    return `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
  }

  return `<ul class="meal-chips">${meals
    .map((meal) => `<li class="meal-chip">${escapeHtml(meal)}</li>`)
    .join("")}</ul>`;
};

const renderDeliveryInfoItem = (selection: PortalSelection) => {
  const deliveryLabel = formatScheduledDeliveryLabel(
    selection.nextScheduledDeliveryDate,
  );

  if (deliveryLabel) {
    return `<div class="key-info-item key-info-item--highlight">
        <span class="key-info-label">Prochaine livraison</span>
        <span class="key-info-value">${escapeHtml(deliveryLabel)}</span>
      </div>`;
  }

  return `<div class="key-info-item key-info-item--highlight">
      <span class="key-info-label">Prochaine livraison</span>
      <span class="key-info-value key-info-value--pending">Livraison à confirmer</span>
    </div>`;
};

const renderDeliveryCutoffNotice = (selection: PortalSelection) => {
  const cutoff = selection.deliveryCutoff;

  if (!cutoff?.isKnown) {
    return "";
  }

  if (cutoff.isPassed) {
    return `<div class="cutoff-notice cutoff-notice--closed" role="note">
        <p class="cutoff-title">Cette box est en préparation.</p>
        <p class="cutoff-message">Les modifications ne sont plus possibles pour cette livraison.</p>
      </div>`;
  }

  if (!cutoff.deadlineLabel) {
    return "";
  }

  return `<div class="cutoff-notice cutoff-notice--open" role="note">
      <p class="cutoff-message">Modifications possibles jusqu’au ${escapeHtml(cutoff.deadlineLabel)}</p>
    </div>`;
};

const renderKeyInfoGrid = (selection: PortalSelection) => {
  const billingValue = selection.nextBillingDate
    ? escapeHtml(formatFrenchDate(selection.nextBillingDate))
    : `<span class="key-info-value--pending">À confirmer</span>`;

  return `<div class="key-info-grid">
      ${renderDeliveryInfoItem(selection)}
      <div class="key-info-item">
        <span class="key-info-label">Prochain prélèvement</span>
        <span class="key-info-value">${billingValue}</span>
      </div>
      <div class="key-info-item">
        <span class="key-info-label">Box</span>
        <span class="key-info-value">${escapeHtml(selection.boxTitle ?? "Non renseignée")}</span>
      </div>
      ${
        selection.objectiveLabel
          ? `<div class="key-info-item">
        <span class="key-info-label">Objectif</span>
        <span class="key-info-value">${escapeHtml(selection.objectiveLabel)}</span>
      </div>`
          : ""
      }
      <div class="key-info-item">
        <span class="key-info-label">Nombre de repas</span>
        <span class="key-info-value">${selection.mealsCount}</span>
      </div>
      ${
        selection.boxSubscriptionPrice
          ? `<div class="key-info-item">
        <span class="key-info-label">Prix abonnement</span>
        <span class="key-info-value">${escapeHtml(formatSubscriptionPrice(selection.boxSubscriptionPrice))}</span>
      </div>`
          : ""
      }
    </div>`;
};

const renderNextBoxCard = ({
  boxes,
  merchantSupport,
  selection,
}: {
  boxes: PortalBoxProduct[];
  merchantSupport: MerchantSupportContact;
  selection: PortalSelection;
}) => {
  const portalState = selection.portalState;
  const isActive = portalState === "active";
  const isPaused = portalState === "paused";
  const isResumeProcessing = portalState === "resume_processing";
  const isModificationBlocked = selection.modificationBlocked;
  const modificationBlockedReason =
    selection.modificationBlockedReason ?? selection.boxChangeBlockedReason;
  const pickerBoxes = selection.objective
    ? boxes.filter((box) => box.objective === selection.objective)
    : [];
  const canChangeBox =
    !isResumeProcessing && !isModificationBlocked && pickerBoxes.length > 0;
  const resumeRequiresPayment = selection.resumeRequiresPayment;
  const resumeButtonLabel = resumeRequiresPayment
    ? "Reprendre mon abonnement et payer maintenant"
    : "Reprendre mon abonnement";
  const resumeNote = resumeRequiresPayment
    ? "Votre prochaine box sera débitée immédiatement après confirmation."
    : selection.nextBillingDate
      ? `Votre prochain prélèvement reste prévu le ${formatFrenchDate(selection.nextBillingDate)}.`
      : "Votre abonnement sera repris sans prélèvement immédiat.";

  const mealEditorOpenByDefault =
    isPaused && !isResumeProcessing && !isModificationBlocked;

  return `<section class="portal-card selection-card${mealEditorOpenByDefault ? " is-meal-editing" : ""}" data-selection-id="${escapeHtml(selection.id)}">
      <div class="card-top">
        <h2>Ma prochaine box</h2>
        ${renderPortalSubscriptionStatus(portalState)}
      </div>
      ${renderKeyInfoGrid(selection)}
      ${renderDeliveryCutoffNotice(selection)}
      <h3 class="section-heading">Plats sélectionnés</h3>
      ${renderMealChips(
        selection.selectedMeals,
        "Aucun plat sélectionné pour le moment.",
      )}
      <p class="editor-notice next-box-notice">Les modifications sont appliquées uniquement à votre prochaine commande.</p>
      ${
        selection.recovery
          ? renderRecoveryBlock(selection.recovery, merchantSupport)
          : ""
      }
      ${
        isResumeProcessing
          ? `<p class="processing-notice">Votre paiement est en cours de confirmation. Ne relancez pas la demande.</p>`
          : ""
      }
      <div class="card-actions">
      ${
        isActive && !isModificationBlocked
          ? `<button class="portal-button secondary edit-button" type="button">Préparer ma semaine</button>`
          : ""
      }
      ${
        canChangeBox
          ? `<button class="portal-button secondary change-box-button" type="button">Changer de box</button>`
          : ""
      }
      ${
        isActive && !isModificationBlocked
          ? `<button class="portal-button secondary pause-button" type="button">Mettre mon abonnement en pause</button>`
          : ""
      }
      </div>
      <div class="objective-support">
        <button class="portal-button secondary change-objective-button" type="button">Changer d'objectif</button>
        <div class="objective-support-panel hidden">
          <p class="objective-support-message">Le changement d'objectif nécessite l'aide de notre équipe afin d'adapter votre abonnement. Contactez-nous via le chat.</p>
          <a class="portal-button objective-support-contact" href="${escapeHtml(merchantSupport.href)}">Contacter le support</a>
        </div>
      </div>
      ${
        isModificationBlocked && modificationBlockedReason
          ? `<p class="muted modification-blocked">${escapeHtml(modificationBlockedReason)}</p>`
          : ""
      }
      <div class="box-change-editor hidden">
        <div class="box-change-step" data-step="1">
          <h3>Choisir une nouvelle box</h3>
          <p class="editor-notice">Ce changement sera appliqué uniquement à votre prochaine commande.</p>
          <p class="editor-notice">Le prix de votre prochain prélèvement sera ajusté selon la box choisie.</p>
          <div class="box-grid">${renderBoxPickerCards(pickerBoxes, selection.currentVariantId)}</div>
          <p class="error box-change-error hidden"></p>
          <button class="portal-button secondary box-change-cancel" type="button">Annuler</button>
        </div>
        <div class="box-change-step hidden" data-step="2">
          <h3>Choisir vos plats pour cette box</h3>
          <p class="editor-notice">Votre sélection de plats doit être refaite pour cette nouvelle box.</p>
          <p class="box-change-selected-box muted"></p>
          <p class="selected-count box-change-count">0 / 0 plats sélectionnés</p>
          <p class="error box-change-error hidden"></p>
          <div class="meal-grid box-change-meal-grid"></div>
          <button class="portal-button secondary box-change-back" type="button">Retour</button>
          ${
            isActive
              ? `<button class="portal-button box-change-confirm" disabled type="button">Confirmer ma nouvelle box pour la prochaine commande</button>`
              : `<button class="portal-button box-change-confirm" disabled type="button">Enregistrer ma nouvelle box</button>`
          }
        </div>
      </div>
      <div class="editor${mealEditorOpenByDefault ? " paused-editor" : " hidden"}">
        <div class="editor-heading">
          <div class="editor-heading-copy">
            <h3>Préparer votre prochaine semaine</h3>
            <div class="meal-week-progress">
              <div class="meal-week-progress-copy">
                <p class="meal-week-progress-label">Votre semaine</p>
                <p class="selected-count meal-editor-count" aria-live="polite">0 / ${selection.mealsCount} repas</p>
              </div>
              <div
                aria-label="Progression de votre semaine"
                aria-valuemax="${selection.mealsCount}"
                aria-valuemin="0"
                aria-valuenow="0"
                class="meal-week-progress-track"
                role="progressbar"
              >
                <div class="meal-week-progress-fill"></div>
              </div>
            </div>
          </div>
          ${
            isActive
              ? `<button class="portal-button save-button" disabled type="button">Valider ma semaine</button>`
              : ""
          }
        </div>
        <p class="editor-notice">Les modifications de plats seront appliquées uniquement à votre prochaine commande.</p>
        ${
          isResumeProcessing
            ? `<p class="editor-notice processing-inline">Votre paiement est en cours de confirmation. Ne relancez pas la demande.</p>`
            : ""
        }
        ${
          isPaused && !resumeRequiresPayment
            ? `<p class="editor-notice paused-notice">Préparez votre prochaine semaine avant de reprendre votre abonnement. Aucun prélèvement immédiat ne sera effectué.</p>`
            : ""
        }
        ${
          isPaused && resumeRequiresPayment
            ? `<p class="editor-notice paused-notice">Préparez votre prochaine semaine avant de reprendre votre abonnement. Vous serez débité uniquement après confirmation.</p>`
            : ""
        }
        ${
          selection.resumeBlockedMessage
            ? `<p class="error portal-error">${escapeHtml(selection.resumeBlockedMessage)}</p>`
            : `<p class="error meal-editor-error hidden"></p>`
        }
        <div class="meal-grid meal-editor-grid"></div>
        ${
          isPaused && !selection.resumeBlockedMessage && !isModificationBlocked
            ? `<button class="portal-button resume-button" disabled type="button">${escapeHtml(resumeButtonLabel)}</button>
        <p class="resume-note">${escapeHtml(resumeNote)}</p>`
            : ""
        }
        ${
          isResumeProcessing
            ? `<button class="portal-button secondary" disabled type="button">Paiement en cours de confirmation</button>`
            : ""
        }
        ${
          isActive
            ? `<button class="portal-button secondary cancel-button" type="button">Annuler</button>`
            : ""
        }
        ${
          isPaused && !isModificationBlocked
            ? `<button class="portal-button secondary save-button" disabled type="button">Valider ma semaine</button>`
            : ""
        }
      </div>
    </section>`;
};

const renderTerminalSelectionCard = (selection: PortalTerminalSelection) =>
  `<section class="portal-card terminal-selection-card" data-terminal-selection-id="${escapeHtml(selection.id)}">
      <div class="card-top">
        <h2>${escapeHtml(selection.boxTitle ?? "Abonnement terminé")}</h2>
        <span class="status-badge ${escapeHtml(getTerminalStatusBadgeClass(selection.status))}">${escapeHtml(selection.statusLabel)}</span>
      </div>
      <p class="terminal-notice muted">Cet abonnement est terminé. Aucune modification ni nouveau prélèvement n’est possible.</p>
      <div class="key-info-grid">
        <div class="key-info-item">
          <span class="key-info-label">Box</span>
          <span class="key-info-value">${escapeHtml(selection.boxTitle ?? "Non renseignée")}</span>
        </div>
        <div class="key-info-item">
          <span class="key-info-label">Nombre de repas</span>
          <span class="key-info-value">${selection.mealsCount}</span>
        </div>
        ${
          selection.shopifyOrderName
            ? `<div class="key-info-item">
          <span class="key-info-label">Première commande</span>
          <span class="key-info-value">${escapeHtml(selection.shopifyOrderName)}</span>
        </div>`
            : ""
        }
        ${
          selection.lastOrderDate
            ? `<div class="key-info-item">
          <span class="key-info-label">Dernière commande</span>
          <span class="key-info-value">${escapeHtml(formatFrenchDateTime(selection.lastOrderDate))}</span>
        </div>`
            : ""
        }
        <div class="key-info-item">
          <span class="key-info-label">Dernière mise à jour</span>
          <span class="key-info-value">${escapeHtml(formatFrenchDateTime(selection.updatedAt))}</span>
        </div>
      </div>
      <h3 class="section-heading">Dernière sélection enregistrée</h3>
      ${renderMealChips(selection.selectedMeals, "Aucun plat enregistré.")}
    </section>`;

const renderForecastCard = (
  cycle: PortalForecastCycle,
  cycleNumber: number,
) => `<article class="portal-card forecast-card">
      <div class="forecast-card-header">
        <h3>Box prévue ${cycleNumber}</h3>
        <span class="forecast-badge">Prévisionnel</span>
      </div>
      <p class="forecast-label muted">Prévision</p>
      <p><strong>Date estimée :</strong> ${escapeHtml(formatFrenchDate(cycle.estimatedBillingDate))}</p>
      <p><strong>Box :</strong> ${escapeHtml(cycle.boxTitle ?? "Non renseignée")}</p>
      <p><strong>Nombre de repas :</strong> ${cycle.mealsCount}</p>
      ${
        cycle.boxSubscriptionPrice
          ? `<p><strong>Prix abonnement :</strong> ${escapeHtml(formatSubscriptionPrice(cycle.boxSubscriptionPrice))}</p>`
          : ""
      }
    </article>`;

const renderHistoryCard = (order: PortalHistoryOrder) => {
  const fulfillmentLabel = formatFulfillmentStatus(order.fulfillmentStatus);
  const statusParts = [
    formatFinancialStatus(order.financialStatus),
    fulfillmentLabel,
  ].filter(Boolean);

  return `<article class="portal-card history-card">
      <h3>${escapeHtml(order.shopifyOrderName ?? "Commande")}</h3>
      <p><strong>Date de commande :</strong> ${escapeHtml(formatFrenchDateTime(order.orderDate))}</p>
      <p><strong>Box :</strong> ${escapeHtml(order.boxTitle ?? "Non renseignée")}</p>
      <p><strong>Prix :</strong> ${escapeHtml(formatOrderPrice(order.price))}</p>
      <p><strong>Statut :</strong> ${escapeHtml(statusParts.join(" · "))}</p>
      <h3 class="section-heading">Plats</h3>
      ${renderMealChips(order.selectedMeals, "Aucun plat enregistré.")}
      ${
        order.statusPageUrl
          ? `<p><a class="portal-button secondary history-order-link" href="${escapeHtml(order.statusPageUrl)}" rel="noopener noreferrer" target="_blank">Voir le suivi de commande</a></p>`
          : ""
      }
    </article>`;
};

export const renderPortal = ({
  boxes,
  errorMessage,
  historyOrders,
  meals,
  merchantSupport,
  processingMessage,
  selections,
  successMessage,
  terminalSelections,
}: {
  boxes: PortalBoxProduct[];
  errorMessage?: string | null;
  historyOrders: PortalHistoryOrder[];
  meals: PortalMeal[];
  merchantSupport: MerchantSupportContact;
  processingMessage?: string | null;
  selections: PortalSelection[];
  successMessage?: string | null;
  terminalSelections: PortalTerminalSelection[];
}) => {
  const initialQuantities = Object.fromEntries(
    selections.map((selection) => [
      selection.id,
      titlesToQuantities(
        selection.selectedMeals,
        selection.objective
          ? meals.filter((meal) => meal.objective === selection.objective)
          : [],
      ),
    ]),
  );

  const forecastCards = selections
    .filter((selection) => isPortalForecastEligible(selection.portalState))
    .flatMap((selection) => selection.forecastCycles)
    .map((cycle, index) => renderForecastCard(cycle, index + 1));
  const upcomingEmptyMessage = getUpcomingTabEmptyMessage(
    selections,
    forecastCards.length,
  );
  const hasManageable = selections.length > 0;
  const hasTerminal = terminalSelections.length > 0;
  const hasAnySubscription = hasManageable || hasTerminal;

  return htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mes box Mileyo</title>
  <style>${portalStyles}</style>
</head>
<body>
  <main class="portal-shell">
    <section class="portal-card portal-header">
      ${renderMileyoLogoImg("portal-logo")}
      <h1>Mes box Mileyo</h1>
      <p class="intro">
        Gérez votre prochaine box, consultez vos livraisons à venir et retrouvez l’historique de vos commandes — en toute clarté.
      </p>
      ${
        processingMessage
          ? `<p class="processing-notice">${escapeHtml(processingMessage)}</p>`
          : ""
      }
      ${
        successMessage
          ? `<p class="success">${escapeHtml(successMessage)}</p>`
          : ""
      }
      ${
        errorMessage
          ? `<p class="error portal-error">${escapeHtml(errorMessage)}</p>`
          : ""
      }
    </section>

    ${
      !hasAnySubscription
        ? `<section class="portal-card"><p>Aucun abonnement trouvé pour ton compte.</p></section>`
        : `<nav aria-label="Sections du portail" class="portal-tabs" role="tablist">
      <button aria-selected="true" class="portal-tab active" data-tab="next" role="tab" type="button">Ma prochaine box</button>
      <button aria-selected="false" class="portal-tab" data-tab="upcoming" role="tab" type="button">À venir</button>
      <button aria-selected="false" class="portal-tab" data-tab="history" role="tab" type="button">Historique</button>
      ${hasTerminal ? `<button aria-selected="false" class="portal-tab" data-tab="ended" role="tab" type="button">Abonnements terminés</button>` : ""}
    </nav>
    <div class="portal-tab-panel" data-tab-panel="next" role="tabpanel">
      ${
        hasManageable
          ? selections
              .map((selection) =>
                renderNextBoxCard({ boxes, merchantSupport, selection }),
              )
              .join("")
          : `<section class="portal-card"><p class="muted">Aucun abonnement actif ou en pause. Consultez l’onglet Abonnements terminés si votre abonnement a pris fin.</p></section>`
      }
    </div>
    <div class="portal-tab-panel hidden" data-tab-panel="upcoming" role="tabpanel">
      <section class="portal-card forecast-intro">
        <h2>Mes prochaines box</h2>
        <p class="intro">Vous pouvez modifier uniquement votre prochaine box. Les suivantes sont affichées à titre prévisionnel.</p>
      </section>
      ${
        forecastCards.length > 0
          ? forecastCards.join("")
          : `<section class="portal-card"><p class="muted">${escapeHtml(upcomingEmptyMessage ?? "Aucune prévision disponible pour le moment.")}</p></section>`
      }
    </div>
    <div class="portal-tab-panel hidden" data-tab-panel="history" role="tabpanel">
      <section class="portal-card history-intro">
        <h2>Historique</h2>
        <p class="intro">Vos commandes passées, confirmées et payées.</p>
      </section>
      ${
        historyOrders.length > 0
          ? historyOrders.map((order) => renderHistoryCard(order)).join("")
          : `<section class="portal-card"><p class="muted">Aucune commande passée pour le moment.</p></section>`
      }
    </div>
    ${
      hasTerminal
        ? `<div class="portal-tab-panel hidden" data-tab-panel="ended" role="tabpanel">
      <section class="portal-card terminal-intro">
        <h2>Abonnements terminés</h2>
        <p class="intro">Ces abonnements sont clos. Vos repas et commandes passées restent consultables, sans action possible.</p>
      </section>
      ${terminalSelections.map((selection) => renderTerminalSelectionCard(selection)).join("")}
    </div>`
        : ""
    }`
    }

    <p class="back-link"><a href="/apps/box-builder">← Retour au composeur de box</a></p>
  </main>

  <div
    aria-hidden="true"
    aria-labelledby="meal-nutrition-modal-title"
    class="meal-nutrition-modal hidden"
    id="meal-nutrition-modal"
    role="dialog"
  >
    <button aria-label="Fermer" class="meal-nutrition-modal-backdrop" type="button"></button>
    <div class="meal-nutrition-modal-panel">
      <div class="meal-nutrition-modal-head">
        <h2 id="meal-nutrition-modal-title">Informations nutritionnelles</h2>
        <button aria-label="Fermer" class="meal-nutrition-modal-close" type="button">×</button>
      </div>
      <p class="meal-nutrition-modal-meal" id="meal-nutrition-modal-meal"></p>
      <div class="meal-nutrition-modal-list" id="meal-nutrition-modal-list"></div>
    </div>
  </div>

  <script>window.__MILEYO_PORTAL__ = ${scriptJson({ boxes, initialQuantities, meals, selections })};</script>
  <script>${portalClientScript}</script>
</body>
</html>`);
};
