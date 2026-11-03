#!/usr/bin/env npx tsx
/**
 * PRINT-ONLY — procédure d’urgence Hossam (P0).
 * Ne connecte pas PROD, ne mute pas Shopify, ne déploie pas.
 *
 * Source de vérité freeze Vercel (docs 2026) :
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs
 * - UI "Disable Cron Jobs" = **projet entier** (tous les crons).
 * - Suppression individuelle = éditer vercel.json + redéployer (pas prouvé via UI).
 */
const procedure = {
  mode: "operator-runbook-only",
  contractId: "26652508488",
  selectionId: "cmvl524nv0001jw08yu7toq1g",
  shop: "4pvhfk-d8.myshopify.com",
  keepStatus: "ACTIVE",
  vercelDocsFact: {
    uiDisableCronJobs: "project-wide — disables ALL crons until explicitly re-enabled",
    uiPerCronDisable: "NOT documented / NOT assumed",
    perCronRemoval: "edit vercel.json remove path + redeploy",
    runningInvocations:
      "a new deployment does NOT interrupt an already-running cron invocation",
    instantRollback:
      "restores cron definitions of rolled-back deployment; project Disable Cron Jobs setting is preserved",
  },
  doNot: [
    "pause / cancel le contrat",
    "refund automatique",
    "prétendre qu’un cron individuel est désactivable via l’UI Vercel sans preuve",
    "avancer nextBillingDate vers le prochain samedi/hebdo commercial (ex. 2026-11-06/07)",
    "déployer le nouveau moteur en pensant que cela suffit sans freeze + NBD hold",
  ],
  steps: [
    {
      id: "E0",
      title: "Choisir la méthode de freeze (obligatoire avant E2)",
      methods: [
        {
          id: "F-GLOBAL",
          preferredWhen: "besoin immédiat sans redéploiement ; accepter pause email retries",
          how: [
            "Vercel → Project Mileyo → Settings → Cron Jobs → Disable Cron Jobs",
            "Vérifier que le bouton / état indique cron jobs disabled for the project",
          ],
          impact: [
            "process-subscriptions STOP (billing + recovery cron)",
            "process-email-retries STOP (retries emails transactionnels)",
            "persiste à travers Instant Rollback jusqu’à réactivation manuelle",
          ],
          prodMutation: "settings projet Vercel (pas Shopify/DB)",
        },
        {
          id: "F-SELECTIVE",
          preferredWhen: "garder process-email-retries ; accepter un redéploiement freeze-only",
          how: [
            "Sur une branche freeze: vercel.json ne conserve QUE process-email-retries",
            "Redéployer PRODUCTION avec ce vercel.json (sans nouveau billing engine)",
            "Vercel Settings → Cron Jobs: confirmer que process-subscriptions a disparu de la liste active",
            "Attendre la fin de toute invocation process-subscriptions déjà en cours (logs)",
          ],
          impact: [
            "billing/recovery cron stoppés après redéploiement + fin des runs en vol",
            "email retries continuent",
          ],
          prodMutation: "DEPLOY PROD (configuration crons)",
          caveat:
            "Ce n’est PAS un disable UI par cron. C’est une suppression de config + deploy.",
        },
        {
          id: "F-SECRET",
          preferredWhen: "dernier recours",
          how: [
            "Rotation temporaire CRON_SECRET (Vercel env Production)",
            "Les deux endpoints protégés renvoient 401 jusqu’à restauration",
          ],
          impact: ["billing + email retries cassés"],
          prodMutation: "env Vercel",
        },
      ],
      recommendation:
        "Cutover court: F-GLOBAL (rapide, documenté, kill switch durable). Si emails critiques: F-SELECTIVE puis F-GLOBAL en backup.",
    },
    {
      id: "E1",
      title: "Garantir qu’aucun worker facturation ancien n’est encore en cours",
      how: [
        "Après F-GLOBAL ou F-SELECTIVE: Vercel → Logs filtrer requestPath:/api/cron/process-subscriptions",
        "Confirmer: plus de nouvelle invocation après disable/deploy; aucune exécution active en cours",
        "Attendre ≥ 1 fenêtre horaire ou durée max de la function avant migrations si un run était actif",
      ],
      why: "Vercel: Creating a new deployment will not interrupt your running cron jobs.",
    },
    {
      id: "E2",
      title: "Hold NBD Hossam (ACTIVE conservé) — MUTATION PROD manuelle",
      why: "NBD Shopify+local encore due (2026-10-30T16:00:00Z) → portal resume / ancien worker peuvent encore tenter un débit tant que le hold code n’est pas déployé.",
      how: [
        "Shopify Admin GraphQL subscriptionContractSetNextBillingDate → HOLD lointaine (ex. 2026-12-31T23:05:00+01:00), PAS 2026-11-06/07",
        "UPDATE SubscriptionMealSelection.nextBillingDate en miroir (même instant)",
        "Vérifier lecture: status ACTIVE; Shopify NBD = DB; aucun nouvel billingAttempt",
      ],
      prodMutation: true,
      note: "Ce script ne l’exécute pas.",
    },
    {
      id: "E3",
      title: "Vérification anti-débit Hossam",
      how: [
        "GraphQL: contract status ACTIVE, nextBillingDate = HOLD",
        "GraphQL: billingAttempts créés après E2 = aucun",
        "Logs: pas de process-subscriptions post-freeze (ou 401 si F-SECRET)",
      ],
    },
    {
      id: "E4",
      title: "Ensuite — cutover code",
      how: [
        "Suivre scripts/billing-cutover-checklist.ts (runbook détaillé)",
        "Hold applicatif actif seulement APRÈS déploiement du bundle cycleIndex",
        "Backfill claim c2 avant réactivation cron",
      ],
    },
  ],
  nonCronChargePathsDuringCutover: {
    portalResume: {
      risk: "ÉLEVÉ pour Hossam tant que NBD due + code ancien",
      mitigation: "E2 NBD HOLD immédiat; après deploy: isSubscriptionBillingIncidentHeld",
    },
    adminBillingTest: {
      risk: "seulement si ENABLE_SHOPIFY_BILLING_TEST_BUTTON=true en Production",
      mitigation:
        "Vérifier env PROD = unset/false; après deploy getSelectionSkipReason+trigger hold",
    },
    recoveryCron: {
      risk: "via process-subscriptions uniquement",
      mitigation: "freeze cron (F-GLOBAL ou F-SELECTIVE)",
    },
    recoveryAdminDev: {
      risk: "nul en production (isRecoveryDevRetryEnabled force NODE_ENV!==production)",
      mitigation: "aucune",
    },
    webhook: {
      risk: "pas de create attempt — reconcile only",
      mitigation: "n/a",
    },
  },
  killSwitchFutureIncidents: [
    "F-GLOBAL Disable Cron Jobs (projet)",
    "NBD HOLD lointaine sans pause (ACTIVE)",
    "Après deploy: contractId dans SUBSCRIPTION_BILLING_INCIDENT_HOLD_CONTRACT_IDS",
  ],
};

console.log(JSON.stringify(procedure, null, 2));
