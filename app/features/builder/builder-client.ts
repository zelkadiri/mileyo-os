import { FIRST_BOX_LAUNCH_DISCOUNT_EUR } from "../../constants/firstBoxLaunchDiscount";
import { mealNutritionFormatRuntimeScript } from "../../utils/mealNutritionFormat";
import { mealFilterRuntimeScript } from "./builder-filter-runtime";
import {
  BUILDER_CART_PREPARE_ERROR,
} from "./builder-cart";
import {
  CAPTURE_CHECKOUT_LEAD_INTENT,
  CREATE_BUILDER_CHECKOUT_INTENT,
} from "./builder-email";
import {
  BUILDER_STEP_COUNT,
  getBuilderStepLabel,
  getBuilderStepProgressPercent,
} from "./builder-objective-options";

const builderStepLabelsJson = JSON.stringify({
  email: getBuilderStepLabel("email"),
  formule: getBuilderStepLabel("formule"),
  livraison: getBuilderStepLabel("livraison"),
  objectif: getBuilderStepLabel("objectif"),
  repas: getBuilderStepLabel("repas"),
});

const builderStepProgressJson = JSON.stringify({
  email: getBuilderStepProgressPercent("email"),
  formule: getBuilderStepProgressPercent("formule"),
  livraison: getBuilderStepProgressPercent("livraison"),
  objectif: getBuilderStepProgressPercent("objectif"),
  repas: getBuilderStepProgressPercent("repas"),
});

