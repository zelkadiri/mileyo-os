/**
 * Business regression — EMAIL-6G-A admin email observability (read-only).
 *
 * Static + pure formatter checks. No EmailEvent writes. No Prisma migration.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_TYPE,
} from "../../app/constants/emailEvent";
import {
  buildEmailEventTimeline,
  computeSuccessRate24h,
  formatEmailEventStatusLabel,
  formatEmailEventTypeLabel,
  formatEmailNextOrSentLabel,
  formatSafeMetaLabel,
  formatSafeMetaValue,
  formatSuccessRatePercent,
  isEmailEventExhausted,
  isEmailEventStaleProcessing,
  maskRecipientEmail,
  parseEmailAdminEventTypeFilter,
  parseEmailAdminPage,
  parseEmailAdminPeriodFilter,
  parseEmailAdminStatusFilter,
  parseEmailEventSafeMeta,
  truncateErrorMessage,
  truncateForTable,
} from "../../app/features/emails/emails-formatters";
import { EMAIL_ADMIN_PAGE_SIZE } from "../../app/features/emails/emails-types";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const countOccurrences = (source: string, pattern: RegExp): number =>
  (source.match(pattern) || []).length;

const FORBIDDEN_WRITE_ACTIONS = [
  "Retry",
  "Resend",
  "Cancel",
  "Reset",
  "Delete",
  "method=\"post\"",
  "method='post'",
];

const FORBIDDEN_MIGRATION_TOUCH = [
  'prisma migrate',
  "schema.prisma",
];

const runSuite = async () => {
  const ctx = createBusinessTestContext("76-email-admin-observability");

  ctx.scenario("A. Fichiers feature / route / nav / runner");
  const requiredFiles = [
    "app/routes/app.emails.tsx",
    "app/features/emails/emails-types.ts",
    "app/features/emails/emails-data.server.ts",
    "app/features/emails/emails-formatters.ts",
    "app/features/emails/emails-render.tsx",
    "app/features/emails/emails-styles.ts",
    "scripts/business-tests/76-email-admin-observability.test.ts",
  ];
  for (const relativePath of requiredFiles) {
    ctx.assertTrue(
      `${relativePath} existe`,
      existsSync(join(repoRoot, relativePath)),
    );
  }

  const nav = readRepoFile("app/routes/app.tsx");
  ctx.assertTrue(
    "Nav contient Emails → /app/emails",
    nav.includes('href="/app/emails"') && nav.includes(">Emails</s-link>"),
  );

  const route = readRepoFile("app/routes/app.emails.tsx");
  ctx.assertTrue(
    "Route délègue au loader feature (pas de logique métier inline)",
    route.includes("loadEmailsPageData") &&
      route.includes("emails-render") &&
      !route.includes("db.emailEvent.update") &&
      !route.includes("db.emailEvent.create"),
  );

  const runner = readRepoFile(
    "scripts/business-tests/00-run-business-regression-suite.ts",
  );
  ctx.assertEqual(
    "Suite 76 enregistrée une seule fois dans le runner",
    countOccurrences(runner, /76-email-admin-observability\.test\.ts/g),
    1,
  );

  ctx.scenario("B. Read-only — aucune action write dans UI / data");
  const render = readRepoFile("app/features/emails/emails-render.tsx");
  const dataServer = readRepoFile("app/features/emails/emails-data.server.ts");

  for (const token of FORBIDDEN_WRITE_ACTIONS) {
    if (token.startsWith("method=")) {
      ctx.assertFalse(
        `Render n'utilise pas ${token}`,
        render.toLowerCase().includes(token),
      );
    } else {
      // Allow words in explanatory copy like "aucun retry" but forbid action buttons.
      const buttonish = new RegExp(
        `>(\\s*${token}\\s*)<|type=["']submit["'][^>]*>\\s*${token}`,
        "i",
      );
      ctx.assertFalse(
        `Pas de bouton d'action ${token}`,
        buttonish.test(render) ||
          render.includes(`>${token}<`) ||
          render.includes(`"${token}"`),
      );
    }
  }

  ctx.assertTrue(
    "Copy explicite lecture seule / aucun retry",
    (render.includes("Lecture seule") ||
      render.includes("lecture seule") ||
      render.includes("aucun retry")) &&
      !/>\s*Retry\s*</.test(render) &&
      !/>\s*Resend\s*</.test(render),
  );

  ctx.assertFalse(
    "Data server n'appelle pas emailEvent.update",
    dataServer.includes("emailEvent.update") ||
      dataServer.includes("emailEvent.create") ||
      dataServer.includes("emailEvent.delete"),
  );
  ctx.assertTrue(
    "Data server lit via findMany/count/findFirst",
    dataServer.includes("findMany") &&
      dataServer.includes("count") &&
      dataServer.includes("authenticate.admin"),
  );

  ctx.scenario("C. Métriques + exhausted + pagination");
  ctx.assertTrue(
    "Métriques sent/pending/failed/processing présentes dans data",
    dataServer.includes("sentLast24h") &&
      dataServer.includes("pending") &&
      dataServer.includes("failed") &&
      dataServer.includes("processing") &&
      dataServer.includes("exhausted"),
  );
  ctx.assertTrue(
    "Métriques chargées hors tableau paginé (loadMetrics)",
    dataServer.includes("loadMetrics") &&
      dataServer.includes("EMAIL_ADMIN_PAGE_SIZE"),
  );
  ctx.assertEqual(
    "Page size défaut = 25",
    EMAIL_ADMIN_PAGE_SIZE,
    25,
  );
  ctx.assertTrue(
    "Tri createdAt desc",
    dataServer.includes('orderBy: { createdAt: "desc" }'),
  );

  ctx.assertTrue(
    "Exhausted = failed + attemptCount >= MAX",
    isEmailEventExhausted({
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS,
      status: EMAIL_EVENT_STATUS.FAILED,
    }),
  );
  ctx.assertFalse(
    "Failed avec attempts < MAX n'est pas exhausted",
    isEmailEventExhausted({
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS - 1,
      status: EMAIL_EVENT_STATUS.FAILED,
    }),
  );
  ctx.assertFalse(
    "Sent n'est jamais exhausted",
    isEmailEventExhausted({
      attemptCount: 99,
      status: EMAIL_EVENT_STATUS.SENT,
    }),
  );
  ctx.assertEqual(
    "Label exhausted FR",
    formatEmailEventStatusLabel({
      attemptCount: EMAIL_EVENT_MAX_ATTEMPTS,
      status: EMAIL_EVENT_STATUS.FAILED,
    }),
    "Épuisé",
  );

  ctx.assertEqual(
    "Success rate 24h = sent/(sent+failed)",
    computeSuccessRate24h({ failed: 1, sent: 3 }),
    0.75,
  );
  ctx.assertNull(
    "Success rate null si dénominateur 0",
    computeSuccessRate24h({ failed: 0, sent: 0 }),
  );
  ctx.assertEqual(
    "Success rate empty state UI = Aucune donnée",
    formatSuccessRatePercent(null),
    "Aucune donnée",
  );
  ctx.assertEqual(
    "Success rate formaté en %",
    formatSuccessRatePercent(0.75),
    "75%",
  );

  ctx.scenario("D. Labels types FR");
  ctx.assertEqual(
    "payment_failed → Paiement échoué",
    formatEmailEventTypeLabel(EMAIL_EVENT_TYPE.PAYMENT_FAILED),
    "Paiement échoué",
  );
  ctx.assertEqual(
    "subscription_created → Abonnement créé",
    formatEmailEventTypeLabel(EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED),
    "Abonnement créé",
  );
  ctx.assertEqual(
    "upcoming_delivery → Livraison à venir",
    formatEmailEventTypeLabel(EMAIL_EVENT_TYPE.UPCOMING_DELIVERY),
    "Livraison à venir",
  );
  ctx.assertEqual(
    "payment_recovered label",
    formatEmailEventTypeLabel(EMAIL_EVENT_TYPE.PAYMENT_RECOVERED),
    "Paiement récupéré",
  );
  ctx.assertEqual(
    "subscription_paused label",
    formatEmailEventTypeLabel(EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED),
    "Abonnement mis en pause",
  );
  ctx.assertEqual(
    "meal_selection_confirmed label",
    formatEmailEventTypeLabel(EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED),
    "Sélection de repas confirmée",
  );
  ctx.assertEqual(
    "meal_selection_reminder label",
    formatEmailEventTypeLabel(EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER),
    "Rappel sélection de repas",
  );

  ctx.scenario("E. Recipient masking");
  ctx.assertEqual(
    "Mask john.doe@gmail.com",
    maskRecipientEmail("john.doe@gmail.com"),
    "j***@gmail.com",
  );
  ctx.assertEqual(
    "Mask a@b.co",
    maskRecipientEmail("a@b.co"),
    "a***@b.co",
  );
  ctx.assertEqual("Mask null → —", maskRecipientEmail(null), "—");
  ctx.assertEqual("Mask invalid → ***", maskRecipientEmail("not-an-email"), "***");
  ctx.assertTrue(
    "Liste utilise recipientMasked / pas d'email brut en colonne principale",
    render.includes("recipientMasked") &&
      !render.includes("recipientEmail}") &&
      dataServer.includes("maskRecipientEmail"),
  );

  ctx.scenario("F. Filtres / search / pagination params");
  ctx.assertEqual(
    "status filter pending",
    parseEmailAdminStatusFilter("pending"),
    "pending",
  );
  ctx.assertEqual(
    "status filter invalid → all",
    parseEmailAdminStatusFilter("nope"),
    "all",
  );
  ctx.assertEqual(
    "eventType filter",
    parseEmailAdminEventTypeFilter("payment_failed"),
    "payment_failed",
  );
  ctx.assertEqual(
    "period 7d",
    parseEmailAdminPeriodFilter("7d"),
    "7d",
  );
  ctx.assertEqual("page parse", parseEmailAdminPage("3"), 3);
  ctx.assertEqual("page invalid → 1", parseEmailAdminPage("abc"), 1);

  ctx.assertTrue(
    "Filtres status/eventType/period/q dans data where",
    dataServer.includes("parseEmailAdminStatusFilter") &&
      dataServer.includes("parseEmailAdminEventTypeFilter") &&
      dataServer.includes("parseEmailAdminPeriodFilter") &&
      dataServer.includes("contains: filters.q"),
  );
  ctx.assertTrue(
    "Search matches recipient/reference/provider/idempotency",
    dataServer.includes("recipientEmail") &&
      dataServer.includes("referenceId") &&
      dataServer.includes("providerId") &&
      dataServer.includes("idempotencyKey") &&
      dataServer.includes("contains: filters.q"),
  );
  ctx.assertTrue(
    "UI filtres GET Form",
    render.includes('method="get"') &&
      render.includes('name="status"') &&
      render.includes('name="eventType"') &&
      render.includes('name="period"') &&
      render.includes('name="q"'),
  );

  ctx.scenario("G. Detail / timeline / meta / errors / next retry / stale");
  ctx.assertTrue(
    "Detail via query event= + drawer",
    render.includes("detail") &&
      (render.includes("drawer") || render.includes("Drawer") || render.includes("aside")) &&
      dataServer.includes('url.searchParams.get("event")'),
  );
  ctx.assertTrue(
    "Detail affiche idempotency / provider / error / meta",
    render.includes("idempotencyKey") &&
      render.includes("providerId") &&
      render.includes("lastErrorCode") &&
      render.includes("lastErrorMessage") &&
      render.includes("metaSafe"),
  );

  const timeline = buildEmailEventTimeline({
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    lastAttemptAt: new Date("2026-01-01T11:00:00.000Z"),
    sentAt: new Date("2026-01-01T11:05:00.000Z"),
    status: EMAIL_EVENT_STATUS.SENT,
  });
  ctx.assertTrue(
    "Timeline contient Créé + Envoyé (timestamps réels)",
    timeline.some((s) => s.label === "Créé") &&
      timeline.some((s) => s.label === "Envoyé") &&
      timeline.some((s) => s.label === "Dernière tentative"),
  );
  ctx.assertTrue(
    "UI précise que la timeline n'est pas un historique complet",
    render.includes("pas un historique complet") ||
      render.includes("Jalons connus"),
  );

  const okMeta = parseEmailEventSafeMeta(
    JSON.stringify({
      deliveryDate: "2026-08-20",
      orderId: "ord_1",
      secretToken: "SHOULD_NOT_APPEAR",
    }),
  );
  ctx.assertTrue(
    "metaJson safe — deliveryDate + orderId",
    okMeta.metaSafe?.deliveryDate === "2026-08-20" &&
      okMeta.metaSafe?.orderId === "ord_1" &&
      okMeta.metaSafe?.secretToken == null &&
      okMeta.metaUnavailable === false,
  );
  const badMeta = parseEmailEventSafeMeta("{not-json");
  ctx.assertTrue(
    "metaJson invalide → unavailable",
    badMeta.metaUnavailable === true && badMeta.metaSafe == null,
  );
  ctx.assertTrue(
    "UI affiche Métadonnées indisponibles",
    render.includes("Métadonnées indisponibles"),
  );

  ctx.assertEqual(
    "Error truncée",
    truncateErrorMessage("x".repeat(100), 80).endsWith("…"),
    true,
  );
  ctx.assertEqual(
    "pending nextAttemptAt null → Dès que possible",
    formatEmailNextOrSentLabel({
      nextAttemptAt: null,
      sentAt: null,
      status: EMAIL_EVENT_STATUS.PENDING,
    }),
    "Dès que possible",
  );
  ctx.assertEqual(
    "failed ne montre pas next retry",
    formatEmailNextOrSentLabel({
      nextAttemptAt: new Date("2026-01-02T00:00:00.000Z"),
      sentAt: null,
      status: EMAIL_EVENT_STATUS.FAILED,
    }),
    "—",
  );

  const staleNow = new Date("2026-01-01T12:00:00.000Z");
  ctx.assertTrue(
    "Stale processing > 10 min",
    isEmailEventStaleProcessing({
      now: staleNow,
      processingStartedAt: new Date("2026-01-01T11:49:00.000Z"),
      status: EMAIL_EVENT_STATUS.PROCESSING,
    }),
  );
  ctx.assertFalse(
    "Processing frais n'est pas stale",
    isEmailEventStaleProcessing({
      now: staleNow,
      processingStartedAt: new Date("2026-01-01T11:55:00.000Z"),
      status: EMAIL_EVENT_STATUS.PROCESSING,
    }),
  );
  ctx.assertTrue(
    "UI warning Traitement potentiellement bloqué",
    render.includes("Traitement potentiellement bloqué"),
  );

  ctx.scenario("H. Empty states + status badges");
  ctx.assertTrue(
    "Empty states copy",
    render.includes("Aucun événement email") &&
      render.includes("Aucun résultat pour ces filtres") &&
      render.includes("Aucun email en échec"),
  );
  for (const status of [
    EMAIL_EVENT_STATUS.PENDING,
    EMAIL_EVENT_STATUS.PROCESSING,
    EMAIL_EVENT_STATUS.SENT,
    EMAIL_EVENT_STATUS.FAILED,
    EMAIL_EVENT_STATUS.CANCELLED,
  ]) {
    ctx.assertTrue(
      `Badge label pour ${status}`,
      formatEmailEventStatusLabel({ attemptCount: 0, status }).length > 0,
    );
  }

  ctx.scenario("I. Pas de migration Prisma / schema intact côté feature");
  for (const token of FORBIDDEN_MIGRATION_TOUCH) {
    ctx.assertFalse(
      `Feature emails ne référence pas ${token}`,
      dataServer.includes(token) || render.includes(token),
    );
  }
  ctx.assertTrue(
    "schema.prisma EmailEvent existe toujours (aucune migration requise)",
    readRepoFile("prisma/schema.prisma").includes("model EmailEvent"),
  );

  ctx.scenario("J. Auth admin Shopify");
  ctx.assertTrue(
    "Loader authentifie admin",
    dataServer.includes("authenticate.admin"),
  );
  ctx.assertFalse(
    "Pas de route publique emails hors /app",
    existsSync(join(repoRoot, "app/routes/emails.tsx")) ||
      existsSync(join(repoRoot, "app/routes/api.emails.tsx")),
  );

  ctx.scenario("K. UX polish structurelle (EMAIL-6G-A final)");
  const styles = readRepoFile("app/features/emails/emails-styles.ts");

  ctx.assertTrue(
    "Intro simplifiée opérateur",
    render.includes("Suivez l’état des emails transactionnels Mileyo.") &&
      render.includes("Données en lecture seule.") &&
      !render.includes("Observabilité des EmailEvent Resend") &&
      !render.includes("indépendamment du tableau paginé"),
  );
  ctx.assertTrue(
    "Métriques cards présentes (labels lisibles)",
    render.includes("Envoyés") &&
      render.includes("En attente") &&
      render.includes("Échoués") &&
      render.includes("Épuisés") &&
      render.includes("Taux de succès") &&
      !render.includes("sent / (sent + failed)"),
  );
  ctx.assertTrue(
    "Grille métriques responsive (minmax)",
    styles.includes("minmax(") && styles.includes("summaryGridStyle"),
  );
  ctx.assertTrue(
    "Colonne échéance renommée (Envoi / prochain essai)",
    render.includes("Envoi / prochain essai") &&
      !render.includes("Retry / Envoi"),
  );
  ctx.assertTrue(
    "Référence table tronquée / layout-safe",
    render.includes("truncateForTable") &&
      styles.includes("truncateCellStyle") &&
      truncateForTable("subscription_selection:cmsykabcdefghijklmnop", 28)
        .includes("…"),
  );
  ctx.assertTrue(
    "Drawer header opérateur (type humain + résumé)",
    render.includes("formatEmailEventTypeLabel(detail.eventType)") &&
      render.includes("formatAttemptCountLabel") &&
      render.includes("Créé le") &&
      !render.includes("Détail EmailEvent"),
  );
  ctx.assertTrue(
    "Drawer sections État / Destinataire / Références / Erreur / Métadonnées / Jalons",
    render.includes(">État<") &&
      render.includes(">Destinataire<") &&
      render.includes("Références techniques") &&
      render.includes(">Erreur<") &&
      render.includes(">Métadonnées<") &&
      render.includes("Jalons connus"),
  );
  ctx.assertTrue(
    "Section erreur + ids techniques stylés",
    styles.includes("errorPanelStyle") &&
      styles.includes("techIdBlockStyle") &&
      render.includes("errorPanelStyle") &&
      render.includes("techIdBlockStyle"),
  );
  ctx.assertTrue(
    "Meta labels humains centralisés",
    formatSafeMetaLabel("deliveryDate") === "Date de livraison" &&
      formatSafeMetaValue("deliveryDate", "2026-09-03") === "03/09/2026" &&
      render.includes("formatSafeMetaLabel"),
  );
  ctx.assertTrue(
    "Jalons — disclaimer muted + timeline",
    render.includes("pas un historique complet") &&
      styles.includes("timelineDisclaimerStyle"),
  );
  ctx.assertTrue(
    "Drawer width desktop ~420–480px",
    /width:\s*"min\(4[2-8]0px,\s*100vw\)"/.test(styles),
  );
  ctx.assertTrue(
    "Read-only garanti (pas de write actions)",
    !render.includes("method=\"post\"") &&
      !/>\s*Retry\s*</.test(render) &&
      !/>\s*Cancel\s*</.test(render) &&
      !/>\s*Delete\s*</.test(render),
  );

  const exitCode = finishSuite("76-email-admin-observability", ctx);
  process.exit(exitCode);
};

runSuite().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
