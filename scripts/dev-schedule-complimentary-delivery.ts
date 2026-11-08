/**
 * Ops helper — schedule a complimentary kitchen delivery (no Shopify billing).
 *
 * Safety:
 * - Dry-run by default (no DB write unless --apply + --confirm=YES)
 * - No hardcoded customer/contract ids
 * - Never prints secrets (DATABASE_URL / tokens redacted)
 * - Never creates payments, never touches HOLD / nextBillingDate
 * - PROD requires unambiguous env + shop + db fingerprint checks
 *
 * Usage (DEV first):
 *   npx tsx --env-file=.env scripts/dev-schedule-complimentary-delivery.ts \
 *     --env=dev \
 *     --shop=mileyo-ok1bszwz.myshopify.com \
 *     --contract=31036440716 \
 *     --delivery-date=2026-11-12 \
 *     --reason="Commercial goodwill — free box" \
 *     --operation-id=comp-dev-31036440716-20261112
 *
 * Write path (explicit):
 *   ...same flags... --apply --confirm=YES
 *
 * Does NOT bill Shopify. Does NOT touch nextBillingDate / HOLD.
 * Sets nextScheduledDeliveryDate for portal cutoff (unless --no-sync-nsdd).
 *
 * Do NOT run against PROD without explicit human authorization outside this script.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  COMPLIMENTARY_DELIVERY_STATUS,
} from "../app/constants/complimentaryDelivery";
import db from "../app/db.server";
import { scheduleComplimentaryDelivery } from "../app/services/complimentaryDelivery.server";
import { parseDeliveryDate } from "../app/utils/deliveryDate";
import {
  normalizeShopifyId,
  subscriptionContractIdOrFilter,
} from "../app/utils/shopifyIds.server";

/** Boutiques DEV connues — refus si --env=prod les cible. */
const KNOWN_DEV_SHOPS = new Set(["mileyo-ok1bszwz.myshopify.com"]);
/**
 * Boutiques souvent citées comme PROD dans les tests/docs.
 * Refus si --env=dev les cible (anti-erreur de bascule).
 * La preuve PROD réelle reste --expected-shop + empreinte DB.
 */
const KNOWN_PROD_LIKE_SHOPS = new Set(["mileyo.myshopify.com"]);

const SECRET_ENV_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "CRON_SECRET",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "RESEND_API_KEY",
] as const;

type ParsedArgs = Record<string, string>;

const parseArgs = (argv: string[]): ParsedArgs =>
  Object.fromEntries(
    argv.map((part) => {
      const match = /^--([^=]+)=(.*)$/.exec(part);
      if (match) return [match[1], match[2]];
      if (part.startsWith("--")) return [part.slice(2), "true"];
      return [part, "true"];
    }),
  );

const usage = () => {
  console.error(`Required:
  --env=dev|prod
  --shop=<exact.myshopify.com>
  --contract=<numeric or GID>
  --delivery-date=YYYY-MM-DD
  --reason="<audit reason>"
  --operation-id=<unique ops key>

Optional:
  --apply                 actually write (default: dry-run)
  --confirm=YES           required with --apply
  --no-sync-nsdd          do not set selection.nextScheduledDeliveryDate
  --expected-shop=<exact.myshopify.com>  required when --env=prod (must equal --shop)
  --expected-db-host=<h>  required when --env=prod (hostname fingerprint)
  --expected-db-name=<n>  required when --env=prod (database name fingerprint)

Never prints secrets. Never creates payments. Never mutates HOLD / NBD.`);
};

const redactDatabaseUrl = (raw: string | undefined): {
  host: string | null;
  name: string | null;
  scheme: string | null;
} => {
  if (!raw?.trim()) {
    return { host: null, name: null, scheme: null };
  }
  try {
    const normalized = raw.replace(/^prisma\+/, "");
    const url = new URL(normalized);
    const name = url.pathname.replace(/^\//, "").split("?")[0] || null;
    return {
      host: url.hostname || null,
      name,
      scheme: url.protocol.replace(/:$/, "") || null,
    };
  } catch {
    return { host: "(unparseable)", name: null, scheme: null };
  }
};

const assertNoSecretLeak = (payload: unknown) => {
  const text = JSON.stringify(payload);
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 8 && text.includes(value)) {
      throw new Error(`Refus: tentative d'affichage du secret ${key}.`);
    }
  }
};

const requireArg = (args: ParsedArgs, key: string): string => {
  const value = args[key]?.trim();
  if (!value) {
    usage();
    console.error(`Missing --${key}`);
    process.exit(1);
  }
  return value;
};

