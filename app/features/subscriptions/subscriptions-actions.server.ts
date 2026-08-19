import type { Prisma } from "@prisma/client";
import { redirect } from "react-router";

import db from "../../db.server";
import { authenticate } from "../../shopify.server";
import { isTerminalSubscriptionSelectionStatus } from "../../constants/subscriptionMealSelection";
import {
  syncSubscriptionContractState,
} from "../../services/subscriptionContractSync.server";
import { triggerSubscriptionBillingAttempt } from "../../services/subscriptionBillingWorker.server";
import { processDueRecoveryRetries } from "../../services/subscriptionPaymentRecovery.server";
import { getSelectedMealsFromJson } from "../../utils/mealSelection";

import {
  isRecoveryDevRetryEnabled,
  isSubscriptionTestActionsEnabled,
} from "./subscriptions-test.server";

const redirectWithBillingError = (message: string) =>
  redirect(
    `/app/subscriptions?billingError=${encodeURIComponent(message)}`,
  );

export const handleSubscriptionsAction = async (request: Request) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const selectionId = String(formData.get("selectionId") ?? "");

  if (!selectionId) {
    return redirect("/app/subscriptions");
  }

  if (intent === "triggerShopifyBillingAttempt") {
    if (!isSubscriptionTestActionsEnabled()) {
      return redirectWithBillingError(
        "Déclenchement manuel Shopify désactivé en production.",
      );
    }

    const selection = await db.subscriptionMealSelection.findFirst({
      where: {
        active: true,
        id: selectionId,
        shop,
        status: "active",
      },
    });

    if (!selection) {
      return redirectWithBillingError("Abonnement introuvable ou inactif.");
    }

    if (isTerminalSubscriptionSelectionStatus(selection.status)) {
      return redirectWithBillingError(
        "Cet abonnement est terminé et ne peut plus être facturé.",
      );
    }

    if (!selection.subscriptionContractId) {
      return redirectWithBillingError(
        "Contrat d’abonnement Shopify manquant pour cet abonnement.",
      );
    }

    const syncResult = await syncSubscriptionContractState({
      admin,
      shop,
      source: "admin_action",
      subscriptionContractId: selection.subscriptionContractId,
    });

    if (
      syncResult.selection &&
      isTerminalSubscriptionSelectionStatus(syncResult.selection.status)
    ) {
      return redirectWithBillingError(
        "Cet abonnement est terminé côté Shopify et ne peut plus être facturé.",
      );
    }

    const billableSelection = syncResult.selection ?? selection;

    if (!billableSelection.active || billableSelection.status !== "active") {
      return redirectWithBillingError(
        "Cet abonnement n’est pas actif et ne peut pas être facturé.",
      );
    }

    const idempotencyKey = `mileyo_admin_${billableSelection.id}_${Date.now()}`;

    try {
      const billingResult = await triggerSubscriptionBillingAttempt({
        admin,
        idempotencyKey,
        selectionId: billableSelection.id,
        subscriptionContractId: billableSelection.subscriptionContractId!,
      });

      if (
        billingResult.status === "failure" ||
        billingResult.status === "unknown"
      ) {
        return redirectWithBillingError(
          billingResult.errorMessage ??
            "Shopify a refusé la tentative de facturation.",
        );
      }

      const attemptId = billingResult.attemptId ?? "inconnu";

      return redirect(
        `/app/subscriptions?billingSuccess=1&attemptId=${encodeURIComponent(attemptId)}`,
      );
    } catch {
      return redirectWithBillingError(
        "Impossible de contacter Shopify pour déclencher la facturation.",
      );
    }
  }

  if (intent === "triggerRecoveryRetry") {
    if (!isRecoveryDevRetryEnabled()) {
      return redirectWithBillingError(
        "Déclenchement recovery DEV désactivé en production.",
      );
    }

    const simulatedNowRaw = String(formData.get("simulatedNow") ?? "").trim();
    const simulatedNow = new Date(simulatedNowRaw);

    if (!simulatedNowRaw || Number.isNaN(simulatedNow.getTime())) {
      return redirectWithBillingError(
        "Horloge simulée recovery DEV invalide.",
      );
    }

    const selection = await db.subscriptionMealSelection.findFirst({
      where: {
        id: selectionId,
        shop,
      },
    });

    if (!selection) {
      return redirectWithBillingError("Abonnement introuvable.");
    }

    try {
      const summary = await processDueRecoveryRetries(shop, admin, {
        now: simulatedNow,
        selectionId,
      });

      return redirect(
        `/app/subscriptions?recoveryRetrySuccess=1&retried=${encodeURIComponent(String(summary.retried))}&processed=${encodeURIComponent(String(summary.processed))}`,
      );
    } catch {
      return redirectWithBillingError(
        "Impossible d’exécuter le retry recovery DEV.",
      );
    }
  }

  if (intent !== "simulateNextSubscriptionOrder") {
    return redirect("/app/subscriptions");
  }

  if (!isSubscriptionTestActionsEnabled()) {
    return redirectWithBillingError(
      "Actions de test désactivées en production.",
    );
  }

  const selection = await db.subscriptionMealSelection.findFirst({
    where: {
      active: true,
      id: selectionId,
      shop,
      status: "active",
    },
  });

  if (!selection?.selectedMeals) {
    return redirect("/app/subscriptions?error=no_meals");
  }

  const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);

  if (selectedMeals.length === 0) {
    return redirect("/app/subscriptions?error=no_meals");
  }

  const firstOrder = await db.boxOrder.findFirst({
    where: {
      shop,
      shopifyOrderId: selection.shopifyOrderId,
    },
  });

  const now = Date.now();
  const shopifyOrderId = `simulated_${selection.id}_${now}`;
  const shopifyOrderName = `SIM-${new Date(now)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ")}`;
  const rawOrder = {
    message:
      "Simulated renewal order for testing. No Shopify order was created.",
    simulated: true,
    subscriptionSelectionId: selection.id,
    type: "subscription_renewal_test",
  } as Prisma.InputJsonValue;

  await db.boxOrder.create({
    data: {
      boxTitle: selection.boxTitle,
      customerEmail: selection.customerEmail,
      customerName: firstOrder?.customerName ?? null,
      financialStatus: "simulated",
      fulfillmentStatus: "unfulfilled",
      isSubscriptionRenewal: true,
      mealsCount: selection.mealsCount,
      orderType: "Abonnement hebdomadaire",
      rawOrder,
      selectedMeals: selection.selectedMeals as Prisma.InputJsonValue,
      selectedMealsSource: "subscription_future_selection",
      shop,
      shopifyOrderId,
      shopifyOrderName,
      simulated: true,
      subscriptionSelectionId: selection.id,
      subscriptionContractId: selection.subscriptionContractId,
    },
  });

  return redirect("/app/orders?simulated=1");
};
