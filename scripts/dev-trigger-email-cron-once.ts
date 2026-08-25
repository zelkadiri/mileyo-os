/**
 * DEV-only: trigger email retries cron once (EMAIL-6G-C QA).
 * Uses CRON_SECRET / CRON_SHOP from env. Does not print secrets.
 */
import { runProcessEmailRetriesCron } from "../app/routes/api.cron.process-email-retries";
import db from "../app/db.server";

const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error("CRON_SECRET missing");
  process.exit(1);
}

const response = await runProcessEmailRetriesCron(
  new Request("https://example.com/api/cron/process-email-retries", {
    headers: { Authorization: `Bearer ${secret}` },
  }),
);

const body = (await response.json()) as Record<string, unknown>;
console.log("httpStatus", response.status);
console.log(
  JSON.stringify(
    {
      claimed: body.claimed,
      failed: body.failed,
      reclaimed: body.reclaimed,
      retried: body.retried,
      runId: body.runId,
      scanned: body.scanned,
      sent: body.sent,
      shop: body.shop,
      error: body.error,
    },
    null,
    2,
  ),
);

const runId = typeof body.runId === "string" ? body.runId : null;
if (runId) {
  const row = await db.emailCronRun.findUnique({ where: { id: runId } });
  console.log(
    "persisted",
    JSON.stringify(
      {
        durationMs: row?.durationMs,
        failedCount: row?.failedCount,
        processedCount: row?.processedCount,
        reclaimedCount: row?.reclaimedCount,
        requeuedCount: row?.requeuedCount,
        sentCount: row?.sentCount,
        status: row?.status,
      },
      null,
      2,
    ),
  );
}

await db.$disconnect();
