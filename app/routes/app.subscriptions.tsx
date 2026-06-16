import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

const getSelectedMeals = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((meal) => String(meal));
};

const listStyle = {
  margin: 0,
  paddingLeft: "1.25rem",
} as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const selections = await db.subscriptionMealSelection.findMany({
    orderBy: { createdAt: "desc" },
    where: { shop },
  });
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

  return {
    selections: selections.map((selection) => ({
      ...selection,
      customerName: customerNameByOrderId.get(selection.shopifyOrderId) ?? null,
    })),
  };
};

export default function Subscriptions() {
  const { selections = [] } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Abonnements">
      <s-section>
        <s-stack gap="base">
          {selections.length === 0 ? (
            <s-text>Aucun abonnement enregistré pour le moment.</s-text>
          ) : (
            selections.map((selection) => {
              const selectedMeals = getSelectedMeals(selection.selectedMeals);

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
                    <s-text>Box : {selection.boxTitle ?? "Non renseignée"}</s-text>
                    <s-text>
                      Nombre de repas : {selection.mealsCount ?? "Non renseigné"}
                    </s-text>
                    <s-text>Prochains plats :</s-text>
                    {selectedMeals.length > 0 ? (
                      <ul style={listStyle}>
                        {selectedMeals.map((meal, index) => (
                          <li key={`${selection.id}-${meal}-${index}`}>{meal}</li>
                        ))}
                      </ul>
                    ) : (
                      <s-text>Aucun plat trouvé.</s-text>
                    )}
                    <s-text>Statut : {selection.status}</s-text>
                    {selection.subscriptionContractId ? (
                      <s-text>
                        Contrat : {selection.subscriptionContractId}
                      </s-text>
                    ) : null}
                    <s-text>
                      Créée le :{" "}
                      {new Date(selection.createdAt).toLocaleString("fr-FR")}
                    </s-text>
                    <s-text>
                      Mise à jour le :{" "}
                      {new Date(selection.updatedAt).toLocaleString("fr-FR")}
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
