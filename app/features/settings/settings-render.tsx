import { useEffect, useRef } from "react";
import { Form, useActionData, useLoaderData } from "react-router";

import { downloadMealNutritionCsv } from "../../utils/mealNutritionExport";
import {
  formatMealCaloriesLabel,
  formatMealCarbsLabel,
  formatMealFatLabel,
  formatMealFiberLabel,
  formatMealPortionGramsLabel,
  formatMealProteinsLabel,
  formatMealSaltLabel,
  formatMealSaturatedFatLabel,
  formatMealSugarsLabel,
} from "../../utils/mealNutritionFormat";
import type { MealNutritionMacroSnapshot } from "../../utils/mealNutritionCsv";
import type { loadSettingsPageData } from "./settings-catalog.server";
import {
  fieldStyle,
  maintenanceDetailsStyle,
  maintenanceSummaryStyle,
  selectStyle,
  textInputStyle,
} from "./settings-styles";
import type { SettingsActionData } from "./settings-types";

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
  `Graisses saturées : ${formatImportMacroOrUnset(formatMealSaturatedFatLabel(macros.saturatedFat), "")}`,
  `Sucres : ${formatImportMacroOrUnset(formatMealSugarsLabel(macros.sugars), "")}`,
  `Fibres : ${formatImportMacroOrUnset(formatMealFiberLabel(macros.fiber), "")}`,
  `Sel : ${formatImportMacroOrUnset(formatMealSaltLabel(macros.salt), "")}`,
  `Portion : ${formatImportMacroOrUnset(formatMealPortionGramsLabel(macros.portionGrams), "")}`,
];

function ActionErrors({ errors }: { errors: string[] }) {
  return (
    <s-unordered-list>
      {errors.map((error) => (
        <s-list-item key={error}>{error}</s-list-item>
      ))}
    </s-unordered-list>
  );
}

export default function Settings() {
  const actionData = useActionData<SettingsActionData>();
  const { collections, settings } = useLoaderData<SettingsPageData>();
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
      <s-section heading="Plats">
        <s-stack gap="base">
          <s-text>
            Sélectionnez la collection Shopify qui alimente le catalogue repas
            Mileyo (recettes proposées aux abonnés).
          </s-text>
          <Form method="post">
            <input type="hidden" name="intent" value="saveSettings" />
            <input
              name="boxCollectionId"
              type="hidden"
              value={settings.boxCollectionId ?? ""}
            />
            <s-stack gap="base">
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
          {settings.mealCollectionTitle ? (
            <s-text>
              Collection active :{" "}
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
                <ActionErrors errors={actionData.errors} />
              ) : null}
            </>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Nutrition">
        <s-stack gap="large">
          <s-stack gap="base">
            <s-text>
              <strong>Export nutrition CSV</strong>
            </s-text>
            <s-text>
              Télécharge un CSV pré-rempli (une ligne par variante repas) pour
              renseigner les macros : calories, protéines, glucides, lipides,
              portion. Ce fichier sert aussi de format d’import.
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
                Sélectionnez une collection de plats avant d’exporter le
                template nutrition.
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
                  <ActionErrors errors={actionData.errors} />
                ) : null}
              </>
            ) : null}
          </s-stack>

          <s-stack gap="base">
            <s-text>
              <strong>Import nutrition CSV</strong>
            </s-text>
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
                                <s-text
                                  key={`before-${diff.variantId}-${line}`}
                                >
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
                  <ActionErrors errors={actionData.errors} />
                ) : null}
              </s-stack>
            ) : null}
            {actionData?.errors?.length &&
            actionData.message?.includes("écriture") ? (
              <ActionErrors errors={actionData.errors} />
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Maintenance / Configuration avancée">
        <s-stack gap="base">
          <s-text>
            Ces outils servent au provisioning ou à la maintenance du catalogue.
            Ne les utilisez pas pour les opérations quotidiennes.
          </s-text>
          <details style={maintenanceDetailsStyle}>
            <summary style={maintenanceSummaryStyle}>
              Afficher les outils de maintenance
            </summary>
            <s-stack gap="large">
              <s-stack gap="base">
                <s-text>
                  <strong>Metafields variante (V2)</strong>
                </s-text>
                <s-text>
                  Crée uniquement les définitions Shopify pour les variantes
                  produit. Aucune valeur n’est écrite sur les variants.
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
              </s-stack>

              <s-stack gap="base">
                <s-text>
                  <strong>Définitions Repas V2</strong>
                </s-text>
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
              </s-stack>

              <s-stack gap="base">
                <s-text>
                  <strong>Catalogue Repas V2</strong>
                </s-text>
                <s-text>
                  Convertit in-place les recettes legacy de la collection de
                  plats configurée : option <strong>Objectif</strong> + 3
                  variantes (Perte de poids · Équilibré · Prise de masse) avec{" "}
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
                    <input
                      type="hidden"
                      name="intent"
                      value="setupV2MealCatalog"
                    />
                    <s-button type="submit">
                      Préparer catalogue Repas V2
                    </s-button>
                  </Form>
                ) : (
                  <s-text>
                    Sélectionnez une collection de plats avant de préparer le
                    catalogue Repas V2.
                  </s-text>
                )}
              </s-stack>

              <s-stack gap="base">
                <s-text>
                  <strong>Catalogue Box V2</strong>
                </s-text>
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
                  Prix : gérés dans Shopify. Les valeurs initiales servent
                  uniquement à l’initialisation d’un catalogue vide.
                </s-text>
                <s-text>
                  Création initiale en brouillon (DRAFT) — la publication se
                  fait dans Shopify Admin.
                </s-text>
                <Form method="post">
                  <input type="hidden" name="intent" value="setupV2BoxCatalog" />
                  <s-button type="submit">
                    Créer / vérifier catalogue Box V2
                  </s-button>
                </Form>
              </s-stack>

              <s-stack gap="base">
                <s-text>
                  <strong>Abonnements Box V2</strong>
                </s-text>
                <s-text>
                  Configure le selling plan hebdomadaire V2 pour le produit{" "}
                  <strong>Box Mileyo V2</strong> (handle{" "}
                  <strong>box-mileyo-v2</strong>), uniquement si toutes ses
                  variantes ont <strong>mileyo.objective</strong> et{" "}
                  <strong>mileyo.meal_count</strong> au niveau variante.
                </s-text>
                <s-text>
                  Les produits legacy de la collection historique ne sont pas
                  concernés. Le prix d’abonnement est le prix de la variante.
                  Aucun discount supplémentaire n’est appliqué.
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
              </s-stack>

              {actionData?.message &&
              !actionData.message.toLowerCase().includes("chat") &&
              actionData.nutritionImportPreview === undefined &&
              actionData.csv === undefined &&
              actionData.nutritionImportAppliedCount == null ? (
                <>
                  <s-text>{actionData.message}</s-text>
                  {actionData.errors?.length ? (
                    <ActionErrors errors={actionData.errors} />
                  ) : null}
                </>
              ) : null}
            </s-stack>
          </details>
        </s-stack>
      </s-section>
    </s-page>
  );
}
