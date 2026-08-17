import { FIRST_BOX_LAUNCH_DISCOUNT_EUR } from "../../constants/firstBoxLaunchDiscount";
import { mealFilterRuntimeScript } from "./builder-filter-runtime";
import {
  BUILDER_CART_PREPARE_ERROR,
  builderCartRuntimeScript,
} from "./builder-cart";
import { CAPTURE_CHECKOUT_LEAD_INTENT } from "./builder-email";
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
  recap: getBuilderStepLabel("recap"),
  repas: getBuilderStepLabel("repas"),
});

const builderStepProgressJson = JSON.stringify({
  email: getBuilderStepProgressPercent("email"),
  formule: getBuilderStepProgressPercent("formule"),
  livraison: getBuilderStepProgressPercent("livraison"),
  objectif: getBuilderStepProgressPercent("objectif"),
  recap: getBuilderStepProgressPercent("recap"),
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
  var mealsEmpty = document.getElementById("meals-empty");
  var mealsEmptyCopy = document.getElementById("meals-empty-copy");
  var mealsEmptyReset = document.getElementById("meals-empty-reset");
  var mealsGaugeFooter = document.getElementById("meals-gauge-footer");
  var emailFooter = document.getElementById("email-footer");
  var emailContinue = document.getElementById("email-continue");
  var emailInput = document.getElementById("checkout-email");
  var emailWeeklyPrice = document.getElementById("email-weekly-price");
  var recapFooter = document.getElementById("recap-footer");
  var recapContinue = document.getElementById("recap-continue");
  var recapObjective = document.getElementById("recap-objective");
  var recapBox = document.getElementById("recap-box");
  var recapLaunchPrice = document.getElementById("recap-launch-price");
  var recapPerMeal = document.getElementById("recap-per-meal");
  var recapWeeklyPrice = document.getElementById("recap-weekly-price");
  var recapPricing = document.getElementById("recap-pricing");
  var recapDelivery = document.getElementById("recap-delivery");
  var recapMeals = document.getElementById("recap-meals");
  var recapEmail = document.getElementById("recap-email");
  var CAPTURE_LEAD_INTENT = ${JSON.stringify(CAPTURE_CHECKOUT_LEAD_INTENT)};
  var CART_PREPARE_ERROR = ${JSON.stringify(BUILDER_CART_PREPARE_ERROR)};
  var mealsGaugeCount = document.getElementById("meals-gauge-count");
  var mealsGaugeFill = document.getElementById("meals-gauge-fill");
  var mealsProgressBox = document.getElementById("meals-progress-box");
  var mealsProgressCount = document.getElementById("meals-progress-count");
  var mealsProgressFill = document.getElementById("meals-progress-fill");
  var mealsProgressStrip = document.getElementById("meals-progress-strip");
  var selectedAllergenFilters = [];
  var selectedBadgeFilters = [];

  ${mealFilterRuntimeScript}
  ${builderCartRuntimeScript}

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

  function getVariantCartId(variantId) {
    return getShopifyNumericId(variantId);
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

  function canEnterRecapStep() {
    return canEnterEmailStep() && isBuilderEmailValid(selectedEmail) && isCapturedLeadFresh();
  }

  function updateEmailCta() {
    if (!emailContinue) return;
    if (isSubmittingLead) {
      emailContinue.disabled = true;
      emailContinue.textContent = "Un instant…";
      return;
    }
    if (!isBuilderEmailValid(selectedEmail)) {
      emailContinue.disabled = true;
      emailContinue.textContent = "Entrez votre e-mail";
      return;
    }
    emailContinue.disabled = false;
    emailContinue.textContent = "Continuer";
  }

  function updateRecapCta() {
    if (!recapContinue) return;
    if (isSubmittingCheckout) {
      recapContinue.disabled = true;
      recapContinue.textContent = "Préparation du paiement…";
      return;
    }
    recapContinue.disabled = !canEnterRecapStep();
    recapContinue.textContent = "Passer au paiement";
  }

  function updateEmailWeeklyPrice() {
    if (!emailWeeklyPrice) return;
    if (!selectedBox || !selectedBox.price) {
      emailWeeklyPrice.textContent = "";
      return;
    }
    emailWeeklyPrice.textContent = "Puis " + formatEuros(selectedBox.price) + "/semaine.";
  }

  function updateTunnelChrome(step) {
    var isObjective = step === "objectif";
    var isFormula = step === "formule";
    var isDelivery = step === "livraison";
    var isMeals = step === "repas";
    var isEmail = step === "email";
    var isRecap = step === "recap";
    currentStep = step;
    document.body.classList.toggle("is-step-objective", isObjective);
    document.body.classList.toggle("is-step-formule", isFormula);
    document.body.classList.toggle("is-step-meals", isMeals);
    document.body.classList.toggle("is-step-livraison", isDelivery);
    document.body.classList.toggle("is-step-email", isEmail);
    document.body.classList.toggle("is-step-recap", isRecap);

    if (tunnelStepLabel) {
      tunnelStepLabel.textContent = STEP_LABELS[step] || ("Étape 1 sur " + STEP_COUNT);
    }
    if (tunnelProgressFill) {
      tunnelProgressFill.classList.remove(
        "is-step-1",
        "is-step-2",
        "is-step-3",
        "is-step-4",
        "is-step-5",
        "is-step-6"
      );
      if (isObjective) tunnelProgressFill.classList.add("is-step-1");
      else if (isFormula) tunnelProgressFill.classList.add("is-step-2");
      else if (isDelivery) tunnelProgressFill.classList.add("is-step-3");
      else if (isMeals) tunnelProgressFill.classList.add("is-step-4");
      else if (isEmail) tunnelProgressFill.classList.add("is-step-5");
      else if (isRecap) tunnelProgressFill.classList.add("is-step-6");
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
      tunnelBack.classList.toggle("is-recap-step", isRecap);
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
    if (recapFooter) {
      recapFooter.classList.toggle("hidden", !isRecap);
    }
    if (mealsLead && selectedBox && requiredMeals) {
      mealsLead.textContent = "Pour votre box de " + requiredMeals + " repas";
    }
    if (mealsProgressBox && selectedBox && requiredMeals) {
      mealsProgressBox.textContent = "Box " + requiredMeals + " repas";
    }
  }

  function findObjectiveLabel(value) {
    if (!value || !data.objectives) return "";
    var match = data.objectives.find(function (option) {
      return option.value === value;
    });
    return match ? match.label : "";
  }

  function formatRecapMealLabel(title, quantity) {
    return quantity > 1 ? title + " ×" + quantity : title;
  }

  function renderRecap() {
    if (recapObjective) {
      recapObjective.textContent = findObjectiveLabel(selectedObjective);
    }
    if (recapBox) {
      recapBox.textContent = selectedBox ? selectedBox.mealCount + " repas" : "";
    }
    if (recapPricing) {
      var launchPricing =
        selectedBox && selectedBox.price
          ? getBuilderLaunchPricing(selectedBox.price, selectedBox.mealCount)
          : null;
      if (launchPricing) {
        recapPricing.classList.remove("is-regular-only");
        if (recapLaunchPrice) {
          recapLaunchPrice.textContent =
            formatEurosFromCents(launchPricing.launchPriceCents) + " la première box*";
        }
        if (recapPerMeal) {
          recapPerMeal.textContent =
            formatEurosFromCents(launchPricing.launchPricePerMealCents) + " / repas";
        }
        if (recapWeeklyPrice) {
          recapWeeklyPrice.textContent =
            "Puis " + formatEurosFromCents(launchPricing.regularPriceCents) + " / semaine";
        }
      } else {
        recapPricing.classList.add("is-regular-only");
        if (recapLaunchPrice) {
          recapLaunchPrice.textContent = "";
        }
        if (recapPerMeal) {
          recapPerMeal.textContent = "";
        }
        if (recapWeeklyPrice) {
          recapWeeklyPrice.textContent =
            selectedBox && selectedBox.price
              ? formatEuros(selectedBox.price) + " / semaine"
              : "";
        }
      }
    }
    if (recapDelivery) {
      var selectedWindow = findDeliveryWindowOption(selectedDeliveryWindowKey);
      recapDelivery.textContent = selectedWindow ? selectedWindow.rangeLabel : "";
    }
    if (recapMeals) {
      recapMeals.innerHTML = "";
      (data.meals || []).forEach(function (meal) {
        if (selectedObjective && meal.objective && meal.objective !== selectedObjective) {
          return;
        }
        var quantity = selectedMeals[meal.variantId] || 0;
        if (quantity <= 0) return;
        var item = document.createElement("li");
        item.textContent = formatRecapMealLabel(meal.title, quantity);
        recapMeals.appendChild(item);
      });
    }
    if (recapEmail) {
      recapEmail.textContent = selectedEmail;
    }
    updateRecapCta();
  }

  function showStep(step, options) {
    var pushHistory = !options || options.pushHistory !== false;
    var replaceHistory = options && options.replaceHistory;

    if (!isValidObjective(selectedObjective) && step !== "objectif") {
      step = "objectif";
    }
    if (step === "recap") {
      if (!isValidObjective(selectedObjective)) {
        step = "objectif";
      } else if (!selectedBox || !selectedBox.sellingPlanId) {
        step = "formule";
      } else if (!isSelectedDeliveryWindowValid()) {
        step = "livraison";
      } else if (!isMealsSelectionComplete()) {
        step = "repas";
      } else if (!isBuilderEmailValid(selectedEmail) || !isCapturedLeadFresh()) {
        step = "email";
      }
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
    if ((step === "formule" || step === "livraison" || step === "repas" || step === "email" || step === "recap") && !isValidObjective(selectedObjective)) {
      step = "objectif";
    }

    updateTunnelChrome(step);

    if (stepObjective) {
      stepObjective.classList.toggle("hidden", step !== "objectif");
    }
    stepFormula.classList.toggle("hidden", step !== "formule");
    stepDelivery.classList.toggle("hidden", step !== "livraison");
    stepMeals.classList.toggle("hidden", step !== "repas");
    var stepEmail = document.getElementById("step-email");
    if (stepEmail) {
      stepEmail.classList.toggle("hidden", step !== "email");
    }
    var stepRecap = document.getElementById("step-recap");
    if (stepRecap) {
      stepRecap.classList.toggle("hidden", step !== "recap");
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
      updateEmailWeeklyPrice();
      updateEmailCta();
      if (emailInput) {
        emailInput.value = selectedEmail;
      }
    } else if (step === "recap") {
      renderRecap();
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
    if (currentStep === "recap") {
      showStep("email", { pushHistory: false });
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
    if (currentStep === "recap" || currentStep === "email" || currentStep === "repas" || currentStep === "livraison" || currentStep === "formule") {
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
    if (hash === "recap" && canEnterRecapStep()) {
      showStep("recap", { pushHistory: false });
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
        mealCount.textContent = box.mealCount + " repas";
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

    var subscriptionUnavailable = selectedBox && !selectedBox.sellingPlanId;
    var isComplete = isMealsSelectionComplete();
    addToCart.disabled = !isComplete;

    if (addToCart.textContent !== "Ajout en cours...") {
      if (!isComplete) {
        addToCart.textContent = "Encore " + remaining + " plat" + (remaining > 1 ? "s" : "");
      } else {
        addToCart.textContent = "Continuer";
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

      if (meal.calories !== null && meal.calories !== undefined && meal.calories > 0) {
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

  function addSelectedBoxToCart() {
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

    var variantId = getVariantCartId(selectedBox.variantId);
    if (!variantId) {
      setError("Cette box n’a pas de variante disponible.");
      return Promise.reject(new Error("missing_variant"));
    }

    if (!selectedBox.sellingPlanId) {
      setError("Abonnement bientôt disponible pour cette box.");
      updateSummary();
      return Promise.reject(new Error("missing_selling_plan"));
    }

    var sellingPlanId = getVariantCartId(selectedBox.sellingPlanId);
    if (!sellingPlanId) {
      setError("Abonnement bientôt disponible pour cette box.");
      updateSummary();
      return Promise.reject(new Error("missing_selling_plan"));
    }

    var properties = {
      "Type de commande": "Abonnement hebdomadaire",
      "Nombre de repas": String(selectedBox.mealCount),
      "_mileyo_delivery_date": selectedScheduledDeliveryDate,
      "Date de livraison souhaitée":
        selectedWindow.rangeLabel +
        " (" +
        selectedScheduledDeliveryDate +
        ")"
    };
    var propertyIndex = 1;
    data.meals.forEach(function (meal) {
      var quantity = selectedMeals[meal.variantId] || 0;
      for (var index = 0; index < quantity; index += 1) {
        properties["Plat " + propertyIndex] = meal.title;
        propertyIndex += 1;
      }
    });

    var item = {
      id: variantId,
      properties: properties,
      quantity: 1,
      selling_plan: sellingPlanId
    };

    return fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [item]
      })
    }).then(function (response) {
      if (!response.ok) throw new Error("Add to cart failed");
      window.location.href = "/checkout";
    });
  }

  function fetchStorefrontCart() {
    return fetch("/cart.js", {
      headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) throw new Error("cart_inspect_failed");
      return response.json();
    });
  }

  function removeCartLineByKey(key) {
    return fetch("/cart/change.js", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: key,
        quantity: 0
      })
    }).then(function (response) {
      if (!response.ok) throw new Error("cart_remove_failed");
    });
  }

  function removeExistingMileyoBoxes(cart) {
    var items = cart && cart.items ? cart.items : [];
    var catalogNumericIds = toCatalogNumericIds(data.boxes);
    var keys = collectMileyoBuilderBoxLineKeys(items, catalogNumericIds);
    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        return removeCartLineByKey(key);
      });
    });
    return chain;
  }

  function replaceSelectedBoxInCart() {
    return fetchStorefrontCart()
      .catch(function () {
        throw new Error("cart_inspect_failed");
      })
      .then(function (cart) {
        return removeExistingMileyoBoxes(cart);
      })
      .then(function () {
        return addSelectedBoxToCart();
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

  function redirectInvalidCheckoutState() {
    if (!isValidObjective(selectedObjective)) {
      showStep("objectif");
      return true;
    }
    if (!selectedBox || !selectedBox.variantId || !selectedBox.sellingPlanId) {
      setError("Choisissez votre box pour continuer.");
      showStep("formule");
      return true;
    }
    if (!isSelectedDeliveryWindowValid()) {
      setError("Choisissez une fenêtre de livraison pour continuer.");
      showStep("livraison");
      return true;
    }
    if (!isMealsSelectionComplete()) {
      setError("Choisissez vos repas avant de continuer.");
      showStep("repas");
      return true;
    }
    if (!isBuilderEmailValid(selectedEmail) || !isCapturedLeadFresh()) {
      setError("Entrez une adresse e-mail valide.");
      showStep("email");
      return true;
    }
    return false;
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

    if (!isMealsSelectionComplete()) {
      setError("Choisissez vos repas avant de continuer.");
      showStep("repas");
      return;
    }

    if (!isSelectedDeliveryWindowValid()) {
      setError("Choisissez une fenêtre de livraison avant de continuer.");
      showStep("livraison");
      return;
    }

    isSubmittingLead = true;
    updateEmailCta();
    setError("");

    captureCheckoutLead()
      .then(function () {
        capturedLeadKey = currentLeadKey();
        isSubmittingLead = false;
        updateEmailCta();
        showStep("recap");
      })
      .catch(function () {
        isSubmittingLead = false;
        updateEmailCta();
        setError("Impossible de continuer pour le moment. Réessayez.");
      });
  }

  function handleRecapSubmit() {
    if (isSubmittingCheckout || isSubmittingLead) return;

    if (redirectInvalidCheckoutState()) {
      updateRecapCta();
      return;
    }

    isSubmittingCheckout = true;
    updateRecapCta();
    setError("");

    replaceSelectedBoxInCart()
      .catch(function (error) {
        isSubmittingCheckout = false;
        updateRecapCta();
        if (error && (error.message === "cart_inspect_failed" || error.message === "cart_remove_failed")) {
          setError(CART_PREPARE_ERROR);
          return;
        }
        if (!errorMessage.textContent) {
          setError("Impossible d’ajouter la box au panier. Réessayez dans un instant.");
        }
      });
  }

  if (emailContinue) {
    emailContinue.addEventListener("click", handleEmailSubmit);
  }

  if (recapContinue) {
    recapContinue.addEventListener("click", handleRecapSubmit);
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

  renderObjectives();
  updateObjectiveCta();
  updateFormulaCta();
  updateDeliveryCta();
  updateSummary();

  if (!isValidObjective(selectedObjective)) {
    showStep("objectif", { replaceHistory: true });
  } else if (location.hash === "#recap" && canEnterRecapStep()) {
    showStep("recap", { replaceHistory: true });
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
