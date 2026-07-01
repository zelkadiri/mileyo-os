import { Form, useLoaderData, useSearchParams } from "react-router";

import type { loadSubscriptionsPageData } from "./subscriptions-data.server";
import {
  formatAdminDateTime,
  formatMealSelectionStatusLabel,
  formatRecoveryStatusLabel,
  getSelectedMealsFromJson,
  shopifyBillingConfirmMessage,
} from "./subscriptions-formatters";
import {
  bannerStyle,
  billingWarningColumnStyle,
  buttonRowStyle,
  listStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./subscriptions-styles";

type SubscriptionsPageData = Awaited<ReturnType<typeof loadSubscriptionsPageData>>;

export default function SubscriptionsPage() {
  const {
    hiddenDuplicateCount = 0,
    paymentRecoveries = [],
    selections = [],
    showSubscriptionTestActions = false,
  } = useLoaderData<SubscriptionsPageData>();
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
                      {formatAdminDateTime(recovery.nextRetryAt)}
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
                        {formatAdminDateTime(selection.nextBillingDate)}
                      </s-text>
                    ) : null}
                    {selection.lastBillingAttemptAt ? (
                      <s-text>
                        Dernière tentative :{" "}
                        {formatAdminDateTime(selection.lastBillingAttemptAt)}
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
                      {formatAdminDateTime(selection.createdAt)}
                    </s-text>
                    <s-text>
                      Mise à jour config abonnement :{" "}
                      {formatAdminDateTime(selection.updatedAt)}
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
                          <div style={billingWarningColumnStyle}>
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
}
