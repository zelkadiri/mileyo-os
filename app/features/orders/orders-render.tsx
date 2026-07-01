import { useLoaderData, useSearchParams } from "react-router";

import { downloadOrdersCsv } from "./orders-csv";
import type { loadOrdersPageData } from "./orders-data.server";
import {
  formatAdminDateTime,
  getSelectedMealsFromJson,
  hasFutureSubscriptionConfig,
  usesFutureSelectionSource,
} from "./orders-formatters";
import {
  exportButtonStyle,
  listStyle,
  successBannerStyle,
} from "./orders-styles";

type OrdersPageData = Awaited<ReturnType<typeof loadOrdersPageData>>;

export default function OrdersPage() {
  const { orders = [] } = useLoaderData<OrdersPageData>();
  const [searchParams] = useSearchParams();
  const showSimulatedSuccess = searchParams.get("simulated") === "1";

  return (
    <s-page heading="Commandes">
      <s-section>
        <s-stack gap="base">
          {showSimulatedSuccess ? (
            <p style={successBannerStyle}>
              Commande simulée créée avec les plats futurs du client.
            </p>
          ) : null}
          <button
            onClick={() => downloadOrdersCsv(orders)}
            style={exportButtonStyle}
            type="button"
          >
            Exporter CSV
          </button>
          {orders.length === 0 ? (
            <s-text>Aucune commande box capturée pour le moment.</s-text>
          ) : (
            orders.map((order) => {
              const selectedMeals = getSelectedMealsFromJson(order.selectedMeals);
              const futureMeals = getSelectedMealsFromJson(order.futureSelectedMeals);
              const usesFutureSelection = usesFutureSelectionSource(
                order.selectedMealsSource,
              );
              const hasFutureConfig = hasFutureSubscriptionConfig({
                boxTitle: order.boxTitle,
                futureBoxTitle: order.futureBoxTitle,
                futureMealsCount: order.futureMealsCount,
                futureSelectedMeals: order.futureSelectedMeals,
                mealsCount: order.mealsCount,
              });

              return (
                <s-box
                  key={order.id}
                  borderRadius="base"
                  borderWidth="base"
                  padding="base"
                >
                  <s-stack gap="small">
                    <s-text>
                      <strong>{order.shopifyOrderName ?? order.shopifyOrderId}</strong>
                    </s-text>
                    {order.simulated ? (
                      <s-text>Commande simulée</s-text>
                    ) : null}
                    {order.isSubscriptionRenewal ? (
                      <s-text>Renouvellement d’abonnement</s-text>
                    ) : null}
                    {usesFutureSelection ? (
                      <s-text>
                        Plats récupérés depuis la sélection future client.
                      </s-text>
                    ) : null}
                    <s-text>
                      Client : {order.customerName ?? "Non renseigné"}{" "}
                      {order.customerEmail ? `(${order.customerEmail})` : ""}
                    </s-text>
                    <s-text>Type : {order.orderType ?? "Non renseigné"}</s-text>
                    <s-text>
                      Box commandée (snapshot) :{" "}
                      {order.boxTitle ?? "Non renseignée"}
                    </s-text>
                    <s-text>
                      Nombre de repas (commande) :{" "}
                      {order.mealsCount ?? "Non renseigné"}
                    </s-text>
                    {hasFutureConfig ? (
                      <>
                        <s-text>
                          Prochaine box configurée : {order.futureBoxTitle}
                        </s-text>
                        <s-text>
                          Repas prévus (prochaine commande) :{" "}
                          {order.futureMealsCount ?? "Non renseigné"}
                        </s-text>
                        {order.futureSubscriptionPrice ? (
                          <s-text>
                            Prix abonnement : {order.futureSubscriptionPrice} € /
                            semaine
                          </s-text>
                        ) : null}
                        {futureMeals.length > 0 ? (
                          <>
                            <s-text>Plats prévus :</s-text>
                            <ul style={listStyle}>
                              {futureMeals.map((meal, index) => (
                                <li key={`future-${meal}-${index}`}>{meal}</li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                        {order.futureUpdatedAt ? (
                          <s-text>
                            Config abonnement mise à jour le :{" "}
                            {formatAdminDateTime(order.futureUpdatedAt)}
                          </s-text>
                        ) : null}
                      </>
                    ) : null}
                    <s-text>
                      Source des plats :{" "}
                      {order.selectedMealsSource ?? "line_item_properties"}
                    </s-text>
                    <s-text>Plats de cette commande :</s-text>
                    {selectedMeals.length > 0 ? (
                      <ul style={listStyle}>
                        {selectedMeals.map((meal, index) => (
                          <li key={`${meal}-${index}`}>{meal}</li>
                        ))}
                      </ul>
                    ) : (
                      <s-text>Aucun plat trouvé.</s-text>
                    )}
                    <s-text>
                      Paiement : {order.financialStatus ?? "Non renseigné"}
                    </s-text>
                    <s-text>
                      Fulfillment : {order.fulfillmentStatus ?? "Non renseigné"}
                    </s-text>
                    <s-text>
                      Créée le : {formatAdminDateTime(order.createdAt)}
                    </s-text>
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
