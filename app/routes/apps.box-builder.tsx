import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  fetchBuilderBoxOptions,
  fetchBuilderMealOptions,
} from "../features/builder/builder-catalog.server";
import {
  CREATE_BUILDER_CHECKOUT_INTENT,
  createBuilderStorefrontCheckout,
  parseCreateBuilderCheckoutBody,
  parseCreateBuilderCheckoutInput,
} from "../features/builder/builder-checkout.server";
import {
  CAPTURE_CHECKOUT_LEAD_INTENT,
  captureCheckoutLead,
  parseCaptureCheckoutLeadBody,
  parseCheckoutLeadContext,
} from "../features/builder/builder-lead.server";
import { renderBuilder, renderMessage } from "../features/builder/builder-render";
import { DELIVERY_TIMEZONE } from "../constants/deliverySchedule";
import { buildBuilderDeliveryWindowOptions } from "../utils/deliveryDate";
import { authenticateMileyoAppProxy } from "../utils/appProxyAuth.server";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    status,
  });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await authenticateMileyoAppProxy(request);

  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings) {
    return renderMessage(
      "Configuration manquante. Sélectionnez la collection de plats dans l’administration Mileyo.",
      shop,
    );
  }

  if (!settings.mealCollectionId) {
    return renderMessage(
      "Configuration incomplète. Sélectionnez une collection de plats dans les réglages.",
      shop,
    );
  }

  const { admin } = await unauthenticated.admin(shop);
  const [boxes, meals] = await Promise.all([
    fetchBuilderBoxOptions(admin),
    fetchBuilderMealOptions(admin, settings.mealCollectionId),
  ]);

  const deliveryWindowOptions = buildBuilderDeliveryWindowOptions();
  const deliveryConfig = {
    deliveryWindowOptions,
    timezone: DELIVERY_TIMEZONE,
  };

  return renderBuilder({
    boxes,
    deliveryConfig,
    meals,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ message: "Méthode non autorisée.", ok: false }, 405);
  }

  const { shop } = await authenticateMileyoAppProxy(request);
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      { message: "Impossible de continuer pour le moment. Réessayez.", ok: false },
      400,
    );
  }

  const checkoutBody = parseCreateBuilderCheckoutBody(payload);
  if (checkoutBody?.intent === CREATE_BUILDER_CHECKOUT_INTENT) {
    const input = parseCreateBuilderCheckoutInput(checkoutBody);
    if (!input) {
      return jsonResponse(
        { message: "Impossible de préparer votre panier. Réessayez.", ok: false },
        400,
      );
    }

    const result = await createBuilderStorefrontCheckout({ input, shop });
    return jsonResponse(result, result.ok ? 200 : 400);
  }

  const body = parseCaptureCheckoutLeadBody(payload);
  if (!body || body.intent !== CAPTURE_CHECKOUT_LEAD_INTENT) {
    return jsonResponse(
      { message: "Impossible de continuer pour le moment. Réessayez.", ok: false },
      400,
    );
  }

  const result = await captureCheckoutLead({
    context: parseCheckoutLeadContext(body),
    emailInput: body.email,
    shop,
  });

  return jsonResponse(result, result.ok ? 200 : 400);
};
