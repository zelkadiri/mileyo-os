import { Form, useLoaderData, useSearchParams } from "react-router";

import type { loadSubscriptionsPageData } from "./subscriptions-data.server";
import {
  DEV_RECOVERY_RETRY_DEFAULT_NOW,
  cancelSubscriptionConfirmMessage,
  formatAdminDateTime,
  formatMealSelectionStatusLabel,
  formatRecoveryStatusLabel,
  getSelectedMealsFromJson,
  recoveryRetryConfirmMessage,
  shopifyBillingConfirmMessage,
} from "./subscriptions-formatters";
import {
  bannerStyle,
  billingWarningColumnStyle,
  buttonRowStyle,
  destructiveButtonStyle,
  listStyle,
  primaryButtonStyle,
  recoveryDevButtonStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  terminalCardStyle,
} from "./subscriptions-styles";

const getStatusBadgeVariant = (
  status: string,
): "active" | "paused" | "cancelled" | "expired" | "failed" | "other" => {
  switch (status) {
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "failed":
      return "failed";
    default:
      return "other";
  }
};

type SubscriptionsPageData = Awaited<ReturnType<typeof loadSubscriptionsPageData>>;

export default function SubscriptionsPage() {
  const {
    hiddenDuplicateCount = 0,
    paymentRecoveries = [],
    selections = [],
    showRecoveryDevRetry = false,
    showSubscriptionTestActions = false,
    statusCounts = {
      active: 0,
      cancelled: 0,
      expired: 0,
      failed: 0,
      other: 0,
      paused: 0,
    },
  } = useLoaderData<SubscriptionsPageData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status");
  const filteredSelections =
    statusFilter && statusFilter !== "all"
      ? selections.filter((selection) => selection.status === statusFilter)
      : selections;
  const error = searchParams.get("error");
  const billingError = searchParams.get("billingError");
  const billingSuccess = searchParams.get("billingSuccess") === "1";
  const cancelError = searchParams.get("cancelError");
  const cancelSuccess = searchParams.get("cancelSuccess") === "1";
  const recoveryRetrySuccess = searchParams.get("recoveryRetrySuccess") === "1";
  const attemptId = searchParams.get("attemptId");
  const recoveryRetried = searchParams.get("retried");
  const recoveryProcessed = searchParams.get("processed");

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
                  {showRecoveryDevRetry &&
                  recovery.status !== "final_failed" ? (
                    <Form
                      method="post"
                      onSubmit={(event) => {
                        if (!confirm(recoveryRetryConfirmMessage)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input
                        name="intent"
                        type="hidden"
                        value="triggerRecoveryRetry"
                      />
                      <input
                        name="selectionId"
                        type="hidden"
                        value={recovery.selectionId}
                      />
                      <s-stack gap="small">
                        <label>
                          Horloge simulée ISO (test DEV — retry #1 dimanche
                          2026-08-22T22:05:00.000Z, retry #2 lundi
                          2026-08-23T22:05:00.000Z)
                          <input
                            defaultValue={DEV_RECOVERY_RETRY_DEFAULT_NOW}
                            name="simulatedNow"
                            style={{
                              display: "block",
                              font: "inherit",
                              marginTop: "0.35rem",
                              padding: "0.4rem 0.5rem",
                              width: "100%",
                            }}
                            type="text"
                          />
                        </label>
                        <button style={recoveryDevButtonStyle} type="submit">
                          Déclencher retry recovery DEV
                        </button>
                      </s-stack>
                    </Form>
                  ) : null}
                </s-stack>
              </s-box>
            ))
          )}
        </s-stack>
      </s-section>
      <s-section>
        <s-stack gap="base">
          <s-text>
            Répartition : {statusCounts.active} actif
            {statusCounts.active > 1 ? "s" : ""}, {statusCounts.paused} en pause
            {statusCounts.cancelled > 0
              ? `, ${statusCounts.cancelled} annulé${statusCounts.cancelled > 1 ? "s" : ""}`
              : ""}
            {statusCounts.expired > 0
              ? `, ${statusCounts.expired} expiré${statusCounts.expired > 1 ? "s" : ""}`
              : ""}
            {statusCounts.failed > 0
              ? `, ${statusCounts.failed} échec${statusCounts.failed > 1 ? "s" : ""} définitif${statusCounts.failed > 1 ? "s" : ""}`
              : ""}
            {statusCounts.other > 0 ? `, ${statusCounts.other} autre(s)` : ""}
          </s-text>
          <div style={buttonRowStyle}>
            {(
              [
                ["all", "Tous"],
                ["active", "Actifs"],
                ["paused", "En pause"],
                ["cancelled", "Annulés"],
                ["expired", "Expirés"],
                ["failed", "Échecs définitifs"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);

                  if (value === "all") {
                    next.delete("status");
                  } else {
                    next.set("status", value);
                  }

                  setSearchParams(next);
                }}
                style={
                  (statusFilter ?? "all") === value
                    ? primaryButtonStyle
                    : secondaryButtonStyle
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
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
          {cancelSuccess ? (
            <p style={bannerStyle("success")}>Abonnement annulé.</p>
          ) : null}
          {cancelError ? (
            <p style={bannerStyle("error")}>{cancelError}</p>
          ) : null}
          {recoveryRetrySuccess ? (
            <p style={bannerStyle("success")}>
              Retry recovery DEV lancé
              {recoveryRetried != null ? ` (retried=${recoveryRetried}` : ""}
              {recoveryProcessed != null
                ? `${recoveryRetried != null ? ", " : " ("}processed=${recoveryProcessed}`
                : ""}
              {recoveryRetried != null || recoveryProcessed != null ? ")" : ""}
              . Observer le webhook failure et la fiche recovery.
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
          {filteredSelections.length === 0 ? (
            <s-text>Aucun abonnement enregistré pour le moment.</s-text>
          ) : (
            filteredSelections.map((selection) => {
              const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);
              const isActive = selection.active && selection.status === "active";
              const isTerminal = selection.isTerminal;
              const canTriggerBilling = Boolean(selection.subscriptionContractId);
              const statusBadgeVariant = getStatusBadgeVariant(selection.status);

              return (
                <div
                  key={selection.id}
                  style={isTerminal ? terminalCardStyle : undefined}
                >
                  <s-box borderRadius="base" borderWidth="base" padding="base">
                  <s-stack gap="small">
                    <span style={statusBadgeStyle(statusBadgeVariant)}>
                      {formatMealSelectionStatusLabel(selection.status)}
                    </span>
                    {isTerminal ? (
                      <s-text>
                        Abonnement terminé — consultation seule, aucune action
                        de test disponible.
                      </s-text>
                    ) : null}
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
                      {isTerminal ? "Dernière box configurée" : "Prochaine box configurée"} :{" "}
                      {selection.boxTitle ?? "Non renseignée"}
                    </s-text>
                    <s-text>
                      {isTerminal ? "Nombre de repas (dernière sélection)" : "Nombre de repas (prochaine commande)"} :{" "}
                      {selection.mealsCount ?? "Non renseigné"}
                    </s-text>
                    {selection.boxSubscriptionPrice ? (
                      <s-text>
                        Prix abonnement : {selection.boxSubscriptionPrice} € / semaine
                      </s-text>
                    ) : null}
                    <s-text>
                      {isTerminal
                        ? "Derniers plats enregistrés :"
                        : "Plats prévus pour la prochaine commande :"}
                    </s-text>
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
                      Statut détaillé :{" "}
                      {formatMealSelectionStatusLabel(selection.status)}
                    </s-text>
                    {selection.subscriptionContractId ? (
                      <s-text>
                        Contrat : {selection.subscriptionContractId}
                      </s-text>
                    ) : null}
                    {!isTerminal && selection.nextBillingDate ? (
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
                    {!isTerminal ? (
                      <div style={buttonRowStyle}>
                        <Form
                          method="post"
                          onSubmit={(event) => {
                            if (!confirm(cancelSubscriptionConfirmMessage)) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <input
                            name="intent"
                            type="hidden"
                            value="cancelSubscription"
                          />
                          <input
                            name="selectionId"
                            type="hidden"
                            value={selection.id}
                          />
                          <button
                            disabled={!selection.subscriptionContractId}
                            style={destructiveButtonStyle}
                            title={
                              selection.subscriptionContractId
                                ? undefined
                                : "Contrat d’abonnement Shopify requis"
                            }
                            type="submit"
                          >
                            Annuler l’abonnement
                          </button>
                        </Form>
                      </div>
                    ) : null}
                    {isActive && !isTerminal ? (
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
                </div>
              );
            })
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
