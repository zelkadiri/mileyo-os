import type {
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Prisma } from "@prisma/client";

import { formatRecoveryStatusLabel, formatMealSelectionStatusLabel } from "../constants/subscriptionStatus";
import { RECOVERY_STATUS } from "../constants/subscriptionPaymentRecovery";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import {
  dedupeSubscriptionSelectionsByContract,
} from "../services/subscriptionMealSelection.server";
import { getSelectedMealsFromJson } from "../utils/mealSelection";
import {
  normalizeShopifyId,
  toSubscriptionContractGid,
} from "../utils/shopifyIds.server";

const billingAttemptCreateMutation = `#graphql
  mutation SubscriptionBillingAttemptCreate(
    $subscriptionContractId: ID!
    $subscriptionBillingAttemptInput: SubscriptionBillingAttemptInput!
  ) {
    subscriptionBillingAttemptCreate(
      subscriptionContractId: $subscriptionContractId
      subscriptionBillingAttemptInput: $subscriptionBillingAttemptInput
    ) {
      subscriptionBillingAttempt {
        id
        ready
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type BillingAttemptCreateResponse = {
  data?: {
    subscriptionBillingAttemptCreate?: {
      subscriptionBillingAttempt?: {
        id?: string | null;
        ready?: boolean | null;
      } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

const listStyle = {
  margin: 0,
  paddingLeft: "1.25rem",
} as const;

const buttonRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  marginTop: "0.5rem",
} as const;

const primaryButtonStyle = {
  background: "#111827",
  border: 0,
  borderRadius: "999px",
  color: "white",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  padding: "0.65rem 1rem",
} as const;

const secondaryButtonStyle = {
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: "999px",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  padding: "0.65rem 1rem",
} as const;

const bannerStyle = (variant: "error" | "success" | "warning") =>
  ({
    background:
      variant === "success"
        ? "#dcfce7"
        : variant === "warning"
          ? "#fef3c7"
          : "#fee2e2",
    borderRadius: "12px",
    color:
      variant === "success"
        ? "#166534"
        : variant === "warning"
          ? "#92400e"
          : "#991b1b",
    padding: "12px 16px",
  }) as const;

const isSubscriptionTestActionsEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_SHOPIFY_BILLING_TEST_BUTTON === "true";

const shopifyBillingConfirmMessage =
  "Confirmer le déclenchement d’une prochaine commande Shopify pour cet abonnement ?";

export const shouldRevalidate = () => true;

export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store, max-age=0, must-revalidate",
});

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return serverLoader();
}

clientLoader.hydrate = true as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const allSelections = await db.subscriptionMealSelection.findMany({
    orderBy: { updatedAt: "desc" },
    where: { shop },
  });
  const selections = dedupeSubscriptionSelectionsByContract(allSelections).sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
  const hiddenDuplicateCount = allSelections.length - selections.length;
  const boxOrders = await db.boxOrder.findMany({
    where: {
      shop,
      shopifyOrderId: {
        in: selections.map((selection) => selection.shopifyOrderId),
      },
    },
  });
  const customerNameByOrderId = new Map(
    boxOrders.map((order) => [order.shopifyOrderId, order.customerName]),
  );

  const paymentRecoveries = await db.subscriptionPaymentRecovery.findMany({
    include: { subscriptionMealSelection: true },
    orderBy: [{ nextRetryAt: "asc" }, { updatedAt: "desc" }],
    where: {
      shop,
      status: {
        in: [
          RECOVERY_STATUS.PROCESSING,
          RECOVERY_STATUS.RETRY_SCHEDULED,
          RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
          RECOVERY_STATUS.EMAIL_SEND_FAILED,
          RECOVERY_STATUS.FINAL_FAILED,
        ],
      },
    },
  });

  return {
    hiddenDuplicateCount,
    paymentRecoveries: paymentRecoveries.map((recovery) => {
      const canonicalSelection = allSelections.find(
        (selection) => selection.id === recovery.subscriptionMealSelectionId,
      );
      const contractId = normalizeShopifyId(
        canonicalSelection?.subscriptionContractId,
      );
      const resolvedSelection = contractId
        ? (selections.find(
            (selection) =>
              normalizeShopifyId(selection.subscriptionContractId) ===
              contractId,
          ) ?? canonicalSelection)
        : canonicalSelection;

      return {
        boxTitle: resolvedSelection?.boxTitle ?? recovery.subscriptionMealSelection.boxTitle,
        boxSubscriptionPrice:
          resolvedSelection?.boxSubscriptionPrice ??
          recovery.subscriptionMealSelection.boxSubscriptionPrice,
        customerEmail: recovery.subscriptionMealSelection.customerEmail,
        customerName:
          customerNameByOrderId.get(
            recovery.subscriptionMealSelection.shopifyOrderId,
          ) ?? null,
        failureCount: recovery.failureCount,
        id: recovery.id,
        lastErrorCode: recovery.lastErrorCode,
        lastErrorMessage: recovery.lastErrorMessage,
        mealsCount:
          resolvedSelection?.mealsCount ??
          recovery.subscriptionMealSelection.mealsCount,
        nextRetryAt: recovery.nextRetryAt,
        selectionId: recovery.subscriptionMealSelectionId,
        shopifyOrderName: recovery.subscriptionMealSelection.shopifyOrderName,
        status: recovery.status,
      };
    }),
    selections: selections.map((selection) => ({
      ...selection,
      customerName: customerNameByOrderId.get(selection.shopifyOrderId) ?? null,
    })),
    showSubscriptionTestActions: isSubscriptionTestActionsEnabled(),
  };
};

const redirectWithBillingError = (message: string) =>
  redirect(
    `/app/subscriptions?billingError=${encodeURIComponent(message)}`,
  );

export const action = async ({ request }: ActionFunctionArgs) => {
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

    if (!selection.subscriptionContractId) {
      return redirectWithBillingError(
        "Contrat d’abonnement Shopify manquant pour cet abonnement.",
      );
    }

    const idempotencyKey = `mileyo_${selection.id}_${Date.now()}`;

    try {
      const response = await admin.graphql(billingAttemptCreateMutation, {
        variables: {
          subscriptionBillingAttemptInput: { idempotencyKey },
          subscriptionContractId: toSubscriptionContractGid(
            selection.subscriptionContractId,
          ),
        },
      });
      const json = (await response.json()) as BillingAttemptCreateResponse;

      if (json.errors?.length) {
        return redirectWithBillingError(
          json.errors
            .map((error) => error.message)
            .filter(Boolean)
            .join(" ") || "Erreur GraphQL lors du déclenchement.",
        );
      }

      const result = json.data?.subscriptionBillingAttemptCreate;
      const userErrors = result?.userErrors ?? [];

      if (userErrors.length > 0) {
        return redirectWithBillingError(
          userErrors
            .map((error) => error.message)
            .filter(Boolean)
            .join(" ") || "Shopify a refusé la tentative de facturation.",
        );
      }

      const attemptId =
        result?.subscriptionBillingAttempt?.id ?? "inconnu";

      return redirect(
        `/app/subscriptions?billingSuccess=1&attemptId=${encodeURIComponent(attemptId)}`,
      );
    } catch {
      return redirectWithBillingError(
        "Impossible de contacter Shopify pour déclencher la facturation.",
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

export default function Subscriptions() {
  const {
    hiddenDuplicateCount = 0,
    paymentRecoveries = [],
    selections = [],
    showSubscriptionTestActions = false,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  const billingError = searchParams.get("billingError");
  const billingSuccess = searchParams.get("billingSuccess") === "1";
  const attemptId = searchParams.get("attemptId");

  return (
    <s-page heading="Abonnements">
      <s-section heading="Paiements à régulariser">
        <s-stack gap="base">
          {paymentRecoveries.length === 0 ? (
            <s-text>Aucun paiement en attente de régularisation.</s-text>
          ) : (
            paymentRecoveries.map((recovery) => (
              <s-box
                key={recovery.id}
                borderRadius="base"
                borderWidth="base"
                padding="base"
              >
                <s-stack gap="small">
                  <s-text>
                    Client :{" "}
                    {recovery.customerName
                      ? `${recovery.customerName} (${recovery.customerEmail ?? "email non renseigné"})`
                      : (recovery.customerEmail ?? "Non renseigné")}
                  </s-text>
                  <s-text>
                    Première commande :{" "}
                    {recovery.shopifyOrderName ?? recovery.selectionId}
                  </s-text>
                  <s-text>Box actuelle (prochaine commande) : {recovery.boxTitle ?? "Non renseignée"}</s-text>
                  {recovery.mealsCount ? (
                    <s-text>Nombre de repas : {recovery.mealsCount}</s-text>
                  ) : null}
                  {recovery.boxSubscriptionPrice ? (
                    <s-text>
                      Prix abonnement : {recovery.boxSubscriptionPrice} € / semaine
                    </s-text>
                  ) : null}
                  <s-text>
                    Tentatives échouées : {recovery.failureCount} / 3
                  </s-text>
                  <s-text>
                    Statut : {formatRecoveryStatusLabel(recovery.status)}
                  </s-text>
                  {recovery.lastErrorMessage ? (
                    <s-text>
                      Dernière erreur
                      {recovery.lastErrorCode
                        ? ` (${recovery.lastErrorCode})`
                        : ""}
                      : {recovery.lastErrorMessage}
                    </s-text>
                  ) : null}
                  {recovery.nextRetryAt ? (
                    <s-text>
                      Prochaine tentative :{" "}
                      {new Date(recovery.nextRetryAt).toLocaleString("fr-FR")}
                    </s-text>
                  ) : null}
                </s-stack>
              </s-box>
            ))
          )}
        </s-stack>
      </s-section>
      <s-section>
        <s-stack gap="base">
          {hiddenDuplicateCount > 0 ? (
            <p style={bannerStyle("warning")}>
              {hiddenDuplicateCount} fiche(s) doublon masquée(s) — seule la
              configuration la plus récente par contrat Shopify est affichée.
            </p>
          ) : null}
          {billingSuccess ? (
            <p style={bannerStyle("success")}>
              Tentative de facturation Shopify lancée
              {attemptId ? ` (${attemptId})` : ""}. Si le paiement réussit,
              Shopify créera la commande et le webhook ORDERS_CREATE la
              capturera.
            </p>
          ) : null}
          {billingError ? (
            <p style={bannerStyle("error")}>{billingError}</p>
          ) : null}
          {error === "no_meals" ? (
            <s-text>
              Impossible de simuler : aucun plat futur enregistré pour cet
              abonnement.
            </s-text>
          ) : null}
          {selections.length === 0 ? (
            <s-text>Aucun abonnement enregistré pour le moment.</s-text>
          ) : (
            selections.map((selection) => {
              const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);
              const isActive = selection.active && selection.status === "active";
              const canTriggerBilling = Boolean(selection.subscriptionContractId);

              return (
                <s-box
                  key={selection.id}
                  borderRadius="base"
                  borderWidth="base"
                  padding="base"
                >
                  <s-stack gap="small">
                    <s-text>
                      Client :{" "}
                      {selection.customerName
                        ? `${selection.customerName} (${selection.customerEmail ?? "email non renseigné"})`
                        : (selection.customerEmail ?? "Non renseigné")}
                    </s-text>
                    <s-text>
                      Première commande :{" "}
                      {selection.shopifyOrderName ?? selection.shopifyOrderId}
                    </s-text>
                    <s-text>
                      Prochaine box configurée :{" "}
                      {selection.boxTitle ?? "Non renseignée"}
                    </s-text>
                    <s-text>
                      Nombre de repas (prochaine commande) :{" "}
                      {selection.mealsCount ?? "Non renseigné"}
                    </s-text>
                    {selection.boxSubscriptionPrice ? (
                      <s-text>
                        Prix abonnement : {selection.boxSubscriptionPrice} € / semaine
                      </s-text>
                    ) : null}
                    <s-text>Plats prévus pour la prochaine commande :</s-text>
                    {selectedMeals.length > 0 ? (
                      <ul style={listStyle}>
                        {selectedMeals.map((meal, index) => (
                          <li key={`${selection.id}-${meal}-${index}`}>{meal}</li>
                        ))}
                      </ul>
                    ) : (
                      <s-text>Aucun plat trouvé.</s-text>
                    )}
                    <s-text>
                      Statut :{" "}
                      {formatMealSelectionStatusLabel(selection.status)}
                    </s-text>
                    {selection.subscriptionContractId ? (
                      <s-text>
                        Contrat : {selection.subscriptionContractId}
                      </s-text>
                    ) : null}
                    {selection.nextBillingDate ? (
                      <s-text>
                        Prochaine facturation :{" "}
                        {new Date(selection.nextBillingDate).toLocaleString(
                          "fr-FR",
                        )}
                      </s-text>
                    ) : null}
                    {selection.lastBillingAttemptAt ? (
                      <s-text>
                        Dernière tentative :{" "}
                        {new Date(selection.lastBillingAttemptAt).toLocaleString(
                          "fr-FR",
                        )}
                        {selection.lastBillingAttemptStatus
                          ? ` (${selection.lastBillingAttemptStatus})`
                          : ""}
                        {selection.lastBillingAttemptError
                          ? ` — ${selection.lastBillingAttemptError}`
                          : ""}
                      </s-text>
                    ) : null}
                    <s-text>
                      Créée le :{" "}
                      {new Date(selection.createdAt).toLocaleString("fr-FR")}
                    </s-text>
                    <s-text>
                      Mise à jour config abonnement :{" "}
                      {new Date(selection.updatedAt).toLocaleString("fr-FR")}
                    </s-text>
                    <s-text>
                      ID fiche : {selection.id}
                    </s-text>
                    {isActive ? (
                      showSubscriptionTestActions ? (
                        <div style={buttonRowStyle}>
                          <Form method="post">
                            <input
                              name="intent"
                              type="hidden"
                              value="simulateNextSubscriptionOrder"
                            />
                            <input
                              name="selectionId"
                              type="hidden"
                              value={selection.id}
                            />
                            <button style={secondaryButtonStyle} type="submit">
                              Simuler prochaine commande
                            </button>
                          </Form>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.5rem",
                            }}
                          >
                            <p style={bannerStyle("warning")}>
                              Attention : ce bouton peut créer une vraie commande
                              Shopify et déclencher une facturation test/réelle selon
                              la configuration de paiement.
                            </p>
                            <Form
                              method="post"
                              onSubmit={(event) => {
                                if (!confirm(shopifyBillingConfirmMessage)) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <input
                                name="intent"
                                type="hidden"
                                value="triggerShopifyBillingAttempt"
                              />
                              <input
                                name="selectionId"
                                type="hidden"
                                value={selection.id}
                              />
                              <button
                                disabled={!canTriggerBilling}
                                style={primaryButtonStyle}
                                title={
                                  canTriggerBilling
                                    ? undefined
                                    : "Contrat d’abonnement Shopify requis"
                                }
                                type="submit"
                              >
                                Déclencher prochaine commande Shopify
                              </button>
                            </Form>
                          </div>
                        </div>
                      ) : (
                        <s-text>Actions de test désactivées en production.</s-text>
                      )
                    ) : null}
                  </s-stack>
                </s-box>
              );
            })
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
};
