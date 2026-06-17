import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { processDueSubscriptionBillings } from "../services/subscriptionBillingWorker.server";

const CRON_SHOP = "mileyo-6u4o9pcv.myshopify.com";

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

const runProcessSubscriptionsCron = async (request: Request) => {
  const authError = validateCronSecret(request);

  if (authError) {
    return authError;
  }

  try {
    const summary = await processDueSubscriptionBillings(CRON_SHOP);
    return Response.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cron job failed unexpectedly.";

    console.error("[cron/process-subscriptions]", message, error);

    return Response.json({ error: message }, { status: 500 });
  }
};

export const loader = ({ request }: LoaderFunctionArgs) =>
  runProcessSubscriptionsCron(request);

export const action = ({ request }: ActionFunctionArgs) =>
  runProcessSubscriptionsCron(request);
