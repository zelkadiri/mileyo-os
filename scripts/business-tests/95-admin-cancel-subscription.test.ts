/**
 * Business regression — admin cancel subscription (PROD-HARDENING).
 *
 * Source + helper guards: admin cancel must call Shopify subscriptionContractCancel,
 * never hard-delete or cancel BoxOrder, and stay fail-closed on terminal / wrong shop.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isManageableSubscriptionSelectionStatus,
  isTerminalSubscriptionSelectionStatus,
  SUBSCRIPTION_SELECTION_STATUS,
} from "../../app/constants/subscriptionMealSelection";
import { isTerminalPortalDisplayStatus } from "../../app/constants/subscriptionStatus";
import { toSubscriptionContractGid } from "../../app/services/subscriptionBillingWorker.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepoFile = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

const runSuite = () => {
  const ctx = createBusinessTestContext("95-admin-cancel-subscription");

  const actionsSource = readRepoFile(
    "app/features/subscriptions/subscriptions-actions.server.ts",
  );
  const renderSource = readRepoFile(
    "app/features/subscriptions/subscriptions-render.tsx",
  );
  const formattersSource = readRepoFile(
    "app/features/subscriptions/subscriptions-formatters.ts",
  );
  const workerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const syncSource = readRepoFile(
    "app/services/subscriptionContractSync.server.ts",
  );
  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );

  const cancelActionSource = actionsSource.slice(
    actionsSource.indexOf('if (intent === "cancelSubscription")'),
    actionsSource.indexOf('if (intent !== "simulateNextSubscriptionOrder")'),
  );
  const cancelHelperSource = workerSource.slice(
    workerSource.indexOf(
      "export const cancelSubscriptionContractOnShopify",
    ),
    workerSource.indexOf("export type PortalSubscriptionState"),
  );

  ctx.scenario("A. Action admin cancel — intents et gardes");
  ctx.assertTrue(
    "admin action exposes cancelSubscription intent",
    actionsSource.includes('intent === "cancelSubscription"'),
  );
  ctx.assertTrue(
    "cancel loads selection scoped by id + shop",
    cancelActionSource.includes("id: selectionId") &&
      cancelActionSource.includes("shop,"),
  );
  ctx.assertTrue(
    "missing selection redirects cancelError",
    cancelActionSource.includes('redirectWithCancelError("Abonnement introuvable.")'),
  );
  ctx.assertTrue(
    "terminal local status is refused before Shopify",
    cancelActionSource.includes("isTerminalSubscriptionSelectionStatus(selection.status)") &&
      cancelActionSource.includes(
        "Cet abonnement est déjà terminé et ne peut plus être annulé.",
      ),
  );
  ctx.assertTrue(
    "ACTIVE and PAUSED are manageable for cancel",
    isManageableSubscriptionSelectionStatus(
      SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
    ) &&
      isManageableSubscriptionSelectionStatus(
        SUBSCRIPTION_SELECTION_STATUS.PAUSED,
      ),
  );
  ctx.assertTrue(
    "CANCELLED / EXPIRED / FAILED are terminal (refus)",
    isTerminalSubscriptionSelectionStatus(
      SUBSCRIPTION_SELECTION_STATUS.CANCELLED,
    ) &&
      isTerminalSubscriptionSelectionStatus(
        SUBSCRIPTION_SELECTION_STATUS.EXPIRED,
      ) &&
      isTerminalSubscriptionSelectionStatus(
        SUBSCRIPTION_SELECTION_STATUS.FAILED,
      ),
  );
  ctx.assertTrue(
    "missing contract id is refused",
    cancelActionSource.includes(
      "Contrat d’abonnement Shopify manquant pour cet abonnement.",
    ),
  );
  ctx.assertTrue(
    "cancel syncs + asserts via shared contract guard",
    cancelActionSource.includes(
      "syncAndAssertSubscriptionContractActionAllowed({",
    ) && cancelActionSource.includes('source: "admin_action"'),
  );
  ctx.assertTrue(
    "cancel calls cancelSubscriptionContractOnShopify",
    cancelActionSource.includes("cancelSubscriptionContractOnShopify("),
  );
  ctx.assertTrue(
    "Shopify error is surfaced without local write claiming success",
    cancelActionSource.includes("if (shopifyResult.error)") &&
      cancelActionSource.indexOf("if (shopifyResult.error)") <
        cancelActionSource.indexOf(
          "db.subscriptionMealSelection.update({",
        ),
  );
  ctx.assertTrue(
    "optimistic local update sets cancelled + inactive + clears nextBillingDate",
    cancelActionSource.includes('status: "cancelled"') &&
      cancelActionSource.includes("active: false") &&
      cancelActionSource.includes("nextBillingDate: null"),
  );
  ctx.assertTrue(
    "local update is scoped by id + shop (fail closed)",
    /where:\s*\{\s*id: cancellableSelection\.id,\s*shop,/m.test(
      cancelActionSource,
    ),
  );
  ctx.assertTrue(
    "success redirects with cancelSuccess",
    cancelActionSource.includes('redirect("/app/subscriptions?cancelSuccess=1")'),
  );
  ctx.assertTrue(
    "authenticate.admin is required for the subscriptions action handler",
    actionsSource.includes("authenticate.admin(request)"),
  );
  ctx.assertTrue(
    "portal does not expose cancelSubscription",
    !portalActionsSource.includes('intent === "cancelSubscription"'),
  );

  ctx.scenario("B. Mutation GraphQL subscriptionContractCancel");
  ctx.assertTrue(
    "helper mutation is subscriptionContractCancel",
    workerSource.includes(
      "mutation SubscriptionContractCancel($subscriptionContractId: ID!)",
    ) &&
      workerSource.includes(
        "subscriptionContractCancel(subscriptionContractId: $subscriptionContractId)",
      ),
  );
  ctx.assertTrue(
    "helper uses toSubscriptionContractGid",
    cancelHelperSource.includes(
      "toSubscriptionContractGid(subscriptionContractId)",
    ),
  );
  ctx.assertEqual(
    "GID helper formats numeric contract id",
    toSubscriptionContractGid("21188772168"),
    "gid://shopify/SubscriptionContract/21188772168",
  );
  ctx.assertTrue(
    "GraphQL top-level errors fail closed",
    cancelHelperSource.includes("json.errors?.length") &&
      cancelHelperSource.includes("Erreur GraphQL lors de l’annulation."),
  );
  ctx.assertTrue(
    "userErrors are propagated",
    cancelHelperSource.includes(
      "getGraphqlUserErrors(result?.userErrors)",
    ),
  );
  ctx.assertTrue(
    "missing contract confirmation fails closed",
    cancelHelperSource.includes(
      "Shopify n’a pas confirmé l’annulation du contrat.",
    ),
  );

  ctx.scenario("C. DB / lifecycle — no hard delete, no BoxOrder cancel");
  ctx.assertTrue(
    "cancel action never deletes subscriptionMealSelection",
    !cancelActionSource.includes("subscriptionMealSelection.delete") &&
      !cancelActionSource.includes(".delete(") &&
      !cancelActionSource.includes(".deleteMany("),
  );
  ctx.assertTrue(
    "cancel action never touches BoxOrder",
    !cancelActionSource.includes("boxOrder") &&
      !cancelActionSource.includes("cancelledAt") &&
      !cancelActionSource.includes("KITCHEN_PREPARATION"),
  );
  ctx.assertTrue(
    "CANCELLED sync map clears nextBillingDate (webhook path)",
    syncSource.includes("CANCELLED:") &&
      /CANCELLED:\s*\{[^}]*clearNextBillingDate:\s*true/s.test(syncSource),
  );
  ctx.assertTrue(
    "optimistic cancel comment documents BoxOrder isolation",
    cancelActionSource.includes("Does not touch BoxOrder") ||
      cancelActionSource.includes("order cancel is separate"),
  );

  ctx.scenario("D. UI — bouton, confirmation, feedback");
  ctx.assertTrue(
    "UI exposes Annuler l’abonnement button",
    renderSource.includes("Annuler l’abonnement"),
  );
  ctx.assertTrue(
    "cancel form posts cancelSubscription intent",
    renderSource.includes('value="cancelSubscription"'),
  );
  ctx.assertTrue(
    "button is gated by !isTerminal (ACTIVE + PAUSED visible)",
    renderSource.includes("{!isTerminal ? (") &&
      renderSource.includes("cancelSubscription"),
  );
  ctx.assertTrue(
    "terminal statuses hide cancel via isTerminalPortalDisplayStatus",
    isTerminalPortalDisplayStatus("cancelled") &&
      isTerminalPortalDisplayStatus("expired") &&
      isTerminalPortalDisplayStatus("failed"),
  );
  ctx.assertTrue(
    "confirmation text matches product copy",
    formattersSource.includes(
      "Annuler définitivement cet abonnement ? Les prochaines facturations seront arrêtées. Les commandes déjà créées ne seront pas annulées automatiquement.",
    ) &&
      renderSource.includes("cancelSubscriptionConfirmMessage"),
  );
  ctx.assertTrue(
    "success banner says Abonnement annulé.",
    renderSource.includes("Abonnement annulé."),
  );
  ctx.assertTrue(
    "cancelError banner is rendered",
    renderSource.includes("cancelError") &&
      renderSource.includes("{cancelError}"),
  );

  ctx.scenario("E. Billing / recovery — cancelled stays out");
  ctx.assertTrue(
    "billing skip reason includes terminal_contract",
    workerSource.includes('"terminal_contract"') &&
      workerSource.includes(
        "isTerminalSubscriptionSelectionStatus(selection.status)",
      ),
  );
  ctx.assertTrue(
    "recovery worker gates terminal contracts",
    recoverySource.includes("isTerminalSubscriptionSelectionStatus") &&
      recoverySource.includes("terminal_contract"),
  );
  ctx.assertTrue(
    "assertSubscriptionContractActionAllowed blocks terminal",
    syncSource.includes("assertSubscriptionContractActionAllowed") &&
      syncSource.includes("isTerminalSubscriptionSelectionStatus(selection.status)"),
  );

  return finishSuite("95-admin-cancel-subscription", ctx);
};

process.exitCode = runSuite();