const args = parseArgs(process.argv.slice(2));
const envName = requireArg(args, "env").toLowerCase();
const shop = requireArg(args, "shop").toLowerCase();
const contractRaw = requireArg(args, "contract");
const deliveryDateRaw = requireArg(args, "delivery-date");
const reason = requireArg(args, "reason");
const operationId = requireArg(args, "operation-id");
const apply = args.apply === "true";
const confirm = args.confirm?.trim() ?? "";
const syncNsdd = args["no-sync-nsdd"] !== "true";
const expectedShop = args["expected-shop"]?.trim().toLowerCase() || null;
const expectedDbHost = args["expected-db-host"]?.trim() || null;
const expectedDbName = args["expected-db-name"]?.trim() || null;

if (envName !== "dev" && envName !== "prod") {
  console.error("--env must be exactly 'dev' or 'prod' (no ambiguity).");
  process.exit(1);
}

if (!shop.endsWith(".myshopify.com")) {
  console.error("--shop must be an exact *.myshopify.com domain.");
  process.exit(1);
}

const contractNormalized = normalizeShopifyId(contractRaw);
if (!contractNormalized) {
  console.error("--contract invalide.");
  process.exit(1);
}

const deliveryDate = parseDeliveryDate(deliveryDateRaw);
if (!deliveryDate) {
  console.error("--delivery-date invalide (YYYY-MM-DD).");
  process.exit(1);
}

if (!operationId || operationId.length < 8) {
  console.error("--operation-id requis (min 8 caractères, unique par shop).");
  process.exit(1);
}

if (envName === "dev" && KNOWN_PROD_LIKE_SHOPS.has(shop)) {
  console.error(
    `Refus: --env=dev mais --shop=${shop} ressemble à une boutique PROD.`,
  );
  process.exit(1);
}

if (envName === "prod" && KNOWN_DEV_SHOPS.has(shop)) {
  console.error(
    `Refus: --env=prod mais --shop=${shop} est une boutique DEV connue.`,
  );
  process.exit(1);
}

if (envName === "prod") {
  if (!expectedShop || expectedShop !== shop) {
    console.error(
      "Refus PROD: --expected-shop obligatoire et doit être identique à --shop (double saisie anti-ambiguïté).",
    );
    process.exit(1);
  }
  if (!expectedDbHost || !expectedDbName) {
    console.error(
      "Refus PROD: --expected-db-host et --expected-db-name sont obligatoires (empreinte DB, sans secret).",
    );
    process.exit(1);
  }
}

const dbMeta = redactDatabaseUrl(process.env.DATABASE_URL);
if (!dbMeta.host || !dbMeta.name) {
  console.error("Refus: DATABASE_URL absent ou non parsable (hôte/nom requis).");
  process.exit(1);
}

