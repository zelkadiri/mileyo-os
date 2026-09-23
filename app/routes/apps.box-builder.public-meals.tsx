/**
 * GET /apps/box-builder/public-meals — App Proxy public meal catalog (JSON).
 *
 * Display-only. No cart, checkout, mutations, or customer session required.
 * Auth: authenticateMileyoAppProxy (same HMAC path as Box Builder).
 *
 * Description security: Admin `description` is plain text (HTML stripped by
 * Shopify). Theme must render with textContent / Liquid `| escape`, never
 * innerHTML of unsanitized HTML.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { fetchCachedPublicMeals } from "../features/public-meals/public-meals.server";
import type {
  PublicMealsErrorBody,
  PublicMealsSuccessBody,
} from "../features/public-meals/public-meals-types";
import { authenticateMileyoAppProxy } from "../utils/appProxyAuth.server";

/** Short browser/CDN hint aligned with process-local TTL (30s). */
const PUBLIC_MEALS_CACHE_CONTROL = "public, max-age=30";

const jsonResponse = (
  body: PublicMealsSuccessBody | PublicMealsErrorBody,
  status: number,
  extraHeaders?: HeadersInit,
) =>
  new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control":
        status === 200 ? PUBLIC_MEALS_CACHE_CONTROL : "no-store",
      ...extraHeaders,
    },
    status,
  });

const methodNotAllowed = () =>
  jsonResponse({ error: "Method Not Allowed" }, 405, {
    Allow: "GET",
  });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed();
  }

  const { admin, shop } = await authenticateMileyoAppProxy(request);

  if (!admin) {
    return jsonResponse(
      { error: "Boutique non disponible." },
      503,
    );
  }

  let settings: { mealCollectionId: string | null } | null;
  try {
    settings = await prisma.appSettings.findUnique({
      where: { shop },
      select: { mealCollectionId: true },
    });
  } catch {
    return jsonResponse(
      { error: "Configuration indisponible." },
      503,
    );
  }

  if (!settings?.mealCollectionId) {
    return jsonResponse(
      { error: "Collection de plats non configurée." },
      404,
    );
  }

  try {
    const { meals } = await fetchCachedPublicMeals(
      admin,
      settings.mealCollectionId,
      shop,
    );
    return jsonResponse({ meals }, 200);
  } catch {
    // Never leak Admin / internal stack traces to the storefront.
    return jsonResponse(
      { error: "Impossible de charger le catalogue repas." },
      502,
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Authenticate first so unsigned probes still fail HMAC (400) like Builder.
  await authenticateMileyoAppProxy(request);
  return methodNotAllowed();
};
