import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

const getSelectedMeals = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((meal) => String(meal));
};

const escapeCsvValue = (value: unknown) => {
  const stringValue = value == null ? "" : String(value);

  return `"${stringValue.replace(/"/g, '""')}"`;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const orders = await db.boxOrder.findMany({
    orderBy: { createdAt: "desc" },
    where: { shop: session.shop },
  });

  return { orders };
};

const listStyle = {
  margin: 0,
  paddingLeft: "1.25rem",
} as const;

const exportButtonStyle = {
  background: "#111827",
  border: 0,
  borderRadius: "999px",
  color: "white",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  justifySelf: "start",
  padding: "0.65rem 1rem",
} as const;

const successBannerStyle = {
  background: "#dcfce7",
  borderRadius: "12px",
  color: "#166534",
  padding: "12px 16px",
} as const;

export default function Orders() {
  const { orders = [] } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const showSimulatedSuccess = searchParams.get("simulated") === "1";

  const handleExportCsv = () => {
    const rows = [
      [
        "Order",
        "Customer",
        "Email",
        "Type",
        "Box",
        "Meals count",
        "Selected meals",
        "Selected meals source",
        "Simulated",
        "Financial status",
        "Fulfillment status",
        "Created at",
      ],
      ...orders.map((order) => [
        order.shopifyOrderName,
        order.customerName,
        order.customerEmail,
        order.orderType,
        order.boxTitle,
        order.mealsCount,
        getSelectedMeals(order.selectedMeals).join(" | "),
        order.selectedMealsSource,
        order.simulated ? "yes" : "no",
        order.financialStatus,
        order.fulfillmentStatus,
        new Date(order.createdAt).toISOString(),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");

    link.href = url;
    link.download = "mileyo-box-orders.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

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
            onClick={handleExportCsv}
            style={exportButtonStyle}
            type="button"
          >
            Exporter CSV
          </button>
          {orders.length === 0 ? (
            <s-text>Aucune commande box capturée pour le moment.</s-text>
          ) : (
            orders.map((order) => {
              const selectedMeals = getSelectedMeals(order.selectedMeals);
              const usesFutureSelection =
                order.selectedMealsSource === "subscription_future_selection";

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
                    <s-text>Box : {order.boxTitle ?? "Non renseignée"}</s-text>
                    <s-text>
                      Nombre de repas : {order.mealsCount ?? "Non renseigné"}
                    </s-text>
                    <s-text>
                      Source des plats :{" "}
                      {order.selectedMealsSource ?? "line_item_properties"}
                    </s-text>
                    <s-text>Plats sélectionnés :</s-text>
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
                      Créée le : {new Date(order.createdAt).toLocaleString("fr-FR")}
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
