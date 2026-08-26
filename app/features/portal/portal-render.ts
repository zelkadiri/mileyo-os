import {
  buildMileyoPortalLoginUrl,
  MILEYO_PORTAL_PATH,
} from "../../constants/mileyoPortal";
import {
  BOX_CHANGE_NEXT_CYCLE_NO_EXTRA_CHARGE,
  BOX_CHANGE_NEXT_CYCLE_STEP1_NOTICE,
  BOX_CHANGE_NEXT_CYCLE_STEP1_TIMING,
  BOX_CHANGE_PENDING_CARD_COPY,
  BOX_CHANGE_PENDING_REPLACE_NOTICE,
  buildBoxChangeDowngradeNotice,
  buildBoxChangeFutureMealsNotice,
  buildCurrentMealEditorPendingNotice,
} from "../../constants/subscriptionBoxChange";
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
  PortalPendingBoxChange,
  PortalRecovery,
  PortalSelection,
  PortalSubscriptionState,
  PortalTerminalSelection,
  PortalBoxProduct,
} from "./portal-types";

const portalLoginHref = buildMileyoPortalLoginUrl(MILEYO_PORTAL_PATH);

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
      <h3 class="recovery-title">Mise à jour du paiement</h3>
      <p class="recovery-message">Pour reprendre vos livraisons, contactez-nous afin de mettre à jour votre moyen de paiement.</p>
      ${retryLine}
      <a class="portal-button recovery-contact-button" href="${escapeHtml(merchantSupport.href)}">${escapeHtml(merchantSupport.label)}</a>
    </div>`;
  }

  const message = recovery.isFinalFailed
    ? "Mettez à jour votre moyen de paiement pour reprendre vos livraisons."
    : "Le paiement de votre prochaine box n’a pas abouti.";

  return `<div class="recovery-block">
      <p class="recovery-message">${escapeHtml(message)}</p>
      ${retryLine}
      <button class="portal-button secondary payment-update-button" type="button">Recevoir un lien sécurisé pour mettre à jour ma carte</button>
      <p class="recovery-note muted">Nous vous enverrons un email sécurisé — aucune carte n’est affichée ici.</p>
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
          ? `<p><a class="portal-button" href="${escapeHtml(portalLoginHref)}">Se connecter</a></p>`
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
      return "";
    case "paused":
      return `<span class="status-badge paused">En pause</span>`;
    case "resume_processing":
      return `<span class="status-badge processing">Reprise en cours</span>`;
    default:
      return "";
  }
};

const HERO_MEAL_PREVIEW_LIMIT = 3;

/** Display-only aggregation — does not change persisted selectedMeals. */
const aggregateSelectedMealTitles = (meals: string[]) => {
  const order: string[] = [];
  const counts = new Map<string, number>();

  for (const title of meals) {
    const existing = counts.get(title);
    if (existing === undefined) {
      order.push(title);
      counts.set(title, 1);
      continue;
    }
    counts.set(title, existing + 1);
  }

  return order.map((title) => ({
    quantity: counts.get(title) ?? 1,
    title,
  }));
};

