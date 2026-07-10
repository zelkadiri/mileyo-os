import { mealFilterRuntimeScript } from "./builder-filter-runtime";

export const builderClientScript = `
(function () {
  var data = window.__MILEYO_BOX_BUILDER__;
  var orderType = "subscription";
  var selectedBox = null;
  var requiredMeals = 0;
  var selectedMeals = {};
  var currentStep = "formule";
  var mealsRendered = false;
  var FIRST_WEEK_DISCOUNT_EUR = 20;
  var RECOMMENDED_MEAL_COUNT = 12;

  var boxGrid = document.getElementById("box-grid");
  var boxRailViewport = document.getElementById("box-rail-viewport");
  var boxRailPrev = document.getElementById("box-rail-prev");
  var boxRailNext = document.getElementById("box-rail-next");
  var mealGrid = document.getElementById("meal-grid");
  var mealsSection = document.getElementById("meals-section");
  var stepFormula = document.getElementById("step-formula");
  var stepMeals = document.getElementById("step-meals");
  var selectedCount = document.getElementById("selected-count");
  var addToCart = document.getElementById("add-to-cart");
  var boxHelper = document.getElementById("box-helper");
  var errorMessage = document.getElementById("error-message");
  var oneTimeToggle = document.getElementById("one-time-toggle");
  var subscriptionToggle = document.getElementById("subscription-toggle");
  var tunnelBack = document.getElementById("tunnel-back");
  var tunnelStepLabel = document.getElementById("tunnel-step-label");
  var tunnelProgressFill = document.getElementById("tunnel-progress-fill");
  var formulaContinue = document.getElementById("formula-continue");
  var formulaFooter = document.getElementById("formula-footer");
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
    var hideOnMeals = currentStep === "repas";
    tunnelPromo.classList.toggle("hidden", hideOnMeals || orderType === "one-time");
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
    var isFormula = step === "formule";
    currentStep = step;
    document.body.classList.toggle("is-step-meals", !isFormula);

    if (tunnelStepLabel) {
      tunnelStepLabel.textContent = isFormula ? "Étape 1 sur 2" : "Étape 2 sur 2";
    }
    if (tunnelProgressFill) {
      tunnelProgressFill.classList.toggle("is-step-2", !isFormula);
    }
    if (tunnelBack) {
      tunnelBack.classList.toggle("is-meals-step", !isFormula);
    }
    if (formulaFooter) {
      formulaFooter.classList.toggle("hidden", !isFormula);
    }
    if (mealsGaugeFooter) {
      mealsGaugeFooter.classList.toggle("hidden", isFormula);
    }
    if (tunnelPromo) {
      tunnelPromo.classList.toggle("hidden", !isFormula || orderType === "one-time");
    }
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

    if (step === "repas" && !selectedBox) {
      step = "formule";
    }

    updateTunnelChrome(step);

    if (step === "formule") {
      stepFormula.classList.remove("hidden");
      stepMeals.classList.add("hidden");
      window.requestAnimationFrame(function () {
        if (selectedBox) {
          var selectedCard = boxGrid.querySelector(".product-card.selected");
          scrollBoxIntoView(selectedCard);
        }
        updateBoxRailNav();
      });
    } else {
      stepFormula.classList.add("hidden");
      stepMeals.classList.remove("hidden");
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

  function goToFormulaFromMeals() {
    if (location.hash === "#repas") {
      history.back();
      return;
    }
    showStep("formule", { pushHistory: false });
  }

  function handleTunnelBack() {
    if (currentStep === "repas") {
      goToFormulaFromMeals();
      return;
    }
    window.location.href = "/";
  }

  function handleHistoryNavigation() {
    var hash = (location.hash || "#formule").replace("#", "");
    if (hash === "repas" && selectedBox) {
      showStep("repas", { pushHistory: false });
      return;
    }
    showStep("formule", { pushHistory: false });
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

    var variantId = getVariantCartId(selectedBox.variantId);
    if (!variantId) {
      setError("Cette box n’a pas de variante disponible.");
      return;
    }

    var properties = {
      "Type de commande": orderType === "subscription" ? "Abonnement hebdomadaire" : "Commande unique",
      "Nombre de repas": String(requiredMeals)
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

  formulaContinue.addEventListener("click", function () {
    if (!selectedBox || !requiredMeals) return;
    showStep("repas");
  });

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
  updatePromoBanner();
  renderBoxes();
  updateFormulaCta();
  updateSummary();

  if (location.hash === "#repas" && selectedBox) {
    showStep("repas", { replaceHistory: true });
  } else {
    showStep("formule", { replaceHistory: true });
  }
})();
`;
