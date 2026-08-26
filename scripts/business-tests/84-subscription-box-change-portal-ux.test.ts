/**
 * Business regression — BOX-CHANGE-6 portal UX: current vs pending box.
 *
 * Source-level guards: pending DTO exposure, current box remains primary,
 * pending notice copy, editor next-cycle wording, meal counters,
 * success immediate vs next_cycle, recovery/cutoff keep pending visible,
 * no refund/prorata wording.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOX_CHANGE_IMMEDIATE_SUCCESS_MESSAGE,
  BOX_CHANGE_NEXT_CYCLE_NO_EXTRA_CHARGE,
  BOX_CHANGE_NEXT_CYCLE_STEP1_NOTICE,
  BOX_CHANGE_NEXT_CYCLE_STEP1_TIMING,
  BOX_CHANGE_PENDING_CARD_COPY,
  BOX_CHANGE_PENDING_REPLACE_NOTICE,
  BOX_CHANGE_PENDING_SUCCESS_MESSAGE,
  BOX_CHANGE_RECOVERY_BLOCK_MESSAGE,
  buildBoxChangeDowngradeNotice,
  buildBoxChangeFutureMealsNotice,
  buildBoxChangeFutureMealsTitle,
  buildBoxChangePendingSuccessMessage,
  buildCurrentMealEditorPendingNotice,
} from "../../app/constants/subscriptionBoxChange";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const FORBIDDEN_BILLING_UX = [
  "remboursement",
  "prorata",
  "proraté",
  "+20 € aujourd",
  "supplément maintenant",
];

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "84-subscription-box-change-portal-ux",
  );

  const portalTypesSource = readRepoFile(
    "app/features/portal/portal-types.ts",
  );
  const portalDataSource = readRepoFile(
    "app/features/portal/portal-data.server.ts",
  );
  const portalRenderSource = readRepoFile(
    "app/features/portal/portal-render.ts",
  );
  const portalClientSource = readRepoFile(
    "app/features/portal/portal-client.ts",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const portalStylesSource = readRepoFile(
    "app/features/portal/portal-styles.ts",
  );
  const constantsSource = readRepoFile(
    "app/constants/subscriptionBoxChange.ts",
  );
  const billingWorkerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );

  const changeBoxBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleChangeSubscriptionBoxAction"),
    portalActionsSource.indexOf("const handleUpdateFutureMealSelectionAction"),
  );

  ctx.scenario("1–2. DTO — current without / with pending fields");
  ctx.assertTrue(
    "PortalPendingBoxChange type exported",
    portalTypesSource.includes("export type PortalPendingBoxChange"),
  );
  ctx.assertTrue(
    "PortalSelection has pendingBoxChange",
    portalTypesSource.includes("pendingBoxChange: PortalPendingBoxChange | null"),
  );
  ctx.assertTrue(
    "PortalSelection has boxChangeAppliesNextCycle",
    portalTypesSource.includes("boxChangeAppliesNextCycle: boolean"),
  );
  ctx.assertTrue(
    "pending DTO includes mealsCount + price + effectiveBillingDate",
    portalTypesSource.includes("mealsCount: number") &&
      portalTypesSource.includes("boxSubscriptionPrice: string | null") &&
      portalTypesSource.includes("effectiveBillingDate: string"),
  );
  ctx.assertTrue(
    "portal-data loads getPendingSubscriptionBoxChange",
    portalDataSource.includes("getPendingSubscriptionBoxChange"),
  );
  ctx.assertTrue(
    "portal-data resolves coverage for next-cycle UX",
    portalDataSource.includes("resolveCurrentDeliveryCoverage") &&
      portalDataSource.includes("boxChangeAppliesNextCycle"),
  );
  ctx.assertTrue(
    "pending price from catalog runtime (targetBox?.price)",
    portalDataSource.includes("boxSubscriptionPrice: targetBox?.price ?? null"),
  );

  ctx.scenario("3–6. Current vs pending notice + timing + price");
  ctx.assertTrue(
    "current box labeled Box actuelle with data-current-box-meals",
    portalRenderSource.includes("Box actuelle") &&
      portalRenderSource.includes('data-current-box-meals="${selection.mealsCount}"'),
  );
  ctx.assertTrue(
    "pending notice Prochaine box",
    portalRenderSource.includes("Prochaine box") &&
      portalRenderSource.includes("pending-box-notice"),
  );
  ctx.assertTrue(
    "pending meals via data-pending-box-meals",
    portalRenderSource.includes("data-pending-box-meals"),
  );
  ctx.assertTrue(
    "pending timing uses prochain prélèvement",
    portalRenderSource.includes("À partir de votre prochain prélèvement"),
  );
  ctx.assertTrue(
    "pending price label Prochain prélèvement",
    portalRenderSource.includes("Prochain prélèvement :"),
  );
  ctx.assertTrue(
    "pending card copy keeps current delivery unchanged",
    BOX_CHANGE_PENDING_CARD_COPY.includes("livraison actuelle reste inchangée") &&
      BOX_CHANGE_PENDING_CARD_COPY.includes("prochain cycle"),
  );
  ctx.assertTrue(
    "pending styles are neutral/positive (not error red)",
    portalStylesSource.includes(".pending-box-notice") &&
      portalStylesSource.includes("rgba(124, 201, 167"),
  );

  ctx.scenario("7–9. Future meals step — target count + current untouched");
  ctx.assertTrue(
    "future meals title helper uses target count",
    buildBoxChangeFutureMealsTitle(12) ===
      "Choisissez les 12 plats de votre prochaine box",
  );
  ctx.assertTrue(
    "future meals notice keeps current 8",
    buildBoxChangeFutureMealsNotice(8).includes("8 plats") &&
      buildBoxChangeFutureMealsNotice(8).includes("ne seront pas modifiés"),
  );
  ctx.assertTrue(
    "client updates meal title with selectedBox.mealCount",
    portalClientSource.includes(
      'Choisissez les " + selectedBox.mealCount + " plats de votre prochaine box',
    ),
  );
  ctx.assertTrue(
    "client sets data-box-change-target-count from requiredMeals",
    portalClientSource.includes("data-box-change-target-count") &&
      portalClientSource.includes("boxChangeState.requiredMeals"),
  );
  ctx.assertTrue(
    "step1 next-cycle copy present",
    BOX_CHANGE_NEXT_CYCLE_STEP1_NOTICE.includes(
      "ne modifiera pas votre livraison actuelle",
    ) &&
      BOX_CHANGE_NEXT_CYCLE_STEP1_TIMING.includes("prochain cycle") &&
      BOX_CHANGE_NEXT_CYCLE_NO_EXTRA_CHARGE.includes(
        "Aucun montant supplémentaire",
      ),
  );
  ctx.assertTrue(
    "render wires next-cycle step1 notices",
    portalRenderSource.includes("BOX_CHANGE_NEXT_CYCLE_STEP1_NOTICE") &&
      portalRenderSource.includes("box-change-next-cycle-notice"),
  );

  ctx.scenario("10. Current meal editor keeps current count with pending");
  ctx.assertTrue(
    "meal editor count uses selection.mealsCount",
    portalRenderSource.includes(
      "0 / ${selection.mealsCount} repas",
    ) &&
      portalRenderSource.includes('data-current-meal-count="${selection.mealsCount}"'),
  );
  ctx.assertTrue(
    "pending notice in current meal editor",
    buildCurrentMealEditorPendingNotice(12).includes("12 repas") &&
      buildCurrentMealEditorPendingNotice(12).includes(
        "livraison actuelle",
      ),
  );
  ctx.assertTrue(
    "render shows meal-editor-pending-notice when pending",
    portalRenderSource.includes("meal-editor-pending-notice") &&
      portalRenderSource.includes("buildCurrentMealEditorPendingNotice"),
  );

  ctx.scenario("11–13. Success next_cycle vs immediate");
  ctx.assertTrue(
    "next_cycle success distinct from immediate",
    buildBoxChangePendingSuccessMessage(12).includes(
      "Votre prochaine box est enregistrée",
    ) &&
      !buildBoxChangePendingSuccessMessage(12).includes(
        BOX_CHANGE_IMMEDIATE_SUCCESS_MESSAGE,
      ),
  );
  ctx.assertTrue(
    "immediate success is short confirmation",
    BOX_CHANGE_IMMEDIATE_SUCCESS_MESSAGE === "Votre box a bien été modifiée.",
  );
  ctx.assertTrue(
    "actions use buildBoxChangePendingSuccessMessage for next_cycle",
    changeBoxBlock.includes("buildBoxChangePendingSuccessMessage") &&
      changeBoxBlock.includes("BOX_CHANGE_EFFECT.NEXT_CYCLE"),
  );
  ctx.assertTrue(
    "actions use BOX_CHANGE_IMMEDIATE_SUCCESS_MESSAGE",
    changeBoxBlock.includes("BOX_CHANGE_IMMEDIATE_SUCCESS_MESSAGE") &&
      changeBoxBlock.includes("BOX_CHANGE_EFFECT.IMMEDIATE"),
  );
  ctx.assertTrue(
    "data-box-change-effect still rendered",
    portalRenderSource.includes("data-box-change-effect"),
  );
  ctx.assertFalse(
    "generic pending constant does not claim already modified",
    BOX_CHANGE_PENDING_SUCCESS_MESSAGE.includes("ont été modifiés") ||
      BOX_CHANGE_PENDING_SUCCESS_MESSAGE.includes("a bien été modifiée"),
  );

  ctx.scenario("14–15. Downgrade copy + no refund/prorata wording");
  {
    const downgrade = buildBoxChangeDowngradeNotice({
      currentMealsCount: 12,
      targetMealsCount: 8,
    });
    ctx.assertTrue(
      "downgrade keeps current 12, future 8",
      downgrade.includes("reste à 12 repas") &&
        downgrade.includes("passera à 8 repas") &&
        downgrade.includes("prochain cycle"),
    );
    ctx.assertTrue(
      "render uses downgrade notice when pending meals < current",
      portalRenderSource.includes("buildBoxChangeDowngradeNotice"),
    );

    const uxSurfaces = [
      constantsSource,
      portalRenderSource,
      portalClientSource,
      changeBoxBlock,
    ].join("\n");

    for (const forbidden of FORBIDDEN_BILLING_UX) {
      ctx.assertFalse(
        `no forbidden UX wording: ${forbidden}`,
        uxSurfaces.toLowerCase().includes(forbidden.toLowerCase()),
      );
    }
  }

  ctx.scenario("16. Pending replacement shows latest target only");
  ctx.assertTrue(
    "replace notice without cancellation fear",
    BOX_CHANGE_PENDING_REPLACE_NOTICE.includes("remplacera") &&
      !BOX_CHANGE_PENDING_REPLACE_NOTICE.toLowerCase().includes("annul"),
  );
  ctx.assertTrue(
    "editor shows replace notice when pending exists",
    portalRenderSource.includes("BOX_CHANGE_PENDING_REPLACE_NOTICE") &&
      portalRenderSource.includes("box-change-replace-notice"),
  );
  ctx.assertTrue(
    "pending mealsCount comes from pendingRecord.toMealsCount only",
    portalDataSource.includes("mealsCount: pendingRecord.toMealsCount"),
  );

  ctx.scenario("17–18. Recovery blocks change, pending stays visible");
  ctx.assertTrue(
    "recovery uses BOX_CHANGE_RECOVERY_BLOCK_MESSAGE",
    BOX_CHANGE_RECOVERY_BLOCK_MESSAGE.includes("régularisation") &&
      portalDataSource.includes("BOX_CHANGE_RECOVERY_BLOCK_MESSAGE"),
  );
  ctx.assertTrue(
    "canChangeBox respects boxChangeBlocked",
    portalRenderSource.includes("!selection.boxChangeBlocked"),
  );
  ctx.assertTrue(
    "blocked reason shown with data-box-change-blocked",
    portalRenderSource.includes('data-box-change-blocked="true"'),
  );
  ctx.assertTrue(
    "pending notice independent of canChangeBox",
    portalRenderSource.includes(
      "pending ? renderPendingBoxChangeNotice(pending, selection.mealsCount)",
    ) && portalRenderSource.includes("!selection.boxChangeBlocked"),
  );

  ctx.scenario("19–20. Cutoff blocks change, pending stays visible");
  ctx.assertTrue(
    "cutoff remains a hard box-change block (not billing_processing)",
    portalDataSource.includes('!== "billing_processing"') &&
      portalDataSource.includes("hardBoxChangeBlockReason"),
  );
  ctx.assertTrue(
    "pending still rendered when present regardless of cutoff UI",
    portalRenderSource.includes(
      "pending ? renderPendingBoxChangeNotice(pending, selection.mealsCount)",
    ),
  );

  ctx.scenario("21. Mobile / critical markup classes present");
  ctx.assertTrue(
    "pending-box-notice + subscription-current-label styles",
    portalStylesSource.includes(".pending-box-notice") &&
      portalStylesSource.includes(".subscription-current-label"),
  );
  ctx.assertTrue(
    "box-change-editor keeps existing structure",
    portalRenderSource.includes("box-change-editor") &&
      portalRenderSource.includes('data-step="1"') &&
      portalRenderSource.includes('data-step="2"'),
  );
  ctx.assertTrue(
    "confirm button remains a real button",
    portalRenderSource.includes('class="portal-button box-change-confirm"') &&
      portalRenderSource.includes('type="button"'),
  );

  ctx.scenario("22. BOX-CHANGE-6B — desktop layout: editor in main, not sidebar");
  {
    const mainHostIdx = portalRenderSource.indexOf(
      'data-box-change-host="main"',
    );
    const editorIdx = portalRenderSource.indexOf('class="box-change-editor');
    const sideColumnIdx = portalRenderSource.indexOf(
      'aside class="portal-side-column"',
    );
    const manageIdx = portalRenderSource.indexOf(
      'class="portal-section manage-section"',
    );
    const pendingNoticeIdx = portalRenderSource.indexOf(
      "renderPendingBoxChangeNotice",
    );
    const mealGridIdx = portalRenderSource.indexOf("box-change-meal-grid");

    ctx.assertTrue(
      "box-change-section hosts editor in main column",
      portalRenderSource.includes("box-change-section") &&
        mainHostIdx >= 0 &&
        editorIdx > mainHostIdx,
    );
    ctx.assertTrue(
      "box editor appears before sidebar (main column)",
      editorIdx >= 0 && sideColumnIdx > editorIdx,
    );
    ctx.assertTrue(
      "future meals grid is with main editor (before sidebar)",
      mealGridIdx >= 0 && mealGridIdx < sideColumnIdx,
    );
    ctx.assertTrue(
      "manage-section has no box-change-editor",
      manageIdx > sideColumnIdx &&
        !portalRenderSource
          .slice(manageIdx, manageIdx + 1200)
          .includes("box-change-editor"),
    );
    ctx.assertTrue(
      "pending summary stays in sidebar subscription block",
      pendingNoticeIdx > sideColumnIdx ||
        portalRenderSource.includes(
          "pending ? renderPendingBoxChangeNotice(pending, selection.mealsCount)",
        ),
    );
    ctx.assertTrue(
      "single box-change-editor instance (no duplication)",
      (portalRenderSource.match(/class="box-change-editor/g) || []).length ===
        1,
    );
    ctx.assertTrue(
      "confirm is one ternary (active|paused), not duplicated forms",
      (portalRenderSource.match(/class="portal-button box-change-confirm"/g) ||
        []).length === 2 &&
        portalRenderSource.includes("isActive") &&
        mealGridIdx < sideColumnIdx,
    );
    ctx.assertTrue(
      "section hides when editor hidden",
      portalStylesSource.includes(
        ".box-change-section:has(.box-change-editor.hidden)",
      ),
    );
    ctx.assertTrue(
      "main-column meal grid widens on desktop",
      portalStylesSource.includes(
        ".portal-main-column .box-change-editor .meal-grid",
      ) &&
        portalStylesSource.includes(
          "grid-template-columns: repeat(3, minmax(0, 1fr))",
        ),
    );
    ctx.assertTrue(
      "client toggles is-box-editing + gentle scroll",
      portalClientSource.includes('classList.add("is-box-editing")') &&
        portalClientSource.includes("scrollIntoView") &&
        portalClientSource.includes('classList.remove("is-box-editing")'),
    );
    ctx.assertTrue(
      "change-box button remains in settings sidebar",
      portalRenderSource.includes("change-box-button") &&
        portalRenderSource.indexOf("change-box-button") > sideColumnIdx,
    );
    ctx.assertTrue(
      "submit intent unchanged",
      portalClientSource.includes('body.set("intent", "changeSubscriptionBox")'),
    );
  }

  ctx.scenario("Scope — billing / recovery engine untouched by UX phase");
  ctx.assertFalse(
    "portal-render does not call applyPending",
    portalRenderSource.includes("applyPendingSubscriptionBoxChangeForBilling"),
  );
  ctx.assertFalse(
    "portal-data does not mark applying/applied",
    portalDataSource.includes("markSubscriptionBoxChangeApplying") ||
      portalDataSource.includes("markSubscriptionBoxChangeApplied"),
  );
  ctx.assertTrue(
    "billing worker still owns apply (unchanged ownership)",
    billingWorkerSource.includes("applyPendingSubscriptionBoxChangeForBilling"),
  );
  ctx.assertFalse(
    "no email event for box change in UX phase",
    changeBoxBlock.includes("EMAIL_EVENT_TYPE") ||
      changeBoxBlock.includes("ensureAndProcessEmailEvent"),
  );

  return finishSuite("84-subscription-box-change-portal-ux", ctx);
};

runSuite();
