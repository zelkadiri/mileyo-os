/**
 * Business regression — EMAIL-4B explicit tracking + MealSelectionConfirmedEmail wiring.
 *
 * Builder first order, portal updateFutureMealSelection, change box, resume.
 * No Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
  hasExplicitMealSelectionForDelivery,
  isMealSelectionConfirmedAlreadySentForDelivery,
  shouldSendMealSelectionConfirmedEmail,
} from "../../app/services/email/email.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = async () => {
  const ctx = createBusinessTestContext("56-email-meal-selection-confirmed");

  const ordersSource = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const mealSelectionEmailSource = readRepoFile(
    "app/services/email/meal-selection-email.server.ts",
  );

  const createFirstBlock = ordersSource.slice(
    ordersSource.indexOf('if (decision === "create_first_subscription")'),
    ordersSource.indexOf("if (isRenewal && matchedSelection)"),
  );

  const updateFutureBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleUpdateFutureMealSelectionAction"),
    portalActionsSource.indexOf("export const handlePortalAction"),
  );

  const changeBoxBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleChangeSubscriptionBoxAction"),
    portalActionsSource.indexOf("const handleUpdateFutureMealSelectionAction"),
  );

  const resumeBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleResumeSubscriptionAction"),
    portalActionsSource.indexOf("const handleResumeSubscriptionAndPayAction"),
  );

  const resumePayBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleResumeSubscriptionAndPayAction"),
    portalActionsSource.indexOf("const handleChangeSubscriptionBoxAction"),
  );

  const markHelperBlock = mealSelectionEmailSource.slice(
    mealSelectionEmailSource.indexOf(
      "export const markMealSelectionExplicitForCurrentDelivery",
    ),
    mealSelectionEmailSource.indexOf(
      "export const trySendMealSelectionConfirmedEmail",
    ),
  );

  ctx.scenario("A. Helper central — tracking + confirmation");
  ctx.assertTrue(
    "markMealSelectionExplicitForCurrentDelivery défini",
    mealSelectionEmailSource.includes(
      "export const markMealSelectionExplicitForCurrentDelivery",
    ),
  );
  ctx.assertTrue(
    "trySendMealSelectionConfirmedEmail défini",
    mealSelectionEmailSource.includes(
      "export const trySendMealSelectionConfirmedEmail",
    ),
  );
  ctx.assertTrue(
    "tracking utilise projectActiveScheduledDeliveryDate",
    markHelperBlock.includes("resolveMealSelectionCycle"),
  );
  ctx.assertFalse(
    "mark helper sans sendEmail",
    markHelperBlock.includes("sendEmail"),
  );
  ctx.assertTrue(
    "mark skip si effectiveDeliveryDate inconnue",
    mealSelectionEmailSource.includes("unknown_effective_delivery_date"),
  );

  ctx.scenario("B. Première commande Builder — explicit tracking sans confirmation");
  ctx.assertTrue(
    "create_first_subscription appelle markMealSelectionExplicit",
    createFirstBlock.includes("markMealSelectionExplicitForCurrentDelivery"),
  );
  ctx.assertTrue(
    "mark après alignFirstOrderBillingWithDeliverySchedule",
    createFirstBlock.indexOf("alignFirstOrderBillingWithDeliverySchedule") <
      createFirstBlock.indexOf("markMealSelectionExplicitForCurrentDelivery"),
  );
  ctx.assertTrue(
    "mark avant ensureAndProcess / SUBSCRIPTION_CREATED",
    createFirstBlock.indexOf("markMealSelectionExplicitForCurrentDelivery") <
      createFirstBlock.indexOf("ensureAndProcessEmailEventImmediately") &&
      createFirstBlock.includes("EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED"),
  );
  ctx.assertFalse(
    "Builder n'appelle pas trySendMealSelectionConfirmedEmail",
    createFirstBlock.includes("trySendMealSelectionConfirmedEmail"),
  );
  ctx.assertTrue(
    "Builder conserve SubscriptionCreatedEmail via ensureAndProcess",
    createFirstBlock.includes("ensureAndProcessEmailEventImmediately") &&
      createFirstBlock.includes("EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED"),
  );

  ctx.scenario("C. Portal updateFutureMealSelection — ordre persist → track → email");
  ctx.assertTrue(
    "updateFuture appelle mark après prisma update selectedMeals",
    updateFutureBlock.indexOf("selectedMeals: validation.titles") <
      updateFutureBlock.indexOf("markMealSelectionExplicitForCurrentDelivery"),
  );
  ctx.assertTrue(
    "updateFuture appelle ensureAndProcess après mark",
    updateFutureBlock.indexOf("markMealSelectionExplicitForCurrentDelivery") <
      updateFutureBlock.indexOf("ensureAndProcessEmailEventImmediately"),
  );
  ctx.assertTrue(
    "updateFuture intent loggé",
    updateFutureBlock.includes('intent: "updateFutureMealSelection"'),
  );
  ctx.assertFalse(
    "updateFuture sans mark avant validation",
    updateFutureBlock.indexOf("markMealSelectionExplicitForCurrentDelivery") <
      updateFutureBlock.indexOf("validateMealSelection"),
  );

  ctx.scenario("D. Confirmation email — règles trySend");
  ctx.assertTrue(
    "sujet confirmé",
    mealSelectionEmailSource.includes(
      'subject: "Votre sélection de repas est confirmée"',
    ),
  );
  ctx.assertTrue(
    "template meal-selection-confirmed",
    mealSelectionEmailSource.includes('template: "meal-selection-confirmed"'),
  );
  ctx.assertTrue(
    "idempotence mealSelectionConfirmedDeliveryDate après send ok",
    mealSelectionEmailSource.includes("mealSelectionConfirmedDeliveryDate: effectiveDeliveryDate"),
  );
  ctx.assertTrue(
    "updateMany conditionnel delivery date",
    mealSelectionEmailSource.includes("mealSelectionConfirmedDeliveryDate: null") &&
      mealSelectionEmailSource.includes(
        "mealSelectionConfirmedDeliveryDate: { not: effectiveDeliveryDate }",
      ),
  );
  ctx.assertFalse(
    "sentAt jamais posé avant sendEmail",
    /mealSelectionConfirmedEmailSentAt:\s*sentAt[\s\S]{0,400}sendEmail/.test(
      mealSelectionEmailSource,
    ),
  );
  ctx.assertTrue(
    "flag via isMileyoTransactionalEmailEnabled",
    mealSelectionEmailSource.includes("isMileyoTransactionalEmailEnabled()"),
  );

  ctx.scenario("E. Eligibility — premier save cycle vs second save");
  ctx.assertTrue(
    "premier save éligible",
    shouldSendMealSelectionConfirmedEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: true,
      hasRecipient: true,
      mealSelectionConfirmedDeliveryDate: null,
      status: "active",
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "second save même cycle refusé",
    shouldSendMealSelectionConfirmedEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: true,
      hasRecipient: true,
      mealSelectionConfirmedDeliveryDate: "2026-08-27",
      status: "active",
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertTrue(
    "nouveau cycle redevient éligible",
    shouldSendMealSelectionConfirmedEmail({
      active: true,
      effectiveDeliveryDate: "2026-09-03",
      hasExplicitSelection: hasExplicitMealSelectionForDelivery({
        effectiveDeliveryDate: "2026-09-03",
        mealSelectionLastExplicitDeliveryDate: "2026-09-03",
      }),
      hasRecipient: true,
      mealSelectionConfirmedDeliveryDate: "2026-08-27",
      status: "active",
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("F. Flag OFF / recipient absent — tracking séparé de l'email");
  ctx.assertFalse(
    "flag off → pas d'email",
    shouldSendMealSelectionConfirmedEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: true,
      hasRecipient: true,
      mealSelectionConfirmedDeliveryDate: null,
      status: "active",
      transactionalEmailsEnabled: false,
    }),
  );
  ctx.assertFalse(
    "recipient absent → pas d'email",
    shouldSendMealSelectionConfirmedEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: true,
      hasRecipient: false,
      mealSelectionConfirmedDeliveryDate: null,
      status: "active",
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertTrue(
    "mark helper indépendant du flag email",
    !mealSelectionEmailSource
      .slice(
        mealSelectionEmailSource.indexOf(
          "export const markMealSelectionExplicitForCurrentDelivery",
        ),
        mealSelectionEmailSource.indexOf(
          "export const trySendMealSelectionConfirmedEmail",
        ),
      )
      .includes("isMileyoTransactionalEmailEnabled"),
  );

  ctx.scenario("G. Cutoff / validation — pas de branchement prématuré");
  ctx.assertTrue(
    "updateFuture blockedResponse avant prisma update",
    updateFutureBlock.indexOf("getPortalModificationBlockResponse") <
      updateFutureBlock.indexOf("prisma.subscriptionMealSelection.update"),
  );
  ctx.assertTrue(
    "validation error avant prisma update",
    updateFutureBlock.indexOf('if ("error" in validation)') <
      updateFutureBlock.indexOf("prisma.subscriptionMealSelection.update"),
  );
  ctx.assertFalse(
    "mark absent avant validation",
    updateFutureBlock.indexOf("markMealSelectionExplicitForCurrentDelivery") <
      updateFutureBlock.indexOf("validateMealSelection"),
  );

  ctx.scenario("H. Change box — tracking sans confirmation");
  ctx.assertTrue(
    "change box appelle mark après persist repas",
    changeBoxBlock.indexOf("selectedMeals: validation.titles") <
      changeBoxBlock.indexOf("markMealSelectionExplicitForCurrentDelivery"),
  );
  ctx.assertFalse(
    "change box sans trySendMealSelectionConfirmedEmail",
    changeBoxBlock.includes("trySendMealSelectionConfirmedEmail"),
  );
  ctx.assertTrue(
    "change box intent loggé",
    changeBoxBlock.includes('intent: "changeSubscriptionBox"'),
  );

  ctx.scenario("I. Resume — tracking après succès, date finale, sans confirmation");
  ctx.assertTrue(
    "resume schedule_only mark après completePortalScheduledResume ok",
    resumeBlock.indexOf("completePortalScheduledResume") <
      resumeBlock.indexOf("markMealSelectionExplicitForCurrentDelivery"),
  );
  ctx.assertTrue(
    "resume mark après resumeResult.ok check",
    resumeBlock.indexOf("if (!resumeResult.ok)") <
      resumeBlock.indexOf("markMealSelectionExplicitForCurrentDelivery"),
  );
  ctx.assertFalse(
    "resume sans trySendMealSelectionConfirmedEmail",
    resumeBlock.includes("trySendMealSelectionConfirmedEmail"),
  );
  ctx.assertTrue(
    "resume pay mark après scheduleResult.ok",
    resumePayBlock.indexOf("scheduleResult.ok") <
      resumePayBlock.indexOf("markMealSelectionExplicitForCurrentDelivery"),
  );
  ctx.assertFalse(
    "resume pay sans confirmation email",
    resumePayBlock.includes("trySendMealSelectionConfirmedEmail"),
  );
  ctx.assertTrue(
    "resume pay mark absent avant billing success path",
    !resumePayBlock.includes("markMealSelectionExplicitForCurrentDelivery") ||
      resumePayBlock.indexOf("scheduleResult.ok") <
        resumePayBlock.lastIndexOf("markMealSelectionExplicitForCurrentDelivery"),
  );

  ctx.scenario("J. Première commande — pas de mealSelectionConfirmedDeliveryDate");
  ctx.assertFalse(
    "Builder ne pose pas mealSelectionConfirmedDeliveryDate",
    createFirstBlock.includes("mealSelectionConfirmedDeliveryDate"),
  );
  ctx.assertTrue(
    "explicit tracking distinct de confirmed delivery date",
    mealSelectionEmailSource.includes("mealSelectionLastExplicitDeliveryDate") &&
      isMealSelectionConfirmedAlreadySentForDelivery({
        effectiveDeliveryDate: "2026-08-27",
        mealSelectionConfirmedDeliveryDate: null,
      }) === false,
  );

  ctx.scenario("K. Feature flag export");
  ctx.assertTrue(
    "ENABLE_MILEYO_TRANSACTIONAL_EMAILS exporté",
    readRepoFile("app/services/email/email-client.server.ts").includes(
      ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
    ),
  );

  return finishSuite("56-email-meal-selection-confirmed", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
