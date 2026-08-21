import { mealFilterRuntimeScript } from "../builder/builder-filter-runtime";
import { mealNutritionFormatRuntimeScript } from "../../utils/mealNutritionFormat";

export const portalClientScript = `
(function () {
  var data = window.__MILEYO_PORTAL__;
  var editors = {};
  var boxChangeStates = {};
  var pendingQuantityPulseMealId = null;
  var selectedAllergenFilters = [];
  var selectedBadgeFilters = [];
  var draftAllergenFilters = [];
  var draftBadgeFilters = [];
  var mealFiltersOpen = false;
  var mealFiltersCloseTimer = null;

  ${mealNutritionFormatRuntimeScript}
  ${mealFilterRuntimeScript}

  var mealNutritionModal = document.getElementById("meal-nutrition-modal");
  var mealNutritionModalMeal = document.getElementById("meal-nutrition-modal-meal");
  var mealNutritionModalList = document.getElementById("meal-nutrition-modal-list");

  var mealDetailOverlay = document.getElementById("meal-detail-overlay");
  var mealDetailMedia = document.getElementById("meal-detail-media");
  var mealDetailTitle = document.getElementById("meal-detail-title");
  var mealDetailBadges = document.getElementById("meal-detail-badges");
  var mealDetailAllergens = document.getElementById("meal-detail-allergens");
  var mealDetailAllergensCopy = document.getElementById("meal-detail-allergens-copy");
  var mealDetailNutrition = document.getElementById("meal-detail-nutrition");
  var mealDetailIngredients = document.getElementById("meal-detail-ingredients");
  var mealDetailIngredientsCopy = document.getElementById("meal-detail-ingredients-copy");
  var mealDetailClose = mealDetailOverlay
    ? mealDetailOverlay.querySelector(".meal-detail-close")
    : null;
  var mealDetailCloseTimer = null;
  var mealDetailLastFocus = null;

  var mealFiltersDrawer = document.getElementById("portal-meal-filters-drawer");
  var mealFiltersApply = document.getElementById("portal-meal-filters-apply");
  var mealFiltersReset = document.getElementById("portal-meal-filters-reset");
  var allergenFilters = document.getElementById("portal-allergen-filters");
  var badgeFilters = document.getElementById("portal-badge-filters");
  var tabButtons = document.querySelectorAll(".portal-tab");
  var tabPanels = document.querySelectorAll(".portal-tab-panel");

  tabButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var tab = button.getAttribute("data-tab");

      tabButtons.forEach(function (item) {
        item.classList.remove("active");
        item.setAttribute("aria-selected", "false");
      });
      tabPanels.forEach(function (panel) {
        panel.classList.add("hidden");
      });

      button.classList.add("active");
      button.setAttribute("aria-selected", "true");

      var panel = document.querySelector('.portal-tab-panel[data-tab-panel="' + tab + '"]');
      if (panel) {
        panel.classList.remove("hidden");
      }
    });
  });

  function mealsForSelection(selection) {
    if (!data.meals || !selection || !selection.objective) return [];
    return data.meals.filter(function (meal) {
      return meal.objective === selection.objective;
    });
  }

  function visibleMealsForSelection(selection) {
    return mealsForSelection(selection).filter(mealMatchesFilter);
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

  function updateMealFiltersToggleCount() {
    var count = activeMealFilterCount();
    Object.keys(editors).forEach(function (selectionId) {
      var editor = editors[selectionId];
      if (!editor || !editor.filtersActiveCount) return;
      editor.filtersActiveCount.textContent = count > 0 ? String(count) : "";
      editor.filtersActiveCount.classList.toggle("hidden", count === 0);
    });
  }

  function setMealFiltersOpen(isOpen) {
    mealFiltersOpen = Boolean(isOpen);
    Object.keys(editors).forEach(function (selectionId) {
      var editor = editors[selectionId];
      if (!editor || !editor.filtersToggle) return;
      editor.filtersToggle.setAttribute(
        "aria-expanded",
        mealFiltersOpen ? "true" : "false",
      );
      editor.filtersToggle.classList.toggle("is-open", mealFiltersOpen);
    });

    if (!mealFiltersDrawer) return;

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

  function openMealFiltersDrawer() {
    closeMealDetail();
    closeMealNutritionModal();
    syncMealFiltersDraftFromSelected();
    renderMealFilters();
    setMealFiltersOpen(true);
  }

  function discardMealFiltersDrawer() {
    setMealFiltersOpen(false);
  }

  function refreshOpenMealEditors() {
    Object.keys(editors).forEach(function (selectionId) {
      var editor = editors[selectionId];
      if (!editor || !editor.editor || editor.editor.classList.contains("hidden")) {
        return;
      }
      updateEditor(editor);
    });
  }

  function applyMealFilters() {
    selectedAllergenFilters = cloneMealFilterIds(draftAllergenFilters);
    selectedBadgeFilters = cloneMealFilterIds(draftBadgeFilters);
    updateMealFiltersToggleCount();
    setMealFiltersOpen(false);
    refreshOpenMealEditors();
  }

  function resetMealFiltersDraft() {
    draftAllergenFilters = [];
    draftBadgeFilters = [];
    renderMealFilters();
  }

  function resetMealFilters() {
    selectedAllergenFilters = [];
    selectedBadgeFilters = [];
    draftAllergenFilters = [];
    draftBadgeFilters = [];
    renderMealFilters();
    updateMealFiltersToggleCount();
    refreshOpenMealEditors();
  }

  function clearMealFiltersOnEditorClose() {
    selectedAllergenFilters = [];
    selectedBadgeFilters = [];
    draftAllergenFilters = [];
    draftBadgeFilters = [];
    if (mealFiltersOpen) {
      setMealFiltersOpen(false);
    }
    updateMealFiltersToggleCount();
  }

  function mealKey(meal) {
    return meal.variantId || meal.id;
  }

  function closeMealNutritionModal() {
    if (!mealNutritionModal) return;
    mealNutritionModal.classList.add("hidden");
    mealNutritionModal.setAttribute("aria-hidden", "true");
    mealNutritionModal.removeAttribute("aria-modal");
    if (mealNutritionModalList) {
      mealNutritionModalList.innerHTML = "";
    }
    if (mealNutritionModalMeal) {
      mealNutritionModalMeal.textContent = "";
    }
  }

  function appendNutritionModalRow(list, label, value) {
    if (!value) return;
    var row = document.createElement("div");
    row.className = "meal-nutrition-modal-row";
    var term = document.createElement("span");
    term.className = "meal-nutrition-modal-row-label";
    term.textContent = label;
    var definition = document.createElement("span");
    definition.className = "meal-nutrition-modal-row-value";
    definition.textContent = value;
    row.appendChild(term);
    row.appendChild(definition);
    list.appendChild(row);
  }

  function openMealNutritionModal(meal, nutrition) {
    if (!mealNutritionModal || !mealNutritionModalList || !nutrition || !nutrition.lines.length) {
      return;
    }

    closeMealDetail();

    mealNutritionModalList.innerHTML = "";
    appendNutritionModalRow(mealNutritionModalList, "Calories", nutrition.calories);
    appendNutritionModalRow(mealNutritionModalList, "Protéines", nutrition.proteins);
    appendNutritionModalRow(mealNutritionModalList, "Glucides", nutrition.carbs);
    appendNutritionModalRow(mealNutritionModalList, "Lipides", nutrition.fat);
    appendNutritionModalRow(mealNutritionModalList, "Portion", nutrition.portionGrams);

    if (mealNutritionModalMeal) {
      mealNutritionModalMeal.textContent = nutrition.portionGrams
        ? "Par portion (" + nutrition.portionGrams + ")"
        : "Par portion";
    }

    mealNutritionModal.classList.remove("hidden");
    mealNutritionModal.setAttribute("aria-hidden", "false");
    mealNutritionModal.setAttribute("aria-modal", "true");
  }

  function findPortalMeal(mealId) {
    if (!data.meals || !mealId) return null;
    for (var i = 0; i < data.meals.length; i += 1) {
      if (mealKey(data.meals[i]) === mealId) {
        return data.meals[i];
      }
    }
    return null;
  }

  function splitMealDetailNutritionDisplay(formatted) {
    if (!formatted) return null;
    var kcalMatch = String(formatted).match(/^([\d\s\u00a0\u202f,.]+)\s*kcal$/i);
    if (kcalMatch) {
      return { unit: "kcal", value: kcalMatch[1].trim() };
    }
    var macroMatch = String(formatted).match(
      /^([\d\s\u00a0\u202f,.]+)\s*g\s+(.+)$/i,
    );
    if (macroMatch) {
      return {
        unit: macroMatch[2].trim(),
        value: macroMatch[1].trim() + "g",
      };
    }
    var gramsMatch = String(formatted).match(/^([\d\s\u00a0\u202f,.]+)\s*g$/i);
    if (gramsMatch) {
      return { unit: "portion", value: gramsMatch[1].trim() + "g" };
    }
    return { unit: "", value: String(formatted) };
  }

  function appendMealDetailNutritionCard(list, formatted) {
    var parts = splitMealDetailNutritionDisplay(formatted);
    if (!parts) return;
    var card = document.createElement("div");
    card.className = "meal-detail-nutrition-card";
    var value = document.createElement("span");
    value.className = "meal-detail-nutrition-value";
    value.textContent = parts.value;
    var unit = document.createElement("span");
    unit.className = "meal-detail-nutrition-unit";
    unit.textContent = parts.unit;
    card.appendChild(value);
    if (parts.unit) {
      card.appendChild(unit);
    }
    list.appendChild(card);
  }

  function closeMealDetail() {
    if (!mealDetailOverlay || mealDetailOverlay.classList.contains("hidden")) return;
    mealDetailOverlay.classList.remove("is-open");
    mealDetailOverlay.setAttribute("aria-hidden", "true");
    mealDetailOverlay.removeAttribute("aria-modal");
    if (mealDetailCloseTimer) {
      window.clearTimeout(mealDetailCloseTimer);
    }
    mealDetailCloseTimer = window.setTimeout(function () {
      mealDetailOverlay.classList.add("hidden");
      mealDetailCloseTimer = null;
      if (mealDetailLastFocus && typeof mealDetailLastFocus.focus === "function") {
        mealDetailLastFocus.focus();
      }
      mealDetailLastFocus = null;
    }, 280);
  }

  function openMealDetail(mealId) {
    var meal = findPortalMeal(mealId);
    if (!meal || !mealDetailOverlay || !mealDetailTitle) return;

    closeMealNutritionModal();

    if (mealDetailCloseTimer) {
      window.clearTimeout(mealDetailCloseTimer);
      mealDetailCloseTimer = null;
    }

    mealDetailLastFocus = document.activeElement;

    if (mealDetailMedia) {
      mealDetailMedia.innerHTML = "";
      if (meal.imageUrl) {
        var image = document.createElement("img");
        image.alt = meal.imageAlt || meal.title;
        image.src = meal.imageUrl;
        mealDetailMedia.appendChild(image);
        mealDetailMedia.classList.remove("meal-detail-media--empty");
      } else {
        mealDetailMedia.classList.add("meal-detail-media--empty");
      }
    }

    mealDetailTitle.textContent = meal.title;

    if (mealDetailBadges) {
      mealDetailBadges.innerHTML = "";
      if (meal.badges && meal.badges.length) {
        meal.badges.forEach(function (badgeText) {
          var badge = document.createElement("span");
          badge.className = "meal-badge meal-badge--" + getBadgeColorSlug(badgeText);
          badge.textContent = badgeText;
          mealDetailBadges.appendChild(badge);
        });
        mealDetailBadges.classList.remove("hidden");
      } else {
        mealDetailBadges.classList.add("hidden");
      }
    }

    if (mealDetailAllergens) {
      if (meal.allergenes && meal.allergenes.length) {
        if (mealDetailAllergensCopy) {
          mealDetailAllergensCopy.textContent = meal.allergenes
            .map(function (entry) {
              return formatAllergenDisplay(entry);
            })
            .join(" · ");
        }
        mealDetailAllergens.classList.remove("hidden");
      } else {
        if (mealDetailAllergensCopy) {
          mealDetailAllergensCopy.textContent = "";
        }
        mealDetailAllergens.classList.add("hidden");
      }
    }

    if (mealDetailNutrition) {
      mealDetailNutrition.innerHTML = "";
      var nutrition = formatMealNutrition({
        calories: meal.calories,
        proteins: meal.proteins,
        carbs: meal.carbs,
        fat: meal.fat,
        portionGrams: meal.portionGrams,
      });
      var macroLines = [
        nutrition.calories,
        nutrition.proteins,
        nutrition.carbs,
        nutrition.fat,
      ].filter(Boolean);
      if (macroLines.length || nutrition.portionGrams) {
        var heading = document.createElement("p");
        heading.className = "meal-detail-section-heading meal-detail-nutrition-heading";
        heading.textContent = nutrition.portionGrams
          ? "Nutrition · Par portion (" + nutrition.portionGrams + ")"
          : "Nutrition";
        mealDetailNutrition.appendChild(heading);
        if (macroLines.length) {
          var grid = document.createElement("div");
          grid.className = "meal-detail-nutrition-grid";
          appendMealDetailNutritionCard(grid, nutrition.calories);
          appendMealDetailNutritionCard(grid, nutrition.proteins);
          appendMealDetailNutritionCard(grid, nutrition.carbs);
          appendMealDetailNutritionCard(grid, nutrition.fat);
          mealDetailNutrition.appendChild(grid);
        }
        mealDetailNutrition.classList.remove("hidden");
      } else {
        mealDetailNutrition.classList.add("hidden");
      }
    }

    if (mealDetailIngredients && mealDetailIngredientsCopy) {
      if (meal.ingredients && meal.ingredients.length) {
        mealDetailIngredientsCopy.textContent = meal.ingredients.join(", ");
        mealDetailIngredients.classList.remove("hidden");
      } else {
        mealDetailIngredientsCopy.textContent = "";
        mealDetailIngredients.classList.add("hidden");
      }
    }

    mealDetailOverlay.classList.remove("hidden");
    mealDetailOverlay.setAttribute("aria-hidden", "false");
    mealDetailOverlay.setAttribute("aria-modal", "true");
    window.requestAnimationFrame(function () {
      mealDetailOverlay.classList.add("is-open");
    });
    if (mealDetailClose && typeof mealDetailClose.focus === "function") {
      mealDetailClose.focus();
    }
  }

  function bindMealDetailOpen(node, meal) {
    if (!node || !meal) return;
    var mealId = mealKey(meal);
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", "Voir le détail de " + meal.title);
    node.addEventListener("click", function () {
      openMealDetail(mealId);
    });
    node.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target !== node) return;
      event.preventDefault();
      openMealDetail(mealId);
    });
  }

  function appendMealNutritionBadge(parent, meal) {
    var nutrition = formatMealNutrition({
      calories: meal.calories,
      proteins: meal.proteins,
      carbs: meal.carbs,
      fat: meal.fat,
      portionGrams: meal.portionGrams,
    });
    if (!nutrition.calories || !nutrition.lines.length) return;

    var badge = document.createElement("button");
    badge.type = "button";
    badge.className = "meal-nutrition-badge";
    badge.setAttribute(
      "aria-label",
      "Voir les valeurs nutritionnelles de " + meal.title,
    );

    var icon = document.createElement("span");
    icon.className = "meal-nutrition-badge-icon";
    icon.setAttribute("aria-hidden", "true");
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
    badge.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openMealNutritionModal(meal, nutrition);
    });
    parent.appendChild(badge);
  }

  function appendMealCardMedia(card, meal) {
    var media = document.createElement("div");
    media.className = "meal-card-media";
    media.classList.add("meal-card-media--interactive");
    if (meal.imageUrl) {
      var image = document.createElement("img");
      image.alt = meal.imageAlt;
      image.src = meal.imageUrl;
      media.appendChild(image);
    } else {
      media.classList.add("meal-card-media--empty");
    }
    appendMealNutritionBadge(media, meal);
    bindMealDetailOpen(media, meal);
    card.appendChild(media);
  }

  function appendMealCardContent(card, meal) {
    var content = document.createElement("div");
    content.className = "meal-card-content";
    content.classList.add("meal-card-content--interactive");

    var title = document.createElement("h2");
    title.className = "meal-title";
    title.textContent = meal.title;
    title.setAttribute("title", meal.title);
    content.appendChild(title);

    if (meal.badges && meal.badges.length) {
      var badges = document.createElement("div");
      badges.className = "meal-badges";
      meal.badges.forEach(function (badgeText) {
        var badge = document.createElement("span");
        badge.className = "meal-badge meal-badge--" + getBadgeColorSlug(badgeText);
        badge.textContent = badgeText;
        badge.setAttribute("title", badgeText);
        badges.appendChild(badge);
      });
      content.appendChild(badges);
    }

    if (meal.allergenes && meal.allergenes.length) {
      var allergens = document.createElement("p");
      allergens.className = "meal-allergenes";
      allergens.textContent =
        "Contient : " +
        meal.allergenes
          .map(function (entry) {
            return formatAllergenDisplay(entry);
          })
          .join(", ");
      allergens.setAttribute("title", allergens.textContent);
      content.appendChild(allergens);
    }

    bindMealDetailOpen(content, meal);
    card.appendChild(content);
  }

  function createPortalMealCard(meal, quantities, requiredMeals, onQuantityChange) {
    var mealId = mealKey(meal);
    quantities[mealId] = quantities[mealId] || 0;
    var quantityValue = quantities[mealId];

    var card = document.createElement("article");
    card.className =
      "meal-card" + (quantityValue > 0 ? " is-selected" : "");

    appendMealCardMedia(card, meal);
    appendMealCardContent(card, meal);

    var quantityRow = document.createElement("div");
    quantityRow.className = "quantity-row";

    var minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "-";
    minus.disabled = quantityValue === 0;
    minus.setAttribute("aria-label", "Retirer " + meal.title);
    minus.addEventListener("click", function () {
      pendingQuantityPulseMealId = mealId;
      quantities[mealId] = Math.max(0, (quantities[mealId] || 0) - 1);
      onQuantityChange();
    });

    var quantity = document.createElement("span");
    quantity.className = "meal-quantity";
    if (pendingQuantityPulseMealId === mealId) {
      quantity.classList.add("is-pulsing");
      pendingQuantityPulseMealId = null;
    }
    quantity.textContent = String(quantities[mealId] || 0);

    var plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.disabled = selectedTotal(quantities) >= requiredMeals;
    plus.setAttribute("aria-label", "Ajouter " + meal.title);
    plus.addEventListener("click", function () {
      if (selectedTotal(quantities) >= requiredMeals) return;
      pendingQuantityPulseMealId = mealId;
      quantities[mealId] = (quantities[mealId] || 0) + 1;
      onQuantityChange();
    });

    quantityRow.appendChild(minus);
    quantityRow.appendChild(quantity);
    quantityRow.appendChild(plus);
    card.appendChild(quantityRow);
    return card;
  }

  function selectedTotal(quantities) {
    return Object.keys(quantities).reduce(function (total, mealId) {
      return total + (quantities[mealId] || 0);
    }, 0);
  }

  function renderMealGrid(editor) {
    if (!editor.mealGrid) return;
    var selection = data.selections.find(function (item) {
      return item.id === editor.selectionId;
    });
    var objectiveMeals = mealsForSelection(selection);
    var visibleMeals = visibleMealsForSelection(selection);
    var noObjectiveMeals = objectiveMeals.length === 0;
    var noVisibleMeals = visibleMeals.length === 0;

    editor.mealGrid.innerHTML = "";
    visibleMeals.forEach(function (meal) {
      editor.mealGrid.appendChild(
        createPortalMealCard(
          meal,
          editor.quantities,
          editor.requiredMeals,
          function () {
            updateEditor(editor);
          },
        ),
      );
    });
    pendingQuantityPulseMealId = null;

    if (editor.emptyState) {
      editor.emptyState.classList.toggle("hidden", !noVisibleMeals);
    }
    if (editor.emptyStateCopy) {
      if (noObjectiveMeals) {
        editor.emptyStateCopy.innerHTML =
          "Aucun plat n’est disponible pour cet objectif pour le moment.";
      } else {
        editor.emptyStateCopy.innerHTML =
          "Aucun plat ne correspond à ces filtres.<br>Essayez de retirer un allergène ou une envie.";
      }
    }
    if (editor.emptyStateReset) {
      editor.emptyStateReset.classList.toggle(
        "hidden",
        noObjectiveMeals || !hasActiveMealFilters(),
      );
    }
    editor.mealGrid.classList.toggle("hidden", noVisibleMeals);
  }

  function updateEditor(editor) {
    if (!editor.selectedCount) return;
    var total = selectedTotal(editor.quantities);
    var required = editor.requiredMeals;
    var percent =
      required > 0 ? Math.min(100, Math.round((total / required) * 100)) : 0;
    var isComplete = required > 0 && total === required;

    editor.selectedCount.textContent = total + " / " + required + " repas";

    if (editor.progressFill) {
      editor.progressFill.style.width = percent + "%";
    }
    if (editor.progressTrack) {
      editor.progressTrack.setAttribute("aria-valuenow", String(total));
      editor.progressTrack.setAttribute("aria-valuemax", String(required));
    }
    if (editor.progress) {
      editor.progress.classList.toggle("is-complete", isComplete);
    }
    if (editor.editor) {
      editor.editor.classList.toggle("is-week-complete", isComplete);
    }

    if (editor.saveButton) {
      editor.saveButton.disabled = !isComplete;
    }
    if (editor.resumeButton) {
      editor.resumeButton.disabled = !isComplete;
    }
    if (editor.errorMessage) {
      editor.errorMessage.classList.add("hidden");
    }
    renderMealGrid(editor);
  }

  function setMealEditingState(editor, isEditing) {
    if (!editor || !editor.card) return;
    editor.card.classList.toggle("is-meal-editing", Boolean(isEditing));
  }

  function setEditorError(editor, message) {
    if (!editor.errorMessage) return;
    editor.errorMessage.textContent = message;
    editor.errorMessage.classList.toggle("hidden", !message);
  }

  function closeMealEditor(editor) {
    if (!editor) return;
    editor.editor.classList.add("hidden");
    if (editor.editButton) {
      editor.editButton.classList.remove("hidden");
    }
    setMealEditingState(editor, false);
    setEditorError(editor, "");
    clearMealFiltersOnEditorClose();
  }

  function closeBoxChange(selectionId) {
    var boxChangeState = boxChangeStates[selectionId];
    if (!boxChangeState) return;
    boxChangeState.boxChangeEditor.classList.add("hidden");
    if (boxChangeState.changeBoxButton) {
      boxChangeState.changeBoxButton.classList.remove("hidden");
    }
    boxChangeState.selectedBox = null;
    boxChangeState.quantities = {};
    boxChangeState.requiredMeals = 0;
    setBoxChangeError(boxChangeState, "");
  }

  function setBoxChangeError(boxChangeState, message) {
    boxChangeState.errorMessages.forEach(function (node) {
      node.textContent = message || "";
      node.classList.toggle("hidden", !message);
    });
  }

  function closeObjectiveSupport(selectionId) {
    var card = document.querySelector('.selection-card[data-selection-id="' + selectionId + '"]');
    if (!card) return;
    var panel = card.querySelector(".objective-support-panel");
    var button = card.querySelector(".change-objective-button");
    if (panel) {
      panel.classList.add("hidden");
    }
    if (button) {
      button.classList.remove("hidden");
    }
  }

  function closeAllFlows(exceptId) {
    Object.keys(editors).forEach(function (selectionId) {
      if (selectionId === exceptId) return;
      closeMealEditor(editors[selectionId]);
      closeBoxChange(selectionId);
      closeObjectiveSupport(selectionId);
    });
  }

  document.querySelectorAll(".selection-card").forEach(function (card) {
    var selectionId = card.getAttribute("data-selection-id");
    var selection = data.selections.find(function (item) {
      return item.id === selectionId;
    });
    if (!selection) return;

    var editor = {
      cancelButton: card.querySelector(".cancel-button"),
      card: card,
      editButton: card.querySelector(".edit-button"),
      editor: card.querySelector(".editor"),
      emptyState: card.querySelector(".meal-editor-empty"),
      emptyStateCopy: card.querySelector(".meal-editor-empty-copy"),
      emptyStateReset: card.querySelector(".meal-editor-empty-reset"),
      errorMessage: card.querySelector(".meal-editor-error"),
      filtersActiveCount: card.querySelector(".meal-filters-toggle-count"),
      filtersToggle: card.querySelector(".meal-filters-toggle"),
      isPaused: selection.portalState === "paused",
      isResumeProcessing: selection.portalState === "resume_processing",
      mealGrid: card.querySelector(".meal-editor-grid"),
      progress: card.querySelector(".meal-week-progress"),
      progressFill: card.querySelector(".meal-week-progress-fill"),
      progressTrack: card.querySelector(".meal-week-progress-track"),
      quantities: JSON.parse(JSON.stringify(data.initialQuantities[selectionId] || {})),
      requiredMeals: selection.mealsCount,
      resumeButton: card.querySelector(".resume-button"),
      resumeButtonLabel: selection.resumeRequiresPayment
        ? "Reprendre mon abonnement et payer maintenant"
        : "Reprendre mon abonnement",
      saveButton: card.querySelector(".save-button"),
      saveButtonLabel: "Valider ma semaine",
      selectedCount: card.querySelector(".meal-editor-count"),
      selectionId: selectionId
    };

    editors[selectionId] = editor;

    if (editor.filtersToggle) {
      editor.filtersToggle.addEventListener("click", function () {
        if (mealFiltersOpen) {
          discardMealFiltersDrawer();
          return;
        }
        openMealFiltersDrawer();
      });
    }

    if (editor.emptyStateReset) {
      editor.emptyStateReset.addEventListener("click", function () {
        resetMealFilters();
      });
    }

    if (editor.isPaused && !selection.resumeBlockedMessage) {
      setMealEditingState(editor, true);
      updateEditor(editor);
    }

    if (editor.isResumeProcessing) {
      if (editor.resumeButton) {
        editor.resumeButton.disabled = true;
      }
      if (editor.saveButton) {
        editor.saveButton.disabled = true;
      }
    }

    if (editor.editButton) {
      editor.editButton.addEventListener("click", function () {
        closeAllFlows(selectionId);
        closeBoxChange(selectionId);
        closeObjectiveSupport(selectionId);
        clearMealFiltersOnEditorClose();
        editor.quantities = JSON.parse(JSON.stringify(data.initialQuantities[selectionId] || {}));
        editor.editButton.classList.add("hidden");
        editor.editor.classList.remove("hidden");
        setMealEditingState(editor, true);
        updateEditor(editor);
      });

      if (editor.cancelButton) {
        editor.cancelButton.addEventListener("click", function () {
          editor.quantities = JSON.parse(JSON.stringify(data.initialQuantities[selectionId] || {}));
          closeMealEditor(editor);
        });
      }
    }

    if (editor.saveButton) {
      editor.saveButton.addEventListener("click", function () {
        if (selectedTotal(editor.quantities) !== editor.requiredMeals) return;

        editor.saveButton.disabled = true;
        editor.saveButton.textContent = "Enregistrement...";
        setEditorError(editor, "");

        var body = new URLSearchParams();
        body.set("intent", "updateFutureMealSelection");
        body.set("selectionId", editor.selectionId);
        body.set("selectedMeals", JSON.stringify(editor.quantities));

        fetch(window.location.pathname + window.location.search, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString()
        }).then(function (response) {
          return response.text().then(function (html) {
            document.open();
            document.write(html);
            document.close();
          });
        }).catch(function () {
          editor.saveButton.textContent = editor.saveButtonLabel;
          updateEditor(editor);
          setEditorError(editor, "Impossible d’enregistrer tes plats. Réessayez dans un instant.");
        });
      });
    }

    if (editor.resumeButton) {
      editor.resumeButton.addEventListener("click", function () {
        if (selectedTotal(editor.quantities) !== editor.requiredMeals) return;

        editor.resumeButton.disabled = true;
        editor.resumeButton.textContent = "Traitement en cours...";
        if (editor.saveButton) {
          editor.saveButton.disabled = true;
        }
        setEditorError(editor, "");

        var resumeBody = new URLSearchParams();
        resumeBody.set(
          "intent",
          selection.resumeRequiresPayment ? "resumeSubscriptionAndPay" : "resumeSubscription"
        );
        resumeBody.set("selectionId", editor.selectionId);
        resumeBody.set("selectedMeals", JSON.stringify(editor.quantities));

        fetch(window.location.pathname + window.location.search, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: resumeBody.toString()
        }).then(function (response) {
          return response.text().then(function (html) {
            document.open();
            document.write(html);
            document.close();
          });
        }).catch(function () {
          editor.resumeButton.textContent = editor.resumeButtonLabel;
          updateEditor(editor);
          setEditorError(editor, "Impossible de reprendre l’abonnement. Réessayez dans un instant.");
        });
      });
    }

    var paymentUpdateButton = card.querySelector(".payment-update-button");
    if (paymentUpdateButton) {
      paymentUpdateButton.addEventListener("click", function () {
        paymentUpdateButton.disabled = true;
        paymentUpdateButton.textContent = "Envoi en cours...";

        var paymentBody = new URLSearchParams();
        paymentBody.set("intent", "sendPaymentUpdateEmail");
        paymentBody.set("selectionId", selectionId);

        fetch(window.location.pathname + window.location.search, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: paymentBody.toString()
        }).then(function (response) {
          return response.text().then(function (html) {
            document.open();
            document.write(html);
            document.close();
          });
        }).catch(function () {
          paymentUpdateButton.disabled = false;
          paymentUpdateButton.textContent = "Recevoir un lien sécurisé pour mettre à jour ma carte";
          alert("Impossible d’envoyer l’email pour le moment. Réessayez demain.");
        });
      });
    }

    var changeObjectiveButton = card.querySelector(".change-objective-button");
    var objectiveSupportPanel = card.querySelector(".objective-support-panel");
    if (changeObjectiveButton && objectiveSupportPanel) {
      changeObjectiveButton.addEventListener("click", function () {
        closeAllFlows(selectionId);
        closeMealEditor(editor);
        closeBoxChange(selectionId);
        changeObjectiveButton.classList.add("hidden");
        objectiveSupportPanel.classList.remove("hidden");
      });
    }

    var pauseButton = card.querySelector(".pause-button");
    if (pauseButton) {
      pauseButton.addEventListener("click", function () {
        if (!confirm("Confirmer la mise en pause de ton abonnement ?")) return;

        pauseButton.disabled = true;
        pauseButton.textContent = "Mise en pause...";

        var pauseBody = new URLSearchParams();
        pauseBody.set("intent", "pauseSubscription");
        pauseBody.set("selectionId", selectionId);

        fetch(window.location.pathname + window.location.search, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: pauseBody.toString()
        }).then(function (response) {
          return response.text().then(function (html) {
            document.open();
            document.write(html);
            document.close();
          });
        }).catch(function () {
          pauseButton.disabled = false;
          pauseButton.textContent = "Mettre mon abonnement en pause";
          alert("Impossible de mettre ton abonnement en pause. Réessayez dans un instant.");
        });
      });
    }

    var changeBoxButton = card.querySelector(".change-box-button");
    var boxChangeEditor = card.querySelector(".box-change-editor");
    if (changeBoxButton && boxChangeEditor) {
      var boxChangeState = {
        boxChangeEditor: boxChangeEditor,
        changeBoxButton: changeBoxButton,
        confirmButton: boxChangeEditor.querySelector(".box-change-confirm"),
        counts: boxChangeEditor.querySelectorAll(".box-change-count"),
        currentVariantId: selection.currentVariantId,
        errorMessages: boxChangeEditor.querySelectorAll(".box-change-error"),
        mealGrid: boxChangeEditor.querySelector(".box-change-meal-grid"),
        quantities: {},
        requiredMeals: 0,
        selectedBox: null,
        selectionId: selectionId,
        step: 1
      };

      boxChangeStates[selectionId] = boxChangeState;

      function formatPrice(price) {
        var amount = parseFloat(String(price).replace(",", "."));
        if (!isFinite(amount)) return String(price) + " € / semaine";
        return amount.toLocaleString("fr-FR", {
          maximumFractionDigits: 2,
          minimumFractionDigits: amount % 1 === 0 ? 0 : 2
        }) + " € / semaine";
      }

      function showBoxChangeStep(step) {
        boxChangeState.step = step;
        boxChangeEditor.querySelectorAll(".box-change-step").forEach(function (node) {
          var nodeStep = Number(node.getAttribute("data-step"));
          node.classList.toggle("hidden", nodeStep !== step);
        });
      }

      function updateBoxChangeCounts() {
        var total = selectedTotal(boxChangeState.quantities);
        boxChangeState.counts.forEach(function (node) {
          node.textContent = total + " / " + boxChangeState.requiredMeals + " plats sélectionnés";
        });
        var isValid = total === boxChangeState.requiredMeals;
        if (boxChangeState.confirmButton) {
          boxChangeState.confirmButton.disabled = !isValid || !boxChangeState.selectedBox;
        }
      }

      function renderBoxChangeMealGrid() {
        if (!boxChangeState.mealGrid) return;
        boxChangeState.mealGrid.innerHTML = "";
        mealsForSelection(selection).forEach(function (meal) {
          boxChangeState.mealGrid.appendChild(
            createPortalMealCard(
              meal,
              boxChangeState.quantities,
              boxChangeState.requiredMeals,
              function () {
                renderBoxChangeMealGrid();
                updateBoxChangeCounts();
              },
            ),
          );
        });
        pendingQuantityPulseMealId = null;
      }

      function updateSelectedBoxLabels() {
        var label = boxChangeState.selectedBox
          ? boxChangeState.selectedBox.title + " · " + boxChangeState.selectedBox.mealCount + " repas · " + formatPrice(boxChangeState.selectedBox.price)
          : "";
        boxChangeEditor.querySelectorAll(".box-change-selected-box").forEach(function (node) {
          node.textContent = label;
        });
      }

      changeBoxButton.addEventListener("click", function () {
        closeAllFlows(selectionId);
        closeMealEditor(editor);
        closeObjectiveSupport(selectionId);
        boxChangeState.selectedBox = null;
        boxChangeState.quantities = {};
        boxChangeState.requiredMeals = 0;
        boxChangeEditor.querySelectorAll(".box-card").forEach(function (node) {
          node.classList.toggle("selected", node.getAttribute("data-variant-id") === boxChangeState.currentVariantId);
        });
        setBoxChangeError(boxChangeState, "");
        changeBoxButton.classList.add("hidden");
        if (editor.editButton) {
          editor.editButton.classList.add("hidden");
        }
        boxChangeEditor.classList.remove("hidden");
        showBoxChangeStep(1);
      });

      boxChangeEditor.querySelectorAll(".box-card").forEach(function (boxCard) {
        boxCard.addEventListener("click", function () {
          if (boxCard.getAttribute("data-available") === "false") {
            setBoxChangeError(boxChangeState, "Cette box n’est pas encore disponible.");
            return;
          }

          var variantId = boxCard.getAttribute("data-variant-id");
          var selectedBox = data.boxes.find(function (box) {
            return box.variantId === variantId;
          });
          if (!selectedBox || selectedBox.mealCount == null) return;

          if (selection.objective && selectedBox.objective !== selection.objective) {
            setBoxChangeError(boxChangeState, "Cette box n’est pas disponible pour votre objectif actuel.");
            return;
          }

          boxChangeState.selectedBox = selectedBox;
          boxChangeState.requiredMeals = selectedBox.mealCount;
          boxChangeState.quantities = {};
          boxChangeEditor.querySelectorAll(".box-card").forEach(function (node) {
            node.classList.toggle("selected", node.getAttribute("data-variant-id") === variantId);
          });
          updateSelectedBoxLabels();
          setBoxChangeError(boxChangeState, "");
          renderBoxChangeMealGrid();
          updateBoxChangeCounts();
          showBoxChangeStep(2);
        });
      });

      var boxChangeCancel = boxChangeEditor.querySelector(".box-change-cancel");
      if (boxChangeCancel) {
        boxChangeCancel.addEventListener("click", function () {
          closeBoxChange(selectionId);
          if (editor.editButton && selection.portalState === "active") {
            editor.editButton.classList.remove("hidden");
          }
        });
      }

      var boxChangeBack = boxChangeEditor.querySelector(".box-change-back");
      if (boxChangeBack) {
        boxChangeBack.addEventListener("click", function () {
          boxChangeState.selectedBox = null;
          boxChangeState.quantities = {};
          boxChangeState.requiredMeals = 0;
          setBoxChangeError(boxChangeState, "");
          showBoxChangeStep(1);
        });
      }

      if (boxChangeState.confirmButton) {
        boxChangeState.confirmButton.addEventListener("click", function () {
          if (!boxChangeState.selectedBox) return;
          if (selectedTotal(boxChangeState.quantities) !== boxChangeState.requiredMeals) return;

          boxChangeState.confirmButton.disabled = true;
          boxChangeState.confirmButton.textContent = "Enregistrement...";
          setBoxChangeError(boxChangeState, "");

          var body = new URLSearchParams();
          body.set("intent", "changeSubscriptionBox");
          body.set("selectionId", boxChangeState.selectionId);
          body.set("productVariantId", boxChangeState.selectedBox.variantId);
          body.set("selectedMeals", JSON.stringify(boxChangeState.quantities));

          fetch(window.location.pathname + window.location.search, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString()
          }).then(function (response) {
            return response.text().then(function (html) {
              document.open();
              document.write(html);
              document.close();
            });
          }).catch(function () {
            boxChangeState.confirmButton.textContent = selection.portalState === "paused"
              ? "Enregistrer ma nouvelle box"
              : "Confirmer ma nouvelle box pour la prochaine commande";
            updateBoxChangeCounts();
            setBoxChangeError(boxChangeState, "Impossible d’enregistrer votre nouvelle box. Réessayez dans un instant.");
          });
        });
      }
    }
  });

  if (mealNutritionModal) {
    mealNutritionModal.addEventListener("click", function (event) {
      var target = event.target;
      if (
        target &&
        (target.classList.contains("meal-nutrition-modal-backdrop") ||
          target.classList.contains("meal-nutrition-modal-close"))
      ) {
        closeMealNutritionModal();
      }
    });
  }

  if (mealDetailOverlay) {
    mealDetailOverlay.addEventListener("click", function (event) {
      var target = event.target;
      if (
        target &&
        (target.classList.contains("meal-detail-overlay-backdrop") ||
          target.classList.contains("meal-detail-close"))
      ) {
        closeMealDetail();
      }
    });
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

  if (mealFiltersApply) {
    mealFiltersApply.addEventListener("click", function () {
      applyMealFilters();
    });
  }

  if (mealFiltersReset) {
    mealFiltersReset.addEventListener("click", function () {
      resetMealFiltersDraft();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (mealFiltersOpen) {
        discardMealFiltersDrawer();
        return;
      }
      if (mealDetailOverlay && !mealDetailOverlay.classList.contains("hidden")) {
        closeMealDetail();
        return;
      }
      closeMealNutritionModal();
    }
  });

  document.querySelectorAll("[data-meal-summary]").forEach(function (summary) {
    var toggle = summary.querySelector(".meal-summary-toggle");
    if (!toggle) return;

    toggle.addEventListener("click", function () {
      var expanded = summary.classList.toggle("is-expanded");
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.textContent = expanded ? "Réduire" : "Voir tout";
    });
  });
})();
`;
