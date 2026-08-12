import { mealFilterRuntimeScript } from "./builder-filter-runtime";
import {
  BUILDER_STEP_COUNT,
  getBuilderStepLabel,
  getBuilderStepProgressPercent,
} from "./builder-objective-options";

const builderStepLabelsJson = JSON.stringify({
  formule: getBuilderStepLabel("formule"),
  livraison: getBuilderStepLabel("livraison"),
  objectif: getBuilderStepLabel("objectif"),
  repas: getBuilderStepLabel("repas"),
});

const builderStepProgressJson = JSON.stringify({
  formule: getBuilderStepProgressPercent("formule"),
  livraison: getBuilderStepProgressPercent("livraison"),
  objectif: getBuilderStepProgressPercent("objectif"),
  repas: getBuilderStepProgressPercent("repas"),
});

export const builderClientScript = `
(function () {
  var data = window.__MILEYO_BOX_BUILDER__;
  var orderType = "subscription";
  var selectedObjective = null;
  var selectedBox = null;
  var requiredMeals = 0;
  var selectedMeals = {};
  var selectedDeliveryDate = null;
  var currentStep = "objectif";
  var mealsRendered = false;
  var FIRST_WEEK_DISCOUNT_EUR = 20;
  var RECOMMENDED_MEAL_COUNT = 12;
  var STEP_COUNT = ${BUILDER_STEP_COUNT};
  var STEP_LABELS = ${builderStepLabelsJson};
  var STEP_PROGRESS = ${builderStepProgressJson};

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
  var oneTimeToggle = document.getElementById("one-time-toggle");
  var subscriptionToggle = document.getElementById("subscription-toggle");
  var tunnelBack = document.getElementById("tunnel-back");
  var tunnelStepLabel = document.getElementById("tunnel-step-label");
  var tunnelProgressFill = document.getElementById("tunnel-progress-fill");
  var objectiveContinue = document.getElementById("objective-continue");
  var objectiveFooter = document.getElementById("objective-footer");
  var formulaContinue = document.getElementById("formula-continue");
  var formulaFooter = document.getElementById("formula-footer");
  var deliveryContinue = document.getElementById("delivery-continue");
  var deliveryFooter = document.getElementById("delivery-footer");
  var deliveryDateGrid = document.getElementById("delivery-date-grid");
  var mealsLead = document.getElementById("meals-lead");
  var tunnelPromo = document.getElementById("tunnel-promo");
  var allergenFilters = document.getElementById("allergen-filters");
  var badgeFilters = document.getElementById("badge-filters");
  var mealFiltersReset = document.getElementById("meal-filters-reset");
  var mealsEmpty = document.getElementById("meals-empty");
  var mealsEmptyReset = document.getElementById("meals-empty-reset");
  var mealsGaugeFooter = document.getElementById("meals-gauge-footer");
  var mealsGaugeCount = document.getElementById("meals-gauge-count");
  var mealsGaugeFill = document.getElementById("meals-gauge-fill");
  var mealsProgressBox = document.getElementById("meals-progress-box");
  var mealsProgressCount = document.getElementById("meals-progress-count");
  var mealsProgressFill = document.getElementById("meals-progress-fill");
  var mealsProgressStrip = document.getElementById("meals-progress-strip");
  var selectedAllergenFilters = [];
  var selectedBadgeFilters = [];

  ${mealFilterRuntimeScript}

  function formatDeliveryDateLabelShort(dateStr) {
    var parts = dateStr.split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    var utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
    var weekday = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "UTC",
      weekday: "short"
    }).format(utcNoon);
    var rest = new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      timeZone: "UTC"
    }).format(utcNoon);

    return weekday.charAt(0).toUpperCase() + weekday.slice(1).replace(/\\.$/, ".") + " " + rest;
  }

  function formatDeliveryDateLabelLong(dateStr) {
    var parts = dateStr.split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    var utcNoon = new Date(Date.UTC(year, month - 1, day, 12));

    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      weekday: "long",
      year: "numeric"
    }).format(utcNoon);
  }

  function ensureSelectedDeliveryDate() {
    var config = data.deliveryConfig;
    if (!config) return;
    var available = config.availableDates || [];
    if (selectedDeliveryDate && available.indexOf(selectedDeliveryDate) !== -1) {
      return;
    }
    selectedDeliveryDate = config.defaultDate || available[0] || null;
  }

  function renderDeliveryDates() {
    if (!deliveryDateGrid || !data.deliveryConfig) return;
    deliveryDateGrid.innerHTML = "";
    data.deliveryConfig.availableDates.forEach(function (dateStr) {
      var chip = document.createElement("button");
      var isSelected = selectedDeliveryDate === dateStr;
      chip.className = "delivery-date-chip" + (isSelected ? " selected" : "");
      chip.type = "button";
      chip.textContent = formatDeliveryDateLabelShort(dateStr);
      chip.setAttribute("aria-pressed", isSelected ? "true" : "false");
      chip.addEventListener("click", function () {
        selectedDeliveryDate = dateStr;
        renderDeliveryDates();
        updateDeliveryCta();
        setError("");
      });
      deliveryDateGrid.appendChild(chip);
    });
  }

  function updateDeliveryCta() {
    if (!deliveryContinue) return;
    if (!selectedDeliveryDate) {
      deliveryContinue.disabled = true;
      deliveryContinue.textContent = "Choisissez une date de livraison";
      return;
    }
    deliveryContinue.disabled = false;
    deliveryContinue.textContent = "Continuer vers mes repas →";
  }

  function formatEuros(price) {
    if (!price) return "";
    var value = Number(price);
    if (Number.isNaN(value)) return price;
    return new Intl.NumberFormat("fr-FR", {
      currency: "EUR",
      style: "currency"
    }).format(value);
  }

  function formatPricePerMeal(totalPrice, mealCount) {
    if (!totalPrice || !mealCount) return "";
    var value = Number(totalPrice) / mealCount;
    if (Number.isNaN(value)) return "";
    return new Intl.NumberFormat("fr-FR", {
      currency: "EUR",
      style: "currency"
    }).format(value);
  }

  function getVariantCartId(variantId) {
    if (!variantId) return "";
    var parts = variantId.split("/");
    return parts[parts.length - 1] || "";
  }

  function isBoxAvailable(box) {
    return typeof box.mealCount === "number" && box.mealCount > 0;
  }

  function isBoxSubscriptionReady(box) {
    return Boolean(box.subscriptionPrice && box.sellingPlanId);
  }

  function sortBoxes(boxes) {
    return boxes.slice().sort(function (a, b) {
      var aAvailable = isBoxAvailable(a);
      var bAvailable = isBoxAvailable(b);
      if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;
      var aCount = a.mealCount || 0;
      var bCount = b.mealCount || 0;
      if (aCount !== bCount) return aCount - bCount;
      return a.title.localeCompare(b.title, "fr");
    });
  }

  function isRecommendedBox(box) {
    return isBoxAvailable(box) && box.mealCount === RECOMMENDED_MEAL_COUNT;
  }

  function getDefaultBox() {
    var sorted = sortBoxes(data.boxes);
    var recommended = sorted.find(function (box) {
      return isRecommendedBox(box);
    });
    if (recommended) return recommended;
    return sorted.find(isBoxAvailable) || null;
  }

  function initializeDefaultSelection() {
    if (selectedBox) return;
    var defaultBox = getDefaultBox();
    if (!defaultBox) return;
    selectedBox = defaultBox;
    requiredMeals = defaultBox.mealCount;
    boxHelper.textContent = requiredMeals + " repas à sélectionner";
  }

  function updatePromoBanner() {
    if (!tunnelPromo) return;
    var hideOnTunnelSteps = currentStep === "repas" || currentStep === "livraison";
    tunnelPromo.classList.toggle("hidden", hideOnTunnelSteps || orderType === "one-time");
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

      if (isSelected) {
        var badge = document.createElement("span");
        badge.className = "selected-badge";
        badge.textContent = "Sélectionné";
        button.appendChild(badge);
      }

      button.addEventListener("click", function () {
        selectedObjective = option.value;
        renderObjectives();
        updateObjectiveCta();
        setError("");
      });

      objectiveGrid.appendChild(button);
    });
  }

  function getVisibleMeals() {
    return data.meals.filter(mealMatchesFilter);
  }

  function hasActiveMealFilters() {
    return selectedAllergenFilters.length > 0 || selectedBadgeFilters.length > 0;
  }

  function resetMealFilters() {
    selectedAllergenFilters = [];
    selectedBadgeFilters = [];
    renderMealFilters();
    renderMeals();
  }

  function toggleAllergenFilter(filterId) {
    var index = selectedAllergenFilters.indexOf(filterId);
    if (index === -1) selectedAllergenFilters.push(filterId);
    else selectedAllergenFilters.splice(index, 1);
    renderMealFilters();
    renderMeals();
  }

  function toggleBadgeFilter(filterId) {
    var index = selectedBadgeFilters.indexOf(filterId);
    if (index === -1) selectedBadgeFilters.push(filterId);
    else selectedBadgeFilters.splice(index, 1);
    renderMealFilters();
    renderMeals();
  }

  function renderMealFilters() {
    if (!allergenFilters || !badgeFilters) return;

    allergenFilters.innerHTML = "";
    ALLERGEN_FILTER_OPTIONS.forEach(function (filter) {
      var chip = document.createElement("button");
      var isActive = selectedAllergenFilters.indexOf(filter.id) !== -1;
      chip.className = "filter-chip filter-chip--allergen" + (isActive ? " active" : "");
      chip.type = "button";
      chip.textContent = filter.label;
      chip.setAttribute("aria-pressed", isActive ? "true" : "false");
      chip.addEventListener("click", function () {
        toggleAllergenFilter(filter.id);
      });
      allergenFilters.appendChild(chip);
    });

    badgeFilters.innerHTML = "";
    BADGE_FILTER_OPTIONS.forEach(function (filter) {
      var chip = document.createElement("button");
      var isActive = selectedBadgeFilters.indexOf(filter.id) !== -1;
      chip.className =
        "filter-chip filter-chip--badge filter-chip--badge-" +
        filter.id +
        (isActive ? " active" : "");
      chip.type = "button";
      chip.textContent = filter.label;
      chip.setAttribute("aria-pressed", isActive ? "true" : "false");
      chip.addEventListener("click", function () {
        toggleBadgeFilter(filter.id);
      });
      badgeFilters.appendChild(chip);
    });

    if (mealFiltersReset) {
      mealFiltersReset.classList.toggle("hidden", !hasActiveMealFilters());
    }
  }

  function getWeeklyPriceValue(subscriptionPrice) {
    var value = Number(subscriptionPrice);
    return Number.isNaN(value) ? null : value;
  }

  function getFirstWeekDisplayPrice(subscriptionPrice) {
    var weekly = getWeeklyPriceValue(subscriptionPrice);
    if (weekly === null) return null;
    return Math.max(0, weekly - FIRST_WEEK_DISCOUNT_EUR);
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
    if (!selectedBox || !requiredMeals) {
      formulaContinue.disabled = true;
      formulaContinue.textContent = "Choisissez votre formule";
      return;
    }
    formulaContinue.disabled = false;
    formulaContinue.textContent = "Continuer avec " + requiredMeals + " repas →";
  }

  function updateTunnelChrome(step) {
    var isObjective = step === "objectif";
    var isFormula = step === "formule";
    var isDelivery = step === "livraison";
    var isMeals = step === "repas";
    currentStep = step;
    document.body.classList.toggle("is-step-objective", isObjective);
    document.body.classList.toggle("is-step-formule", isFormula);
    document.body.classList.toggle("is-step-meals", isMeals);
    document.body.classList.toggle("is-step-livraison", isDelivery);

    if (tunnelStepLabel) {
      tunnelStepLabel.textContent = STEP_LABELS[step] || ("Étape 1 sur " + STEP_COUNT);
    }
    if (tunnelProgressFill) {
      tunnelProgressFill.classList.remove("is-step-1", "is-step-2", "is-step-3", "is-step-4");
      if (isObjective) tunnelProgressFill.classList.add("is-step-1");
      else if (isFormula) tunnelProgressFill.classList.add("is-step-2");
      else if (isDelivery) tunnelProgressFill.classList.add("is-step-3");
      else if (isMeals) tunnelProgressFill.classList.add("is-step-4");
      var percent = STEP_PROGRESS[step];
      if (typeof percent === "number") {
        tunnelProgressFill.style.width = percent + "%";
      }
    }
    if (tunnelBack) {
      tunnelBack.classList.toggle("is-formula-step", isFormula);
      tunnelBack.classList.toggle("is-delivery-step", isDelivery);
      tunnelBack.classList.toggle("is-meals-step", isMeals);
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
    updatePromoBanner();
    if (mealsLead && selectedBox && requiredMeals) {
      mealsLead.textContent = "Pour votre box de " + requiredMeals + " repas";
    }
    if (mealsProgressBox && selectedBox && requiredMeals) {
      mealsProgressBox.textContent = "Box " + requiredMeals + " repas";
    }
  }

  function showStep(step, options) {
    var pushHistory = !options || options.pushHistory !== false;
    var replaceHistory = options && options.replaceHistory;

    if (!isValidObjective(selectedObjective) && step !== "objectif") {
      step = "objectif";
    }
    if (step === "repas" && !selectedBox) {
      step = "formule";
    }
    if (step === "repas" && !selectedDeliveryDate) {
      step = "livraison";
    }
    if (step === "livraison" && !selectedBox) {
      step = "formule";
    }
    if ((step === "formule" || step === "livraison" || step === "repas") && !isValidObjective(selectedObjective)) {
      step = "objectif";
    }

    updateTunnelChrome(step);

    if (stepObjective) {
      stepObjective.classList.toggle("hidden", step !== "objectif");
    }
    stepFormula.classList.toggle("hidden", step !== "formule");
    stepDelivery.classList.toggle("hidden", step !== "livraison");
    stepMeals.classList.toggle("hidden", step !== "repas");

    if (step === "objectif") {
      renderObjectives();
      updateObjectiveCta();
    } else if (step === "formule") {
      window.requestAnimationFrame(function () {
        if (selectedBox) {
          var selectedCard = boxGrid.querySelector(".product-card.selected");
          scrollBoxIntoView(selectedCard);
        }
        updateBoxRailNav();
      });
    } else if (step === "livraison") {
      ensureSelectedDeliveryDate();
      renderDeliveryDates();
      updateDeliveryCta();
    } else {
      renderMealFilters();
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
    if (currentStep === "repas" || currentStep === "livraison" || currentStep === "formule") {
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
    if (hash === "repas" && selectedBox && selectedDeliveryDate) {
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
    var isSameBox = selectedBox && selectedBox.id === box.id;
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
    ensureSelectedDeliveryDate();
    updateSummary();
    scrollBoxIntoView(button);
    window.requestAnimationFrame(updateBoxRailNav);
  }

  function appendRecommendedBadge(badgeRow) {
    var recommendedBadge = document.createElement("span");
    recommendedBadge.className = "recommended-badge";
    recommendedBadge.textContent = "Le meilleur équilibre";
    badgeRow.appendChild(recommendedBadge);
  }

  function appendSubscriptionPricing(button, box) {
    var weeklyPrice = getWeeklyPriceValue(box.subscriptionPrice);
    if (weeklyPrice === null) return;

    var firstWeekPrice = getFirstWeekDisplayPrice(box.subscriptionPrice);
    var priceRow = document.createElement("div");
    priceRow.className = "box-price-row";

    var perMeal = document.createElement("span");
    perMeal.className = "box-price-per-meal";
    perMeal.textContent = formatPricePerMeal(String(firstWeekPrice), box.mealCount) + " / repas";
    priceRow.appendChild(perMeal);
    button.appendChild(priceRow);

    var promoBadge = document.createElement("span");
    promoBadge.className = "box-promo-badge";
    promoBadge.textContent = "🎁 20 € offerts";
    button.appendChild(promoBadge);

    var promo = document.createElement("p");
    promo.className = "box-promo-price";
    promo.innerHTML = "<strong>" + formatEuros(firstWeekPrice) + "</strong> la 1ère semaine";
    button.appendChild(promo);

    var crossedPrice = document.createElement("p");
    crossedPrice.className = "box-crossed-price";
    crossedPrice.innerHTML = "au lieu de <s>" + formatEuros(weeklyPrice) + "</s>";
    button.appendChild(crossedPrice);

    var weekly = document.createElement("p");
    weekly.className = "box-weekly-price";
    weekly.textContent = "Puis " + formatEuros(weeklyPrice) + " / semaine";
    button.appendChild(weekly);

    var promoNote = document.createElement("p");
    promoNote.className = "box-promo-note";
    promoNote.textContent = "Appliqué automatiquement au paiement";
    button.appendChild(promoNote);
  }

  function appendOneTimePricing(button, box) {
    if (!box.variantPrice) return;

    var priceRow = document.createElement("div");
    priceRow.className = "box-price-row";

    var perMeal = document.createElement("span");
    perMeal.className = "box-price-per-meal";
    perMeal.textContent = formatPricePerMeal(box.variantPrice, box.mealCount) + " / repas";
    priceRow.appendChild(perMeal);

    var total = document.createElement("span");
    total.className = "box-price-total";
    total.textContent = "Total : " + formatEuros(box.variantPrice);
    priceRow.appendChild(total);

    button.appendChild(priceRow);
  }

  function renderBoxes() {
    boxGrid.innerHTML = "";
    sortBoxes(data.boxes).forEach(function (box) {
      var isAvailable = isBoxAvailable(box);
      var button = document.createElement("button");
      button.className = "product-card formula-card selectable" + (isAvailable ? "" : " unavailable");
      if (isAvailable && isRecommendedBox(box)) {
        button.classList.add("is-recommended");
      }
      button.type = "button";
      button.disabled = !isAvailable;

      var badgeRow = null;
      if (isAvailable) {
        badgeRow = document.createElement("div");
        badgeRow.className = "card-badge-row";
        button.appendChild(badgeRow);

        if (isRecommendedBox(box)) {
          appendRecommendedBadge(badgeRow);
        }
      }

      if (selectedBox && selectedBox.id === box.id) {
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
        mealCount.textContent = box.mealCount + (orderType === "subscription" ? " repas / semaine" : " repas");
        button.appendChild(mealCount);

        if (orderType === "subscription") {
          if (isBoxSubscriptionReady(box)) {
            appendSubscriptionPricing(button, box);
          } else {
            var subscriptionSoon = document.createElement("span");
            subscriptionSoon.className = "muted";
            subscriptionSoon.textContent = "Abonnement bientôt disponible";
            button.appendChild(subscriptionSoon);
          }
        } else {
          appendOneTimePricing(button, box);
        }
      } else {
        var title = document.createElement("span");
        title.className = "product-title";
        title.textContent = box.title;
        button.appendChild(title);

        var variant = document.createElement("span");
        variant.className = "muted";
        variant.textContent = box.variantTitle;
        button.appendChild(variant);

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
    updateBoxRailNav();
  }

  function updateSummary() {
    var total = selectedTotal();
    var remaining = Math.max(0, requiredMeals - total);
    var progress = requiredMeals > 0 ? (total / requiredMeals) * 100 : 0;
    selectedCount.textContent = total + " / " + requiredMeals + " plats sélectionnés";

    if (mealsGaugeCount) {
      mealsGaugeCount.textContent = total + " / " + requiredMeals + " repas";
    }
    if (mealsProgressCount) {
      mealsProgressCount.textContent = total + " / " + requiredMeals + " repas sélectionnés";
    }
    if (mealsGaugeFill) {
      mealsGaugeFill.style.width = Math.min(100, progress) + "%";
    }
    if (mealsProgressFill) {
      mealsProgressFill.style.width = Math.min(100, progress) + "%";
    }

    var subscriptionUnavailable = orderType === "subscription" && selectedBox && (!selectedBox.sellingPlanId || !selectedBox.subscriptionPrice);
    var isComplete = Boolean(selectedBox && requiredMeals > 0 && total === requiredMeals && !subscriptionUnavailable);
    addToCart.disabled = !isComplete;

    if (addToCart.textContent !== "Ajout en cours...") {
      if (!isComplete) {
        addToCart.textContent = "Encore " + remaining + " plat" + (remaining > 1 ? "s" : "");
      } else {
        addToCart.textContent = "Ajouter ma box au panier";
      }
    }

    if (mealsGaugeFooter) {
      mealsGaugeFooter.classList.toggle("is-complete", isComplete);
    }
    if (mealsProgressStrip) {
      mealsProgressStrip.classList.toggle("is-complete", isComplete);
    }

    if (subscriptionUnavailable) {
      setError("Abonnement bientôt disponible pour cette box.");
    } else if (errorMessage.textContent === "Abonnement bientôt disponible pour cette box.") {
      setError("");
    }
  }

  function setOrderType(nextOrderType) {
    orderType = nextOrderType;
    oneTimeToggle.classList.toggle("active", orderType === "one-time");
    subscriptionToggle.classList.toggle("active", orderType === "subscription");
    updatePromoBanner();
    renderBoxes();
    updateFormulaCta();
    updateSummary();
  }

  function renderMeals() {
    var visibleMeals = getVisibleMeals();
    mealGrid.innerHTML = "";

    if (mealsEmpty) {
      mealsEmpty.classList.toggle("hidden", visibleMeals.length > 0);
    }
    mealGrid.classList.toggle("hidden", visibleMeals.length === 0);

    visibleMeals.forEach(function (meal) {
      selectedMeals[meal.id] = selectedMeals[meal.id] || 0;

      var card = document.createElement("article");
      card.className = "product-card meal-card";

      if (meal.imageUrl) {
        var image = document.createElement("img");
        image.alt = meal.imageAlt;
        image.src = meal.imageUrl;
        card.appendChild(image);
      }

      var content = document.createElement("div");
      content.className = "meal-card-content";

      var title = document.createElement("h2");
      title.className = "meal-title";
      title.textContent = meal.title;
      content.appendChild(title);

      if (meal.calories) {
        var calories = document.createElement("p");
        calories.className = "meal-kcal";
        calories.textContent = meal.calories + " kcal";
        content.appendChild(calories);
      }

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
      minus.disabled = selectedMeals[meal.id] === 0;
      minus.setAttribute("aria-label", "Retirer " + meal.title);
      minus.addEventListener("click", function () {
        selectedMeals[meal.id] = Math.max(0, selectedMeals[meal.id] - 1);
        renderMeals();
        updateSummary();
      });

      var quantity = document.createElement("span");
      quantity.className = "meal-quantity";
      quantity.textContent = String(selectedMeals[meal.id]);

      var plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.disabled = selectedTotal() >= requiredMeals;
      plus.setAttribute("aria-label", "Ajouter " + meal.title);
      plus.addEventListener("click", function () {
        if (selectedTotal() >= requiredMeals) return;
        selectedMeals[meal.id] += 1;
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
    if (!selectedBox || selectedTotal() !== requiredMeals) return;

    if (!selectedDeliveryDate) {
      setError("Choisissez une date de livraison avant d'ajouter votre box au panier.");
      showStep("livraison");
      return;
    }

    var variantId = getVariantCartId(selectedBox.variantId);
    if (!variantId) {
      setError("Cette box n’a pas de variante disponible.");
      return;
    }

    var properties = {
      "Type de commande": orderType === "subscription" ? "Abonnement hebdomadaire" : "Commande unique",
      "Nombre de repas": String(requiredMeals),
      "_mileyo_delivery_date": selectedDeliveryDate,
      "Date de livraison souhaitée":
        formatDeliveryDateLabelLong(selectedDeliveryDate) +
        " (" +
        selectedDeliveryDate +
        ")"
    };
    var propertyIndex = 1;
    data.meals.forEach(function (meal) {
      var quantity = selectedMeals[meal.id] || 0;
      for (var index = 0; index < quantity; index += 1) {
        properties["Plat " + propertyIndex] = meal.title;
        propertyIndex += 1;
      }
    });

    addToCart.disabled = true;
    addToCart.textContent = "Ajout en cours...";
    setError("");

    var item = {
      id: variantId,
      properties: properties,
      quantity: 1
    };

    if (orderType === "subscription") {
      if (!selectedBox.sellingPlanId || !selectedBox.subscriptionPrice) {
        setError("Abonnement bientôt disponible pour cette box.");
        updateSummary();
        return;
      }
      item.selling_plan = getVariantCartId(selectedBox.sellingPlanId);
    }

    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [item]
      })
    }).then(function (response) {
      if (!response.ok) throw new Error("Add to cart failed");
      window.location.href = "/cart";
    }).catch(function () {
      addToCart.textContent = "Ajouter ma box au panier";
      updateSummary();
      setError("Impossible d’ajouter la box au panier. Réessayez dans un instant.");
    });
  });

  oneTimeToggle.addEventListener("click", function () {
    setOrderType("one-time");
  });

  subscriptionToggle.addEventListener("click", function () {
    setOrderType("subscription");
  });

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
    if (!selectedBox || !requiredMeals) return;
    showStep("livraison");
  });

  if (deliveryContinue) {
    deliveryContinue.addEventListener("click", function () {
      if (!selectedDeliveryDate) {
        setError("Choisissez une date de livraison pour continuer.");
        updateDeliveryCta();
        return;
      }
      showStep("repas");
    });
  }

  if (mealFiltersReset) {
    mealFiltersReset.addEventListener("click", resetMealFilters);
  }

  if (mealsEmptyReset) {
    mealsEmptyReset.addEventListener("click", resetMealFilters);
  }

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

  initializeDefaultSelection();
  if (data.deliveryConfig && data.deliveryConfig.defaultDate) {
    selectedDeliveryDate = data.deliveryConfig.defaultDate;
  }
  updatePromoBanner();
  renderObjectives();
  renderBoxes();
  updateObjectiveCta();
  updateFormulaCta();
  updateDeliveryCta();
  updateSummary();

  if (!isValidObjective(selectedObjective)) {
    showStep("objectif", { replaceHistory: true });
  } else if (location.hash === "#repas" && selectedBox && selectedDeliveryDate) {
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
