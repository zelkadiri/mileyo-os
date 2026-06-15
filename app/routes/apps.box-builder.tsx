import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

type ShopifyProduct = {
  id: string;
  title: string;
  featuredImage?: { altText?: string | null; url: string } | null;
  variants: {
    nodes: { id: string; price?: string | null; title: string }[];
  };
};

type BuilderProduct = {
  id: string;
  imageAlt: string;
  imageUrl: string | null;
  title: string;
  variantId: string;
  variantPrice: string | null;
  variantTitle: string;
};

type CollectionProductsResponse = {
  data?: {
    collection?: {
      products: { nodes: ShopifyProduct[] };
    } | null;
  };
};

const collectionProductsQuery = `#graphql
  query BoxBuilderProducts($id: ID!) {
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
              price
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

const toBuilderProducts = (products: ShopifyProduct[]): BuilderProduct[] =>
  products.map((product) => {
    const firstVariant = product.variants.nodes[0];

    return {
      id: product.id,
      imageAlt: product.featuredImage?.altText ?? product.title,
      imageUrl: product.featuredImage?.url ?? null,
      title: product.title,
      variantId: firstVariant?.id ?? "",
      variantPrice: firstVariant?.price ?? null,
      variantTitle: firstVariant?.title ?? "Variante standard",
    };
  });

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

const renderMessage = (message: string, shop?: string) =>
  htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compose ta box</title>
  <style>${styles}</style>
</head>
<body>
  <main class="builder-shell">
    <section class="setup-card">
      <h1>Compose ta box</h1>
      <p>${escapeHtml(message)}</p>
      ${shop ? `<p class="muted">Shop : ${escapeHtml(shop)}</p>` : ""}
    </section>
  </main>
</body>
</html>`);

const renderBuilder = ({
  boxes,
  meals,
}: {
  boxes: BuilderProduct[];
  meals: BuilderProduct[];
}) =>
  htmlResponse(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compose ta box</title>
  <style>${styles}</style>
</head>
<body>
  <main class="builder-shell">
    <section class="hero">
      <p class="eyebrow">Mileyo</p>
      <h1>Compose ta box</h1>
      <p>Choisis ta box, puis sélectionne exactement le nombre de plats inclus.</p>
    </section>

    <section class="toggle-row" aria-label="Type de commande">
      <button class="toggle active" type="button">Commande unique</button>
      <button class="toggle" disabled type="button">Abonnement hebdomadaire · bientôt</button>
    </section>

    <section class="section">
      <div class="section-heading">
        <h2>Choisis ta box</h2>
        <p id="box-helper">Sélectionne une box pour commencer.</p>
      </div>
      <div class="card-grid" id="box-grid"></div>
    </section>

    <section class="section hidden" id="meals-section">
      <div class="section-heading sticky-count">
        <div>
          <h2>Choisis tes plats</h2>
          <p id="selected-count">0 / 0 plats sélectionnés</p>
        </div>
        <button class="add-button" disabled id="add-to-cart" type="button">Ajouter au panier</button>
      </div>
      <p class="error hidden" id="error-message"></p>
      <div class="card-grid" id="meal-grid"></div>
    </section>
  </main>

  <script>window.__MILEYO_BOX_BUILDER__ = ${scriptJson({ boxes, meals })};</script>
  <script>${clientScript}</script>
</body>
</html>`);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim();

  if (!shop) {
    return renderMessage(
      "Boutique introuvable. Ouvrez ce builder via le proxy d’application Shopify.",
    );
  }

  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings) {
    return renderMessage(
      "Configuration manquante. Sélectionnez les collections de box et de plats dans l’administration Mileyo.",
      shop,
    );
  }

  if (!settings.boxCollectionId || !settings.mealCollectionId) {
    return renderMessage(
      "Configuration incomplète. Sélectionnez une collection de box et une collection de plats dans les réglages.",
      shop,
    );
  }

  const { admin } = await unauthenticated.admin(shop);
  const [boxProducts, mealProducts] = await Promise.all([
    getCollectionProducts(admin, settings.boxCollectionId),
    getCollectionProducts(admin, settings.mealCollectionId),
  ]);

  return renderBuilder({
    boxes: toBuilderProducts(boxProducts),
    meals: toBuilderProducts(mealProducts),
  });
};

const clientScript = `
(function () {
  var data = window.__MILEYO_BOX_BUILDER__;
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
    addToCart.disabled = !selectedBox || requiredMeals === 0 || total !== requiredMeals;
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
        price.textContent = formatEuros(box.variantPrice);
        button.appendChild(price);
      }

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
      "Type de commande": "Commande unique",
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

    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{
          id: variantId,
          properties: properties,
          quantity: 1
        }]
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

  renderBoxes();
  updateSummary();
})();
`;

const styles = `
* { box-sizing: border-box; }
body { background: #fff; margin: 0; }
.builder-shell {
  color: #1f2933;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0 auto;
  max-width: 1120px;
  padding: 24px 16px 48px;
}
.hero, .setup-card, .section {
  background: #fffaf4;
  border: 1px solid #f0dfca;
  border-radius: 20px;
  margin-bottom: 18px;
  padding: 20px;
}
.hero h1, .setup-card h1, .section h2 { margin: 0 0 8px; }
.hero p, .setup-card p, .section p { margin: 0; }
.eyebrow, .muted { color: #6b7280; font-size: 0.9rem; }
.hidden { display: none; }
.toggle-row {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr;
  margin-bottom: 18px;
}
.toggle, .add-button, .quantity-row button {
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 12px 16px;
}
.toggle { background: #f3f4f6; color: #374151; }
.toggle.active, .add-button { background: #111827; color: white; }
button:disabled { cursor: not-allowed; opacity: 0.55; }
.section-heading {
  align-items: start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 16px;
}
.sticky-count { align-items: center; flex-wrap: wrap; }
.card-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
}
.product-card {
  appearance: none;
  background: white;
  border: 1px solid #ead8c0;
  border-radius: 18px;
  color: inherit;
  display: grid;
  gap: 8px;
  padding: 14px;
  text-align: left;
  width: 100%;
}
.product-card.selectable { cursor: pointer; }
.product-card.selected {
  background: #f7eadb;
  border-color: #111827;
  box-shadow: 0 0 0 2px #111827;
}
.selected-badge {
  background: #111827;
  border-radius: 999px;
  color: white;
  display: inline-flex;
  font-size: 0.8rem;
  font-weight: 800;
  justify-self: start;
  padding: 4px 10px;
}
.product-card img {
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  object-fit: cover;
  width: 100%;
}
.product-title { font-weight: 800; }
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
.error {
  background: #fee2e2;
  border-radius: 12px;
  color: #991b1b;
  margin-bottom: 14px;
  padding: 12px;
}
@media (min-width: 640px) {
  .toggle-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 960px) {
  .card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
`;
