/**
 * Business regression — portal meal filters in week editor (UX-3B.1).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mealExcludedByAllergenFilters } from "../../app/utils/mealAllergenFilters";
import { mealMatchesBadgeFilters } from "../../app/utils/mealBadgeFilters";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = () => {
  const ctx = createBusinessTestContext("47-portal-meal-filters");
  const portalClient = readSource("app/features/portal/portal-client.ts");
  const portalRender = readSource("app/features/portal/portal-render.ts");
  const portalStyles = readSource("app/features/portal/portal-styles.ts");

  const renderMealGridSource = portalClient.slice(
    portalClient.indexOf("function renderMealGrid"),
    portalClient.indexOf("function updateEditor"),
  );
  const updateEditorSource = portalClient.slice(
    portalClient.indexOf("function updateEditor"),
    portalClient.indexOf("function setMealEditingState"),
  );
  const closeMealEditorSource = portalClient.slice(
    portalClient.indexOf("function closeMealEditor"),
    portalClient.indexOf("function closeBoxChange"),
  );
  const renderBoxChangeMealGridSource = portalClient.slice(
    portalClient.indexOf("function renderBoxChangeMealGrid"),
    portalClient.indexOf("function updateSelectedBoxLabels"),
  );

  ctx.scenario("A. Bouton filtres dans l’éditeur seulement");
  ctx.assertTrue(
    "editor markup includes Filtres toggle",
    portalRender.includes('class="meal-filters-toggle"') &&
      portalRender.includes("meal-filters-toggle-label") &&
      portalRender.includes(">Filtres</span>"),
  );
  ctx.assertTrue(
    "filters live inside .editor before meal-editor-grid",
    portalRender.includes("meal-editor-filters") &&
      portalRender.indexOf("meal-editor-filters") <
        portalRender.indexOf('class="meal-grid meal-editor-grid"'),
  );
  const heroPrimaryActions = portalRender.match(
    /<div class="hero-primary-actions">([\s\S]*?)<\/div>/,
  );
  ctx.assertTrue(
    "hero primary actions do not include filter toggle",
    Boolean(heroPrimaryActions) &&
      heroPrimaryActions![1].includes("Préparer ma semaine") &&
      !heroPrimaryActions![1].includes("meal-filters"),
  );
  ctx.assertFalse(
    "box-change editor does not include meal filters",
    /box-change-editor[\s\S]*meal-editor-filters/.test(portalRender) ||
      /box-change-meal-grid[\s\S]*meal-filters-toggle/.test(portalRender),
  );
  ctx.assertTrue(
    "drawer titled Filtrer les plats",
    portalRender.includes("Filtrer les plats") &&
      portalRender.includes('id="portal-meal-filters-drawer"'),
  );
  ctx.assertTrue(
    "drawer sections Mes envies then J'évite",
    portalRender.indexOf(">Mes envies<") < portalRender.indexOf(">J'évite<") &&
      portalRender.includes('id="portal-badge-filters"') &&
      portalRender.includes('id="portal-allergen-filters"'),
  );

  ctx.scenario("B. Pipeline client objectif → filtres → grille");
  ctx.assertTrue(
    "reuses builder mealFilterRuntimeScript",
    portalClient.includes('from "../builder/builder-filter-runtime"') &&
      portalClient.includes("${mealFilterRuntimeScript}"),
  );
  ctx.assertTrue(
    "visible meals pipeline uses mealMatchesFilter after objective",
    portalClient.includes("function visibleMealsForSelection(selection)") &&
      portalClient.includes(
        "mealsForSelection(selection).filter(mealMatchesFilter)",
      ),
  );
  ctx.assertTrue(
    "renderMealGrid uses visibleMealsForSelection",
    renderMealGridSource.includes("visibleMealsForSelection(selection)"),
  );
  ctx.assertTrue(
    "box-change grid stays on mealsForSelection only",
    renderBoxChangeMealGridSource.includes("mealsForSelection(selection)") &&
      !renderBoxChangeMealGridSource.includes("visibleMealsForSelection") &&
      !renderBoxChangeMealGridSource.includes("mealMatchesFilter"),
  );

  ctx.scenario("C. Helpers badge / allergène inchangés");
  ctx.assertTrue(
    "badge include-any hides non-matching meals",
    mealMatchesBadgeFilters(["Poulet"], ["poulet"]) === true &&
      mealMatchesBadgeFilters(["Saumon"], ["poulet"]) === false &&
      mealMatchesBadgeFilters([], ["poulet"]) === false &&
      mealMatchesBadgeFilters(["Poulet"], []) === true,
  );
  ctx.assertTrue(
    "allergen exclude hides matching meals",
    mealExcludedByAllergenFilters(["Gluten"], ["gluten"]) === true &&
      mealExcludedByAllergenFilters(["Lait"], ["gluten"]) === false &&
      mealExcludedByAllergenFilters([], ["gluten"]) === false &&
      mealExcludedByAllergenFilters(["Gluten"], []) === false,
  );

  ctx.scenario("D. Sélection et compteur préservés");
  ctx.assertTrue(
    "updateEditor counts from quantities not visible meals",
    updateEditorSource.includes("selectedTotal(editor.quantities)") &&
      updateEditorSource.includes("renderMealGrid(editor)") &&
      !updateEditorSource.includes("visibleMealsForSelection"),
  );
  ctx.assertTrue(
    "renderMealGrid does not mutate editor.quantities",
    !renderMealGridSource.includes("editor.quantities =") &&
      !renderMealGridSource.includes("delete editor.quantities") &&
      renderMealGridSource.includes("editor.quantities"),
  );
  ctx.assertTrue(
    "filters reset when leaving editor",
    closeMealEditorSource.includes("clearMealFiltersOnEditorClose()") &&
      portalClient.includes("function clearMealFiltersOnEditorClose()") &&
      portalClient.includes("selectedAllergenFilters = []") &&
      portalClient.includes("selectedBadgeFilters = []"),
  );
  ctx.assertFalse(
    "no localStorage filter persistence",
    portalClient.includes("localStorage") &&
      /localStorage[\s\S]{0,80}Filter/.test(portalClient),
  );

  ctx.scenario("E. Reset + drawers existants");
  ctx.assertTrue(
    "empty-state reset clears applied filters",
    portalClient.includes("function resetMealFilters()") &&
      portalRender.includes("meal-editor-empty-reset") &&
      portalClient.includes("editor.emptyStateReset.addEventListener"),
  );
  ctx.assertTrue(
    "meal detail drawer still wired",
    portalClient.includes("function openMealDetail") &&
      portalClient.includes("function closeMealDetail") &&
      portalRender.includes('id="meal-detail-overlay"'),
  );
  ctx.assertTrue(
    "nutrition modal still wired",
    portalClient.includes("function openMealNutritionModal") &&
      portalRender.includes('id="meal-nutrition-modal"'),
  );
  ctx.assertTrue(
    "filter drawer above sticky footer",
    portalStyles.includes(".meal-filters-drawer") &&
      portalStyles.includes("z-index: 90"),
  );
  ctx.assertTrue(
    "sticky footer meal-editor-actions preserved",
    portalStyles.includes(
      ".selection-card.is-meal-editing .editor:not(.paused-editor) .meal-editor-actions",
    ) &&
      portalRender.includes('class="meal-editor-actions"') &&
      portalRender.includes("save-button") &&
      portalRender.includes("cancel-button"),
  );

  return finishSuite("47-portal-meal-filters", ctx);
};

process.exitCode = runSuite();
