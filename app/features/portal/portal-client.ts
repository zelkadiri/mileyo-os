export const portalClientScript = `
(function () {
  var data = window.__MILEYO_PORTAL__;
  var editors = {};
  var boxChangeStates = {};

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

  function mealKey(meal) {
    return meal.variantId || meal.id;
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
    editor.mealGrid.innerHTML = "";
    mealsForSelection(selection).forEach(function (meal) {
      var mealId = mealKey(meal);
      editor.quantities[mealId] = editor.quantities[mealId] || 0;

      var card = document.createElement("article");
      card.className = "meal-card";

      if (meal.imageUrl) {
        var image = document.createElement("img");
        image.alt = meal.imageAlt;
        image.src = meal.imageUrl;
        card.appendChild(image);
      }

      var title = document.createElement("span");
      title.className = "meal-title";
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
      minus.disabled = editor.quantities[mealId] === 0;
      minus.setAttribute("aria-label", "Retirer " + meal.title);
      minus.addEventListener("click", function () {
        editor.quantities[mealId] = Math.max(0, editor.quantities[mealId] - 1);
        updateEditor(editor);
      });

      var quantity = document.createElement("span");
      quantity.textContent = String(editor.quantities[mealId]);

      var plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.disabled = selectedTotal(editor.quantities) >= editor.requiredMeals;
      plus.setAttribute("aria-label", "Ajouter " + meal.title);
      plus.addEventListener("click", function () {
        if (selectedTotal(editor.quantities) >= editor.requiredMeals) return;
        editor.quantities[mealId] += 1;
        updateEditor(editor);
      });

      quantityRow.appendChild(minus);
      quantityRow.appendChild(quantity);
      quantityRow.appendChild(plus);
      card.appendChild(quantityRow);
      editor.mealGrid.appendChild(card);
    });
  }

  function updateEditor(editor) {
    if (!editor.selectedCount) return;
    var total = selectedTotal(editor.quantities);
    editor.selectedCount.textContent = total + " / " + editor.requiredMeals + " plats sélectionnés";
    var isValid = total === editor.requiredMeals;
    if (editor.saveButton) {
      editor.saveButton.disabled = !isValid;
    }
    if (editor.resumeButton) {
      editor.resumeButton.disabled = !isValid;
    }
    if (editor.errorMessage) {
      editor.errorMessage.classList.add("hidden");
    }
    renderMealGrid(editor);
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
    setEditorError(editor, "");
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
      editButton: card.querySelector(".edit-button"),
      editor: card.querySelector(".editor"),
      errorMessage: card.querySelector(".meal-editor-error"),
      isPaused: selection.portalState === "paused",
      isResumeProcessing: selection.portalState === "resume_processing",
      mealGrid: card.querySelector(".meal-editor-grid"),
      quantities: JSON.parse(JSON.stringify(data.initialQuantities[selectionId] || {})),
      requiredMeals: selection.mealsCount,
      resumeButton: card.querySelector(".resume-button"),
      resumeButtonLabel: selection.resumeRequiresPayment
        ? "Reprendre mon abonnement et payer maintenant"
        : "Reprendre mon abonnement",
      saveButton: card.querySelector(".save-button"),
      selectedCount: card.querySelector(".meal-editor-count"),
      selectionId: selectionId
    };

    editors[selectionId] = editor;

    if (editor.isPaused && !selection.resumeBlockedMessage) {
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
        editor.quantities = JSON.parse(JSON.stringify(data.initialQuantities[selectionId] || {}));
        editor.editButton.classList.add("hidden");
        editor.editor.classList.remove("hidden");
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
          editor.saveButton.textContent = editor.isPaused ? "Enregistrer mes choix" : "Enregistrer";
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
          var mealId = mealKey(meal);
          boxChangeState.quantities[mealId] = boxChangeState.quantities[mealId] || 0;

          var mealCard = document.createElement("article");
          mealCard.className = "meal-card";

          if (meal.imageUrl) {
            var image = document.createElement("img");
            image.alt = meal.imageAlt;
            image.src = meal.imageUrl;
            mealCard.appendChild(image);
          }

          var title = document.createElement("span");
          title.className = "meal-title";
          title.textContent = meal.title;
          mealCard.appendChild(title);

          var variant = document.createElement("span");
          variant.className = "muted";
          variant.textContent = meal.variantTitle;
          mealCard.appendChild(variant);

          var quantityRow = document.createElement("div");
          quantityRow.className = "quantity-row";

          var minus = document.createElement("button");
          minus.type = "button";
          minus.textContent = "-";
          minus.disabled = boxChangeState.quantities[mealId] === 0;
          minus.addEventListener("click", function () {
            boxChangeState.quantities[mealId] = Math.max(0, boxChangeState.quantities[mealId] - 1);
            renderBoxChangeMealGrid();
            updateBoxChangeCounts();
          });

          var quantity = document.createElement("span");
          quantity.textContent = String(boxChangeState.quantities[mealId]);

          var plus = document.createElement("button");
          plus.type = "button";
          plus.textContent = "+";
          plus.disabled = selectedTotal(boxChangeState.quantities) >= boxChangeState.requiredMeals;
          plus.addEventListener("click", function () {
            if (selectedTotal(boxChangeState.quantities) >= boxChangeState.requiredMeals) return;
            boxChangeState.quantities[mealId] += 1;
            renderBoxChangeMealGrid();
            updateBoxChangeCounts();
          });

          quantityRow.appendChild(minus);
          quantityRow.appendChild(quantity);
          quantityRow.appendChild(plus);
          mealCard.appendChild(quantityRow);
          boxChangeState.mealGrid.appendChild(mealCard);
        });
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
})();
`;
