import { CRON_NAME } from "../constants/cronRun";
import { processDueMealSelectionReminders } from "./email/meal-selection-reminder-runner.server";
import { processDueUpcomingDeliveryEmails } from "./email/upcoming-delivery-runner.server";
import {
  completeCronRunFailure,
  completeCronRunSuccess,
  safeCronRunErrorMessage,
  startCronRun,
  type CronRunDb,
} from "./monitoring/cron-run.server";
import { captureTechnicalError } from "./observability/captureTechnicalError.server";
import { processDueSubscriptionBillings } from "./subscriptionBillingWorker.server";
import { resolveCronShop } from "../utils/cronShop.server";

export type ProcessSubscriptionsCronDeps = {
  completeCronRunFailure?: typeof completeCronRunFailure;
  completeCronRunSuccess?: typeof completeCronRunSuccess;
  cronRunClient?: CronRunDb;
  processDueMealSelectionReminders?: typeof processDueMealSelectionReminders;
  processDueSubscriptionBillings?: typeof processDueSubscriptionBillings;
  processDueUpcomingDeliveryEmails?: typeof processDueUpcomingDeliveryEmails;
  startCronRun?: typeof startCronRun;
};

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

/**
 * Billing + meal reminder + upcoming delivery cron.
 * MONITORING-1: persists CronRun heartbeat fail-open (never blocks billing).
 * @internal deps injectable for business regression tests only.
 */
export const runProcessSubscriptionsCron = async (
  request: Request,
  deps: ProcessSubscriptionsCronDeps = {},
) => {
  const processBillings =
    deps.processDueSubscriptionBillings ?? processDueSubscriptionBillings;
  const processMealReminders =
    deps.processDueMealSelectionReminders ?? processDueMealSelectionReminders;
  const processUpcoming =
    deps.processDueUpcomingDeliveryEmails ?? processDueUpcomingDeliveryEmails;
  const startRun = deps.startCronRun ?? startCronRun;
  const completeSuccess =
    deps.completeCronRunSuccess ?? completeCronRunSuccess;
  const completeFailure =
    deps.completeCronRunFailure ?? completeCronRunFailure;

  const authError = validateCronSecret(request);

  if (authError) {
    return authError;
  }

  const shopConfig = validateCronShop();

  if (shopConfig instanceof Response) {
    return shopConfig;
  }

  const shop = shopConfig.shop;
  const startedAt = new Date();
  const cronRun = await startRun({
    client: deps.cronRunClient,
    cronName: CRON_NAME.PROCESS_SUBSCRIPTIONS,
    now: startedAt,
    shop,
  });
  const runId = cronRun?.id ?? null;

  try {
    const billingSummary = await processBillings(shop);

    let mealSelectionReminders = null;
    let mealSelectionReminderError: string | null = null;

    try {
      mealSelectionReminders = await processMealReminders(shop);
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

      captureTechnicalError(reminderError, {
        cronName: "process-subscriptions",
        runner: "meal-selection-reminder",
        shop,
      });
    }

    let upcomingDeliveryEmails = null;
    let upcomingDeliveryError: string | null = null;

    try {
      upcomingDeliveryEmails = await processUpcoming(shop);
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

      captureTechnicalError(upcomingError, {
        cronName: "process-subscriptions",
        runner: "upcoming-delivery",
        shop,
      });
    }

    const completedAt = new Date();

    if (runId) {
      await completeSuccess({
        client: deps.cronRunClient,
        now: completedAt,
        runId,
        startedAt,
        summary: {
          errorCount: billingSummary.errors,
          processedCount: billingSummary.processed,
          skippedCount: billingSummary.skipped,
        },
      });
    }

    return Response.json({
      ...billingSummary,
      mealSelectionReminderError,
      mealSelectionReminders,
      runId,
      upcomingDeliveryEmails,
      upcomingDeliveryError,
    });
  } catch (error) {
    const message = safeCronRunErrorMessage(error);
    const completedAt = new Date();

    if (runId) {
      await completeFailure({
        client: deps.cronRunClient,
        errorCode: "cron_exception",
        errorMessage: message,
        now: completedAt,
        runId,
        startedAt,
      });
    }

    console.error("[cron/process-subscriptions]", message, error);

    captureTechnicalError(error, {
      cronName: "process-subscriptions",
      runId,
      shop,
      source: "cron",
    });

    return Response.json({ error: message, runId }, { status: 500 });
  }
};