if (envName === "prod") {
  if (dbMeta.host !== expectedDbHost || dbMeta.name !== expectedDbName) {
    console.error(
      JSON.stringify(
        {
          error: "PROD DB fingerprint mismatch",
          expected: { host: expectedDbHost, name: expectedDbName },
          observed: { host: dbMeta.host, name: dbMeta.name },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  // Heuristic: refuse obvious local / ephemeral DB hosts in PROD mode.
  if (
    /localhost|127\.0\.0\.1|0\.0\.0\.0|embedded|tmp|test/i.test(dbMeta.host) ||
    /localhost|127\.0\.0\.1|test|dev/i.test(dbMeta.name)
  ) {
    console.error(
      JSON.stringify(
        {
          error: "PROD refused: DB host/name looks non-production",
          observed: { host: dbMeta.host, name: dbMeta.name },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

const selection = await db.subscriptionMealSelection.findFirst({
  select: {
    id: true,
    mealsCount: true,
    nextBillingDate: true,
    nextScheduledDeliveryDate: true,
    shop: true,
    status: true,
    subscriptionContractId: true,
  },
  where: {
    shop,
    ...subscriptionContractIdOrFilter(contractNormalized),
  },
});

if (!selection) {
  console.error(
    JSON.stringify(
      {
        error: "selection_not_found",
        shop,
        contract: contractNormalized,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const existingByOperation = await db.complimentaryDelivery.findUnique({
  where: {
    shop_operationId: {
      operationId,
      shop,
    },
  },
});

const existingByDate = await db.complimentaryDelivery.findUnique({
  where: {
    subscriptionMealSelectionId_scheduledDeliveryDate: {
      scheduledDeliveryDate: deliveryDate,
      subscriptionMealSelectionId: selection.id,
    },
  },
});

const preflight = {
  apply,
  confirmRequired: apply,
  contract: contractNormalized,
  deliveryDate,
  dryRun: !apply,
  env: envName,
  existingByDate: existingByDate
    ? {
        id: existingByDate.id,
        operationId: existingByDate.operationId,
        status: existingByDate.status,
      }
    : null,
  existingByOperation: existingByOperation
    ? {
        id: existingByOperation.id,
        scheduledDeliveryDate: existingByOperation.scheduledDeliveryDate,
        status: existingByOperation.status,
      }
    : null,
  invariants: {
    createsPayment: false,
    mutatesHold: false,
    mutatesNextBillingDate: false,
    maySyncNextScheduledDeliveryDate: syncNsdd,
  },
  operationId,
  selection: {
    id: selection.id,
    mealsCount: selection.mealsCount,
    nextBillingDate: selection.nextBillingDate?.toISOString() ?? null,
    nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
    status: selection.status,
  },
  shop,
  targetDb: {
    host: dbMeta.host,
    name: dbMeta.name,
    scheme: dbMeta.scheme,
  },
  uniquenessOk: !existingByOperation && !existingByDate,
};

assertNoSecretLeak(preflight);
console.log(JSON.stringify({ phase: "preflight", ...preflight }, null, 2));

if (existingByOperation) {
  console.error(
    JSON.stringify(
      {
        error: "operation_id_not_unique",
        existingId: existingByOperation.id,
        operationId,
        shop,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

if (
  existingByDate &&
  existingByDate.status !== COMPLIMENTARY_DELIVERY_STATUS.CANCELLED &&
  existingByDate.status !== COMPLIMENTARY_DELIVERY_STATUS.FAILED
) {
  console.error(
    JSON.stringify(
      {
        error: "delivery_date_already_scheduled",
        existingId: existingByDate.id,
        scheduledDeliveryDate: deliveryDate,
        status: existingByDate.status,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

if (!apply) {
  console.log(
    JSON.stringify(
      {
        phase: "dry-run",
        message:
          "Aucune écriture. Relancer avec --apply --confirm=YES pour programmer.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (confirm !== "YES") {
  console.error(
    'Refus écriture: --apply exige --confirm=YES (majuscules exactes).',
  );
  process.exit(1);
}

if (envName === "prod") {
  const rl = createInterface({ input, output });
  const typed = (
    await rl.question(
      `PROD WRITE CONFIRM — tapez exactement le contrat ${contractNormalized} pour continuer: `,
    )
  ).trim();
  rl.close();
  if (typed !== contractNormalized) {
    console.error("Refus PROD: confirmation contrat incorrecte. Aucune écriture.");
    process.exit(1);
  }
}

const nbdBefore = selection.nextBillingDate?.toISOString() ?? null;

const result = await scheduleComplimentaryDelivery({
  commercialReason: reason,
  operationId,
  scheduledDeliveryDate: deliveryDate,
  shop,
  subscriptionContractId: contractNormalized,
  syncNextScheduledDeliveryDate: syncNsdd,
});

const selectionAfter = await db.subscriptionMealSelection.findUnique({
  select: {
    nextBillingDate: true,
    nextScheduledDeliveryDate: true,
  },
  where: { id: selection.id },
});

const report = {
  phase: "apply",
  result: result.ok
    ? {
        created: result.created,
        deliveryId: result.delivery.id,
        operationId: result.delivery.operationId,
        scheduledDeliveryDate: result.delivery.scheduledDeliveryDate,
        status: result.delivery.status,
      }
    : result,
  selectionAfter: {
    nextBillingDate: selectionAfter?.nextBillingDate?.toISOString() ?? null,
    nextScheduledDeliveryDate: selectionAfter?.nextScheduledDeliveryDate ?? null,
  },
  selectionBefore: {
    nextBillingDate: nbdBefore,
    nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
  },
  nbdUnchanged:
    (selectionAfter?.nextBillingDate?.toISOString() ?? null) === nbdBefore,
};

assertNoSecretLeak(report);
console.log(JSON.stringify(report, null, 2));

if (!result.ok) {
  process.exit(1);
}

if (!report.nbdUnchanged) {
  console.error(
    "ALERTE: nextBillingDate a changé — situation anormale pour complimentary.",
  );
  process.exit(2);
}

process.exit(0);
