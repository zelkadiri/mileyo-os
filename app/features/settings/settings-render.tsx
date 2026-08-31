import { useEffect, useRef } from "react";
import { Form, useActionData, useLoaderData } from "react-router";

import { downloadMealNutritionCsv } from "../../utils/mealNutritionExport";
import {
  formatMealCaloriesLabel,
  formatMealCarbsLabel,
  formatMealFatLabel,
  formatMealPortionGramsLabel,
  formatMealProteinsLabel,
} from "../../utils/mealNutritionFormat";
import type { MealNutritionMacroSnapshot } from "../../utils/mealNutritionCsv";
import type { loadSettingsPageData } from "./settings-catalog.server";
import {
  fieldStyle,
  numberInputStyle,
  productGridStyle,
  productImageStyle,
  selectStyle,
  textInputStyle,
  warningBadgeStyle,
} from "./settings-styles";
import type { SettingsActionData, SettingsBoxProduct, ShopifyProduct } from "./settings-types";

type SettingsPageData = Awaited<ReturnType<typeof loadSettingsPageData>>;

const formatImportMacroOrUnset = (
  label: string | null,
  fallbackPrefix: string,
) => label ?? `${fallbackPrefix}non renseigné`;

const formatImportMacroSnapshotLines = (macros: MealNutritionMacroSnapshot) => [
  `Calories : ${formatImportMacroOrUnset(formatMealCaloriesLabel(macros.calories), "")}`,
  `Protéines : ${formatImportMacroOrUnset(formatMealProteinsLabel(macros.proteins), "")}`,
  `Glucides : ${formatImportMacroOrUnset(formatMealCarbsLabel(macros.carbs), "")}`,
  `Lipides : ${formatImportMacroOrUnset(formatMealFatLabel(macros.fat), "")}`,
  `Portion : ${formatImportMacroOrUnset(formatMealPortionGramsLabel(macros.portionGrams), "")}`,
];

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
  const lastNutritionDownloadTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!actionData?.ok || !actionData.csv || !actionData.downloadToken) {
      return;
    }
    if (lastNutritionDownloadTokenRef.current === actionData.downloadToken) {
      return;
    }

    lastNutritionDownloadTokenRef.current = actionData.downloadToken;
    downloadMealNutritionCsv(actionData.csv, actionData.filename);
  }, [actionData]);

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

      <s-section heading="Support client">
        <s-stack gap="base">
          <Form method="post">
            <input type="hidden" name="intent" value="saveSupportChatUrl" />
            <s-stack gap="base">
              <label style={fieldStyle}>
                URL du chat diététicien
                <input
                  defaultValue={settings.supportChatUrl ?? ""}
                  name="supportChatUrl"
                  placeholder="https://..."
                  style={textInputStyle}
                  type="text"
                />
              </label>
              <s-text>
                Crisp, Intercom, WhatsApp Business ou autre outil externe.
              </s-text>
              <s-button type="submit">Enregistrer l’URL du chat</s-button>
            </s-stack>
          </Form>
          {actionData?.message?.toLowerCase().includes("chat") ? (
            <>
              <s-text>{actionData.message}</s-text>
              {actionData.errors?.length ? (
                <s-unordered-list>
                  {actionData.errors.map((error) => (
                    <s-list-item key={error}>{error}</s-list-item>
                  ))}
                </s-unordered-list>
              ) : null}
            </>
          ) : null}
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

      <s-section heading="Définitions Repas V2">
        <s-stack gap="base">
          <s-text>
            Crée / vérifie les définitions PRODUCTVARIANT pour les repas :
            <strong> mileyo.objective</strong>,{" "}
            <strong>custom.calories</strong>,{" "}
            <strong>custom.proteins</strong>,{" "}
            <strong>custom.carbs</strong>,{" "}
            <strong>custom.fat</strong>,{" "}
            <strong>custom.portion_grams</strong>.
          </s-text>
          <s-text>
            Aucune valeur n’est écrite sur les variantes. La définition
            PRODUCT legacy <strong>custom.calories</strong> n’est pas
            touchée.
          </s-text>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="setupMealV2MetafieldDefinitions"
            />
            <s-button type="submit">
              Créer / vérifier définitions Repas V2
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

      <s-section heading="Catalogue Repas V2">
        <s-stack gap="base">
          <s-text>
            Convertit in-place les recettes legacy de la collection de plats
            configurée : option <strong>Objectif</strong> + 3 variantes
            (Perte de poids · Équilibré · Prise de masse) avec{" "}
            <strong>mileyo.objective</strong>.
          </s-text>
          <s-text>
            Prix catalogue : <strong>0.00</strong>. Aucune macro inventée.
            Les produits déjà configurés sont ignorés (idempotent). Les
            structures ambiguës sont bloquées sans mutation.
          </s-text>
          <s-text>
            {settings.mealCollectionTitle ? (
              <>
                Collection cible :{" "}
                <strong>{settings.mealCollectionTitle}</strong> (
                {settings.mealCollectionHandle})
              </>
            ) : (
              <>Aucune collection de plats n’est configurée.</>
            )}
          </s-text>
          {settings.mealCollectionId ? (
            <Form method="post">
              <input type="hidden" name="intent" value="setupV2MealCatalog" />
              <s-button type="submit">Préparer catalogue Repas V2</s-button>
            </Form>
          ) : (
            <s-text>
              Sélectionnez une collection de plats avant de préparer le
              catalogue Repas V2.
            </s-text>
          )}
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

      <s-section heading="Export nutrition">
        <s-stack gap="base">
          <s-text>
            Télécharge un CSV pré-rempli (une ligne par variante repas) pour
            renseigner les macros : calories, protéines, glucides, lipides,
            portion. Ce fichier servira aussi de format d’import ultérieur.
          </s-text>
          <s-text>
            {settings.mealCollectionTitle ? (
              <>
                Collection cible :{" "}
                <strong>{settings.mealCollectionTitle}</strong> (
                {settings.mealCollectionHandle})
              </>
            ) : (
              <>Aucune collection de plats n’est configurée.</>
            )}
          </s-text>
          {settings.mealCollectionId ? (
            <Form method="post">
              <input
                type="hidden"
                name="intent"
                value="exportMealNutritionTemplate"
              />
              <s-button type="submit">Exporter template nutrition</s-button>
            </Form>
          ) : (
            <s-text>
              Sélectionnez une collection de plats avant d’exporter le template
              nutrition.
            </s-text>
          )}
          {actionData?.csv !== undefined ||
          actionData?.message === "Export nutrition impossible." ||
          actionData?.message ===
            "Impossible d’exporter le template nutrition." ? (
            <>
              {actionData.message ? (
                <s-text>{actionData.message}</s-text>
              ) : null}
              {actionData.errors?.length ? (
                <s-unordered-list>
                  {actionData.errors.map((error) => (
                    <s-list-item key={error}>{error}</s-list-item>
                  ))}
                </s-unordered-list>
              ) : null}
            </>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Import nutrition">
        <s-stack gap="base">
          <s-text>
            Uploadez le CSV nutrition rempli (même format que l’export),
            analysez-le, puis appliquez uniquement si la preview est valide.
          </s-text>
          <Form encType="multipart/form-data" method="post">
            <input
              type="hidden"
              name="intent"
              value="previewMealNutritionImport"
            />
            <s-stack gap="base">
              <label style={fieldStyle}>
                Fichier CSV
                <input
                  accept=".csv,text/csv"
                  name="nutritionCsv"
                  style={selectStyle}
                  type="file"
                />
              </label>
              <s-button type="submit">Analyser</s-button>
            </s-stack>
          </Form>
          {actionData?.nutritionImportAppliedCount != null &&
          actionData.ok ? (
            <s-stack gap="small">
              <s-text>
                <strong>Import terminé</strong>
              </s-text>
              <s-text>
                {actionData.nutritionImportAppliedCount} variante(s) mise(s) à
                jour.
              </s-text>
            </s-stack>
          ) : null}
          {actionData?.nutritionImportPreview ? (
            <s-stack gap="small">
              {actionData.message ? (
                <s-text>{actionData.message}</s-text>
              ) : null}
              <s-text>
                Lignes analysées :{" "}
                <strong>{actionData.nutritionImportPreview.rowCount}</strong>
              </s-text>
              <s-text>
                Modifications prêtes :{" "}
                <strong>
                  {actionData.nutritionImportPreview.validRowCount}
                </strong>
              </s-text>
              <s-text>
                Lignes ignorées :{" "}
                <strong>
                  {actionData.nutritionImportPreview.ignoredRowCount}
                </strong>
              </s-text>
              <s-text>
                Erreurs :{" "}
                <strong>
                  {actionData.nutritionImportPreview.issues.length}
                </strong>
              </s-text>
              {actionData.nutritionImportPreview.skippedEmptyRowCount > 0 ? (
                <s-text>
                  Lignes vides ignorées :{" "}
                  {actionData.nutritionImportPreview.skippedEmptyRowCount}
                </s-text>
              ) : null}
              {actionData.nutritionImportPreview.diffs.length > 0 ? (
                <s-stack gap="small">
                  <s-text>
                    <strong>Aperçu des modifications</strong> (max 5)
                  </s-text>
                  {actionData.nutritionImportPreview.diffs
                    .slice(0, 5)
                    .map((diff) => (
                      <s-box
                        key={diff.variantId}
                        borderRadius="base"
                        borderWidth="base"
                        padding="base"
                      >
                        <s-stack gap="small">
                          <s-text>
                            <strong>{diff.productTitle}</strong>
                          </s-text>
                          <s-text>{diff.variantTitle}</s-text>
                          <s-text>
                            <strong>Avant</strong>
                          </s-text>
                          {formatImportMacroSnapshotLines(diff.before).map(
                            (line) => (
                              <s-text key={`before-${diff.variantId}-${line}`}>
                                {line}
                              </s-text>
                            ),
                          )}
                          <s-text>
                            <strong>Après</strong>
                          </s-text>
                          {formatImportMacroSnapshotLines(diff.after).map(
                            (line) => (
                              <s-text key={`after-${diff.variantId}-${line}`}>
                                {line}
                              </s-text>
                            ),
                          )}
                        </s-stack>
                      </s-box>
                    ))}
                </s-stack>
              ) : null}
              {actionData.nutritionImportPreview.issues.length > 0 ? (
                <s-stack gap="small">
                  <s-text>
                    <strong>Erreurs détectées</strong>
                  </s-text>
                  <s-unordered-list>
                    {actionData.nutritionImportPreview.issues.map((issue) => (
                      <s-list-item
                        key={`${issue.code}-${issue.rowIndex}-${issue.message}`}
                      >
                        Ligne{" "}
                        {issue.rowIndex < 0 ? "—" : issue.rowIndex + 1} :{" "}
                        <strong>{issue.code}</strong>
                        {issue.message ? ` — ${issue.message}` : ""}
                      </s-list-item>
                    ))}
                  </s-unordered-list>
                </s-stack>
              ) : null}
              {actionData.nutritionImportPreview.validRowCount > 0 &&
              actionData.nutritionImportCsvText ? (
                <Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="applyMealNutritionImport"
                  />
                  <textarea
                    defaultValue={actionData.nutritionImportCsvText}
                    hidden
                    name="nutritionCsvText"
                    readOnly
                  />
                  <s-stack gap="small">
                    <s-text>
                      {actionData.nutritionImportPreview.validRowCount}{" "}
                      modification(s) prête(s)
                    </s-text>
                    <s-button type="submit">
                      Appliquer les modifications
                    </s-button>
                  </s-stack>
                </Form>
              ) : null}
              {actionData.errors?.length &&
              actionData.nutritionImportPreview.issues.length > 0 ? (
                <s-unordered-list>
                  {actionData.errors.map((error) => (
                    <s-list-item key={error}>{error}</s-list-item>
                  ))}
                </s-unordered-list>
              ) : null}
            </s-stack>
          ) : null}
          {actionData?.errors?.length &&
          actionData.message?.includes("écriture") ? (
            <s-unordered-list>
              {actionData.errors.map((error) => (
                <s-list-item key={error}>{error}</s-list-item>
              ))}
            </s-unordered-list>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Catalogue Box V2">
        <s-stack gap="base">
          <s-text>
            Produit : <strong>Box Mileyo V2</strong>
          </s-text>
          <s-text>
            Tailles : 8 · 10 · 12 · 16 · 20 · 24 repas
          </s-text>
          <s-text>
            Objectifs : Perte de poids · Équilibré · Prise de masse
          </s-text>
          <s-text>Variantes : 18</s-text>
          <s-text>
            Prix : gérés dans Shopify. Les valeurs initiales servent uniquement
            à l’initialisation d’un catalogue vide.
          </s-text>
          <s-text>
            Création initiale en brouillon (DRAFT) — la publication se fait dans
            Shopify Admin.
          </s-text>
          <s-text>
            Le produit n’est ajouté à aucune collection et n’est pas branché
            au builder legacy.
          </s-text>
          <Form method="post">
            <input type="hidden" name="intent" value="setupV2BoxCatalog" />
            <s-button type="submit">
              Créer / vérifier catalogue Box V2
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
            Configure le selling plan hebdomadaire V2 pour le produit{" "}
            <strong>Box Mileyo V2</strong> (handle{" "}
            <strong>box-mileyo-v2</strong>), uniquement si toutes ses variantes
            ont <strong>mileyo.objective</strong> et{" "}
            <strong>mileyo.meal_count</strong> au niveau variante.
          </s-text>
          <s-text>
            Les produits legacy de la collection historique ne sont pas
            concernés. Le prix d’abonnement est le prix de la variante. Aucun
            discount supplémentaire n’est appliqué.
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
