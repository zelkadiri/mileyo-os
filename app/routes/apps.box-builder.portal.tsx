import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { normalizeShopifyId } from "../utils/shopifyIds.server";

type ShopifyProduct = {
  id: string;
  title: string;
  featuredImage?: { altText?: string | null; url: string } | null;
  variants: {
    nodes: {
      id: string;
      title: string;
    }[];
  };
};

type PortalMeal = {
  id: string;
  imageAlt: string;
  imageUrl: string | null;
  title: string;
  variantTitle: string;
};

type PortalSelection = {
  boxTitle: string | null;
  id: string;
  mealsCount: number;
  selectedMeals: string[];
  shopifyOrderName: string | null;
  status: string;
};

type SubscriptionContractStatusResponse = {
  data?: {
    subscriptionContractPause?: {
      contract?: { id?: string | null; status?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
    subscriptionContractActivate?: {
      contract?: { id?: string | null; status?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

const subscriptionContractPauseMutation = `#graphql
  mutation SubscriptionContractPause($subscriptionContractId: ID!) {
    subscriptionContractPause(subscriptionContractId: $subscriptionContractId) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const subscriptionContractActivateMutation = `#graphql
  mutation SubscriptionContractActivate($subscriptionContractId: ID!) {
    subscriptionContractActivate(subscriptionContractId: $subscriptionContractId) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const toSubscriptionContractGid = (subscriptionContractId: string) =>
  subscriptionContractId.includes("/")
    ? subscriptionContractId
    : `gid://shopify/SubscriptionContract/${subscriptionContractId}`;

type CollectionProductsResponse = {
  data?: {
    collection?: {
      products: { nodes: ShopifyProduct[] };
    } | null;
  };
};

const collectionProductsQuery = `#graphql
  query PortalMealProducts($id: ID!) {
    collection(id: $id) {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          title
          featuredImage {
            altText
            url
          }
          variants(first: 1) {
            nodes {
              id
              title
            }
          }
        }
      }
    }
  }
`;

const getCollectionProducts = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  id: string,
) => {
  const response = await admin.graphql(collectionProductsQuery, {
    variables: { id },
  });
  const json = (await response.json()) as CollectionProductsResponse;

  return json.data?.collection?.products.nodes ?? [];
};

const toPortalMeals = (products: ShopifyProduct[]): PortalMeal[] =>
  products.map((product) => {
    const firstVariant = product.variants.nodes[0];

    return {
      id: product.id,
      imageAlt: product.featuredImage?.altText ?? product.title,
      imageUrl: product.featuredImage?.url ?? null,
      title: product.title,
      variantTitle: firstVariant?.title ?? "Variante standard",
    };
  });

const getSelectedMeals = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((meal) => String(meal));
};

const titlesToQuantities = (
  titles: string[],
  meals: PortalMeal[],
): Record<string, number> => {
  const titleToId = new Map(meals.map((meal) => [meal.title, meal.id]));
  const quantities: Record<string, number> = {};

  for (const title of titles) {
    const mealId = titleToId.get(title);
    if (!mealId) continue;
    quantities[mealId] = (quantities[mealId] ?? 0) + 1;
  }

  return quantities;
};

const quantitiesToTitles = (
  quantities: Record<string, number>,
  meals: PortalMeal[],
) => {
  const mealById = new Map(meals.map((meal) => [meal.id, meal.title]));
  const titles: string[] = [];

  for (const [mealId, quantity] of Object.entries(quantities)) {
    const title = mealById.get(mealId);
    if (!title) {
      return null;
    }

    for (let index = 0; index < quantity; index += 1) {
      titles.push(title);
    }
  }

  return titles;
};

const htmlResponse = (html: string) =>
  new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const renderMessage = (message: string, options?: { loginLink?: boolean }) =>
  htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mes prochaines box</title>
  <style>${styles}</style>
</head>
<body>
  <main class="portal-shell">
    <section class="portal-card">
      <h1>Mes prochaines box</h1>
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

const renderPortal = ({
  meals,
  selections,
  successMessage,
}: {
  meals: PortalMeal[];
  selections: PortalSelection[];
  successMessage?: string | null;
}) => {
  const initialQuantities = Object.fromEntries(
    selections.map((selection) => [
      selection.id,
      titlesToQuantities(selection.selectedMeals, meals),
    ]),
  );

  return htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mes prochaines box</title>
  <style>${styles}</style>
</head>
<body>
  <main class="portal-shell">
    <section class="portal-card">
      <p class="eyebrow">Mileyo</p>
      <h1>Mes prochaines box</h1>
      <p class="intro">
        Ta première commande est déjà confirmée et ne peut pas être modifiée. Ici, tu peux modifier les plats de tes prochaines box avant le prochain prélèvement.
      </p>
      ${
        successMessage
          ? `<p class="success">${escapeHtml(successMessage)}</p>`
          : ""
      }
    </section>

    ${
      selections.length === 0
        ? `<section class="portal-card"><p>Aucun abonnement trouvé pour ton compte.</p></section>`
        : selections
            .map(
              (selection) => {
                const isActive = selection.status === "active";
                const isPaused = selection.status === "paused";

                return `<section class="portal-card selection-card" data-selection-id="${escapeHtml(selection.id)}">
      <h2>${escapeHtml(selection.shopifyOrderName ?? "Commande abonnement")}</h2>
      ${
        isPaused
          ? `<p class="status-badge paused">Abonnement en pause</p>`
          : ""
      }
      <p><strong>Box :</strong> ${escapeHtml(selection.boxTitle ?? "Non renseignée")}</p>
      <p><strong>Nombre de repas :</strong> ${selection.mealsCount}</p>
      <p><strong>Prochains plats :</strong></p>
      ${
        selection.selectedMeals.length > 0
          ? `<ul class="meal-list">${selection.selectedMeals
              .map(
                (meal) =>
                  `<li>${escapeHtml(meal)}</li>`,
              )
              .join("")}</ul>`
          : `<p class="muted">Aucun plat sélectionné pour le moment.</p>`
      }
      ${
        isActive
          ? `<button class="portal-button secondary edit-button" type="button">Modifier mes prochains plats</button>`
          : ""
      }
      ${
        isActive
          ? `<button class="portal-button secondary pause-button" type="button">Mettre mon abonnement en pause</button>`
          : ""
      }
      ${
        isPaused
          ? `<button class="portal-button reactivate-button" type="button">Réactiver mon abonnement</button>`
          : ""
      }
      <div class="editor hidden">
        <div class="editor-heading">
          <div>
            <h3>Modifier tes prochains plats</h3>
            <p class="selected-count">0 / ${selection.mealsCount} plats sélectionnés</p>
          </div>
          <button class="portal-button save-button" disabled type="button">Enregistrer</button>
        </div>
        <p class="error hidden"></p>
        <div class="meal-grid"></div>
        <button class="portal-button secondary cancel-button" type="button">Annuler</button>
      </div>
    </section>`;
              },
            )
            .join("")
    }

    <p class="back-link"><a href="/apps/box-builder">← Retour au composeur de box</a></p>
  </main>

  <script>window.__MILEYO_PORTAL__ = ${scriptJson({ initialQuantities, meals, selections })};</script>
  <script>${clientScript}</script>
</body>
</html>`);
};

const getShopFromRequest = (request: Request) => {
  const url = new URL(request.url);
  return url.searchParams.get("shop")?.trim() ?? null;
};

const getCustomerIdFromRequest = (request: Request) => {
  const url = new URL(request.url);
  return normalizeShopifyId(url.searchParams.get("logged_in_customer_id"));
};

const loadPortalData = async ({
  customerShopifyId,
  shop,
}: {
  customerShopifyId: string;
  shop: string;
}) => {
  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings?.mealCollectionId) {
    return null;
  }

  const { admin } = await unauthenticated.admin(shop);
  const mealProducts = await getCollectionProducts(admin, settings.mealCollectionId);
  const meals = toPortalMeals(mealProducts);

  const records = await prisma.subscriptionMealSelection.findMany({
    orderBy: { createdAt: "desc" },
    where: {
      customerShopifyId,
      shop,
      status: { in: ["active", "paused"] },
    },
  });

  const selections: PortalSelection[] = records
    .filter((record) => typeof record.mealsCount === "number" && record.mealsCount > 0)
    .map((record) => ({
      boxTitle: record.boxTitle,
      id: record.id,
      mealsCount: record.mealsCount as number,
      selectedMeals: getSelectedMeals(record.selectedMeals),
      shopifyOrderName: record.shopifyOrderName,
      status: record.status,
    }));

  return { meals, selections };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = getShopFromRequest(request);
  const customerShopifyId = getCustomerIdFromRequest(request);

  if (!shop) {
    return renderMessage(
      "Boutique introuvable. Ouvrez ce portail via le proxy d’application Shopify.",
    );
  }

  if (!customerShopifyId) {
    return renderMessage(
      "Connecte-toi à ton compte pour modifier tes prochaines box.",
      { loginLink: true },
    );
  }

  const portalData = await loadPortalData({ customerShopifyId, shop });

  if (!portalData) {
    return renderMessage(
      "Configuration incomplète. La collection de plats n’est pas configurée.",
    );
  }

  return renderPortal({ ...portalData, successMessage: null });
};

const getGraphqlUserErrors = (
  userErrors: { message?: string | null }[] | undefined,
) =>
  userErrors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join(" ") ?? "";

const pauseSubscriptionContract = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { subscriptionContractId: string } },
    ) => Promise<Response>;
  },
  subscriptionContractId: string,
) => {
  const response = await admin.graphql(subscriptionContractPauseMutation, {
    variables: {
      subscriptionContractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractStatusResponse;

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de la mise en pause.",
    };
  }

  const result = json.data?.subscriptionContractPause;
  const userErrorMessage = getGraphqlUserErrors(result?.userErrors);

  if (userErrorMessage) {
    return { error: userErrorMessage };
  }

  if (!result?.contract?.id) {
    return { error: "Shopify n’a pas confirmé la mise en pause." };
  }

  return { ok: true as const };
};

const reactivateSubscriptionContract = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { subscriptionContractId: string } },
    ) => Promise<Response>;
  },
  subscriptionContractId: string,
) => {
  const response = await admin.graphql(subscriptionContractActivateMutation, {
    variables: {
      subscriptionContractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractStatusResponse;

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de la réactivation.",
    };
  }

  const result = json.data?.subscriptionContractActivate;
  const userErrorMessage = getGraphqlUserErrors(result?.userErrors);

  if (userErrorMessage) {
    return { error: userErrorMessage };
  }

  if (!result?.contract?.id) {
    return { error: "Shopify n’a pas confirmé la réactivation." };
  }

  return { ok: true as const };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = getShopFromRequest(request);
  const customerShopifyId = getCustomerIdFromRequest(request);

  if (!shop) {
    return renderMessage("Boutique introuvable.");
  }

  if (!customerShopifyId) {
    return renderMessage(
      "Connecte-toi à ton compte pour modifier tes prochaines box.",
      { loginLink: true },
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const selectionId = String(formData.get("selectionId") ?? "");

  if (!selectionId) {
    return renderMessage("Données de sélection invalides.");
  }

  if (intent === "pauseSubscription" || intent === "reactivateSubscription") {
    const expectedStatus = intent === "pauseSubscription" ? "active" : "paused";

    const selection = await prisma.subscriptionMealSelection.findFirst({
      where: {
        customerShopifyId,
        id: selectionId,
        shop,
        status: expectedStatus,
      },
    });

    if (!selection) {
      return renderMessage("Abonnement introuvable.");
    }

    if (!selection.subscriptionContractId) {
      return renderMessage("Contrat d’abonnement Shopify manquant.");
    }

    const { admin } = await unauthenticated.admin(shop);

    const shopifyResult =
      intent === "pauseSubscription"
        ? await pauseSubscriptionContract(
            admin,
            selection.subscriptionContractId,
          )
        : await reactivateSubscriptionContract(
            admin,
            selection.subscriptionContractId,
          );

    if ("error" in shopifyResult) {
      return renderMessage(
        shopifyResult.error ?? "Erreur lors de l’opération Shopify.",
      );
    }

    await prisma.subscriptionMealSelection.update({
      data:
        intent === "pauseSubscription"
          ? { active: false, status: "paused" }
          : { active: true, status: "active" },
      where: { id: selection.id },
    });

    const portalData = await loadPortalData({ customerShopifyId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      successMessage:
        intent === "pauseSubscription"
          ? "Ton abonnement a bien été mis en pause."
          : "Ton abonnement a bien été réactivé.",
    });
  }

  if (intent !== "updateFutureMealSelection") {
    return renderMessage("Action non reconnue.");
  }

  const selectedMealsRaw = String(formData.get("selectedMeals") ?? "");

  if (!selectedMealsRaw) {
    return renderMessage("Données de sélection invalides.");
  }

  let quantities: Record<string, number>;

  try {
    const parsed = JSON.parse(selectedMealsRaw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return renderMessage("Format de sélection invalide.");
    }

    quantities = Object.fromEntries(
      Object.entries(parsed).map(([mealId, quantity]) => [
        mealId,
        Number(quantity),
      ]),
    );
  } catch {
    return renderMessage("Format de sélection invalide.");
  }

  const selection = await prisma.subscriptionMealSelection.findFirst({
    where: {
      active: true,
      customerShopifyId,
      id: selectionId,
      shop,
    },
  });

  if (!selection || typeof selection.mealsCount !== "number") {
    return renderMessage("Abonnement introuvable.");
  }

  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings?.mealCollectionId) {
    return renderMessage("Configuration incomplète.");
  }

  const { admin } = await unauthenticated.admin(shop);
  const mealProducts = await getCollectionProducts(admin, settings.mealCollectionId);
  const meals = toPortalMeals(mealProducts);

  const totalSelected = Object.values(quantities).reduce(
    (total, quantity) => total + (Number.isFinite(quantity) ? quantity : 0),
    0,
  );

  if (totalSelected !== selection.mealsCount) {
    return renderMessage(
      `Tu dois sélectionner exactement ${selection.mealsCount} plats.`,
    );
  }

  const titles = quantitiesToTitles(quantities, meals);

  if (!titles || titles.length !== selection.mealsCount) {
    return renderMessage("Un ou plusieurs plats sélectionnés ne sont pas valides.");
  }

  await prisma.subscriptionMealSelection.update({
    data: {
      selectedMeals: titles as Prisma.InputJsonValue,
    },
    where: { id: selection.id },
  });

  const portalData = await loadPortalData({ customerShopifyId, shop });

  if (!portalData) {
    return renderMessage("Configuration incomplète.");
  }

  return renderPortal({
    ...portalData,
    successMessage: "Tes prochains plats ont bien été mis à jour.",
  });
};

const clientScript = `
(function () {
  var data = window.__MILEYO_PORTAL__;
  var editors = {};

  function selectedTotal(quantities) {
    return Object.keys(quantities).reduce(function (total, mealId) {
      return total + (quantities[mealId] || 0);
    }, 0);
  }

  function renderMealGrid(editor) {
    editor.mealGrid.innerHTML = "";
    data.meals.forEach(function (meal) {
      editor.quantities[meal.id] = editor.quantities[meal.id] || 0;

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
      minus.disabled = editor.quantities[meal.id] === 0;
      minus.setAttribute("aria-label", "Retirer " + meal.title);
      minus.addEventListener("click", function () {
        editor.quantities[meal.id] = Math.max(0, editor.quantities[meal.id] - 1);
        updateEditor(editor);
      });

      var quantity = document.createElement("span");
      quantity.textContent = String(editor.quantities[meal.id]);

      var plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.disabled = selectedTotal(editor.quantities) >= editor.requiredMeals;
      plus.setAttribute("aria-label", "Ajouter " + meal.title);
      plus.addEventListener("click", function () {
        if (selectedTotal(editor.quantities) >= editor.requiredMeals) return;
        editor.quantities[meal.id] += 1;
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
    var total = selectedTotal(editor.quantities);
    editor.selectedCount.textContent = total + " / " + editor.requiredMeals + " plats sélectionnés";
    editor.saveButton.disabled = total !== editor.requiredMeals;
    editor.errorMessage.classList.add("hidden");
    renderMealGrid(editor);
  }

  function setEditorError(editor, message) {
    editor.errorMessage.textContent = message;
    editor.errorMessage.classList.toggle("hidden", !message);
  }

  function closeAllEditors(exceptId) {
    Object.keys(editors).forEach(function (selectionId) {
      if (selectionId === exceptId) return;
      editors[selectionId].editor.classList.add("hidden");
      if (editors[selectionId].editButton) {
        editors[selectionId].editButton.classList.remove("hidden");
      }
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
      errorMessage: card.querySelector(".error"),
      mealGrid: card.querySelector(".meal-grid"),
      quantities: JSON.parse(JSON.stringify(data.initialQuantities[selectionId] || {})),
      requiredMeals: selection.mealsCount,
      saveButton: card.querySelector(".save-button"),
      selectedCount: card.querySelector(".selected-count"),
      selectionId: selectionId
    };

    editors[selectionId] = editor;

    if (editor.editButton) {
      editor.editButton.addEventListener("click", function () {
        closeAllEditors(selectionId);
        editor.quantities = JSON.parse(JSON.stringify(data.initialQuantities[selectionId] || {}));
        editor.editButton.classList.add("hidden");
        editor.editor.classList.remove("hidden");
        updateEditor(editor);
      });

      editor.cancelButton.addEventListener("click", function () {
        editor.editor.classList.add("hidden");
        editor.editButton.classList.remove("hidden");
        setEditorError(editor, "");
      });

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
          editor.saveButton.textContent = "Enregistrer";
          updateEditor(editor);
          setEditorError(editor, "Impossible d’enregistrer tes plats. Réessayez dans un instant.");
        });
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

    var reactivateButton = card.querySelector(".reactivate-button");
    if (reactivateButton) {
      reactivateButton.addEventListener("click", function () {
        if (!confirm("Confirmer la réactivation de ton abonnement ?")) return;

        reactivateButton.disabled = true;
        reactivateButton.textContent = "Réactivation...";

        var reactivateBody = new URLSearchParams();
        reactivateBody.set("intent", "reactivateSubscription");
        reactivateBody.set("selectionId", selectionId);

        fetch(window.location.pathname + window.location.search, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: reactivateBody.toString()
        }).then(function (response) {
          return response.text().then(function (html) {
            document.open();
            document.write(html);
            document.close();
          });
        }).catch(function () {
          reactivateButton.disabled = false;
          reactivateButton.textContent = "Réactiver mon abonnement";
          alert("Impossible de réactiver ton abonnement. Réessayez dans un instant.");
        });
      });
    }
  });
})();
`;

const styles = `
* { box-sizing: border-box; }
body { background: #fff; margin: 0; }
.portal-shell {
  color: #1f2933;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0 auto;
  max-width: 920px;
  padding: 24px 16px 48px;
}
.portal-card {
  background: #fffaf4;
  border: 1px solid #f0dfca;
  border-radius: 20px;
  margin-bottom: 18px;
  padding: 20px;
}
.portal-card h1, .portal-card h2, .portal-card h3 { margin: 0 0 8px; }
.portal-card p, .portal-card li { margin: 0; }
.intro { line-height: 1.5; }
.eyebrow, .muted { color: #6b7280; font-size: 0.9rem; }
.hidden { display: none; }
.meal-list {
  margin: 8px 0 16px;
  padding-left: 1.25rem;
}
.success {
  background: #dcfce7;
  border-radius: 12px;
  color: #166534;
  margin-top: 12px;
  padding: 12px;
}
.status-badge {
  border-radius: 999px;
  display: inline-block;
  font-size: 0.85rem;
  font-weight: 700;
  margin-bottom: 8px;
  padding: 6px 12px;
}
.status-badge.paused {
  background: #fef3c7;
  color: #92400e;
}
.error {
  background: #fee2e2;
  border-radius: 12px;
  color: #991b1b;
  margin-bottom: 14px;
  padding: 12px;
}
.portal-button, .quantity-row button {
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 700;
  padding: 12px 16px;
  text-decoration: none;
}
.portal-button {
  background: #111827;
  color: white;
  margin-top: 8px;
}
.portal-button.secondary {
  background: #f3f4f6;
  color: #374151;
}
button:disabled { cursor: not-allowed; opacity: 0.55; }
.editor { margin-top: 16px; }
.editor-heading {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 16px;
}
.meal-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
  margin-bottom: 12px;
}
.meal-card {
  background: white;
  border: 1px solid #ead8c0;
  border-radius: 18px;
  display: grid;
  gap: 8px;
  padding: 14px;
}
.meal-card img {
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  object-fit: cover;
  width: 100%;
}
.meal-title { font-weight: 800; }
.quantity-row {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-top: 8px;
}
.quantity-row button {
  background: #111827;
  color: white;
  height: 40px;
  padding: 0;
  width: 40px;
}
.back-link { margin-top: 8px; }
.back-link a { color: #111827; }
@media (min-width: 640px) {
  .meal-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 960px) {
  .meal-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
`;
