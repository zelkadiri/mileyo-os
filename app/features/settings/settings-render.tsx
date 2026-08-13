import { Form, useActionData, useLoaderData } from "react-router";

import type { loadSettingsPageData } from "./settings-catalog.server";
import {
  fieldStyle,
  numberInputStyle,
  productGridStyle,
  productImageStyle,
  selectStyle,
  warningBadgeStyle,
} from "./settings-styles";
import type { SettingsActionData, SettingsBoxProduct, ShopifyProduct } from "./settings-types";

type SettingsPageData = Awaited<ReturnType<typeof loadSettingsPageData>>;

function ProductPreview({
  emptyMessage,
  products,
  showVariantPrice = false,
}: {
  emptyMessage: string;
  products: ShopifyProduct[];
  showVariantPrice?: boolean;
}) {
  if (products.length === 0) {
    return <s-text>{emptyMessage}</s-text>;
  }

  return (
    <div style={productGridStyle}>
      {products.map((product) => {
        const firstVariant = product.variants.nodes[0];

        return (
          <s-box
            key={product.id}
            borderRadius="base"
            borderWidth="base"
            padding="base"
          >
            <s-stack gap="small">
              {product.featuredImage ? (
                <img
                  alt={product.featuredImage.altText ?? product.title}
                  src={product.featuredImage.url}
                  style={productImageStyle}
                />
              ) : null}
              <s-text>
                <strong>{product.title}</strong>
              </s-text>
              <s-text>Handle : {product.handle}</s-text>
              <s-text>
                Variante ID : {firstVariant?.id ?? "Aucune variante"}
              </s-text>
              <s-text>
                Variante titre : {firstVariant?.title ?? "Aucune variante"}
              </s-text>
              {showVariantPrice ? (
                <s-text>
                  Variante prix : {firstVariant?.price ?? "Non disponible"}
                </s-text>
              ) : (
                <>
                  <s-text>
                    Status : {product.status ?? "Non disponible"}
                  </s-text>
                  <s-text>
                    Publication : {product.publishedAt ? "Publié" : "Non publié"}
                  </s-text>
                </>
              )}
            </s-stack>
          </s-box>
        );
      })}
    </div>
  );
}

function BoxMealCountField({ product }: { product: SettingsBoxProduct }) {
  const needsConfiguration = product.configuredMealCount === null;

  return (
    <s-box borderRadius="base" borderWidth="base" padding="base">
      <s-stack gap="small">
        {product.featuredImage ? (
          <img
            alt={product.featuredImage.altText ?? product.title}
            src={product.featuredImage.url}
            style={productImageStyle}
          />
        ) : null}
        <s-text>
          <strong>{product.title}</strong>
        </s-text>
        {needsConfiguration ? (
          <span style={warningBadgeStyle}>À configurer</span>
        ) : (
          <s-text>Valeur actuelle : {product.configuredMealCount} repas</s-text>
        )}
        <input name="boxProductIds" type="hidden" value={product.id} />
        <label style={fieldStyle}>
          Nombre de repas
          <input
            defaultValue={
              product.configuredMealCount != null
                ? String(product.configuredMealCount)
                : ""
            }
            inputMode="numeric"
            max={100}
            min={1}
            name="boxMealCounts"
            placeholder="Ex. 6"
            step={1}
            style={numberInputStyle}
            type="number"
          />
        </label>
      </s-stack>
    </s-box>
  );
}

