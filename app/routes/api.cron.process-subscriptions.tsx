import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { processDueMealSelectionReminders } from "../services/email/meal-selection-reminder-runner.server";
import { processDueUpcomingDeliveryEmails } from "../services/email/upcoming-delivery-runner.server";
import { processDueSubscriptionBillings } from "../services/subscriptionBillingWorker.server";
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

const runProcessSubscriptionsCron = async (request: Request) => {
  const authError = validateCronSecret(request);

  if (authError) {
    return authError;
  }

  const shopConfig = validateCronShop();

  if (shopConfig instanceof Response) {
    return shopConfig;
  }

  try {
    const billingSummary = await processDueSubscriptionBillings(shopConfig.shop);

    let mealSelectionReminders = null;
    let mealSelectionReminderError: string | null = null;

    try {
      mealSelectionReminders = await processDueMealSelectionReminders(
        shopConfig.shop,
      );
    } catch (reminderError) {
      mealSelectionReminderError =
        reminderError instanceof Error
          ? reminderError.message
          : "Meal selection reminder runner failed unexpectedly.";

      console.error(
        "[cron/process-subscriptions] meal selection reminder failed",
        mealSelectionReminderError,
        reminderError,
      );
    }

    let upcomingDeliveryEmails = null;
    let upcomingDeliveryError: string | null = null;

    try {
      upcomingDeliveryEmails = await processDueUpcomingDeliveryEmails(
        shopConfig.shop,
      );
    } catch (upcomingError) {
      upcomingDeliveryError =
        upcomingError instanceof Error
          ? upcomingError.message
          : "Upcoming delivery email runner failed unexpectedly.";

      console.error(
        "[cron/process-subscriptions] upcoming delivery email failed",
        upcomingDeliveryError,
        upcomingError,
      );
    }

    return Response.json({
      ...billingSummary,
      mealSelectionReminderError,
      mealSelectionReminders,
      upcomingDeliveryEmails,
      upcomingDeliveryError,
    });
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
