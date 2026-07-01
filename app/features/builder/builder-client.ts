export const builderClientScript = `
(function () {
  var data = window.__MILEYO_BOX_BUILDER__;
  var orderType = "one-time";
  var selectedBox = null;
  var requiredMeals = 0;
  var selectedMeals = {};

  var boxGrid = document.getElementById("box-grid");
  var mealGrid = document.getElementById("meal-grid");
  var mealsSection = document.getElementById("meals-section");
  var selectedCount = document.getElementById("selected-count");
  var addToCart = document.getElementById("add-to-cart");
  var boxHelper = document.getElementById("box-helper");
  var errorMessage = document.getElementById("error-message");
  var oneTimeToggle = document.getElementById("one-time-toggle");
  var subscriptionToggle = document.getElementById("subscription-toggle");

  function getMealCountFromTitle(title) {
    var match = title.match(/\\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  function getVariantCartId(variantId) {
    if (!variantId) return "";
    var parts = variantId.split("/");
    return parts[parts.length - 1] || "";
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

  function selectedTotal() {
    return Object.keys(selectedMeals).reduce(function (total, mealId) {
      return total + selectedMeals[mealId];
    }, 0);
  }

  function setError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.toggle("hidden", !message);
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
    updateSummary();
  }

  function renderBoxes() {
    boxGrid.innerHTML = "";
    data.boxes.forEach(function (box) {
      var button = document.createElement("button");
      button.className = "product-card selectable";
      button.type = "button";

      if (box.imageUrl) {
        var image = document.createElement("img");
        image.alt = box.imageAlt;
        image.src = box.imageUrl;
        button.appendChild(image);
      }

      var title = document.createElement("span");
      title.className = "product-title";
      title.textContent = box.title;
      button.appendChild(title);

      var variant = document.createElement("span");
      variant.className = "muted";
      variant.textContent = box.variantTitle;
      button.appendChild(variant);

      if (box.variantPrice) {
        var price = document.createElement("span");
        price.textContent = "Commande unique : " + formatEuros(box.variantPrice);
        button.appendChild(price);
      }

      var subscriptionPrice = document.createElement("span");
      subscriptionPrice.className = box.subscriptionPrice ? "" : "muted";
      subscriptionPrice.textContent = box.subscriptionPrice
        ? "Abonnement : " + formatEuros(box.subscriptionPrice)
        : "Abonnement bientôt disponible";
      button.appendChild(subscriptionPrice);

      button.addEventListener("click", function () {
        console.log("Selected box", box);
        selectedBox = box;
        requiredMeals = getMealCountFromTitle(box.title);
        selectedMeals = {};
        setError("");
        boxHelper.textContent = requiredMeals + " repas à sélectionner";
        mealsSection.classList.remove("hidden");

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

        renderMeals();
        updateSummary();
      });

      boxGrid.appendChild(button);
    });
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

  renderBoxes();
  updateSummary();
})();
`;
