#!/usr/bin/env npx tsx
/**
 * PRINT-ONLY — runbook cutover PROD (ops). Aucune écriture.
 * Inventaire migrations PROD vérifié en lecture seule le 2026-11-03.
 */
const verifiedPendingMigrationsProd = [
  {
    name: "20261007140000_harden_supabase_public_access",
    kind: "RLS / privileges",
    audited: true,
    riskSummary:
      "ENABLE RLS sans policies + REVOKE anon/authenticated sur tables serveur existantes. Pas de FORCE RLS. postgres/service_role non révoqués. Connexion PROD actuelle: current_user=postgres, rolbypassrls=true → Prisma continue. Table claim créée APRÈS: pas d’ENABLE RLS automatique (DEFAULT PRIVILEGES révoquent anon/authenticated pour tables créées par postgres).",
  },
  {
    name: "20261103180000_add_subscription_billing_cycle_claim",
    kind: "schema billing",
    audited: true,
    riskSummary:
      "CREATE TABLE SubscriptionBillingCycleClaim + UNIQUE(selectionId,billingCycleKey) + FK selection. Aucun débit.",
  },
  {
    name: "20261103190000_billing_cycle_claim_idempotency_unique",
    kind: "schema billing",
    audited: true,
    riskSummary: "UNIQUE(idempotencyKey). Aucun débit.",
  },
] as const;

