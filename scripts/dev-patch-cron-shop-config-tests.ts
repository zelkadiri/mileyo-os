/**
 * Cron shop config — unit + route gate checks (no billing when CRON_SHOP invalid).
 * Does not mutate the reference contract 25688637580.
 */
import db from "../app/db.server";
import {
  isValidMyshopifyDomain,
  normalizeCronShop,
  resolveCronShop,
} from "../app/utils/cronShop.server";
import { normalizeShopifyId } from "../app/utils/shopifyIds.server";

const REFERENCE_CONTRACT_ID = "25688637580";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];
const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });
const fail = (name: string, detail: string) => checks.push({ name, ok: false, detail });

const expectResolve = (
  name: string,
  raw: string | undefined,
  expected: "ok" | "missing" | "invalid",
  expectedShop?: string,
) => {
  const result = resolveCronShop(raw);

  if (expected === "ok") {
    if (result.ok && result.shop === expectedShop) {
      pass(name, `shop=${result.shop}`);
      return;
    }

    fail(
      name,
      `expected ok shop=${expectedShop ?? "?"}, got ${JSON.stringify(result)}`,
    );
    return;
  }

  if (!result.ok && expected === "missing" && result.error.includes("not configured")) {
    pass(name, result.error);
    return;
  }

  if (!result.ok && expected === "invalid" && result.error.includes("valid")) {
    pass(name, result.error);
    return;
  }

  fail(name, `expected ${expected}, got ${JSON.stringify(result)}`);
};

async function snapshotReferenceContract() {
  return db.subscriptionMealSelection.findFirst({
    where: {
      subscriptionContractId: { contains: REFERENCE_CONTRACT_ID },
    },
  });
}

async function callCronLoader(env: {
  cronSecret?: string;
  cronShop?: string;
  providedSecret?: string;
}) {
  const previousSecret = process.env.CRON_SECRET;
  const previousShop = process.env.CRON_SHOP;

  if (env.cronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = env.cronSecret;
  }

  if (env.cronShop === undefined) {
    delete process.env.CRON_SHOP;
  } else {
    process.env.CRON_SHOP = env.cronShop;
  }

  const modulePath = `../app/routes/api.cron.process-subscriptions.tsx?cron-test=${Date.now()}`;
  const { loader } = await import(modulePath);
  const secret = env.providedSecret ?? env.cronSecret ?? "";
  const request = new Request(
    `http://localhost/api/cron/process-subscriptions?secret=${encodeURIComponent(secret)}`,
  );
  const response = await loader({
    context: {},
    params: {},
    request,
  });
  const body = await response.json();

  if (previousSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = previousSecret;
  }

  if (previousShop === undefined) {
    delete process.env.CRON_SHOP;
  } else {
    process.env.CRON_SHOP = previousShop;
  }

  return { body, status: response.status };
}