const renderMealChips = (meals: string[], emptyMessage: string) => {
  if (meals.length === 0) {
    return `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
  }

  return `<ul class="meal-chips">${meals
    .map((meal) => `<li class="meal-chip">${escapeHtml(meal)}</li>`)
    .join("")}</ul>`;
};

const findHeroMeal = (title: string, catalog: PortalMeal[]) =>
  catalog.find((meal) => meal.title === title) ?? null;

const renderHeroWeekCaption = (mealsCount: number, selectedCount: number) => {
  if (mealsCount <= 0) {
    return `<p class="hero-week-caption">Votre sélection</p>`;
  }

  if (selectedCount <= 0) {
    return `<p class="hero-week-caption">
      <span class="hero-week-count">${mealsCount} repas</span>
      <span class="hero-week-caption-copy">à composer pour votre prochaine livraison</span>
    </p>`;
  }

  const remaining = Math.max(0, mealsCount - selectedCount);
  const remainingCopy =
    remaining > 0
      ? `<span class="hero-week-caption-copy">· encore ${remaining} à choisir</span>`
      : `<span class="hero-week-caption-copy">pour cette livraison</span>`;

  return `<p class="hero-week-caption">
      <span class="hero-week-count">${selectedCount} repas</span>
      ${remainingCopy}
    </p>`;
};

/** Display-only meal preview for the next-box hero (history / terminal keep renderMealChips). */
const renderSelectedMealsSummary = (
  meals: string[],
  emptyMessage: string,
  mealsCount: number,
  catalog: PortalMeal[],
) => {
  const caption = renderHeroWeekCaption(mealsCount, meals.length);

  if (meals.length === 0) {
    return `<div class="meal-summary selection-preview selection-preview--empty">
      <div class="selection-preview-head">${caption}</div>
      <p class="muted selection-preview-empty">${escapeHtml(emptyMessage)}</p>
    </div>`;
  }

  const aggregated = aggregateSelectedMealTitles(meals);
  const visible = aggregated.slice(0, HERO_MEAL_PREVIEW_LIMIT);
  const overflowCount = aggregated.length - visible.length;

  const items = visible
    .map((item) => {
      const meal = findHeroMeal(item.title, catalog);
      const media = meal?.imageUrl
        ? `<img alt="${escapeHtml(meal.imageAlt || item.title)}" src="${escapeHtml(meal.imageUrl)}" />`
        : `<span class="hero-meal-preview-placeholder" aria-hidden="true"></span>`;
      const qtyBadge =
        item.quantity > 1
          ? `<span class="hero-meal-preview-qty">×${item.quantity}</span>`
          : "";

      return `<li class="hero-meal-preview-item">
        <span class="hero-meal-preview-media">${media}${qtyBadge}</span>
        <span class="hero-meal-preview-title">${escapeHtml(item.title)}</span>
      </li>`;
    })
    .join("");

  const overflowNote =
    overflowCount > 0
      ? `<p class="selection-preview-overflow">+ ${overflowCount} autre${overflowCount > 1 ? "s" : ""} plat${overflowCount > 1 ? "s" : ""} dans votre box</p>`
      : "";

  return `<div class="meal-summary selection-preview">
      <div class="selection-preview-head">${caption}</div>
      <ul class="hero-meal-preview">${items}</ul>
      ${overflowNote}
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

const renderHeroDelivery = (selection: PortalSelection) => {
  const deliveryLabel = formatScheduledDeliveryLabel(
    selection.nextScheduledDeliveryDate,
  );

  if (deliveryLabel) {
    return `<div class="hero-delivery">
        <span class="hero-delivery-label">Livraison</span>
        <span class="hero-delivery-value">${escapeHtml(deliveryLabel)}</span>
      </div>`;
  }

  return `<div class="hero-delivery">
      <span class="hero-delivery-label">Livraison</span>
      <span class="hero-delivery-value hero-delivery-value--pending">à confirmer</span>
    </div>`;
};

const renderSubscriptionSecondary = (selection: PortalSelection) => {
  const billingValue = selection.nextBillingDate
    ? escapeHtml(formatFrenchDate(selection.nextBillingDate))
    : `<span class="subscription-secondary-value--pending">À confirmer</span>`;

  return `<div class="subscription-secondary-facts">
      <div class="subscription-plan-group">
        <p class="subscription-current-label">Box actuelle</p>
        <p class="subscription-plan-box" data-current-box-meals="${selection.mealsCount}">${selection.mealsCount} repas</p>
        ${
          selection.objectiveLabel
            ? `<p class="subscription-plan-objective">${escapeHtml(selection.objectiveLabel)}</p>`
            : ""
        }
      </div>
      <div class="subscription-billing-group">
        ${
          selection.boxSubscriptionPrice
            ? `<p class="subscription-plan-price">${escapeHtml(formatSubscriptionPrice(selection.boxSubscriptionPrice))}</p>`
            : ""
        }
        <div class="subscription-billing-next">
          <span class="subscription-secondary-label">Prochain prélèvement</span>
          <span class="subscription-secondary-value">${billingValue}</span>
        </div>
      </div>
    </div>`;
};

const renderPendingBoxChangeNotice = (
  pending: PortalPendingBoxChange,
  currentMealsCount: number,
) => {
  const timingLabel = pending.effectiveBillingDate
    ? `À partir de votre prochain prélèvement du ${formatFrenchDate(pending.effectiveBillingDate)}`
    : "À partir du prochain cycle";
  const explainCopy =
    pending.mealsCount < currentMealsCount
      ? buildBoxChangeDowngradeNotice({
          currentMealsCount,
          targetMealsCount: pending.mealsCount,
        })
      : BOX_CHANGE_PENDING_CARD_COPY;

  return `<div
      class="pending-box-notice"
      data-pending-box-meals="${pending.mealsCount}"
      data-pending-box-variant="${escapeHtml(pending.productVariantId)}"
    >
      <p class="pending-box-notice-kicker">Prochaine box</p>
      <p class="pending-box-notice-meals">${pending.mealsCount} repas</p>
      <p class="pending-box-notice-timing">${escapeHtml(timingLabel)}</p>
      ${
        pending.boxSubscriptionPrice
          ? `<p class="pending-box-notice-price">Prochain prélèvement : ${escapeHtml(formatOrderPrice(pending.boxSubscriptionPrice))}</p>`
          : ""
      }
      <p class="pending-box-notice-copy">${escapeHtml(explainCopy)}</p>
    </div>`;
};

const renderNextBoxCard = ({
  boxes,
  meals,
  merchantSupport,
  selection,
}: {
  boxes: PortalBoxProduct[];
  meals: PortalMeal[];
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
    !isResumeProcessing &&
    !selection.boxChangeBlocked &&
    pickerBoxes.length > 0;
  const pending = selection.pendingBoxChange;
  const appliesNextCycle = selection.boxChangeAppliesNextCycle;
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
  const mealsForHero = selection.objective
    ? meals.filter((meal) => meal.objective === selection.objective)
    : meals;

  const boxChangeStep1Notices = appliesNextCycle
    ? `<p class="editor-notice box-change-next-cycle-notice">${escapeHtml(BOX_CHANGE_NEXT_CYCLE_STEP1_NOTICE)}</p>
          <p class="editor-notice">${escapeHtml(BOX_CHANGE_NEXT_CYCLE_STEP1_TIMING)}</p>
          <p class="editor-notice">${escapeHtml(BOX_CHANGE_NEXT_CYCLE_NO_EXTRA_CHARGE)}</p>`
    : `<p class="editor-notice">Ce changement sera appliqué à votre prochaine commande.</p>
          <p class="editor-notice">Le prix de votre prochain prélèvement sera ajusté selon la box choisie.</p>`;

  const boxChangeStep2Title = appliesNextCycle
    ? "Choisissez les plats de votre prochaine box"
    : "Choisissez vos plats pour cette box";
  const boxChangeStep2Notice = appliesNextCycle
    ? buildBoxChangeFutureMealsNotice(selection.mealsCount)
    : "Votre sélection de plats doit être refaite pour cette nouvelle box.";

  return `<section class="portal-card selection-card${mealEditorOpenByDefault ? " is-meal-editing" : ""}" data-selection-id="${escapeHtml(selection.id)}" data-current-box-meals="${selection.mealsCount}"${pending ? ` data-pending-box-meals="${pending.mealsCount}"` : ""}${appliesNextCycle ? ` data-box-change-applies-next-cycle="true"` : ""}>
      <section class="portal-layout">
      <div class="portal-main-column">
      <section class="portal-section next-box-section">
      <div class="next-box-hero">
        <div class="hero-intro">
          <div class="hero-header">
            <p class="hero-kicker">Ma prochaine box</p>
            ${renderPortalSubscriptionStatus(portalState)}
          </div>
          <h2 class="hero-week-title">Votre semaine</h2>
          ${renderHeroDelivery(selection)}
        </div>
        ${renderSelectedMealsSummary(
          selection.selectedMeals,
          "Aucun plat sélectionné pour le moment.",
          selection.mealsCount,
          mealsForHero,
        )}
        ${
          isActive && !isModificationBlocked
            ? `<div class="hero-primary-actions">
          <button class="portal-button edit-button" type="button">Préparer ma semaine</button>
        </div>`
            : ""
        }
        ${renderDeliveryCutoffNotice(selection)}
      </div>
      </section>
      <section class="portal-section meal-preparation-section">
      <div class="editor${mealEditorOpenByDefault ? " paused-editor" : " hidden"}">
        <div class="editor-heading">
          <div class="editor-heading-copy">
            <h3>Préparer votre prochaine semaine</h3>
            <div class="meal-week-progress">
              <div class="meal-week-progress-copy">
                <p class="meal-week-progress-label">Votre semaine</p>
                <p class="selected-count meal-editor-count" aria-live="polite" data-current-meal-count="${selection.mealsCount}">0 / ${selection.mealsCount} repas</p>
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
        </div>
        <p class="editor-notice">Vos choix s’appliquent à la prochaine livraison.</p>
        ${
          pending
            ? `<p class="editor-notice meal-editor-pending-notice">${escapeHtml(buildCurrentMealEditorPendingNotice(pending.mealsCount))}</p>`
            : ""
        }
        ${
          isPaused && !resumeRequiresPayment
            ? `<p class="editor-notice paused-notice">Préparez votre semaine, puis reprenez. Aucun prélèvement immédiat.</p>`
            : ""
        }
        ${
          isPaused && resumeRequiresPayment
            ? `<p class="editor-notice paused-notice">Préparez votre semaine, puis reprenez. Le paiement n’a lieu qu’après confirmation.</p>`
            : ""
        }
        ${
          selection.resumeBlockedMessage
            ? `<p class="error portal-error">${escapeHtml(selection.resumeBlockedMessage)}</p>`
            : `<p class="error meal-editor-error hidden"></p>`
        }
        <div class="meal-filters-panel meal-editor-filters">
          <div class="meal-filters-panel-head">
            <button
              aria-controls="portal-meal-filters-drawer"
              aria-expanded="false"
              aria-haspopup="dialog"
              aria-label="Filtres"
              class="meal-filters-toggle"
              type="button"
            >
              <span aria-hidden="true" class="meal-filters-toggle-icon">
                <svg fill="currentColor" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 .8 1.6L15 12.5V19a1 1 0 0 1-1.45.89l-4-2A1 1 0 0 1 9 17v-4.5L3.2 5.6A1 1 0 0 1 3 5z"/>
                </svg>
              </span>
              <span class="meal-filters-toggle-label">Filtres</span>
              <span aria-hidden="true" class="meal-filters-toggle-count hidden"></span>
            </button>
          </div>
        </div>
        <div class="meals-empty meal-editor-empty hidden">
          <p class="meal-editor-empty-copy">Aucun plat ne correspond à ces filtres.<br>Essayez de retirer un allergène ou une envie.</p>
          <button class="meals-empty-reset meal-editor-empty-reset" type="button">Réinitialiser les filtres</button>
        </div>
        <div class="meal-grid meal-editor-grid"></div>
        ${
          isPaused && !selection.resumeBlockedMessage && !isModificationBlocked
            ? `<p class="resume-note">${escapeHtml(resumeNote)}</p>`
            : ""
        }
        ${
          isResumeProcessing
            ? `<button class="portal-button secondary" disabled type="button">Paiement en cours de confirmation</button>`
            : ""
        }
        ${
          isActive
            ? `<div class="meal-editor-actions">
          <button class="portal-button secondary cancel-button" type="button">Annuler</button>
          <button class="portal-button save-button" disabled type="button">Valider ma semaine</button>
        </div>`
            : ""
        }
        ${
          isPaused && !isModificationBlocked
            ? `<div class="meal-editor-actions">
          ${
            !selection.resumeBlockedMessage
              ? `<button class="portal-button resume-button" disabled type="button">${escapeHtml(resumeButtonLabel)}</button>`
              : ""
          }
          <button class="portal-button secondary save-button" disabled type="button">Valider ma semaine</button>
        </div>`
            : ""
        }
      </div>
      </section>
      <section class="portal-section box-change-section" data-box-change-host="main">
      <div
        class="box-change-editor hidden"
        data-applies-next-cycle="${appliesNextCycle ? "true" : "false"}"
        data-current-meals-count="${selection.mealsCount}"
        ${pending ? `data-has-pending="true"` : ""}
      >
        <div class="box-change-step" data-step="1">
          <h3>Choisir une nouvelle box</h3>
          ${
            pending
              ? `<p class="editor-notice box-change-replace-notice">${escapeHtml(BOX_CHANGE_PENDING_REPLACE_NOTICE)}</p>`
              : ""
          }
          ${boxChangeStep1Notices}
          <div class="box-grid">${renderBoxPickerCards(pickerBoxes, selection.currentVariantId)}</div>
          <p class="error box-change-error hidden"></p>
          <button class="portal-button secondary box-change-cancel" type="button">Annuler</button>
        </div>
        <div class="box-change-step hidden" data-step="2">
          <h3 class="box-change-meal-title">${escapeHtml(boxChangeStep2Title)}</h3>
          <p class="editor-notice box-change-meal-notice">${escapeHtml(boxChangeStep2Notice)}</p>
          <p class="box-change-selected-box muted"></p>
          <p class="selected-count box-change-count" data-box-change-target-count="0">0 / 0 plats sélectionnés</p>
          <p class="error box-change-error hidden"></p>
          <div class="meal-grid box-change-meal-grid"></div>
          <div class="box-change-actions">
            <button class="portal-button secondary box-change-back" type="button">Retour</button>
            ${
              isActive
                ? `<button class="portal-button box-change-confirm" disabled type="button">Confirmer ma nouvelle box pour la prochaine commande</button>`
                : `<button class="portal-button box-change-confirm" disabled type="button">Enregistrer ma nouvelle box</button>`
            }
          </div>
        </div>
      </div>
      </section>
      </div>
      <aside class="portal-side-column">
      <section class="portal-section subscription-section">
      <div class="subscription-secondary">
        <p class="subscription-secondary-title">Votre formule</p>
        ${renderSubscriptionSecondary(selection)}
        ${pending ? renderPendingBoxChangeNotice(pending, selection.mealsCount) : ""}
      </div>
      </section>
      ${
        selection.recovery ||
        isResumeProcessing ||
        (isModificationBlocked && modificationBlockedReason)
          ? `<section class="portal-section recovery-section">
      ${
        selection.recovery
          ? renderRecoveryBlock(selection.recovery, merchantSupport)
          : ""
      }
      ${
        isResumeProcessing
          ? `<p class="processing-notice">La confirmation est en cours. Pas besoin de relancer.</p>`
          : ""
      }
      ${
        isModificationBlocked && modificationBlockedReason
          ? `<p class="muted modification-blocked">${escapeHtml(modificationBlockedReason)}</p>`
          : ""
      }
      </section>`
          : ""
      }
      <section class="portal-section manage-section">
      <div class="subscription-manage">
        <p class="subscription-manage-title">Paramètres</p>
        <div class="settings-menu">
        ${
          canChangeBox
            ? `<button class="settings-row change-box-button" type="button">
          <span class="settings-row-copy">
            <span class="settings-row-label">Changer de box</span>
            <span class="settings-row-hint">Adapter le nombre de repas</span>
          </span>
          <span class="settings-row-chevron" aria-hidden="true"></span>
        </button>`
            : selection.boxChangeBlocked && selection.boxChangeBlockedReason
              ? `<p class="muted box-change-blocked" data-box-change-blocked="true">${escapeHtml(selection.boxChangeBlockedReason)}</p>`
              : ""
        }
        ${
          isActive && !isModificationBlocked
            ? `<button class="settings-row pause-button" type="button">
          <span class="settings-row-copy">
            <span class="settings-row-label">Mettre mon abonnement en pause</span>
            <span class="settings-row-hint">Suspendre les prochaines livraisons</span>
          </span>
          <span class="settings-row-chevron" aria-hidden="true"></span>
        </button>`
            : ""
        }
        <div class="objective-support">
          <button class="settings-row change-objective-button" type="button">
            <span class="settings-row-copy">
              <span class="settings-row-label">Changer d'objectif</span>
              <span class="settings-row-hint">Avec l’aide de notre équipe</span>
            </span>
            <span class="settings-row-chevron" aria-hidden="true"></span>
          </button>
          <div class="objective-support-panel hidden">
            <p class="objective-support-message">Le changement d'objectif nécessite l'aide de notre équipe afin d'adapter votre abonnement. Contactez-nous via le chat.</p>
            <a class="portal-button objective-support-contact" href="${escapeHtml(merchantSupport.href)}">Contacter le support</a>
          </div>
        </div>
        </div>
      </div>
      </section>
      <section class="portal-section dietitian-section">
        <div class="dietitian-card">
          <p class="dietitian-title">Votre diététicienne</p>
          <p class="dietitian-lead">Une question sur vos repas ?</p>
          <p class="dietitian-copy">Discutez avec votre diététicienne</p>
          <a
            class="portal-button secondary dietitian-chat-button"
            href="${escapeHtml(merchantSupport.href)}"
            rel="noopener noreferrer"
            target="_blank"
          >
            Ouvrir le chat
          </a>
        </div>
      </section>
      </aside>
      </section>
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
  boxChangeEffect,
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
  /** BOX-CHANGE-3: immediate apply vs pending next-cycle (for BOX-CHANGE-6 UX). */
  boxChangeEffect?: "immediate" | "next_cycle" | null;
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

  const headerFlash = [
    processingMessage
      ? `<p class="processing-notice">${escapeHtml(processingMessage)}</p>`
      : "",
    successMessage
      ? `<p class="success"${
          boxChangeEffect
            ? ` data-box-change-effect="${escapeHtml(boxChangeEffect)}"`
            : ""
        }>${escapeHtml(successMessage)}</p>`
      : "",
    errorMessage
      ? `<p class="error portal-error">${escapeHtml(errorMessage)}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mileyo</title>
  <style>${portalStyles}</style>
</head>
<body>
  <main class="portal-shell">
    <header class="portal-header">
      ${renderMileyoLogoImg("portal-logo")}
      ${headerFlash ? `<div class="portal-header-flash">${headerFlash}</div>` : ""}
    </header>

    ${
      !hasAnySubscription
        ? `<section class="portal-card"><p>Aucun abonnement trouvé pour ton compte.</p></section>`
        : `<nav aria-label="Sections du portail" class="portal-tabs" role="tablist">
      <button aria-selected="true" class="portal-tab active" data-tab="next" role="tab" type="button">Ma box</button>
      <button aria-selected="false" class="portal-tab" data-tab="upcoming" role="tab" type="button">À venir</button>
      <button aria-selected="false" class="portal-tab" data-tab="history" role="tab" type="button">Historique</button>
      ${hasTerminal ? `<button aria-selected="false" class="portal-tab" data-tab="ended" role="tab" type="button">Terminés</button>` : ""}
    </nav>
    <div class="portal-tab-panel" data-tab-panel="next" role="tabpanel">
      ${
        hasManageable
          ? selections
              .map((selection) =>
                renderNextBoxCard({ boxes, meals, merchantSupport, selection }),
              )
              .join("")
          : `<section class="portal-card"><p class="muted">Aucun abonnement actif ou en pause. Consultez l’onglet Terminés si votre abonnement a pris fin.</p></section>`
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
    class="meal-filters-drawer hidden"
    id="portal-meal-filters-drawer"
  >
    <button aria-label="Fermer les filtres" class="meal-filters-drawer-backdrop" type="button"></button>
    <aside
      aria-labelledby="portal-meal-filters-drawer-title"
      class="meal-filters-drawer-panel"
      id="portal-meal-filters-drawer-panel"
      role="dialog"
    >
      <div class="meal-filters-drawer-head">
        <h2 class="meal-filters-drawer-title" id="portal-meal-filters-drawer-title">Filtrer les plats</h2>
        <button aria-label="Fermer" class="meal-filters-drawer-close" type="button">×</button>
      </div>
      <div class="meal-filters-drawer-scroll" id="portal-meal-filters-body">
        <div class="meal-filter-row">
          <span class="meal-filter-label">Mes envies</span>
          <div class="meal-filter-options" id="portal-badge-filters" role="group" aria-label="Envies et badges"></div>
        </div>
        <div class="meal-filter-row">
          <span class="meal-filter-label">J'évite</span>
          <div class="meal-filter-options" id="portal-allergen-filters" role="group" aria-label="Allergènes à éviter"></div>
        </div>
        <button class="meal-filters-reset hidden" id="portal-meal-filters-reset" type="button">Réinitialiser</button>
      </div>
      <div class="meal-filters-drawer-footer">
        <button class="meal-filters-apply" id="portal-meal-filters-apply" type="button">Appliquer</button>
      </div>
    </aside>
  </div>

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

  <div
    aria-hidden="true"
    class="meal-detail-overlay hidden"
    id="meal-detail-overlay"
  >
    <button aria-label="Fermer" class="meal-detail-overlay-backdrop" type="button"></button>
    <aside
      aria-labelledby="meal-detail-title"
      class="meal-detail-drawer"
      id="meal-detail-drawer"
      role="dialog"
    >
      <div aria-hidden="true" class="meal-detail-handle">
        <span class="meal-detail-handle-bar"></span>
      </div>
      <button aria-label="Fermer" class="meal-detail-close" type="button">×</button>
      <div class="meal-detail-scroll">
        <div class="meal-detail-media" id="meal-detail-media"></div>
        <h2 class="meal-detail-title" id="meal-detail-title"></h2>
        <div class="meal-badges meal-detail-badges hidden" id="meal-detail-badges"></div>
        <div class="meal-detail-nutrition hidden" id="meal-detail-nutrition"></div>
        <div class="meal-detail-allergens hidden" id="meal-detail-allergens">
          <p class="meal-detail-section-heading">Allergènes</p>
          <p class="meal-detail-allergens-lead">Contient :</p>
          <p class="meal-detail-allergens-copy" id="meal-detail-allergens-copy"></p>
        </div>
        <div class="meal-detail-ingredients hidden" id="meal-detail-ingredients">
          <p class="meal-detail-section-heading meal-detail-ingredients-heading">Ingrédients</p>
          <p class="meal-detail-ingredients-copy" id="meal-detail-ingredients-copy"></p>
        </div>
      </div>
    </aside>
  </div>

  <script>window.__MILEYO_PORTAL__ = ${scriptJson({ boxes, initialQuantities, meals, selections })};</script>
  <script>${portalClientScript}</script>
</body>
</html>`);
};