export default function Settings() {
  const actionData = useActionData<SettingsActionData>();
  const { boxProducts, collections, mealProducts, settings, shop } =
    useLoaderData<SettingsPageData>();

  return (
    <s-page heading="Réglages">
      <s-section heading="Collections Shopify">
        <s-stack gap="base">
          <s-text>Shop : {shop}</s-text>
          <Form method="post">
            <input type="hidden" name="intent" value="saveSettings" />
            <s-stack gap="base">
              <label style={fieldStyle}>
                Collection des box
                <select
                  defaultValue={settings.boxCollectionId ?? ""}
                  name="boxCollectionId"
                  style={selectStyle}
                >
                  <option value="">Aucune collection sélectionnée</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.title}
                    </option>
                  ))}
                </select>
              </label>
              <s-text>
                Les produits de cette collection seront utilisés comme box dans
                le builder client.
              </s-text>
              <label style={fieldStyle}>
                Collection de plats
                <select
                  defaultValue={settings.mealCollectionId ?? ""}
                  name="mealCollectionId"
                  style={selectStyle}
                >
                  <option value="">Aucune collection sélectionnée</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.title}
                    </option>
                  ))}
                </select>
              </label>
              <s-button type="submit">Enregistrer</s-button>
            </s-stack>
          </Form>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="createSubscriptionPriceMetafieldDefinition"
            />
            <s-button type="submit">
              Créer le champ Prix abonnement
            </s-button>
          </Form>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="createMealCountMetafieldDefinition"
            />
            <s-button type="submit">Créer le champ Nombre de repas</s-button>
          </Form>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="setupWeeklySellingPlans"
            />
            <s-button type="submit">
              Créer / mettre à jour les abonnements hebdomadaires
            </s-button>
          </Form>
          {actionData?.message ? <s-text>{actionData.message}</s-text> : null}
          {actionData?.errors?.length ? (
            <s-unordered-list>
              {actionData.errors.map((error) => (
                <s-list-item key={error}>{error}</s-list-item>
              ))}
            </s-unordered-list>
          ) : null}
          {settings.boxCollectionTitle ? (
            <s-text>
              Collection des box :{" "}
              <strong>{settings.boxCollectionTitle}</strong> (
              {settings.boxCollectionHandle})
            </s-text>
          ) : (
            <s-text>Aucune collection de box n’est configurée.</s-text>
          )}
          {settings.mealCollectionTitle ? (
            <s-text>
              Collection de plats :{" "}
              <strong>{settings.mealCollectionTitle}</strong> (
              {settings.mealCollectionHandle})
            </s-text>
          ) : (
            <s-text>Aucune collection de plats n’est configurée.</s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Metafields variante (V2)">
        <s-stack gap="base">
          <s-text>
            Crée uniquement les définitions Shopify pour les variantes produit.
            Aucune valeur n’est écrite sur les variants.
          </s-text>
          <s-text>
            <strong>mileyo.objective</strong> — Variante produit
          </s-text>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="createVariantObjectiveMetafieldDefinition"
            />
            <s-button type="submit">
              Créer définition objectif variante
            </s-button>
          </Form>
          <s-text>
            <strong>mileyo.meal_count</strong> — Variante produit
          </s-text>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="createVariantMealCountMetafieldDefinition"
            />
            <s-button type="submit">
              Créer définition nombre de repas variante
            </s-button>
          </Form>
          {actionData?.message ? <s-text>{actionData.message}</s-text> : null}
          {actionData?.errors?.length ? (
            <s-unordered-list>
              {actionData.errors.map((error) => (
                <s-list-item key={error}>{error}</s-list-item>
              ))}
            </s-unordered-list>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Abonnements Box V2">
        <s-stack gap="base">
          <s-text>
            Configure le selling plan hebdomadaire V2 uniquement pour les
            produits dont toutes les variantes ont{" "}
            <strong>mileyo.objective</strong> et{" "}
            <strong>mileyo.meal_count</strong> au niveau variante.
          </s-text>
          <s-text>
            Les produits legacy ou incomplets sont ignorés. Le prix
            d’abonnement est le prix de la variante. Aucun discount
            supplémentaire n’est appliqué.
          </s-text>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="setupV2WeeklySellingPlans"
            />
            <s-button type="submit">
              Configurer abonnements Box V2
            </s-button>
          </Form>
          {actionData?.message ? <s-text>{actionData.message}</s-text> : null}
          {actionData?.errors?.length ? (
            <s-unordered-list>
              {actionData.errors.map((error) => (
                <s-list-item key={error}>{error}</s-list-item>
              ))}
            </s-unordered-list>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Configuration des tailles de box">
        <s-stack gap="base">
          <s-text>
            Définissez le nombre de repas inclus pour chaque produit box via le
            metafield <strong>mileyo.meal_count</strong>. Cette valeur est
            utilisée par le builder, le portail client et les changements de box.
          </s-text>
          {boxProducts.length === 0 ? (
            <s-text>
              Sélectionnez une collection de box contenant des produits pour
              configurer les tailles.
            </s-text>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="saveBoxMealCounts" />
              <s-stack gap="base">
                <div style={productGridStyle}>
                  {boxProducts.map((product) => (
                    <BoxMealCountField key={product.id} product={product} />
                  ))}
                </div>
                <s-button type="submit">
                  Enregistrer les tailles de box
                </s-button>
              </s-stack>
            </Form>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Aperçu des plats">
        <ProductPreview
          emptyMessage="Sélectionnez une collection de plats contenant des produits pour afficher un aperçu."
          products={mealProducts}
        />
      </s-section>

      <s-section heading="Aperçu des box">
        <ProductPreview
          emptyMessage="Sélectionnez une collection de box contenant des produits pour afficher un aperçu."
          products={boxProducts}
          showVariantPrice
        />
      </s-section>
    </s-page>
  );
}
