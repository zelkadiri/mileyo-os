/**
 * Business regression — EMAIL-5C upcoming delivery email send wiring.
 *
 * trySendUpcomingDeliveryEmail idempotence, eligibility, no Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
  isUpcomingDeliveryEmailAlreadySentForDelivery,
  shouldSendUpcomingDeliveryEmail,
} from "../../app/services/email/email.server";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  parisWallClockToInstant,
  parseDeliveryDate,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const parisAt = ({
  date,
  hour,
  minute = 0,
}: {
  date: string;
  hour: number;
  minute?: number;
}) =>
  parisWallClockToInstant({
    date: parseDeliveryDate(date)!,
    hour,
    minute,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });

const thursdayDelivery = "2026-08-27";
const jMinus2Morning = parisAt({ date: "2026-08-25", hour: 9 });

const eligibleBase = {
  active: true as boolean | null,
  effectiveDeliveryDate: thursdayDelivery,
  hasRecipient: true,
  hasUsableMeals: true,
  now: jMinus2Morning,
  status: "active" as string | null,
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  transactionalEmailsEnabled: true,
  upcomingDeliveryEmailDeliveryDate: null as string | null,
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("59-email-upcoming-delivery-send");

  const upcomingSource = readRepoFile(
    "app/services/email/upcoming-delivery-email.server.ts",
  );
  const trySendBlock = upcomingSource.slice(
    upcomingSource.indexOf("export const trySendUpcomingDeliveryEmail"),
    upcomingSource.length,
  );

  ctx.scenario("A. Helper — trySendUpcomingDeliveryEmail défini");
  ctx.assertTrue(
    "trySendUpcomingDeliveryEmail exporté",
    upcomingSource.includes("export const trySendUpcomingDeliveryEmail"),
  );
  ctx.assertTrue(
    "réexport email.server",
    readRepoFile("app/services/email/email.server.ts").includes(
      "trySendUpcomingDeliveryEmail",
    ),
  );
  ctx.assertFalse(
    "pas de runner exporté",
    readRepoFile("app/services/email/email.server.ts").includes(
      "processDueUpcomingDelivery",
    ),
  );

  ctx.scenario("B. Send — sujet + template exacts");
  ctx.assertTrue(
    "sujet validé",
    trySendBlock.includes(
      'subject: "Votre prochaine box Mileyo arrive bientôt"',
    ),
  );
  ctx.assertTrue(
    "template upcoming-delivery",
    trySendBlock.includes('template: "upcoming-delivery"'),
  );
  ctx.assertTrue(
    "sendEmail import dynamique",
    trySendBlock.includes('await import("./email.server")'),
  );

  ctx.scenario("C. Eligibility — sélection éligible déclenchable");
  ctx.assertTrue(
    "sélection éligible après cutoff + fenêtre J-2",
    shouldSendUpcomingDeliveryEmail(eligibleBase),
  );

  ctx.scenario("D. Flag OFF — aucun send / aucun stamp");
  ctx.assertFalse(
    "flag off → shouldSend false",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      transactionalEmailsEnabled: false,
    }),
  );
  ctx.assertTrue(
    "flag via isMileyoTransactionalEmailEnabled",
    trySendBlock.includes("isMileyoTransactionalEmailEnabled()"),
  );
  ctx.assertTrue(
    "ENABLE_MILEYO_TRANSACTIONAL_EMAILS exporté",
    readRepoFile("app/services/email/email-client.server.ts").includes(
      ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
    ),
  );

  ctx.scenario("E. Recipient absent → skip");
  ctx.assertFalse(
    "recipient absent → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      hasRecipient: false,
    }),
  );
  ctx.assertTrue(
    "BoxOrder lookup pour fallback recipient",
    trySendBlock.includes("db.boxOrder.findUnique"),
  );
  ctx.assertTrue(
    "resolveSubscriptionEmailRecipient utilisé",
    trySendBlock.includes("resolveSubscriptionEmailRecipient"),
  );

  ctx.scenario("F. Idempotence — même cycle / nouveau cycle");
  ctx.assertTrue(
    "déjà envoyé même effectiveDeliveryDate",
    isUpcomingDeliveryEmailAlreadySentForDelivery({
      effectiveDeliveryDate: thursdayDelivery,
      upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
    }),
  );
  ctx.assertFalse(
    "shouldSend skip si déjà envoyé",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
    }),
  );
  ctx.assertTrue(
    "nouvelle effectiveDeliveryDate redevient éligible",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: "2026-09-03",
      now: parisAt({ date: "2026-09-01", hour: 9 }),
      upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
    }),
  );

  ctx.scenario("G. Stamp — success only, failure never");
  ctx.assertTrue(
    "stamp après send ok uniquement",
    trySendBlock.includes("upcomingDeliveryEmailDeliveryDate: effectiveDeliveryDate") &&
      trySendBlock.includes("upcomingDeliveryEmailSentAt: sentAt"),
  );
  ctx.assertTrue(
    "updateMany conditionnel delivery date",
    trySendBlock.includes("upcomingDeliveryEmailDeliveryDate: null") &&
      trySendBlock.includes(
        "upcomingDeliveryEmailDeliveryDate: { not: effectiveDeliveryDate }",
      ),
  );
  ctx.assertFalse(
    "sentAt jamais posé avant sendEmail",
    /upcomingDeliveryEmailSentAt:\s*sentAt[\s\S]{0,400}sendEmail/.test(
      trySendBlock,
    ),
  );
  ctx.assertTrue(
    "return failed sans stamp",
    trySendBlock.includes('status: "failed"') &&
      trySendBlock.indexOf("if (!result.ok)") <
        trySendBlock.indexOf("upcomingDeliveryEmailSentAt: sentAt"),
  );

  ctx.scenario("H. Cutoff / fenêtre — skip");
  ctx.assertFalse(
    "cutoff pas passé → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      now: parisAt({ date: "2026-08-24", hour: 12 }),
    }),
  );
  ctx.assertFalse(
    "fenêtre fermée J-3 → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      now: parisAt({ date: "2026-08-24", hour: 12 }),
    }),
  );
  ctx.assertFalse(
    "fenêtre fermée jour J → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      now: parisAt({ date: "2026-08-27", hour: 12 }),
    }),
  );

  ctx.scenario("I. Guards — inactive / paused");
  ctx.assertFalse(
    "paused → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      status: "paused",
    }),
  );
  ctx.assertFalse(
    "inactive → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      active: false,
    }),
  );

  ctx.scenario("J. Support shop-aware au build");
  ctx.assertTrue(
    "getMerchantSupportContact(shop) au send",
    trySendBlock.includes("getMerchantSupportContact(selection.shop)"),
  );
  ctx.assertTrue(
    "support passé au builder",
    trySendBlock.includes("supportHref: merchantSupport.href") &&
      trySendBlock.includes("supportLabel: merchantSupport.label"),
  );

  ctx.scenario("K. Pas de preuve BoxOrder obligatoire (EMAIL-5D)");
  ctx.assertFalse(
    "trySend n'exige pas BoxOrder présent",
    /if\s*\(\s*!order\s*\)/.test(trySendBlock),
  );
  ctx.assertFalse(
    "trySend sans guard simulated order",
    trySendBlock.includes("isSimulated"),
  );

  return finishSuite("59-email-upcoming-delivery-send", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