async function main() {
  expectResolve(
    "normalize https trailing slash",
    "https://Mileyo-Shop.Myshopify.com/",
    "ok",
    "mileyo-shop.myshopify.com",
  );
  expectResolve("missing CRON_SHOP", undefined, "missing");
  expectResolve("empty CRON_SHOP", "   ", "missing");
  expectResolve("invalid domain", "not-a-shop.example.com", "invalid");
  expectResolve("invalid bare myshopify", ".myshopify.com", "invalid");
  expectResolve(
    "valid domain",
    "mileyo-ok1bszwz.myshopify.com",
    "ok",
    "mileyo-ok1bszwz.myshopify.com",
  );
  expectResolve("reject path suffix", "foo.myshopify.com/path", "invalid");
  expectResolve("reject query suffix", "foo.myshopify.com?x=1", "invalid");
  expectResolve("reject double dot shop", "foo..myshopify.com", "invalid");
  expectResolve(
    "reject myshopify suffix trick",
    "foo.myshopify.com.evil.com",
    "invalid",
  );
  expectResolve(
    "accept exact hostname",
    "mileyo-fr.myshopify.com",
    "ok",
    "mileyo-fr.myshopify.com",
  );

  if (
    normalizeCronShop(" https://Foo.myshopify.com/ ") !== "foo.myshopify.com"
  ) {
    fail("normalizeCronShop trims and lowercases", "unexpected output");
  } else {
    pass("normalizeCronShop trims and lowercases", "foo.myshopify.com");
  }

  if (!isValidMyshopifyDomain("foo.myshopify.com")) {
    fail("isValidMyshopifyDomain accepts valid shop", "rejected valid shop");
  } else {
    pass("isValidMyshopifyDomain accepts valid shop", "ok");
  }

  const beforeRef = await snapshotReferenceContract();
  if (!beforeRef) {
    fail("reference contract exists", `contract ${REFERENCE_CONTRACT_ID} not found`);
  } else {
    pass(
      "reference contract exists",
      `id=${beforeRef.id} contract=${normalizeShopifyId(beforeRef.subscriptionContractId)}`,
    );
  }

  const absentShop = await callCronLoader({
    cronSecret: "patch-cron-test-secret",
    cronShop: undefined,
    providedSecret: "patch-cron-test-secret",
  });

  if (absentShop.status === 500 && absentShop.body?.error?.includes("CRON_SHOP")) {
    pass("route absent CRON_SHOP", `status=${absentShop.status}`);
  } else {
    fail(
      "route absent CRON_SHOP",
      `status=${absentShop.status} body=${JSON.stringify(absentShop.body)}`,
    );
  }

  const invalidShop = await callCronLoader({
    cronSecret: "patch-cron-test-secret",
    cronShop: "bad-shop.example.com",
    providedSecret: "patch-cron-test-secret",
  });

  if (
    invalidShop.status === 500 &&
    invalidShop.body?.error?.includes("valid")
  ) {
    pass("route invalid CRON_SHOP", `status=${invalidShop.status}`);
  } else {
    fail(
      "route invalid CRON_SHOP",
      `status=${invalidShop.status} body=${JSON.stringify(invalidShop.body)}`,
    );
  }

  const validShop = process.env.CRON_SHOP?.trim();
  const validSecret = process.env.CRON_SECRET?.trim();
  const runLiveDry = process.env.RUN_LIVE_CRON_DRY === "1";

  if (validShop && validSecret && runLiveDry) {
    const dryRun = await callCronLoader({
      cronSecret: validSecret,
      cronShop: validShop,
      providedSecret: validSecret,
    });

    if (dryRun.status === 200 && typeof dryRun.body?.processed === "number") {
      pass(
        "route valid CRON_SHOP dry run",
        `status=${dryRun.status} processed=${dryRun.body.processed}`,
      );

      if (dryRun.body.processed === 0) {
        pass("route valid CRON_SHOP processed zero", "no billing attempts");
      } else {
        fail(
          "route valid CRON_SHOP processed zero",
          `processed=${dryRun.body.processed} — run only when all nextBillingDate are future`,
        );
      }
    } else {
      fail(
        "route valid CRON_SHOP dry run",
        `status=${dryRun.status} body=${JSON.stringify(dryRun.body)}`,
      );
    }
  } else {
    pass(
      "route valid CRON_SHOP dry run",
      runLiveDry
        ? "skipped — set CRON_SHOP and CRON_SECRET in env to run live dry cron"
        : "skipped — set RUN_LIVE_CRON_DRY=1 to call the live worker (ensure all nextBillingDate are future)",
    );
  }

  const afterRef = await snapshotReferenceContract();

  if (
    beforeRef &&
    afterRef &&
    beforeRef.updatedAt.getTime() === afterRef.updatedAt.getTime() &&
    beforeRef.lastBillingAttemptAt?.getTime() ===
      afterRef.lastBillingAttemptAt?.getTime() &&
    beforeRef.lastBillingAttemptStatus === afterRef.lastBillingAttemptStatus
  ) {
    pass("reference contract unchanged", `id=${afterRef.id}`);
  } else if (beforeRef && afterRef) {
    fail("reference contract unchanged", "selection fields changed during tests");
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(`\nCron shop config tests: ${checks.length - failed.length}/${checks.length}`);

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}: ${check.name} — ${check.detail}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[dev-patch-cron-shop-config-tests] failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
