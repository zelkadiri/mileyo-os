export const builderClientScript = `
(function () {
  var data = window.__MILEYO_BOX_BUILDER__;
  var orderType = "one-time";
  var selectedBox = null;
  var requiredMeals = 0;
  var selectedMeals = {};
  var currentStep = "formule";
  var mealsRendered = false;
  var FIRST_WEEK_DISCOUNT_EUR = 20;

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
      tunnelBack.textContent = isFormula ? "← Retour" : "← Modifier ma formule";
    }
    if (formulaFooter) {
      formulaFooter.classList.toggle("hidden", !isFormula);
    }
    if (mealsLead && selectedBox && requiredMeals) {
      mealsLead.textContent = "Pour votre box de " + requiredMeals + " repas";
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
      mealsSection.classList.add("hidden");
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
      mealsSection.classList.remove("hidden");
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

    button.classList.add("selected");
    var badge = document.createElement("span");
    badge.className = "selected-badge";
    badge.textContent = "Sélectionnée";
    button.insertBefore(badge, button.firstChild);

    updateFormulaCta();
    updateSummary();
    scrollBoxIntoView(button);
    window.requestAnimationFrame(updateBoxRailNav);
  }

  function appendSubscriptionPricing(button, box) {
    var weeklyPrice = getWeeklyPriceValue(box.subscriptionPrice);
    if (weeklyPrice === null) return;

    var firstWeekPrice = getFirstWeekDisplayPrice(box.subscriptionPrice);
    var promo = document.createElement("p");
    promo.className = "box-promo-price";
    promo.innerHTML =
      "<strong>" + formatEuros(firstWeekPrice) + "</strong> au lieu de <s>" +
      formatEuros(weeklyPrice) + "</s> la première semaine";
    button.appendChild(promo);

    var weekly = document.createElement("p");
    weekly.className = "box-weekly-price";
    weekly.textContent = "Puis " + formatEuros(weeklyPrice) + " / semaine";
    button.appendChild(weekly);

    var note = document.createElement("p");
    note.className = "box-promo-note";
    note.textContent = "Réduction de 20 € appliquée automatiquement au paiement";
    button.appendChild(note);
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
      button.className = "product-card selectable" + (isAvailable ? "" : " unavailable");
      button.type = "button";
      button.disabled = !isAvailable;

      if (selectedBox && selectedBox.id === box.id) {
        button.classList.add("selected");
        var selectedBadge = document.createElement("span");
        selectedBadge.className = "selected-badge";
        selectedBadge.textContent = "Sélectionnée";
        button.insertBefore(selectedBadge, button.firstChild);
      }

      if (box.imageUrl) {
        var image = document.createElement("img");
        image.alt = box.imageAlt;
        image.src = box.imageUrl;
        button.appendChild(image);
      }

      if (isAvailable) {
        var mealCount = document.createElement("span");
        mealCount.className = "box-meal-count";
        mealCount.textContent = box.mealCount + (orderType === "subscription" ? " repas par semaine" : " repas");
        button.appendChild(mealCount);

        var tagline = document.createElement("span");
        tagline.className = "box-tagline";
        tagline.textContent = box.title;
        button.appendChild(tagline);

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
    selectedCount.textContent = total + " / " + requiredMeals + " plats sélectionnés";
    var subscriptionUnavailable = orderType === "subscription" && selectedBox && (!selectedBox.sellingPlanId || !selectedBox.subscriptionPrice);
    addToCart.disabled = !selectedBox || requiredMeals === 0 || total !== requiredMeals || subscriptionUnavailable;
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
    renderBoxes();
    updateFormulaCta();
    updateSummary();
  }

  function renderMeals() {
    mealGrid.innerHTML = "";
    data.meals.forEach(function (meal) {
      selectedMeals[meal.id] = selectedMeals[meal.id] || 0;

      var card = document.createElement("article");
      card.className = "product-card";

      if (meal.imageUrl) {
        var image = document.createElement("img");
        image.alt = meal.imageAlt;
        image.src = meal.imageUrl;
        card.appendChild(image);
      }

      var title = document.createElement("span");
      title.className = "product-title";
      title.textContent = meal.title;
      card.appendChild(title);

      var variant = document.createElement("span");
      variant.className = "muted";
      variant.textContent = meal.variantTitle;
      card.appendChild(variant);

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
      addToCart.textContent = "Ajouter au panier";
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
