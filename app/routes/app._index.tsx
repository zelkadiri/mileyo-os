import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const defaultMealBoxes = [
  {
    name: "Box 6 repas",
    meals: 6,
    oneTimePriceCents: 5400,
    subscriptionPriceCents: 4200,
    sortOrder: 1,
  },
  {
    name: "Box 8 repas",
    meals: 8,
    oneTimePriceCents: 7200,
    subscriptionPriceCents: 5600,
    sortOrder: 2,
  },
  {
    name: "Box 10 repas",
    meals: 10,
    oneTimePriceCents: 9000,
    subscriptionPriceCents: 7000,
    sortOrder: 3,
  },
  {
    name: "Box 12 repas",
    meals: 12,
    oneTimePriceCents: 10800,
    subscriptionPriceCents: 8400,
    sortOrder: 4,
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const boxCount = await prisma.mealBox.count({
    where: { shop },
  });

  if (boxCount === 0) {
    await prisma.mealBox.createMany({
      data: defaultMealBoxes.map((box) => ({
        ...box,
        shop,
      })),
    });
  }

  const boxes = await prisma.mealBox.findMany({
    where: { shop },
    orderBy: { sortOrder: "asc" },
  });

  return { boxes };
};

const getFormString = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const parseInteger = (formData: FormData, key: string) => {
  const value = Number.parseInt(getFormString(formData, key), 10);

  if (Number.isNaN(value)) {
    throw new Response(`Invalid ${key}`, { status: 400 });
  }

  return value;
};

const parseEurosToCents = (formData: FormData, key: string) => {
  const normalizedValue = getFormString(formData, key).replace(",", ".");
  const value = Number.parseFloat(normalizedValue);

  if (Number.isNaN(value)) {
    throw new Response(`Invalid ${key}`, { status: 400 });
  }

  return Math.round(value * 100);
};

const getBoxPayload = (formData: FormData) => {
  const name = getFormString(formData, "name");

  if (!name) {
    throw new Response("Name is required", { status: 400 });
  }

  return {
    name,
    meals: parseInteger(formData, "meals"),
    oneTimePriceCents: parseEurosToCents(formData, "oneTimePriceEuros"),
    subscriptionPriceCents: parseEurosToCents(
      formData,
      "subscriptionPriceEuros",
    ),
    sortOrder: parseInteger(formData, "sortOrder"),
  };
};

const getRequiredId = (formData: FormData) => {
  const id = getFormString(formData, "id");

  if (!id) {
    throw new Response("Box id is required", { status: 400 });
  }

  return id;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = getFormString(formData, "intent");

  if (intent === "createBox") {
    await prisma.mealBox.create({
      data: {
        ...getBoxPayload(formData),
        shop,
      },
    });

    return { ok: true };
  }

  if (intent === "updateBox") {
    const id = getRequiredId(formData);
    const existingBox = await prisma.mealBox.findFirst({
      where: { id, shop },
      select: { id: true },
    });

    if (!existingBox) {
      throw new Response("Meal box not found", { status: 404 });
    }

    await prisma.mealBox.update({
      where: { id },
      data: getBoxPayload(formData),
    });

    return { ok: true };
  }

  if (intent === "toggleBoxActive") {
    const id = getRequiredId(formData);
    const existingBox = await prisma.mealBox.findFirst({
      where: { id, shop },
      select: { id: true, active: true },
    });

    if (!existingBox) {
      throw new Response("Meal box not found", { status: 404 });
    }

    await prisma.mealBox.update({
      where: { id },
      data: { active: !existingBox.active },
    });

    return { ok: true };
  }

  throw new Response("Unknown action", { status: 400 });
};

const formatEurosForInput = (cents: number) => (cents / 100).toFixed(2);

const fieldStyle = {
  display: "grid",
  gap: "0.25rem",
} as const;

const inputStyle = {
  border: "1px solid #c9cccf",
  borderRadius: "0.5rem",
  font: "inherit",
  padding: "0.6rem 0.75rem",
} as const;

const gridStyle = {
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} as const;

export default function Index() {
  const { boxes } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Mileyo Subscription OS">
      <s-section heading="Créer une nouvelle box">
        <Form method="post">
          <input type="hidden" name="intent" value="createBox" />
          <s-stack gap="base">
            <div style={gridStyle}>
              <label style={fieldStyle}>
                Nom
                <input name="name" required style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Repas
                <input
                  min="1"
                  name="meals"
                  required
                  style={inputStyle}
                  type="number"
                />
              </label>
              <label style={fieldStyle}>
                Prix achat unique (€)
                <input
                  min="0"
                  name="oneTimePriceEuros"
                  required
                  step="0.01"
                  style={inputStyle}
                  type="number"
                />
              </label>
              <label style={fieldStyle}>
                Prix abonnement (€)
                <input
                  min="0"
                  name="subscriptionPriceEuros"
                  required
                  step="0.01"
                  style={inputStyle}
                  type="number"
                />
              </label>
              <label style={fieldStyle}>
                Ordre
                <input
                  defaultValue="0"
                  name="sortOrder"
                  required
                  style={inputStyle}
                  type="number"
                />
              </label>
            </div>
            <s-button type="submit">Créer la box</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Boxes">
        <s-stack gap="base">
          {boxes.map((box) => (
            <s-box
              key={box.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack gap="small">
                <s-text>
                  <strong>{box.name}</strong>{" "}
                  {box.active ? "(active)" : "(inactive)"}
                </s-text>
                <Form method="post">
                  <input type="hidden" name="intent" value="updateBox" />
                  <input type="hidden" name="id" value={box.id} />
                  <s-stack gap="base">
                    <div style={gridStyle}>
                      <label style={fieldStyle}>
                        Nom
                        <input
                          defaultValue={box.name}
                          name="name"
                          required
                          style={inputStyle}
                        />
                      </label>
                      <label style={fieldStyle}>
                        Repas
                        <input
                          defaultValue={box.meals}
                          min="1"
                          name="meals"
                          required
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <label style={fieldStyle}>
                        Prix achat unique (€)
                        <input
                          defaultValue={formatEurosForInput(
                            box.oneTimePriceCents,
                          )}
                          min="0"
                          name="oneTimePriceEuros"
                          required
                          step="0.01"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <label style={fieldStyle}>
                        Prix abonnement (€)
                        <input
                          defaultValue={formatEurosForInput(
                            box.subscriptionPriceCents,
                          )}
                          min="0"
                          name="subscriptionPriceEuros"
                          required
                          step="0.01"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <label style={fieldStyle}>
                        Ordre
                        <input
                          defaultValue={box.sortOrder}
                          name="sortOrder"
                          required
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                    </div>
                    <s-button type="submit">Enregistrer</s-button>
                  </s-stack>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="toggleBoxActive" />
                  <input type="hidden" name="id" value={box.id} />
                  <s-button
                    tone={box.active ? "critical" : "neutral"}
                    type="submit"
                  >
                    {box.active ? "Désactiver" : "Activer"}
                  </s-button>
                </Form>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}