# Business test matrix — Mileyo Subscription OS

This matrix lists the business scenarios protected by the regression suite.

Run the full suite:

```bash
npm run test:business
```

When adding a feature, update this matrix and add the corresponding scenario tests under `scripts/business-tests/`.

## Matrix

| Domaine | Scénario | Risque couvert | Script |
| --- | --- | --- | --- |
| Box builder | Commande unique — payload propriétés correct | Panier mal formé, repas perdus | `01-builder-cart-payload.test.ts` |
| Box builder | Abonnement — type + date + repas | Selling plan / propriétés manquantes | `01-builder-cart-payload.test.ts` |
| Box builder | Box 8/10/12/16/20/24 — validation exacte | Panier avec mauvais nombre de plats | `01-builder-cart-payload.test.ts` |
| Box builder | Dates livraison J+3..J+10, jamais dimanche | Date impossible ou hors fenêtre | `01-builder-cart-payload.test.ts` |
| Box builder | Filtres allergènes / badges OR | Plats interdits visibles | `01-builder-cart-payload.test.ts` |
| Box builder | Parsing propriétés `_mileyo_delivery_date` | Roundtrip builder → webhook | `dev-delivery-property-parsing-tests.ts` |
| Première commande | Livraison J+3 + billing 2e livraison | Billing trop tôt | `02-first-order-delivery-billing.test.ts` |
| Première commande | Livraison J+10, pas de billing J+7 | Prélèvement Shopify +7 | `02-first-order-delivery-billing.test.ts` |
| Première commande | Rejeu webhook idempotent | Doublon BoxOrder / repas | `02-first-order-delivery-billing.test.ts` |
| Première commande | Intégration DB orders-create | Persistance réelle | `dev-delivery-order-integration-tests.ts` |
| Renouvellement | Livraison projetée active (pas J+3) | Livraison repoussée d’une semaine | `03-renewal-cycle.test.ts` |
| Renouvellement | Billing sur livraison suivante | Retour Shopify +7 | `03-renewal-cycle.test.ts` |
| Renouvellement | Intégration DB renewal | BoxOrder + billing alignés | `dev-delivery-order-integration-tests.ts` |
| Cutoff | Avant cutoff — modifications OK | Blocage à tort | `04-cutoff-guards.test.ts` |
| Cutoff | Après cutoff — modifications bloquées | Modification après préparation | `04-cutoff-guards.test.ts` |
| Cutoff | Cutoff sur date projetée | Date DB passée bloque à tort | `04-cutoff-guards.test.ts` |
| Cutoff | Cron avant/après billingReadyAt | Prélèvement avant cutoff | `04-cutoff-guards.test.ts` |
| Cutoff | Guards portail détaillés | UI vs serveur incohérents | `dev-delivery-cutoff-guard-tests.ts` |
| Pause | Pause autorisée avant cutoff | Impossible de mettre en pause | `05-pause-resume.test.ts` |
| Pause | Pause refusée après cutoff | Pause sur box en préparation | `05-pause-resume.test.ts` |
| Reprise | Reprise simple avant/après cutoff | Mauvaise livraison cible | `05-pause-resume.test.ts` |
| Reprise | Reprise paiement immédiat avant/après cutoff | Billing paymentAt +7 | `05-pause-resume.test.ts` |
| Reprise | Schedule resume détaillé | Ancienne logique +7 active | `dev-resume-delivery-schedule-tests.ts` |
| Portail | Projection prochaine livraison | Date passée affichée | `06-portal-state.test.ts` |
| Portail | Cutoff cohérent sur date projetée | Bandeau cutoff faux | `06-portal-state.test.ts` |
| Portail | Guards repas / box / reprise | UI autorise, serveur refuse | `06-portal-state.test.ts` |
| Portail | Blocages billing / recovery | Modification pendant prélèvement | `dev-patch3-modification-block-tests.ts` |
| Préparation | Agrégation par scheduledDeliveryDate | Totaux plats faux | `07-preparation-backoffice.test.ts` |
| Préparation | Export production / commandes CSV | Exports cuisine erronés | `07-preparation-backoffice.test.ts` |
| Préparation | Historique non altéré par projection portail | Confusion dates portail / BO | `07-preparation-backoffice.test.ts` |
| Backfill | Legacy J+10 nextBillingDate trop tôt | Prélèvement avant 2e box | `08-legacy-alignment-backfill.test.ts` |
| Backfill | Livraison payée vs non payée | Mauvais billing recommandé | `08-legacy-alignment-backfill.test.ts` |
| Backfill | Dry-run / apply / idempotence | Mutation accidentelle prod | `08-legacy-alignment-backfill.test.ts` |
| Backfill | Audit calcul pur | Régression helper alignment | `dev-delivery-billing-alignment-audit-tests.ts` |
| Edge cases | Été/hiver Paris, dimanche, invalid data | Crash timezone / date | `09-edge-cases.test.ts` |
| Edge cases | Contrat terminal / in-flight billing | Prélèvement ou action interdite | `09-edge-cases.test.ts` |
| Cycle billing 13K-A | Samedi 00:05 Paris + retries dim/lun | Mauvais jour ou UTC | `25-subscription-cycle-billing.test.ts` |
| Cycle billing 13K-A | Été/hiver Paris 00:05 | Décalage DST | `25-subscription-cycle-billing.test.ts` |
| Cycle billing 13K-B1 | Livraison → samedi associé | Mauvaise box facturée | `26-subscription-billing-schedule-resolver.test.ts` |
| Cycle billing 13K-B1 | Après livraison payée → samedi D+7 | Billing trop tôt / double charge | `26-subscription-billing-schedule-resolver.test.ts` |
| Cycle billing 13K-C1 | First order + renewal nextBillingDate samedi | Alignement encore J-2 | `27-first-order-renewal-cycle-alignment.test.ts` |
| Cycle billing 13K-C2 | Runner respecte nextBillingDate samedi | Skip/realign J-2 | `28-billing-runner-cycle-gate.test.ts` |
| Cycle billing 13K-D1 | Recovery retry dimanche/lundi 00:05 | Délai +24h/+48h | `29-subscription-payment-recovery-cycle.test.ts` |
| Recovery DEV 13L-A | Trigger recovery-only + now simulé + selectionId | Cron/billing normal, retry hors cible | `36-subscription-recovery-dev-retry-trigger.test.ts` |
| Cutoff DEV 13L-B | Horloge portail-only + refus production | Billing/recovery contaminés par Date simulée | `37-cutoff-dev-clock.test.ts` |
| Cycle billing 13K-E2 | Resume portail nextBillingDate samedi | Resume encore J-2 | `30-portal-resume-cycle-billing.test.ts` |
| Cycle billing 13K-F2 | Backfill reco samedi (BoxOrder / unpaid) | Reco encore J-2 | `31-subscription-delivery-billing-alignment-cycle.test.ts` |
| Billing schedule | Helpers cutoff → billingReadyAt | Dates billing incorrectes | `dev-delivery-billing-schedule-tests.ts` |
| Billing runner | Cycle gate cron (nextBillingDate) | Realign samedi → mardi | `dev-billing-runner-delivery-readiness-tests.ts` |
| Delivery dates | Fenêtre J+3..J+10, report paiement tardif | Mauvaise 1ère livraison | `dev-delivery-date-tests.ts` |
| Cutoff utils | Calcul cutoff Paris | Cutoff décalé | `dev-delivery-cutoff-tests.ts` |
| Nutrition import 14A | Validation macros + mapping metafieldsSet variante | Valeurs invalides / mauvais owner PRODUCT | `39-meal-nutrition-import-foundation.test.ts` |
| Nutrition export 14B | Template CSV Settings via Form POST + Blob (embedded-safe) | href hors auth / mauvais headers / invente macros | `40-meal-nutrition-export-template.test.ts` |
| Nutrition import 14C-A | Preview CSV Settings (parse + validate, zéro écriture) | Apply prématuré / headers / doublons | `41-meal-nutrition-import-preview.test.ts` |
| Nutrition import 14C-B1 | Preview métier catalogue (variant/objective + diff) | variant inconnu / objective faux / écriture | `42-meal-nutrition-import-catalog-preview.test.ts` |
| Nutrition import 14C-C | Apply CSV → revalidation → metafieldsSet variantes | Apply sans preview / writer bypass | `43-meal-nutrition-import-apply.test.ts` |
| Nutrition import 14C-D | Import partiel Excel (lignes macros vides ignorées) | Apply bloqué / fausses erreurs template | `44-meal-nutrition-import-partial.test.ts` |
| Nutrition import 14C-E | metafieldsSet batché ≤25 inputs | Exceeded maximum metafields input limit of 25 | `45-meal-nutrition-import-metafields-batch.test.ts` |

## Runner

| Fichier | Rôle |
| --- | --- |
| `scripts/business-tests/00-run-business-regression-suite.ts` | Lance toutes les suites business + legacy |
| `npm run test:business` | Commande globale CI / pre-prod |

## Conventions

- Format **Scenario / Given / When / Then** dans chaque fichier `scripts/business-tests/*.test.ts`
- Les scripts `dev-*` restent la couche technique ; les fichiers `business-tests` ajoutent la lecture métier
- Exit code `1` si une suite échoue

## Maintenance

À chaque nouvelle feature :

1. Ajouter la ligne dans cette matrice
2. Ajouter ou étendre un scénario dans `scripts/business-tests/`
3. Lancer `npm run test:business` avant commit
