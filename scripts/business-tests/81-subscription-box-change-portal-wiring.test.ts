/**
 * Business regression — BOX-CHANGE-3 / 3B portal wiring for changeSubscriptionBox.
 *
 * Source-level guards: recovery block, coverage branch, unpaid immediate,
 * locked pending (validate target meals → toSelectedMeals, no current selection
 * mutation / no Shopify), success discriminator, cutoff preserved,
 * changeMeals not broadened.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOX_CHANGE_EFFECT,
  BOX_CHANGE_PENDING_SUCCESS_MESSAGE,
  BOX_CHANGE_RECOVERY_BLOCK_MESSAGE,
  buildBoxChangePendingSuccessMessage,
} from "../../app/constants/subscriptionBoxChange";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "81-subscription-box-change-portal-wiring",
  );

  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const portalRenderSource = readRepoFile(
    "app/features/portal/portal-render.ts",
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

  const updateFutureBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleUpdateFutureMealSelectionAction"),
    portalActionsSource.indexOf("export const handlePortalAction"),
  );

  ctx.scenario("A. Constants — effect + recovery/pending copy");
  ctx.assertEqual(
    "BOX_CHANGE_EFFECT.IMMEDIATE",
    BOX_CHANGE_EFFECT.IMMEDIATE,
    "immediate",
  );
  ctx.assertEqual(
    "BOX_CHANGE_EFFECT.NEXT_CYCLE",
    BOX_CHANGE_EFFECT.NEXT_CYCLE,
    "next_cycle",
  );
  ctx.assertTrue(
    "recovery block copy present",
    BOX_CHANGE_RECOVERY_BLOCK_MESSAGE.includes("régularisation"),
  );
  ctx.assertTrue(
    "pending success copy keeps current box",
    BOX_CHANGE_PENDING_SUCCESS_MESSAGE.includes("inchangée") &&
      BOX_CHANGE_PENDING_SUCCESS_MESSAGE.includes("prochain cycle"),
  );
  ctx.assertTrue(
    "pending success leads with prochaine box enregistrée",
    BOX_CHANGE_PENDING_SUCCESS_MESSAGE.includes(
      "Votre prochaine box est enregistrée",
    ),
  );
  ctx.assertTrue(
    "constants export BOX_CHANGE_EFFECT",
    constantsSource.includes("BOX_CHANGE_EFFECT"),
  );

  ctx.scenario("B. Recovery SoT — box change only");
  ctx.assertTrue(
    "change box uses isRecoveryBlockingBoxChange",
    changeBoxBlock.includes("isRecoveryBlockingBoxChange"),
  );
  ctx.assertTrue(
    "change box uses BOX_CHANGE_RECOVERY_BLOCK_MESSAGE",
    changeBoxBlock.includes("BOX_CHANGE_RECOVERY_BLOCK_MESSAGE"),
  );
  ctx.assertFalse(
    "changeMeals does not use isRecoveryBlockingBoxChange",
    updateFutureBlock.includes("isRecoveryBlockingBoxChange"),
  );
  ctx.assertFalse(
    "change box does not hardcode recovery status list",
    changeBoxBlock.includes("retry_scheduled") ||
      changeBoxBlock.includes("payment_method_update_needed") ||
      changeBoxBlock.includes("email_send_failed"),
  );

  ctx.scenario("C. Coverage resolution before Shopify mutation");
  ctx.assertTrue(
    "resolveCurrentDeliveryCoverage in change box",
    changeBoxBlock.includes("resolveCurrentDeliveryCoverage"),
  );
  ctx.assertTrue(
    "coverage before updateSubscriptionContractBoxViaDraft",
    changeBoxBlock.indexOf("resolveCurrentDeliveryCoverage") <
      changeBoxBlock.indexOf("updateSubscriptionContractBoxViaDraft"),
  );
  ctx.assertTrue(
    "locked branch calls requestSubscriptionBoxChange",
    changeBoxBlock.includes("requestSubscriptionBoxChange") &&
      changeBoxBlock.includes("if (locked)"),
  );

  ctx.scenario(
    "D. Pending branch — target meals on pending, current selection untouched",
  );
  {
    const lockedStart = changeBoxBlock.indexOf("if (locked)");
    const unpaidMarker = changeBoxBlock.indexOf(
      "// unpaid → immediate (existing behavior)",
    );
    const lockedBlock = changeBoxBlock.slice(
      lockedStart,
      unpaidMarker > lockedStart ? unpaidMarker : changeBoxBlock.length,
    );

    ctx.assertTrue("locked branch present", lockedStart >= 0);
    ctx.assertFalse(
      "locked has no Shopify draft mutation",
      lockedBlock.includes("updateSubscriptionContractBoxViaDraft"),
    );
    ctx.assertFalse(
      "locked does not write selection.mealsCount",
      /prisma\.subscriptionMealSelection\.update|subscriptionMealSelection\.update/.test(
        lockedBlock,
      ),
    );
    ctx.assertTrue(
      "locked validates meals against selectedBox.mealCount",
      lockedBlock.includes("mealsCount: selectedBox.mealCount") &&
        lockedBlock.includes("validateMealSelection"),
    );
    ctx.assertTrue(
      "locked stores toSelectedMeals on pending",
      lockedBlock.includes("toSelectedMeals: validation.titles"),
    );
    ctx.assertTrue(
      "locked uses selection.nextBillingDate as effectiveBillingDate",
      lockedBlock.includes("effectiveBillingDate: selection.nextBillingDate"),
    );
    ctx.assertTrue(
      "locked from = current active box variant",
      lockedBlock.includes("fromProductVariantId: currentBox.variantId"),
    );
    ctx.assertTrue(
      "locked documents current delivery isolation",
      changeBoxBlock.includes("Do not mutate") &&
        changeBoxBlock.includes("selection.selectedMeals"),
    );
  }

  ctx.scenario("E. Unpaid branch — immediate path preserved");
  ctx.assertTrue(
    "unpaid validates meals against new size",
    changeBoxBlock.includes("mealsCount: selectedBox.mealCount") &&
      changeBoxBlock.includes("validateMealSelection"),
  );
  ctx.assertTrue(
    "unpaid still mutates Shopify draft",
    changeBoxBlock.includes("updateSubscriptionContractBoxViaDraft"),
  );
  ctx.assertTrue(
    "unpaid still updates selection mealsCount + selectedMeals",
    changeBoxBlock.includes("mealsCount: selectedBox.mealCount") &&
      changeBoxBlock.includes("selectedMeals: validation.titles"),
  );
  ctx.assertTrue(
    "immediate effect on unpaid success",
    changeBoxBlock.includes("BOX_CHANGE_EFFECT.IMMEDIATE"),
  );

  ctx.scenario("F. Success discriminator + pending copy");
  ctx.assertTrue(
    "pending success uses NEXT_CYCLE effect",
    changeBoxBlock.includes("BOX_CHANGE_EFFECT.NEXT_CYCLE"),
  );
  ctx.assertTrue(
    "pending success uses buildBoxChangePendingSuccessMessage",
    changeBoxBlock.includes("buildBoxChangePendingSuccessMessage"),
  );
  ctx.assertTrue(
    "buildBoxChangePendingSuccessMessage includes meal count",
    buildBoxChangePendingSuccessMessage(12).includes("12 repas") &&
      buildBoxChangePendingSuccessMessage(12).includes(
        "Votre prochaine box est enregistrée",
      ),
  );
  ctx.assertTrue(
    "renderPortal accepts boxChangeEffect",
    portalRenderSource.includes("boxChangeEffect") &&
      portalRenderSource.includes("data-box-change-effect"),
  );
  ctx.assertFalse(
    "pending copy does not claim box already modified",
    BOX_CHANGE_PENDING_SUCCESS_MESSAGE.includes("ont été modifiés"),
  );

  ctx.scenario("G. Cutoff + billing_processing routing");
  ctx.assertTrue(
    "change box still consults getPortalModificationBlockReason",
    changeBoxBlock.includes("getPortalModificationBlockReason"),
  );
  ctx.assertTrue(
    "billing_processing falls through to coverage (not hard-block)",
    changeBoxBlock.includes('blockReason !== "billing_processing"'),
  );
  ctx.assertTrue(
    "cutoff still applied via blockReason path",
    changeBoxBlock.includes("getCutoffNow()") ||
      portalActionsSource.includes("getCutoffNow()"),
  );

  ctx.scenario("H. Portal does not apply — billing worker owns BOX-CHANGE-4");
  ctx.assertTrue(
    "billing worker owns applyPendingSubscriptionBoxChangeForBilling",
    billingWorkerSource.includes("applyPendingSubscriptionBoxChangeForBilling"),
  );
  ctx.assertFalse(
    "change box does not mark applying/applied",
    changeBoxBlock.includes("markSubscriptionBoxChangeApplying") ||
      changeBoxBlock.includes("markSubscriptionBoxChangeApplied"),
  );

  ctx.scenario("I. changeMeals stays on current selection only");
  ctx.assertTrue(
    "updateFutureMealSelection validates against selection.mealsCount",
    updateFutureBlock.includes("mealsCount: selection.mealsCount"),
  );
  ctx.assertTrue(
    "updateFutureMealSelection syncs via applyCurrentDeliveryMealSelectionUpdate",
    updateFutureBlock.includes("applyCurrentDeliveryMealSelectionUpdate") &&
      updateFutureBlock.includes("selectedMeals: validation.titles"),
  );
  ctx.assertFalse(
    "updateFutureMealSelection does not touch SubscriptionBoxChange",
    updateFutureBlock.includes("requestSubscriptionBoxChange") ||
      updateFutureBlock.includes("toSelectedMeals") ||
      updateFutureBlock.includes("subscriptionBoxChange"),
  );

  return finishSuite("81-subscription-box-change-portal-wiring", ctx);
};

runSuite();
