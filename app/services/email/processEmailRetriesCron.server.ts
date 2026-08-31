import {
  completeEmailCronRunFailure,
  completeEmailCronRunSuccess,
  safeCronErrorMessage,
  startEmailCronRun,
  type EmailCronRunDb,
} from "./email-cron-run.server";
import { processDueEmailEvents } from "./email-event-worker.server";
import { captureTechnicalError } from "../observability/captureTechnicalError.server";
import { resolveCronShop } from "../../utils/cronShop.server";

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

export type ProcessEmailRetriesDeps = {
  completeEmailCronRunFailure?: typeof completeEmailCronRunFailure;
  completeEmailCronRunSuccess?: typeof completeEmailCronRunSuccess;
  cronRunClient?: EmailCronRunDb;
  processDueEmailEvents?: typeof processDueEmailEvents;
  startEmailCronRun?: typeof startEmailCronRun;
};

/**
 * Dedicated EmailEvent retry cron — isolated from billing / reminder / upcoming.
 * Empty EmailEvent table is a valid success (summary.scanned = 0).
 *
 * EMAIL-6G-C: persists EmailCronRun for admin health. Monitoring is fail-open —
 * persistence failures never block processDueEmailEvents.
 *
 * @internal deps injectable for business regression tests only.
 */
export const runProcessEmailRetriesCron = async (
  request: Request,
  deps: ProcessEmailRetriesDeps = {},
) => {
  const processFn = deps.processDueEmailEvents ?? processDueEmailEvents;
  const startRun = deps.startEmailCronRun ?? startEmailCronRun;
  const completeSuccess =
    deps.completeEmailCronRunSuccess ?? completeEmailCronRunSuccess;
  const completeFailure =
    deps.completeEmailCronRunFailure ?? completeEmailCronRunFailure;

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
    now: startedAt,
    shop,
  });
  const runId = cronRun?.id ?? null;

  try {
    const summary = await processFn({
      shop,
    });

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

    if (runId) {
      await completeSuccess({
        client: deps.cronRunClient,
        now: completedAt,
        runId,
        startedAt,
        summary,
      });
    }

    console.log("[cron/process-email-retries] completed", {
      durationMs,
      failed: summary.failed,
      processed: summary.claimed,
      reclaimed: summary.reclaimed,
      requeued: summary.retried,
      runId,
      sent: summary.sent,
      shop,
      status: "success",
    });

    return Response.json({
      runId,
      shop,
      ...summary,
    });
  } catch (error) {
    const message = safeCronErrorMessage(error);
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

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

    console.error("[cron/process-email-retries]", {
      durationMs,
      message,
      runId,
      shop,
      status: "failed",
    });

    captureTechnicalError(error, {
      cronName: "process-email-retries",
      errorCode: "cron_exception",
      runId,
      shop,
      source: "cron",
    });

    return Response.json({ error: message, runId }, { status: 500 });
  }
};