export const builderClientScript = `
(function () {
  var data = window.__MILEYO_BOX_BUILDER__;
  var selectedObjective = null;
  var selectedBox = null;
  var requiredMeals = 0;
  var selectedMeals = {};
  var selectedDeliveryWindowKey = null;
  var selectedScheduledDeliveryDate = null;
  var selectedEmail = "";
  var capturedLeadKey = "";
  var currentStep = "objectif";
  var isSubmittingLead = false;
  var isSubmittingCheckout = false;
  var mealsRendered = false;
  var RECOMMENDED_MEAL_COUNT = 12;
  var STEP_COUNT = ${BUILDER_STEP_COUNT};
  var STEP_LABELS = ${builderStepLabelsJson};
  var STEP_PROGRESS = ${builderStepProgressJson};
  var LAUNCH_DISCOUNT_EUR = ${FIRST_BOX_LAUNCH_DISCOUNT_EUR};

  var boxGrid = document.getElementById("box-grid");
  var boxRailViewport = document.getElementById("box-rail-viewport");
  var boxRailPrev = document.getElementById("box-rail-prev");
  var boxRailNext = document.getElementById("box-rail-next");
  var mealGrid = document.getElementById("meal-grid");
  var mealsSection = document.getElementById("meals-section");
  var stepObjective = document.getElementById("step-objective");
  var stepFormula = document.getElementById("step-formula");
  var stepDelivery = document.getElementById("step-delivery");
  var stepMeals = document.getElementById("step-meals");
  var objectiveGrid = document.getElementById("objective-grid");
  var selectedCount = document.getElementById("selected-count");
  var addToCart = document.getElementById("add-to-cart");
  var boxHelper = document.getElementById("box-helper");
  var errorMessage = document.getElementById("error-message");
  var tunnelBack = document.getElementById("tunnel-back");
  var tunnelPromo = document.getElementById("tunnel-promo");
  var tunnelPromoDismiss = document.getElementById("tunnel-promo-dismiss");
  var tunnelStepLabel = document.getElementById("tunnel-step-label");
  var tunnelProgressFill = document.getElementById("tunnel-progress-fill");
  var objectiveContinue = document.getElementById("objective-continue");
  var objectiveFooter = document.getElementById("objective-footer");
  var formulaContinue = document.getElementById("formula-continue");
  var formulaFooter = document.getElementById("formula-footer");
  var deliveryContinue = document.getElementById("delivery-continue");
  var deliveryFooter = document.getElementById("delivery-footer");
  var deliveryWindowGrid = document.getElementById("delivery-window-grid");
  var mealsLead = document.getElementById("meals-lead");
  var allergenFilters = document.getElementById("allergen-filters");
  var badgeFilters = document.getElementById("badge-filters");
  var mealFiltersReset = document.getElementById("meal-filters-reset");
  var mealFiltersToggle = document.getElementById("meal-filters-toggle");
  var mealFiltersDrawer = document.getElementById("meal-filters-drawer");
  var mealFiltersApply = document.getElementById("meal-filters-apply");
  var mealFiltersActiveCount = document.getElementById("meal-filters-active-count");
  var mealFiltersCloseTimer = null;
  var mealsEmpty = document.getElementById("meals-empty");
  var mealsEmptyCopy = document.getElementById("meals-empty-copy");
  var mealsEmptyReset = document.getElementById("meals-empty-reset");
  var mealsGaugeFooter = document.getElementById("meals-gauge-footer");
  var emailFooter = document.getElementById("email-footer");
  var emailContinue = document.getElementById("email-continue");
  var emailInput = document.getElementById("checkout-email");
  var emailMiniRecapBox = document.getElementById("email-mini-recap-box");
  var emailMiniRecapObjective = document.getElementById("email-mini-recap-objective");
  var emailMiniRecapDelivery = document.getElementById("email-mini-recap-delivery");
  var emailMiniRecapMeals = document.getElementById("email-mini-recap-meals");
  var emailMiniRecapPrice = document.getElementById("email-mini-recap-price");
  var CAPTURE_LEAD_INTENT = ${JSON.stringify(CAPTURE_CHECKOUT_LEAD_INTENT)};
  var CREATE_CHECKOUT_INTENT = ${JSON.stringify(CREATE_BUILDER_CHECKOUT_INTENT)};
  var CART_PREPARE_ERROR = ${JSON.stringify(BUILDER_CART_PREPARE_ERROR)};
  var mealDetailDrawer = document.getElementById("meal-detail-drawer");
  var mealDetailDrawerMedia = document.getElementById("meal-detail-drawer-media");
  var mealDetailDrawerTitle = document.getElementById("meal-detail-drawer-title");
  var mealDetailDrawerBadges = document.getElementById("meal-detail-drawer-badges");
  var mealDetailDrawerAllergens = document.getElementById("meal-detail-drawer-allergens");
  var mealDetailDrawerDescription = document.getElementById("meal-detail-drawer-description");
  var mealDetailDrawerNutrition = document.getElementById("meal-detail-drawer-nutrition");
  var mealDetailDrawerCloseTimer = null;
  var selectedAllergenFilters = [];
  var selectedBadgeFilters = [];
  var draftAllergenFilters = [];
  var draftBadgeFilters = [];
  var mealFiltersOpen = false;

  ${mealFilterRuntimeScript}
  ${mealNutritionFormatRuntimeScript}

  function getDeliveryWindowOptions() {
    if (!data.deliveryConfig || !data.deliveryConfig.deliveryWindowOptions) {
      return [];
    }
    return data.deliveryConfig.deliveryWindowOptions;
  }

  function findDeliveryWindowOption(key) {
    return getDeliveryWindowOptions().find(function (option) {
      return option.key === key;
    }) || null;
  }

  function isSelectedDeliveryWindowValid() {
    if (!selectedDeliveryWindowKey || !selectedScheduledDeliveryDate) {
      return false;
    }
    var option = findDeliveryWindowOption(selectedDeliveryWindowKey);
    return Boolean(
      option &&
        option.scheduledDeliveryDate === selectedScheduledDeliveryDate,
    );
  }

  function renderDeliveryWindows() {
    if (!deliveryWindowGrid || !data.deliveryConfig) return;
    deliveryWindowGrid.innerHTML = "";
    getDeliveryWindowOptions().forEach(function (option) {
      var button = document.createElement("button");
      var isSelected = selectedDeliveryWindowKey === option.key;
      button.className =
        "delivery-window-card" + (isSelected ? " selected" : "");
      button.type = "button";
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");

      var title = document.createElement("span");
      title.className = "delivery-window-card-title";
      title.textContent = option.cardLabel;
      button.appendChild(title);

      var range = document.createElement("span");
      range.className = "delivery-window-card-range";
      range.textContent = option.rangeLabel;
      button.appendChild(range);

      button.addEventListener("click", function () {
        selectedDeliveryWindowKey = option.key;
        selectedScheduledDeliveryDate = option.scheduledDeliveryDate;
        renderDeliveryWindows();
        updateDeliveryCta();
        setError("");
      });
      deliveryWindowGrid.appendChild(button);
    });
  }

  function updateDeliveryCta() {
    if (!deliveryContinue) return;
    if (!isSelectedDeliveryWindowValid()) {
      deliveryContinue.disabled = true;
      deliveryContinue.textContent = "Choisissez une fenêtre de livraison";
      return;
    }
    deliveryContinue.disabled = false;
    deliveryContinue.textContent = "Continuer vers mes repas →";
  }

  function formatEuros(price) {
    if (!price && price !== 0) return "";
    var value = Number(price);
    if (Number.isNaN(value)) return price;
    return new Intl.NumberFormat("fr-FR", {
      currency: "EUR",
      style: "currency"
    }).format(value);
  }

  function formatEurosFromCents(cents) {
    if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
    return formatEuros(cents / 100);
  }

  /** UI-only label for formula cards — mealCount numeric identity unchanged elsewhere. */
  function formatBoxMealCountDisplay(mealCount) {
    if (mealCount === 16 || mealCount === 20 || mealCount === 24) {
      return mealCount + " repas (Duo)";
    }
    return mealCount + " repas";
  }

  function parsePriceToCents(price) {
    if (typeof price === "number") {
      if (!Number.isFinite(price) || price < 0) return null;
      return Math.round(price * 100);
    }
    if (price == null) return null;
    var trimmed = String(price).trim().replace(",", ".");
    if (!trimmed) return null;
    var amount = Number.parseFloat(trimmed);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100);
  }

  /** Display-only launch pricing — never billed, never sent to cart. */
  function getBuilderLaunchPricing(regularPrice, mealCount) {
    if (
      typeof mealCount !== "number" ||
      !Number.isFinite(mealCount) ||
      mealCount <= 0 ||
      !Number.isInteger(mealCount)
    ) {
      return null;
    }
    var regularPriceCents = parsePriceToCents(regularPrice);
    if (regularPriceCents == null) return null;
    var discountCents = Math.round(LAUNCH_DISCOUNT_EUR * 100);
    var launchPriceCents = Math.max(0, regularPriceCents - discountCents);
    return {
      launchPriceCents: launchPriceCents,
      launchPricePerMealCents: Math.round(launchPriceCents / mealCount),
      regularPriceCents: regularPriceCents
    };
  }

  function isBoxAvailable(box) {
    return typeof box.mealCount === "number" && box.mealCount > 0 && Boolean(box.sellingPlanId);
  }

  function getBoxesForSelectedObjective() {
    if (!selectedObjective || !data.boxes) return [];
    return data.boxes.filter(function (box) {
      return box.objective === selectedObjective;
    });
  }

  function sortBoxes(boxes) {
    return boxes.slice().sort(function (a, b) {
      var aCount = a.mealCount || 0;
      var bCount = b.mealCount || 0;
      if (aCount !== bCount) return aCount - bCount;
      return String(a.variantTitle || "").localeCompare(String(b.variantTitle || ""), "fr");
    });
  }

  function isRecommendedBox(box) {
    return isBoxAvailable(box) && box.mealCount === RECOMMENDED_MEAL_COUNT;
  }

  function resetBoxSelectionState() {
    selectedBox = null;
    requiredMeals = 0;
    selectedMeals = {};
    mealsRendered = false;
    if (boxHelper) {
      boxHelper.textContent = "Choisissez votre box";
    }
  }

  function setSelectedObjective(nextObjective) {
    var previous = selectedObjective;
    selectedObjective = nextObjective;
    if (
      previous !== nextObjective &&
      selectedBox &&
      selectedBox.objective !== selectedObjective
    ) {
      resetBoxSelectionState();
    }
  }

  function isValidObjective(value) {
    if (!value || !data.objectives || !data.objectives.length) return false;
    return data.objectives.some(function (option) {
      return option.value === value;
    });
  }

  function updateObjectiveCta() {
    if (!objectiveContinue) return;
    if (!isValidObjective(selectedObjective)) {
      objectiveContinue.disabled = true;
      objectiveContinue.textContent = "Choisissez votre objectif";
      return;
    }
    objectiveContinue.disabled = false;
    objectiveContinue.textContent = "Continuer →";
  }

  function renderObjectives() {
    if (!objectiveGrid || !data.objectives) return;
    objectiveGrid.innerHTML = "";
    data.objectives.forEach(function (option) {
      var button = document.createElement("button");
      var isSelected = selectedObjective === option.value;
      button.className = "objective-card" + (isSelected ? " selected" : "");
      button.type = "button";
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");

      var label = document.createElement("span");
      label.className = "objective-card-label";
      label.textContent = option.label;
      button.appendChild(label);

      var description = document.createElement("span");
      description.className = "objective-card-description";
      description.textContent = option.description;
      button.appendChild(description);

      var priceInfo =
        data.objectiveStartingPriceLabels &&
        data.objectiveStartingPriceLabels[option.value];
      if (priceInfo) {
        var pricingBlock = document.createElement("div");
        pricingBlock.className = "objective-card-pricing";

        if (priceInfo.launchLine) {
          var launchPrice = document.createElement("span");
          launchPrice.className = "objective-card-launch-price";
          launchPrice.textContent = priceInfo.launchLine;
          pricingBlock.appendChild(launchPrice);

          var recurringPrice = document.createElement("span");
          recurringPrice.className = "objective-card-recurring-price";
          recurringPrice.textContent = priceInfo.recurringLine;
          pricingBlock.appendChild(recurringPrice);
        } else if (priceInfo.recurringLine) {
          var startingPrice = document.createElement("span");
          startingPrice.className = "objective-card-starting-price";
          startingPrice.textContent = priceInfo.recurringLine;
          pricingBlock.appendChild(startingPrice);
        }

        button.appendChild(pricingBlock);
      }

      if (isSelected) {
        var badge = document.createElement("span");
        badge.className = "selected-badge";
        badge.textContent = "Sélectionné";
        button.appendChild(badge);
      }

      button.addEventListener("click", function () {
        setSelectedObjective(option.value);
        renderObjectives();
        updateObjectiveCta();
        setError("");
      });

      objectiveGrid.appendChild(button);
    });
  }

  function getMealsForSelectedObjective() {
    if (!selectedObjective || !data.meals) return [];
    return data.meals.filter(function (meal) {
      return meal.objective === selectedObjective;
    });
  }

  function getVisibleMeals() {
    return getMealsForSelectedObjective().filter(mealMatchesFilter);
  }

  function cloneMealFilterIds(ids) {
    return ids.slice();
  }

  function hasActiveMealFilters() {
    return selectedAllergenFilters.length > 0 || selectedBadgeFilters.length > 0;
  }

  function hasDraftMealFilters() {
    return draftAllergenFilters.length > 0 || draftBadgeFilters.length > 0;
  }

  function activeMealFilterCount() {
    return selectedAllergenFilters.length + selectedBadgeFilters.length;
  }

  function syncMealFiltersDraftFromSelected() {
    draftAllergenFilters = cloneMealFilterIds(selectedAllergenFilters);
    draftBadgeFilters = cloneMealFilterIds(selectedBadgeFilters);
  }

  function setMealFiltersOpen(isOpen) {
    mealFiltersOpen = Boolean(isOpen);
    if (!mealFiltersDrawer) {
      if (mealFiltersToggle) {
        mealFiltersToggle.setAttribute(
          "aria-expanded",
          mealFiltersOpen ? "true" : "false",
        );
        mealFiltersToggle.classList.toggle("is-open", mealFiltersOpen);
      }
      return;
    }

    if (mealFiltersToggle) {
      mealFiltersToggle.setAttribute(
        "aria-expanded",
        mealFiltersOpen ? "true" : "false",
      );
      mealFiltersToggle.classList.toggle("is-open", mealFiltersOpen);
    }

    if (mealFiltersOpen) {
      if (mealFiltersCloseTimer) {
        window.clearTimeout(mealFiltersCloseTimer);
        mealFiltersCloseTimer = null;
      }
      mealFiltersDrawer.classList.remove("hidden");
      mealFiltersDrawer.setAttribute("aria-hidden", "false");
      mealFiltersDrawer.setAttribute("aria-modal", "true");
      window.requestAnimationFrame(function () {
        mealFiltersDrawer.classList.add("is-open");
      });
      return;
    }

    mealFiltersDrawer.classList.remove("is-open");
    mealFiltersDrawer.setAttribute("aria-hidden", "true");
    mealFiltersDrawer.removeAttribute("aria-modal");
    if (mealFiltersCloseTimer) {
      window.clearTimeout(mealFiltersCloseTimer);
    }
    mealFiltersCloseTimer = window.setTimeout(function () {
      mealFiltersDrawer.classList.add("hidden");
      mealFiltersCloseTimer = null;
    }, 320);
  }

  function openMealFiltersDrawer() {
    syncMealFiltersDraftFromSelected();
    renderMealFilters();
    setMealFiltersOpen(true);
  }

  function discardMealFiltersDrawer() {
    setMealFiltersOpen(false);
  }

  function applyMealFilters() {
    selectedAllergenFilters = cloneMealFilterIds(draftAllergenFilters);
    selectedBadgeFilters = cloneMealFilterIds(draftBadgeFilters);
    updateMealFiltersToggleCount();
    setMealFiltersOpen(false);
    renderMeals();
  }

  function updateMealFiltersToggleCount() {
    if (!mealFiltersActiveCount) return;
    var count = activeMealFilterCount();
    mealFiltersActiveCount.textContent = count > 0 ? String(count) : "";
    mealFiltersActiveCount.classList.toggle("hidden", count === 0);
  }

  function resetMealFilters() {
    selectedAllergenFilters = [];
    selectedBadgeFilters = [];
    draftAllergenFilters = [];
    draftBadgeFilters = [];
    renderMealFilters();
    updateMealFiltersToggleCount();
    renderMeals();
  }

  function resetMealFiltersDraft() {
    draftAllergenFilters = [];
    draftBadgeFilters = [];
    renderMealFilters();
  }

  function toggleDraftAllergenFilter(filterId) {
    var index = draftAllergenFilters.indexOf(filterId);
    if (index === -1) draftAllergenFilters.push(filterId);
    else draftAllergenFilters.splice(index, 1);
    renderMealFilters();
  }

  function toggleDraftBadgeFilter(filterId) {
    var index = draftBadgeFilters.indexOf(filterId);
    if (index === -1) draftBadgeFilters.push(filterId);
    else draftBadgeFilters.splice(index, 1);
    renderMealFilters();
  }

  function renderMealFilters() {
    if (!allergenFilters || !badgeFilters) return;

    allergenFilters.innerHTML = "";
    ALLERGEN_FILTER_OPTIONS.forEach(function (filter) {
      var isActive = draftAllergenFilters.indexOf(filter.id) !== -1;
      var option = document.createElement("label");
      option.className =
        "meal-filter-option" + (isActive ? " is-active" : "");

      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = isActive;
      input.setAttribute("data-filter-id", filter.id);
      input.addEventListener("change", function () {
        toggleDraftAllergenFilter(filter.id);
      });

      var text = document.createElement("span");
      text.textContent = filter.label;

      option.appendChild(input);
      option.appendChild(text);
      allergenFilters.appendChild(option);
    });

    badgeFilters.innerHTML = "";
    BADGE_FILTER_OPTIONS.forEach(function (filter) {
      var isActive = draftBadgeFilters.indexOf(filter.id) !== -1;
      var option = document.createElement("label");
      option.className =
        "meal-filter-option meal-filter-option--badge-" +
        filter.id +
        (isActive ? " is-active" : "");

      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = isActive;
      input.setAttribute("data-filter-id", filter.id);
      input.addEventListener("change", function () {
        toggleDraftBadgeFilter(filter.id);
      });

      var text = document.createElement("span");
      text.textContent = filter.label;

      option.appendChild(input);
      option.appendChild(text);
      badgeFilters.appendChild(option);
    });

    if (mealFiltersReset) {
      mealFiltersReset.classList.toggle("hidden", !hasDraftMealFilters());
    }
  }

  function updateBoxRailNav() {
    if (!boxRailViewport || !boxRailPrev || !boxRailNext) return;
    var maxScroll = boxRailViewport.scrollWidth - boxRailViewport.clientWidth;
    if (maxScroll <= 0) {
      boxRailPrev.disabled = true;
      boxRailNext.disabled = true;
      return;
    }
    boxRailPrev.disabled = boxRailViewport.scrollLeft <= 2;
    boxRailNext.disabled = boxRailViewport.scrollLeft >= maxScroll - 2;
  }

  function scrollBoxRail(direction) {
    if (!boxRailViewport) return;
    var card = boxRailViewport.querySelector(".product-card");
    var gap = 14;
    var scrollAmount = card ? card.offsetWidth + gap : 280;
    boxRailViewport.scrollBy({ behavior: "smooth", left: direction * scrollAmount });
  }

  function scrollBoxIntoView(card) {
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  function selectedTotal() {
    return Object.keys(selectedMeals).reduce(function (total, mealId) {
      return total + selectedMeals[mealId];
    }, 0);
  }

  function setError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.toggle("hidden", !message);
  }

  function updateFormulaCta() {
    if (!formulaContinue) return;
    if (!selectedBox || !requiredMeals || !selectedBox.sellingPlanId) {
      formulaContinue.disabled = true;
      formulaContinue.textContent = "Choisissez votre box";
      return;
    }
    formulaContinue.disabled = false;
    formulaContinue.textContent = "Continuer avec " + requiredMeals + " repas →";
  }

  function isMealsSelectionComplete() {
    return Boolean(
      selectedBox &&
        selectedBox.sellingPlanId &&
        requiredMeals > 0 &&
        selectedTotal() === requiredMeals
    );
  }

  function isBuilderEmailValid(value) {
    if (!value) return false;
    var trimmed = String(value).trim();
    if (!trimmed || trimmed.length > 254) return false;
    if (/\\s/.test(trimmed)) return false;
    var separator = trimmed.indexOf("@");
    if (separator <= 0 || separator !== trimmed.lastIndexOf("@")) return false;
    var local = trimmed.slice(0, separator);
    var domain = trimmed.slice(separator + 1);
    if (!local || !domain || domain.indexOf(".") === -1) return false;
    if (domain.charAt(0) === "." || domain.charAt(domain.length - 1) === ".") return false;
    return domain.split(".").every(function (label) {
      return label.length > 0;
    });
  }

  function currentLeadKey() {
    if (
      !selectedEmail ||
      !selectedObjective ||
      !selectedBox ||
      !selectedBox.variantId ||
      selectedBox.mealCount == null ||
      !selectedScheduledDeliveryDate
    ) {
      return "";
    }
    return [
      String(selectedEmail).trim(),
      selectedObjective,
      selectedBox.variantId,
      selectedBox.mealCount,
      selectedScheduledDeliveryDate
    ].join("|");
  }

  function isCapturedLeadFresh() {
    var key = currentLeadKey();
    return Boolean(key) && capturedLeadKey === key;
  }

  function canEnterEmailStep() {
    return (
      isValidObjective(selectedObjective) &&
      Boolean(selectedBox && selectedBox.sellingPlanId) &&
      isSelectedDeliveryWindowValid() &&
      isMealsSelectionComplete()
    );
  }

  function updateEmailCta() {
    if (!emailContinue) return;
    if (isSubmittingLead) {
      emailContinue.disabled = true;
      emailContinue.textContent = "Un instant…";
      return;
    }
    if (isSubmittingCheckout) {
      emailContinue.disabled = true;
      emailContinue.textContent = "Préparation du paiement…";
      return;
    }
    if (!isBuilderEmailValid(selectedEmail)) {
      emailContinue.disabled = true;
      emailContinue.textContent = "Entrez votre e-mail";
      return;
    }
    emailContinue.disabled = false;
    emailContinue.textContent = "Passer au paiement";
  }

  function updateTunnelChrome(step) {
    var isObjective = step === "objectif";
    var isFormula = step === "formule";
    var isDelivery = step === "livraison";
    var isMeals = step === "repas";
    var isEmail = step === "email";
    currentStep = step;
    document.body.classList.toggle("is-step-objective", isObjective);
    document.body.classList.toggle("is-step-formule", isFormula);
    document.body.classList.toggle("is-step-meals", isMeals);
    document.body.classList.toggle("is-step-livraison", isDelivery);
    document.body.classList.toggle("is-step-email", isEmail);

    if (tunnelStepLabel) {
      tunnelStepLabel.textContent = STEP_LABELS[step] || ("Étape 1 sur " + STEP_COUNT);
    }
    if (tunnelProgressFill) {
      tunnelProgressFill.classList.remove(
        "is-step-1",
        "is-step-2",
        "is-step-3",
        "is-step-4",
        "is-step-5"
      );
      if (isObjective) tunnelProgressFill.classList.add("is-step-1");
      else if (isFormula) tunnelProgressFill.classList.add("is-step-2");
      else if (isDelivery) tunnelProgressFill.classList.add("is-step-3");
      else if (isMeals) tunnelProgressFill.classList.add("is-step-4");
      else if (isEmail) tunnelProgressFill.classList.add("is-step-5");
      var percent = STEP_PROGRESS[step];
      if (typeof percent === "number") {
        tunnelProgressFill.style.width = percent + "%";
      }
    }
    if (tunnelBack) {
      tunnelBack.classList.toggle("is-formula-step", isFormula);
      tunnelBack.classList.toggle("is-delivery-step", isDelivery);
      tunnelBack.classList.toggle("is-meals-step", isMeals);
      tunnelBack.classList.toggle("is-email-step", isEmail);
    }
    if (objectiveFooter) {
      objectiveFooter.classList.toggle("hidden", !isObjective);
    }
    if (formulaFooter) {
      formulaFooter.classList.toggle("hidden", !isFormula);
    }
    if (deliveryFooter) {
      deliveryFooter.classList.toggle("hidden", !isDelivery);
    }
    if (mealsGaugeFooter) {
      mealsGaugeFooter.classList.toggle("hidden", !isMeals);
    }
    if (emailFooter) {
      emailFooter.classList.toggle("hidden", !isEmail);
    }
    if (mealsLead && selectedBox && requiredMeals) {
      mealsLead.textContent = "Pour votre box de " + requiredMeals + " repas";
    }
  }

  function findObjectiveLabel(value) {
    if (!value || !data.objectives) return "";
    var match = data.objectives.find(function (option) {
      return option.value === value;
    });
    return match ? match.label : "";
  }

  /** Display-only summary on the email step — no lead/checkout side effects. */
  function renderEmailMiniRecap() {
    if (emailMiniRecapBox) {
      emailMiniRecapBox.textContent = selectedBox
        ? formatBoxMealCountDisplay(selectedBox.mealCount)
        : "";
    }
    if (emailMiniRecapObjective) {
      emailMiniRecapObjective.textContent = findObjectiveLabel(selectedObjective);
    }
    if (emailMiniRecapDelivery) {
      var selectedWindow = findDeliveryWindowOption(selectedDeliveryWindowKey);
      emailMiniRecapDelivery.textContent = selectedWindow ? selectedWindow.rangeLabel : "";
    }
    if (emailMiniRecapMeals) {
      var total = selectedTotal();
      var required = selectedBox && selectedBox.mealCount != null
        ? selectedBox.mealCount
        : requiredMeals;
      emailMiniRecapMeals.textContent =
        total + " / " + required + " plats sélectionnés";
    }
    if (emailMiniRecapPrice) {
      var launchPricing =
        selectedBox && selectedBox.price
          ? getBuilderLaunchPricing(selectedBox.price, selectedBox.mealCount)
          : null;
      emailMiniRecapPrice.textContent = launchPricing
        ? formatEurosFromCents(launchPricing.launchPriceCents) + " la première box*"
        : "";
    }
  }

  function showStep(step, options) {
    var pushHistory = !options || options.pushHistory !== false;
    var replaceHistory = options && options.replaceHistory;

    // Legacy step id "recap" remapped to email (guards fall back if incomplete).
    if (step === "recap") {
      step = "email";
    }

    if (!isValidObjective(selectedObjective) && step !== "objectif") {
      step = "objectif";
    }
    if (step === "email") {
      if (!isValidObjective(selectedObjective)) {
        step = "objectif";
      } else if (!selectedBox) {
        step = "formule";
      } else if (!isSelectedDeliveryWindowValid()) {
        step = "livraison";
      } else if (!isMealsSelectionComplete()) {
        step = "repas";
      }
    }
    if (step === "repas" && !selectedBox) {
      step = "formule";
    }
    if (step === "repas" && !isSelectedDeliveryWindowValid()) {
      step = "livraison";
    }
    if (step === "livraison" && !selectedBox) {
      step = "formule";
    }
    if ((step === "formule" || step === "livraison" || step === "repas" || step === "email") && !isValidObjective(selectedObjective)) {
      step = "objectif";
    }

    updateTunnelChrome(step);

    if (stepObjective) {
      stepObjective.classList.toggle("hidden", step !== "objectif");
    }
    stepFormula.classList.toggle("hidden", step !== "formule");
    stepDelivery.classList.toggle("hidden", step !== "livraison");
    stepMeals.classList.toggle("hidden", step !== "repas");
    if (step !== "repas" && mealFiltersOpen) {
      discardMealFiltersDrawer();
    }
    var stepEmail = document.getElementById("step-email");
    if (stepEmail) {
      stepEmail.classList.toggle("hidden", step !== "email");
    }

    if (step === "objectif") {
      renderObjectives();
      updateObjectiveCta();
    } else if (step === "formule") {
      renderBoxes();
      window.requestAnimationFrame(function () {
        if (selectedBox) {
          var selectedCard = boxGrid.querySelector(".product-card.selected");
          scrollBoxIntoView(selectedCard);
        }
        updateBoxRailNav();
      });
    } else if (step === "livraison") {
      renderDeliveryWindows();
      updateDeliveryCta();
    } else if (step === "email") {
      renderEmailMiniRecap();
      updateEmailCta();
      if (emailInput) {
        emailInput.value = selectedEmail;
      }
    } else {
      syncMealFiltersDraftFromSelected();
      renderMealFilters();
      updateMealFiltersToggleCount();
      if (!mealsRendered) {
        renderMeals();
        mealsRendered = true;
      }
      updateSummary();
    }

    if (pushHistory || replaceHistory) {
      var method = replaceHistory ? "replaceState" : "pushState";
      history[method]({ step: step }, "", "#" + step);
    }
  }

  function goToPreviousStep() {
    if (location.hash === "#" + currentStep) {
      history.back();
      return;
    }
    if (currentStep === "email") {
      showStep("repas", { pushHistory: false });
      return;
    }
    if (currentStep === "repas") {
      showStep("livraison", { pushHistory: false });
      return;
    }
    if (currentStep === "livraison") {
      showStep("formule", { pushHistory: false });
      return;
    }
    if (currentStep === "formule") {
      showStep("objectif", { pushHistory: false });
    }
  }

  function handleTunnelBack() {
    if (currentStep === "email" || currentStep === "repas" || currentStep === "livraison" || currentStep === "formule") {
      goToPreviousStep();
      return;
    }
    window.location.href = "/";
  }

  function handleHistoryNavigation() {
    var hash = (location.hash || "#objectif").replace("#", "");
    if (!isValidObjective(selectedObjective)) {
      showStep("objectif", { pushHistory: false });
      return;
    }
    // Legacy hash: never open dead recap step / never auto-checkout.
    if (hash === "recap") {
      showStep("email", { pushHistory: false });
      return;
    }
    if (hash === "email" && canEnterEmailStep()) {
      showStep("email", { pushHistory: false });
      return;
    }
    if (hash === "repas" && selectedBox && isSelectedDeliveryWindowValid()) {
      showStep("repas", { pushHistory: false });
      return;
    }
    if (hash === "livraison" && selectedBox) {
      showStep("livraison", { pushHistory: false });
      return;
    }
    if (hash === "formule") {
      showStep("formule", { pushHistory: false });
      return;
    }
    showStep("objectif", { pushHistory: false });
  }

  function selectBox(box, button) {
    var isSameBox = selectedBox && selectedBox.variantId === box.variantId;
    selectedBox = box;
    requiredMeals = box.mealCount;
    if (!isSameBox) {
      selectedMeals = {};
      mealsRendered = false;
    }
    setError("");
    boxHelper.textContent = requiredMeals + " repas à sélectionner";

    document.querySelectorAll(".product-card.selectable").forEach(function (card) {
      card.classList.remove("selected");
      var existingBadge = card.querySelector(".selected-badge");
      if (existingBadge) existingBadge.remove();
    });

    var badgeRow = button.querySelector(".card-badge-row");
    if (!badgeRow) {
      badgeRow = document.createElement("div");
      badgeRow.className = "card-badge-row";
      button.insertBefore(badgeRow, button.firstChild);
    }
    badgeRow.querySelectorAll(".selected-badge").forEach(function (badge) {
      badge.remove();
    });

    var badge = document.createElement("span");
    badge.className = "selected-badge";
    badge.textContent = "Sélectionnée";
    badgeRow.appendChild(badge);
    button.classList.add("selected");

    updateFormulaCta();
    updateSummary();
    scrollBoxIntoView(button);
    window.requestAnimationFrame(updateBoxRailNav);
  }

  function appendRecommendedBadge(badgeRow) {
    var recommendedBadge = document.createElement("span");
    recommendedBadge.className = "recommended-badge";
    recommendedBadge.textContent = "Recommandé";
    badgeRow.appendChild(recommendedBadge);
  }

  function appendSubscriptionPricing(button, box) {
    if (!box.price) return;

    var launch = getBuilderLaunchPricing(box.price, box.mealCount);
    if (launch) {
      var promo = document.createElement("p");
      promo.className = "box-promo-price";
      var promoStrong = document.createElement("strong");
      promoStrong.textContent = formatEurosFromCents(launch.launchPriceCents);
      promo.appendChild(promoStrong);
      promo.appendChild(document.createTextNode(" la première box*"));
      button.appendChild(promo);

      var perMeal = document.createElement("p");
      perMeal.className = "box-price-per-meal";
      perMeal.textContent =
        formatEurosFromCents(launch.launchPricePerMealCents) + " / repas";
      button.appendChild(perMeal);

      var weekly = document.createElement("p");
      weekly.className = "box-weekly-price";
      weekly.textContent =
        "Puis " + formatEurosFromCents(launch.regularPriceCents) + " / semaine";
      button.appendChild(weekly);
      return;
    }

    var weeklyOnly = document.createElement("p");
    weeklyOnly.className = "box-weekly-price";
    weeklyOnly.textContent = formatEuros(box.price) + " / semaine";
    button.appendChild(weeklyOnly);
  }

  function renderBoxes() {
    boxGrid.innerHTML = "";
    sortBoxes(getBoxesForSelectedObjective()).forEach(function (box) {
      var isAvailable = isBoxAvailable(box);
      var button = document.createElement("button");
      button.className = "product-card formula-card selectable" + (isAvailable ? "" : " unavailable");
      if (isAvailable && isRecommendedBox(box)) {
        button.classList.add("is-recommended");
      }
      button.type = "button";
      button.disabled = !isAvailable;
      button.dataset.variantId = box.variantId;

      var badgeRow = null;
      if (isAvailable) {
        badgeRow = document.createElement("div");
        badgeRow.className = "card-badge-row";
        button.appendChild(badgeRow);

        if (isRecommendedBox(box)) {
          appendRecommendedBadge(badgeRow);
        }
      }

      if (selectedBox && selectedBox.variantId === box.variantId) {
        button.classList.add("selected");
        if (!badgeRow) {
          badgeRow = document.createElement("div");
          badgeRow.className = "card-badge-row";
          button.insertBefore(badgeRow, button.firstChild);
        }
        var selectedBadge = document.createElement("span");
        selectedBadge.className = "selected-badge";
        selectedBadge.textContent = "Sélectionnée";
        badgeRow.appendChild(selectedBadge);
      }

      if (isAvailable) {
        var mealCount = document.createElement("span");
        mealCount.className = "box-meal-count";
        mealCount.textContent = formatBoxMealCountDisplay(box.mealCount);
        button.appendChild(mealCount);
        appendSubscriptionPricing(button, box);
      } else {
        var title = document.createElement("span");
        title.className = "product-title";
        title.textContent = box.productTitle || box.variantTitle;
        button.appendChild(title);

        var unavailable = document.createElement("span");
        unavailable.className = "muted";
        unavailable.textContent = "Cette box n’est pas encore disponible.";
        button.appendChild(unavailable);
      }

      button.addEventListener("click", function () {
        if (!isAvailable) {
          setError("Cette box n’est pas encore disponible.");
          return;
        }
        selectBox(box, button);
      });

      boxGrid.appendChild(button);
    });
    updateFormulaCta();
    updateBoxRailNav();
  }

  function updateSummary() {
    var total = selectedTotal();
    var remaining = Math.max(0, requiredMeals - total);
    selectedCount.textContent = total + " / " + requiredMeals + " plats sélectionnés";

    var subscriptionUnavailable = selectedBox && !selectedBox.sellingPlanId;
    var isComplete = isMealsSelectionComplete();
    addToCart.disabled = !isComplete;

    if (addToCart.textContent !== "Ajout en cours...") {
      if (isComplete) {
        addToCart.textContent = "Continuer";
      } else if (total === 0) {
        addToCart.textContent =
          "Encore " + remaining + " plat" + (remaining > 1 ? "s" : "");
      } else {
        addToCart.textContent = total + " / " + requiredMeals + " repas";
      }
    }

    if (mealsGaugeFooter) {
      mealsGaugeFooter.classList.toggle("is-complete", isComplete);
    }

    if (subscriptionUnavailable) {
      setError("Abonnement bientôt disponible pour cette box.");
    } else if (errorMessage.textContent === "Abonnement bientôt disponible pour cette box.") {
      setError("");
    }
  }

  function closeMealDetailDrawer() {
    if (!mealDetailDrawer || mealDetailDrawer.classList.contains("hidden")) return;
    mealDetailDrawer.classList.remove("is-open");
    mealDetailDrawer.setAttribute("aria-hidden", "true");
    mealDetailDrawer.removeAttribute("aria-modal");
    if (mealDetailDrawerCloseTimer) {
      window.clearTimeout(mealDetailDrawerCloseTimer);
    }
    mealDetailDrawerCloseTimer = window.setTimeout(function () {
      mealDetailDrawer.classList.add("hidden");
      mealDetailDrawerCloseTimer = null;
    }, 320);
  }

  function openMealDetailDrawer(meal) {
    if (!mealDetailDrawer || !mealDetailDrawerTitle) return;

    if (mealFiltersOpen) {
      discardMealFiltersDrawer();
    }

    if (mealDetailDrawerCloseTimer) {
      window.clearTimeout(mealDetailDrawerCloseTimer);
      mealDetailDrawerCloseTimer = null;
    }

    if (mealDetailDrawerMedia) {
      mealDetailDrawerMedia.innerHTML = "";
      if (meal.imageUrl) {
        var image = document.createElement("img");
        image.alt = meal.imageAlt || meal.title;
        image.src = meal.imageUrl;
        mealDetailDrawerMedia.appendChild(image);
      }
    }

    mealDetailDrawerTitle.textContent = meal.title;

    if (mealDetailDrawerBadges) {
      mealDetailDrawerBadges.innerHTML = "";
      if (meal.badges && meal.badges.length) {
        meal.badges.forEach(function (badgeText) {
          var badge = document.createElement("span");
          badge.className = "meal-badge meal-badge--" + getBadgeColorSlug(badgeText);
          badge.textContent = badgeText;
          mealDetailDrawerBadges.appendChild(badge);
        });
        mealDetailDrawerBadges.classList.remove("hidden");
      } else {
        mealDetailDrawerBadges.classList.add("hidden");
      }
    }

    if (mealDetailDrawerAllergens) {
      if (meal.allergenes && meal.allergenes.length) {
        mealDetailDrawerAllergens.textContent =
          "Contient : " +
          meal.allergenes.map(function (entry) {
            return formatAllergenDisplay(entry);
          }).join(", ");
        mealDetailDrawerAllergens.classList.remove("hidden");
      } else {
        mealDetailDrawerAllergens.textContent = "";
        mealDetailDrawerAllergens.classList.add("hidden");
      }
    }

    if (mealDetailDrawerDescription) {
      if (meal.ingredients && meal.ingredients.length) {
        mealDetailDrawerDescription.textContent = meal.ingredients.join(", ");
        mealDetailDrawerDescription.classList.remove("hidden");
      } else {
        mealDetailDrawerDescription.textContent = "";
        mealDetailDrawerDescription.classList.add("hidden");
      }
    }

    if (mealDetailDrawerNutrition) {
      mealDetailDrawerNutrition.innerHTML = "";
      appendMealNutritionTable(mealDetailDrawerNutrition, {
        calories: meal.calories,
        proteins: meal.proteins,
        carbs: meal.carbs,
        fat: meal.fat,
        saturatedFat: meal.saturatedFat,
        sugars: meal.sugars,
        fiber: meal.fiber,
        salt: meal.salt,
        portionGrams: meal.portionGrams,
      });
    }

    mealDetailDrawer.classList.remove("hidden");
    mealDetailDrawer.setAttribute("aria-hidden", "false");
    mealDetailDrawer.setAttribute("aria-modal", "true");
    window.requestAnimationFrame(function () {
      mealDetailDrawer.classList.add("is-open");
    });
  }

  function appendMealNutritionBadge(parent, meal) {
    var nutrition = formatMealNutrition({
      calories: meal.calories,
      proteins: meal.proteins,
      carbs: meal.carbs,
      fat: meal.fat,
      saturatedFat: meal.saturatedFat,
      sugars: meal.sugars,
      fiber: meal.fiber,
      salt: meal.salt,
      portionGrams: meal.portionGrams,
    });
    if (!nutrition.calories || !nutrition.lines.length) return;

    var badge = document.createElement("span");
    badge.className = "meal-nutrition-badge";
    badge.setAttribute("aria-hidden", "true");

    var icon = document.createElement("span");
    icon.className = "meal-nutrition-badge-icon";
    icon.innerHTML =
      '<svg viewBox="21 1 142 182" width="18" height="18" focusable="false" aria-hidden="true">' +
      '<path fill="#FFFFFF" d="M92 3L103 13L110 28L112 61L117 79L122 84L132 84L137 80L140 70L142 70L149 90L149 104L146 115L152 111L154 102L157 103L161 114L159 135L145 158L129 171L107 180L82 181L64 176L47 166L32 149L25 132L23 120L24 102L27 92L34 78L46 62L46 75L51 89L59 96L71 97L71 95L60 85L58 75L62 66L83 47L89 37L93 24L92 4Z"/>' +
      "</svg>";

    var copy = document.createElement("span");
    copy.className = "meal-nutrition-badge-copy";

    var calories = document.createElement("span");
    calories.className = "meal-nutrition-badge-calories";
    calories.textContent = nutrition.calories;

    var caption = document.createElement("span");
    caption.className = "meal-nutrition-badge-caption";
    caption.textContent = "par portion";

    copy.appendChild(calories);
    copy.appendChild(caption);
    badge.appendChild(icon);
    badge.appendChild(copy);
    parent.appendChild(badge);
  }

  function appendMealCardMedia(card, meal) {
    var media = document.createElement("div");
    media.className = "meal-card-media meal-card-media--interactive";
    media.setAttribute("role", "button");
    media.setAttribute("tabindex", "0");
    media.setAttribute("aria-label", "Voir le détail de " + meal.title);
    if (meal.imageUrl) {
      var image = document.createElement("img");
      image.alt = meal.imageAlt;
      image.src = meal.imageUrl;
      media.appendChild(image);
    } else {
      media.classList.add("meal-card-media--empty");
    }
    appendMealNutritionBadge(media, meal);
    media.addEventListener("click", function () {
      openMealDetailDrawer(meal);
    });
    media.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target !== media) return;
      event.preventDefault();
      openMealDetailDrawer(meal);
    });
    card.appendChild(media);
  }

  function renderMeals() {
    var objectiveMeals = getMealsForSelectedObjective();
    var visibleMeals = getVisibleMeals();
    mealGrid.innerHTML = "";

    var noObjectiveMeals = objectiveMeals.length === 0;
    var noVisibleMeals = visibleMeals.length === 0;

    if (mealsEmpty) {
      mealsEmpty.classList.toggle("hidden", !noVisibleMeals);
    }
    if (mealsEmptyCopy) {
      if (noObjectiveMeals) {
        mealsEmptyCopy.innerHTML =
          "Aucun plat n’est disponible pour cet objectif pour le moment.";
      } else {
        mealsEmptyCopy.innerHTML =
          "Aucun plat ne correspond à ces filtres.<br>Essayez de retirer un allergène ou une envie.";
      }
    }
    if (mealsEmptyReset) {
      mealsEmptyReset.classList.toggle("hidden", noObjectiveMeals || !hasActiveMealFilters());
    }
    mealGrid.classList.toggle("hidden", noVisibleMeals);

    visibleMeals.forEach(function (meal) {
      var quantityValue = selectedMeals[meal.variantId] || 0;
      if (!selectedMeals[meal.variantId]) {
        selectedMeals[meal.variantId] = 0;
      }

      var card = document.createElement("article");
      card.className = "product-card meal-card";

      appendMealCardMedia(card, meal);

      var content = document.createElement("div");
      content.className = "meal-card-content";

      var title = document.createElement("h2");
      title.className = "meal-title";
      title.textContent = meal.title;
      content.appendChild(title);

      if (meal.badges && meal.badges.length) {
        var badges = document.createElement("div");
        badges.className = "meal-badges";
        meal.badges.forEach(function (badgeText) {
          var badge = document.createElement("span");
          var slug = getBadgeColorSlug(badgeText);
          badge.className = "meal-badge meal-badge--" + slug;
          badge.textContent = badgeText;
          badges.appendChild(badge);
        });
        content.appendChild(badges);
      }

      if (meal.allergenes && meal.allergenes.length) {
        var allergens = document.createElement("p");
        allergens.className = "meal-allergenes";
        allergens.textContent =
          "Contient : " +
          meal.allergenes.map(function (entry) {
            return formatAllergenDisplay(entry);
          }).join(", ");
        content.appendChild(allergens);
      }

      card.appendChild(content);

      var quantityRow = document.createElement("div");
      quantityRow.className = "quantity-row";

      var minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "-";
      minus.disabled = quantityValue === 0;
      minus.setAttribute("aria-label", "Retirer " + meal.title);
      minus.addEventListener("click", function () {
        selectedMeals[meal.variantId] = Math.max(0, (selectedMeals[meal.variantId] || 0) - 1);
        renderMeals();
        updateSummary();
      });

      var quantity = document.createElement("span");
      quantity.className = "meal-quantity";
      quantity.textContent = String(selectedMeals[meal.variantId] || 0);

      var plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.disabled = selectedTotal() >= requiredMeals;
      plus.setAttribute("aria-label", "Ajouter " + meal.title);
      plus.addEventListener("click", function () {
        if (selectedTotal() >= requiredMeals) return;
        selectedMeals[meal.variantId] = (selectedMeals[meal.variantId] || 0) + 1;
        renderMeals();
        updateSummary();
      });

      quantityRow.appendChild(minus);
      quantityRow.appendChild(quantity);
      quantityRow.appendChild(plus);
      card.appendChild(quantityRow);
      mealGrid.appendChild(card);
    });
  }

  addToCart.addEventListener("click", function () {
    if (!isMealsSelectionComplete()) return;

    if (!isSelectedDeliveryWindowValid()) {
      setError("Choisissez une fenêtre de livraison avant de continuer.");
      showStep("livraison");
      return;
    }

    setError("");
    showStep("email");
  });

  function createBuilderCheckout() {
    if (!selectedBox || !isMealsSelectionComplete()) {
      return Promise.reject(new Error("incomplete_box"));
    }

    if (!isSelectedDeliveryWindowValid()) {
      setError("Choisissez une fenêtre de livraison avant d'ajouter votre box au panier.");
      showStep("livraison");
      return Promise.reject(new Error("invalid_delivery"));
    }

    var selectedWindow = findDeliveryWindowOption(selectedDeliveryWindowKey);
    if (!selectedWindow) {
      setError("Choisissez une fenêtre de livraison valide.");
      showStep("livraison");
      return Promise.reject(new Error("invalid_delivery"));
    }

    if (!selectedBox.variantId) {
      setError("Cette box n’a pas de variante disponible.");
      return Promise.reject(new Error("missing_variant"));
    }

    if (!selectedBox.sellingPlanId) {
      setError("Abonnement bientôt disponible pour cette box.");
      updateSummary();
      return Promise.reject(new Error("missing_selling_plan"));
    }

    if (!isBuilderEmailValid(selectedEmail)) {
      setError("Entrez une adresse e-mail valide.");
      showStep("email");
      return Promise.reject(new Error("invalid_email"));
    }

    var meals = [];
    data.meals.forEach(function (meal) {
      var quantity = selectedMeals[meal.variantId] || 0;
      if (quantity > 0) {
        meals.push({
          title: meal.title,
          quantity: quantity
        });
      }
    });

    return fetch(window.location.pathname + window.location.search, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: CREATE_CHECKOUT_INTENT,
        email: selectedEmail,
        boxVariantId: selectedBox.variantId,
        sellingPlanId: selectedBox.sellingPlanId,
        mealCount: selectedBox.mealCount,
        scheduledDeliveryDate: selectedScheduledDeliveryDate,
        deliveryRangeLabel: selectedWindow.rangeLabel,
        meals: meals
      })
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok !== true || !payload.checkoutUrl) {
          throw new Error("checkout_create_failed");
        }
        window.location.href = String(payload.checkoutUrl);
      }, function () {
        throw new Error("checkout_create_failed");
      });
    });
  }

  function captureCheckoutLead() {
    return fetch(window.location.pathname + window.location.search, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: CAPTURE_LEAD_INTENT,
        email: selectedEmail,
        objective: selectedObjective,
        boxVariantId: selectedBox && selectedBox.variantId,
        mealCount: selectedBox && selectedBox.mealCount,
        scheduledDeliveryDate: selectedScheduledDeliveryDate
      })
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok !== true) {
          throw new Error("lead_capture_failed");
        }
      }, function () {
        throw new Error("lead_capture_failed");
      });
    });
  }

  function beginCheckoutFromEmail() {
    isSubmittingCheckout = true;
    updateEmailCta();
    setError("");

    createBuilderCheckout()
      .catch(function (error) {
        isSubmittingCheckout = false;
        updateEmailCta();
        if (error && error.message === "checkout_create_failed") {
          setError(CART_PREPARE_ERROR);
          return;
        }
        if (!errorMessage.textContent) {
          setError("Impossible d’ajouter la box au panier. Réessayez dans un instant.");
        }
      });
  }

  function handleEmailSubmit() {
    if (isSubmittingLead || isSubmittingCheckout) return;

    selectedEmail = emailInput ? String(emailInput.value || "").trim() : String(selectedEmail || "").trim();
    if (emailInput) {
      emailInput.value = selectedEmail;
    }

    if (!isBuilderEmailValid(selectedEmail)) {
      setError("Entrez une adresse e-mail valide.");
      updateEmailCta();
      return;
    }

    if (!isValidObjective(selectedObjective)) {
      showStep("objectif");
      return;
    }

    if (!selectedBox || !selectedBox.variantId || !selectedBox.sellingPlanId) {
      setError("Choisissez votre box pour continuer.");
      showStep("formule");
      return;
    }

    if (!isSelectedDeliveryWindowValid()) {
      setError("Choisissez une fenêtre de livraison avant de continuer.");
      showStep("livraison");
      return;
    }

    if (!isMealsSelectionComplete()) {
      setError("Choisissez vos repas avant de continuer.");
      showStep("repas");
      return;
    }

    if (isCapturedLeadFresh()) {
      beginCheckoutFromEmail();
      return;
    }

    isSubmittingLead = true;
    updateEmailCta();
    setError("");

    captureCheckoutLead()
      .then(function () {
        capturedLeadKey = currentLeadKey();
        isSubmittingLead = false;
        beginCheckoutFromEmail();
      })
      .catch(function () {
        isSubmittingLead = false;
        updateEmailCta();
        setError("Impossible de continuer pour le moment. Réessayez.");
      });
  }

  if (emailContinue) {
    emailContinue.addEventListener("click", handleEmailSubmit);
  }

  if (emailInput) {
    emailInput.addEventListener("input", function () {
      selectedEmail = String(emailInput.value || "");
      if (errorMessage.textContent === "Entrez une adresse e-mail valide.") {
        setError("");
      }
      updateEmailCta();
    });
    emailInput.addEventListener("blur", function () {
      selectedEmail = String(emailInput.value || "").trim();
      emailInput.value = selectedEmail;
      if (selectedEmail && !isBuilderEmailValid(selectedEmail)) {
        setError("Entrez une adresse e-mail valide.");
      }
      updateEmailCta();
    });
    emailInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        handleEmailSubmit();
      }
    });
  }

  tunnelBack.addEventListener("click", handleTunnelBack);

  if (objectiveContinue) {
    objectiveContinue.addEventListener("click", function () {
      if (!isValidObjective(selectedObjective)) {
        setError("Choisissez votre objectif pour continuer.");
        updateObjectiveCta();
        return;
      }
      showStep("formule");
    });
  }

  formulaContinue.addEventListener("click", function () {
    if (!selectedBox || !requiredMeals || !selectedBox.sellingPlanId) return;
    showStep("livraison");
  });

  if (deliveryContinue) {
    deliveryContinue.addEventListener("click", function () {
      if (!isSelectedDeliveryWindowValid()) {
        setError("Choisissez une fenêtre de livraison pour continuer.");
        updateDeliveryCta();
        return;
      }
      showStep("repas");
    });
  }

  if (mealFiltersReset) {
    mealFiltersReset.addEventListener("click", resetMealFiltersDraft);
  }

  if (mealFiltersToggle) {
    mealFiltersToggle.addEventListener("click", function () {
      if (mealFiltersOpen) {
        discardMealFiltersDrawer();
        return;
      }
      openMealFiltersDrawer();
    });
  }

  if (mealFiltersApply) {
    mealFiltersApply.addEventListener("click", applyMealFilters);
  }

  if (mealFiltersDrawer) {
    mealFiltersDrawer.addEventListener("click", function (event) {
      var target = event.target;
      if (
        target &&
        (target.classList.contains("meal-filters-drawer-backdrop") ||
          target.classList.contains("meal-filters-drawer-close"))
      ) {
        discardMealFiltersDrawer();
      }
    });
  }

  if (mealsEmptyReset) {
    mealsEmptyReset.addEventListener("click", resetMealFilters);
  }

  if (mealDetailDrawer) {
    mealDetailDrawer.addEventListener("click", function (event) {
      var target = event.target;
      if (
        target &&
        (target.classList.contains("meal-detail-drawer-backdrop") ||
          target.classList.contains("meal-detail-drawer-close"))
      ) {
        closeMealDetailDrawer();
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (mealFiltersOpen) {
        discardMealFiltersDrawer();
        return;
      }
      closeMealDetailDrawer();
    }
  });

  if (boxRailViewport) {
    boxRailViewport.addEventListener("scroll", updateBoxRailNav, { passive: true });
  }

  if (boxRailPrev) {
    boxRailPrev.addEventListener("click", function () {
      scrollBoxRail(-1);
    });
  }

  if (boxRailNext) {
    boxRailNext.addEventListener("click", function () {
      scrollBoxRail(1);
    });
  }

  window.addEventListener("resize", updateBoxRailNav);

  window.addEventListener("popstate", handleHistoryNavigation);
  window.addEventListener("hashchange", handleHistoryNavigation);

  (function initTunnelPromoDismiss() {
    var storageKey = "mileyo-tunnel-promo-dismissed";
    if (!tunnelPromo) return;
    try {
      if (window.sessionStorage.getItem(storageKey) === "1") {
        tunnelPromo.classList.add("hidden");
      }
    } catch (error) {}
    if (!tunnelPromoDismiss) return;
    tunnelPromoDismiss.addEventListener("click", function () {
      tunnelPromo.classList.add("hidden");
      try {
        window.sessionStorage.setItem(storageKey, "1");
      } catch (error) {}
    });
  })();

  renderObjectives();
  updateObjectiveCta();
  updateFormulaCta();
  updateDeliveryCta();
  updateSummary();

  if (!isValidObjective(selectedObjective)) {
    showStep("objectif", { replaceHistory: true });
  } else if (location.hash === "#recap") {
    // Legacy hash → email (or earlier step via showStep guards). Never auto-checkout.
    showStep("email", { replaceHistory: true });
  } else if (location.hash === "#email" && canEnterEmailStep()) {
    showStep("email", { replaceHistory: true });
  } else if (location.hash === "#repas" && selectedBox && isSelectedDeliveryWindowValid()) {
    showStep("repas", { replaceHistory: true });
  } else if (location.hash === "#livraison" && selectedBox) {
    showStep("livraison", { replaceHistory: true });
  } else if (location.hash === "#formule") {
    showStep("formule", { replaceHistory: true });
  } else {
    showStep("objectif", { replaceHistory: true });
  }
})();
`;
