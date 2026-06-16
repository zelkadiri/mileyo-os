import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Prisma } from "@prisma/client";

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

const simulateButtonStyle = {
  background: "#111827",
  border: 0,
  borderRadius: "999px",
  color: "white",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  marginTop: "0.5rem",
  padding: "0.65rem 1rem",
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const selectionId = String(formData.get("selectionId") ?? "");

  if (intent !== "simulateNextSubscriptionOrder" || !selectionId) {
    return redirect("/app/subscriptions");
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

  const selectedMeals = getSelectedMeals(selection.selectedMeals);

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
    },
  });

  return redirect("/app/orders?simulated=1");
};

export default function Subscriptions() {
  const { selections = [] } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  return (
    <s-page heading="Abonnements">
      <s-section>
        <s-stack gap="base">
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
              const selectedMeals = getSelectedMeals(selection.selectedMeals);
              const isActive = selection.active && selection.status === "active";

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
                    {isActive ? (
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
                        <button style={simulateButtonStyle} type="submit">
                          Simuler prochaine commande
                        </button>
                      </Form>
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
