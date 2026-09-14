import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import {
  fetchCachedBuilderBoxOptions,
  fetchCachedBuilderMealOptions,
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
import {
  getBuilderPerfTimings,
  runWithBuilderPerfTimings,
  setBuilderPerfPhase,
} from "../utils/perfTimings.server";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    status,
  });

/** Stable Server-Timing duration (ms), never NaN/negative. */
const timingDur = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms * 10) / 10;
};

const withServerTiming = (
  response: Response,
  timings: Record<string, number>,
) => {
  const value = Object.entries(timings)
    .map(([name, dur]) => `${name};dur=${timingDur(dur)}`)
    .join(", ");
  // Mutate headers on the existing Response — keeps body/status/Content-Type intact.
  response.headers.set("Server-Timing", value);
  return response;
};

/** Merge request-scoped auth/DB sub-timings into Server-Timing (durations only). */
const mergeAuthAndSettingsPerf = (
  timings: Record<string, number>,
): void => {
  const perf = getBuilderPerfTimings();
  if (!perf) return;

  if (perf.sessionLoadCount > 0) {
    timings.sessionLoad = perf.sessionLoad;
  }
  if (perf.sessionQuery > 0) {
    timings.sessionQuery = perf.sessionQuery;
  }
  if (perf.sessionStoreCount > 0) {
    timings.sessionStore = perf.sessionStore;
  }
  if (perf.settingsQuery > 0) {
    timings.settingsQuery = perf.settingsQuery;
  }
  if (perf.boxesCacheHit) {
    timings.boxesCacheHit = 1;
  }
  if (perf.mealsCacheHit) {
    timings.mealsCacheHit = 1;
  }

  // Derived residual — only meaningful when we timed at least one loadSession.
  if (
    typeof timings.appProxyAuth === "number" &&
    perf.sessionLoadCount > 0
  ) {
    const accounted =
      (timings.sessionLoad ?? 0) + (timings.sessionStore ?? 0);
    const authOther = timings.appProxyAuth - accounted;
    if (Number.isFinite(authOther) && authOther >= 0) {
      timings.authOther = authOther;
    }
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) =>
  runWithBuilderPerfTimings(async () => {
    const totalStart = performance.now();
    const timings: Record<string, number> = {};

    setBuilderPerfPhase("auth");
    const authStart = performance.now();
    const { admin, shop } = await authenticateMileyoAppProxy(request);
    timings.appProxyAuth = performance.now() - authStart;

    if (!admin) {
      // No offline session after App Proxy auth (refresh already attempted in SDK).
      // Equivalent failure class to the former SessionNotFoundError path.
      throw new Response(undefined, {
        status: 503,
        statusText: "Service Unavailable",
      });
    }

    // Box catalog does not depend on AppSettings — overlap DB + GraphQL.
    setBuilderPerfPhase("settings");
    const settingsStart = performance.now();
    const boxesStart = performance.now();
    const settingsPromise = prisma.appSettings
      .findUnique({ where: { shop } })
      .then((settings) => {
        timings.settings = performance.now() - settingsStart;
        return settings;
      });
    const boxesPromise = fetchCachedBuilderBoxOptions(admin, shop).then(
      (boxes) => {
        timings.boxes = performance.now() - boxesStart;
        return boxes;
      },
    );
    // Attach immediately so a GraphQL failure during await settings never becomes
    // an unhandled rejection on the early-return path. Happy path still awaits
    // boxesPromise and surfaces the rejection normally.
    boxesPromise.catch(() => undefined);

    const settings = await settingsPromise;
    setBuilderPerfPhase("idle");
    mergeAuthAndSettingsPerf(timings);

    if (!settings) {
      timings.total = performance.now() - totalStart;
      return withServerTiming(
        renderMessage(
          "Configuration manquante. Sélectionnez la collection de plats dans l’administration Mileyo.",
          shop,
        ),
        timings,
      );
    }

    if (!settings.mealCollectionId) {
      timings.total = performance.now() - totalStart;
      return withServerTiming(
        renderMessage(
          "Configuration incomplète. Sélectionnez une collection de plats dans les réglages.",
          shop,
        ),
        timings,
      );
    }

    // Meals need mealCollectionId; keep overlapping with in-flight box fetch.
    const mealsStart = performance.now();
    const mealsPromise = fetchCachedBuilderMealOptions(
      admin,
      settings.mealCollectionId,
      shop,
    ).then((meals) => {
      timings.meals = performance.now() - mealsStart;
      return meals;
    });

    const [boxes, meals] = await Promise.all([boxesPromise, mealsPromise]);

    const deliveryWindowOptions = buildBuilderDeliveryWindowOptions();
    const deliveryConfig = {
      deliveryWindowOptions,
      timezone: DELIVERY_TIMEZONE,
    };

    const renderStart = performance.now();
    const response = renderBuilder({
      boxes,
      deliveryConfig,
      meals,
    });
    timings.render = performance.now() - renderStart;
    timings.total = performance.now() - totalStart;
    // Re-merge in case Prisma query events arrived just after settings await.
    mergeAuthAndSettingsPerf(timings);

    return withServerTiming(response, timings);
  });

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
