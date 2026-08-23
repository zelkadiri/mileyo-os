import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { processDueEmailEvents } from "../services/email/email-event-worker.server";
import { resolveCronShop } from "../utils/cronShop.server";

const validateCronSecret = (request: Request): Response | null => {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET environment variable is not configured." },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const authHeader = request.headers.get("Authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  const providedSecret = bearerSecret ?? querySecret;

  if (providedSecret !== cronSecret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
};

const validateCronShop = (): { shop: string } | Response => {
  const result = resolveCronShop(process.env.CRON_SHOP);

  if (!result.ok) {
    console.error("[CRON_CONFIG]", result.error);

    return Response.json({ error: result.error }, { status: 500 });
  }

  console.log("[CRON_CONFIG] targeting shop", { shop: result.shop });

  return { shop: result.shop };
};

type ProcessEmailRetriesDeps = {
  processDueEmailEvents: typeof processDueEmailEvents;
};

const defaultDeps: ProcessEmailRetriesDeps = {
  processDueEmailEvents,
};

/**
 * Dedicated EmailEvent retry cron — isolated from billing / reminder / upcoming.
 * Empty EmailEvent table is a valid success (summary.scanned = 0).
 *
 * @internal deps injectable for business regression tests only.
 */
export const runProcessEmailRetriesCron = async (
  request: Request,
  deps: ProcessEmailRetriesDeps = defaultDeps,
) => {
  const authError = validateCronSecret(request);

  if (authError) {
    return authError;
  }

  const shopConfig = validateCronShop();

  if (shopConfig instanceof Response) {
    return shopConfig;
  }

  try {
    const summary = await deps.processDueEmailEvents({
      shop: shopConfig.shop,
    });

    return Response.json({
      shop: shopConfig.shop,
      ...summary,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Email event retry cron failed unexpectedly.";

    console.error("[cron/process-email-retries]", message, error);

    return Response.json({ error: message }, { status: 500 });
  }
};

export const loader = ({ request }: LoaderFunctionArgs) =>
  runProcessEmailRetriesCron(request);

export const action = ({ request }: ActionFunctionArgs) =>
  runProcessEmailRetriesCron(request);