const checklist = {
  mode: "checklist-only",
  verifiedAt: "2026-11-03T19:20:00Z",
  datasource: {
    prismaEnv: "DATABASE_URL + DIRECT_URL",
    prodObserved: {
      databaseUrlHost: "aws-1-eu-west-1.pooler.supabase.com:6543 (pgbouncer)",
      directUrlHost: "aws-1-eu-west-1.pooler.supabase.com:5432",
      database: "postgres",
      currentUser: "postgres",
      rolbypassrls: true,
      secrets: "NEVER print connection strings in logs/tickets",
    },
    migrateDeployMustUse: "DIRECT_URL (5432) — ne pas lancer DDL via pooler:6543",
  },
  pendingMigrationsProd: verifiedPendingMigrationsProd,
  migrateDeployWarning:
    "prisma migrate deploy applique TOUTES les migrations en attente (les 3). Impossible de n’appliquer que les claims sans la RLS avec cette commande. Refuser le cutover si une migration non auditée apparaît dans un nouveau `migrate status`.",
  transactionalSemantics: {
    prismaInstalled: "6.19.3",
    mythCorrected:
      "Prisma ne documente PAS une garantie universelle « 1 fichier = 1 transaction PG avec rollback auto ». ARCHITECTURE migrate: wrapping non default; users may add BEGIN/COMMIT.",
    empiricalOn6193: [
      "Multi-statement SANS BEGIN: échec mid-file → DDL absents (atomicité effective via batch PG / simple_query) + ligne _prisma_migrations finished=false (P3018)",
      "Multi-statement AVEC BEGIN/COMMIT: succès OK; échec mid-file → ROLLBACK restaure l’état pré-migration",
      "Prisma 7.4+ a perdu l’atomicité implicite (issue orm#30640) — BEGIN/COMMIT explicites ajoutés aux 3 fichiers non appliqués",
    ],
    filesNowWrapped: [
      "20261007140000_harden_supabase_public_access",
      "20261103180000_add_subscription_billing_cycle_claim",
      "20261103190000_billing_cycle_claim_idempotency_unique",
    ],
    failedMigrationRecovery: [
      "1. Ne pas relancer migrate deploy tant que P3018 non résolu",
      "2. Inspecter schéma (tables/indexes/RLS/grants) vs intention du fichier",
      "3. Si SQL entièrement rollback (attendu avec BEGIN/COMMIT): npx prisma migrate resolve --rolled-back \"<migration_name>\"",
      "4. Corriger le SQL si besoin, puis migrate deploy à nouveau",
      "5. Si état partiel (ne devrait pas arriver avec BEGIN): réparation manuelle SQL puis resolve --applied OU --rolled-back selon le cas — JAMAIS edit manuel de _prisma_migrations",
      "6. Rollback RLS échoué avec BEGIN: REVOKE annulés par ROLLBACK — aucun re-GRANT automatique n’est exécuté; les grants préexistants sont restaurés par PG",
      "7. Inverse ops si RLS appliquée avec succès puis retrait voulu: script GRANT+DISABLE RLS explicite (pas fourni par Prisma)",
    ],
    isolatedTests: [
      "scripts/migrate-transaction-semantics-probe.ts",
      "scripts/migrate-transaction-semantics-probe2.ts",
      "scripts/migrate-pending-three-isolated-apply.ts → /tmp/mileyo-migrate-three-isolated.json status 0 pour les 3",
    ],
  },
  backfillSqlFile: "scripts/billing-hossam-cycle2-backfill.sql",
  uniqueCollisionProof:
    "scripts/business-tests/114-billing-cycle-claim-pg-integration.test.ts (embedded Postgres) — ne pas provoquer UNIQUE en PROD",
  steps: [
    {
      id: "P0",
      title: "Préflight migrations + sauvegarde",
      danger: "READ-ONLY",
      commands: [
        {
          cmd: "export DATABASE_URL=\"$DIRECT_URL_PROD\" DIRECT_URL=\"$DIRECT_URL_PROD\"",
          env: "ops shell — valeurs depuis Vercel/Secret manager, jamais echo",
          expect: "env set without printing",
          verify: "echo only host redacted if needed",
        },
        {
          cmd: "npx prisma migrate status",
          env: "local/CI with DIRECT_URL→PROD 5432",
          expect:
            "Exactly these 3 pending: harden_supabase_public_access, add_subscription_billing_cycle_claim, billing_cycle_claim_idempotency_unique",
          verify:
            "Si liste ≠ 3 auditées → NO-GO immédiat. Comparer aussi SELECT migration_name FROM _prisma_migrations ORDER BY started_at;",
        },
        {
          cmd: "SELECT current_user, rolbypassrls FROM pg_roles r JOIN (SELECT current_user AS u) s ON r.rolname=s.u;",
          env: "SQL PROD read-only",
          expect: "postgres + bypassrls true (ou rôle équivalent audité)",
          verify: "sinon NO-GO RLS",
        },
        {
          cmd: "Backup/PITR timestamp + noter deployment URL actuel",
          env: "Supabase + Vercel",
          expect: "restore point",
          verify: "timestamp < mutations",
        },
      ],
    },
    {
      id: "P1",
      title: "Freeze Vercel Cron Jobs (projet)",
      danger: "PROD-MUTATION settings",
      commands: [
        {
          cmd: "Vercel → Project → Settings → Cron Jobs → Disable Cron Jobs",
          env: "Vercel UI",
          expect: "ALL project crons disabled (billing + email retries)",
          verify: "plus d’invocations; UI per-cron disable NON documenté — ne pas l’assumer",
        },
        {
          cmd: "Logs filter requestPath:/api/cron/process-subscriptions — attendre fin runs en vol",
          expect: "0 active billing cron",
          verify: "deploy n’interrompt pas un run déjà démarré",
        },
        {
          cmd: "Confirmer aucun autre deploy Production concurrent",
          env: "Vercel Deployments",
          expect: "pas de build/deploy en cours hors cutover",
          verify: "lock ops verbal/écrit",
        },
      ],
    },
    {
      id: "P2",
      title: "HOLD NBD Hossam (ACTIVE)",
      danger: "PROD-MUTATION Shopify+DB",
      commands: [
        {
          cmd: "subscriptionContractSetNextBillingDate → HOLD lointaine (ex 2026-12-31T22:05:00.000Z)",
          forbid: ["2026-11-06", "2026-11-07", "samedi commercial"],
          expect: "status ACTIVE; nextBillingDate=HOLD",
          verify: "re-query Shopify contract { status nextBillingDate }",
        },
        {
          cmd: "UPDATE SubscriptionMealSelection SET nextBillingDate=<HOLD> WHERE id='cmvl524nv0001jw08yu7toq1g'",
          expect: "1 row; DB=Shopify",
          verify: "SELECT id,status,active,\"nextBillingDate\",\"subscriptionContractId\" …",
        },
        {
          cmd: "GraphQL billingAttempts — count/createdAt après HOLD",
          expect: "toujours 5 attempts; aucun nouveau",
          verify: "pas de 6e prélèvement",
        },
      ],
      note: "Pas de déblocage auto. Pas d’ENABLE_STUCK_NBD_AUTO_REPAIR. Hold applicatif seulement après deploy code.",
    },
    {
      id: "P3",
      title: "Migrations (toutes les pending auditées)",
      danger: "PROD-MUTATION schema",
      prerequisite: "P0 status = 3 auditées; P1 freeze; 0 billing cron actif",
      commands: [
        {
          cmd: "DATABASE_URL=$DIRECT_URL_PROD DIRECT_URL=$DIRECT_URL_PROD npx prisma migrate deploy",
          env: "ops with DIRECT 5432 only",
          expect: "Applied 3 migrations listed above",
          verify: [
            "npx prisma migrate status → Database schema is up to date",
            "to_regclass SubscriptionBillingCycleClaim non-null",
            "pg_indexes UNIQUE selection+cycle + idempotency",
            "relrowsecurity true on hardened tables; claim table may be false (documented residual)",
            "npx prisma generate && smoke app boot / typecheck client",
          ],
        },
      ],
    },
    {
      id: "P4",
      title: "Backfill claim c2",
      danger: "PROD-MUTATION 1 INSERT",
      commands: [
        {
          cmd: "npx tsx scripts/billing-history-reconcile-dry-run.ts",
          expect: "1 proposed; shopifyOrderId gid://shopify/Order/8030041145672",
          verify: "4 duplicate anomalies kept as notes only",
        },
        {
          cmd: "Apply scripts/billing-hossam-cycle2-backfill.sql INSERT section only after prechecks",
          expect: "1 succeeded row c2",
          verify: "POSTCHECK SELECT = 1 row; do NOT probe UNIQUE violation in PROD",
        },
      ],
    },
    {
      id: "P5",
      title: "Deploy code testé (hold + cycleIndex)",
      danger: "PROD-MUTATION deploy",
      commands: [
        {
          cmd: "Deploy Production du SHA testé (122/122 + 113/114)",
          expect: "hold 26652508488 live; ENABLE_STUCK_NBD_AUTO_REPAIR unset/false; ENABLE_SHOPIFY_BILLING_TEST_BUTTON unset/false",
          verify: "deployment SHA = artefact testé; Cron Jobs still Disabled",
        },
      ],
    },
    {
      id: "P6",
      title: "Smoke SANS paiement",
      danger: "READ-ONLY",
      commands: [
        {
          cmd: "npx tsx scripts/billing-active-contracts-cycle-dry-run.ts",
          expect: "Hossam held; 0 billable_due; no writes",
          verify: "GraphQL attempts Hossam unchanged",
        },
        {
          cmd: "Portal resume / admin billing — message hold only",
          expect: "aucun subscriptionBillingAttemptCreate",
          verify: "logs + Shopify",
        },
      ],
      forbidSmoke: [
        "curl cron with valid secret while Enable Cron Jobs",
        "manual admin bill with test button",
        "Shopify billingAttemptCreate",
      ],
    },
    {
      id: "P7",
      title: "Réactivation cron",
      danger: "PROD-MUTATION — réactive billing auto non-held",
      prerequisite: "P3+P4+P5+P6 OK",
      commands: [
        {
          cmd: "Vercel → Enable Cron Jobs",
          expect: "process-subscriptions + process-email-retries",
          verify: "logs: Hossam incident_billing_hold; no create Hossam",
        },
      ],
    },
    {
      id: "P8",
      title: "Surveillance",
      danger: "READ-ONLY",
      commands: [
        {
          cmd: "2–3 ticks horaires + samedi 2026-11-07",
          expect: "~55 renouvellements cycleIndex; Hossam 0 new attempt",
          verify: "attempt count Hossam = 5",
        },
      ],
    },
    {
      id: "P9",
      title: "Rollback sûr",
      danger: "DESTRUCTIVE si mal fait",
      actions: [
        "Disable Cron Jobs (F-GLOBAL) immédiatement",
        "Garder claims table + row c2 + NBD HOLD + hold list",
        "Ne jamais Instant Rollback vers daily keys avec NBD stuck sans F-GLOBAL",
        "Ne pas DROP SubscriptionBillingCycleClaim",
        "RLS: ne pas rollback partiel non testé; restore PITR si besoin schéma",
      ],
    },
  ],
  goNoGo: {
    GO_requires: [
      "migrate status = exactement 3 migrations auditées ci-dessus",
      "ops accepte d’appliquer la RLS avec les claims (migrate deploy all-or-nothing)",
      "postgres (ou rôle) bypassrls confirmé",
      "F-GLOBAL freeze + 0 billing cron actif",
      "Hossam ACTIVE + NBD HOLD Shopify=DB + 5 attempts inchangés",
      "backfill SQL vérifié (Order/8030041145672) non encore exécuté jusqu’à P4",
      "deploy SHA = code testé; flags repair/test off",
      "réactivation seulement après P3–P6",
    ],
    NO_GO_if: [
      "migrate status montre une migration non auditée",
      "rôle DB sans bypassrls et RLS non acceptée",
      "6e billingAttempt Shopify après freeze/HOLD",
      "deploy concurrent ou SHA ≠ testé",
      "volonté d’appliquer seulement les 2 migrations claim via migrate deploy (impossible sans RLS)",
    ],
  },
};

console.log(JSON.stringify(checklist, null, 2));
