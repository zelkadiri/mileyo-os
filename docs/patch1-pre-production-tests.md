# Patch 1 — Tests pré-production

Contrat de référence **à ne jamais utiliser** pour ces scénarios : `25688637580`.

Utiliser un contrat jetable dédié (nouveau checkout box-builder ou contrat de test existant).

Shop dev : `mileyo-ok1bszwz.myshopify.com`  
Cron local : `curl -s "http://localhost:3000/api/cron/process-subscriptions?secret=$CRON_SECRET"`

---

## 1. EXPIRED réel

### Contexte

Shopify passe un contrat en `EXPIRED` quand tous les cycles prévus sont exécutés (`max_cycles` atteint) ou via expiration administrative. Ce n’est pas une pause ni une annulation client.

### Préparation

1. Créer un abonnement test avec une politique de facturation à **cycles limités** (`max_cycles: 1` ou `2`) si votre selling plan le permet.
2. Alternative dev : laisser le contrat actif et appeler l’API Admin GraphQL `subscriptionContractExpire` sur le contrat test (scope `write_own_subscription_contracts` requis).
3. Noter avant test : `subscriptionContractId`, `id` de la `SubscriptionMealSelection`, `status`, `active`, `nextBillingDate`.

### Déclenchement

- **Option A (naturel)** : laisser Shopify expirer le contrat après le dernier cycle facturé.
- **Option B (accéléré)** : mutation GraphQL `subscriptionContractExpire` depuis l’admin API ou un script dev.
- **Option C** : attendre le webhook `subscription_contracts/expire` si déclenché par Shopify.

### Vérifications obligatoires

| Zone | Attendu |
|---|---|
| Webhook | `SUBSCRIPTION_CONTRACTS_EXPIRE` et/ou `SUBSCRIPTION_CONTRACTS_UPDATE` reçu ; log `[SUBSCRIPTION_CONTRACT_SYNC] webhook received` |
| GraphQL | `subscriptionContract.status` = `EXPIRED` |
| Base locale | `status: expired`, `active: false`, `nextBillingDate: null` |
| Repas / contrat | `selectedMeals` inchangés, `subscriptionContractId` conservé |
| Sélections | count = 1 pour ce contrat, même `id` |
| Cron | `skipReasons.terminal_contract` += 1, `processed: 0` pour ce contrat |
| Logs cron | `[SUBSCRIPTION_CONTRACT_SYNC] cron skipped terminal contract` |
| Facturation | aucun appel aboutissant à une commande ; pas de nouveau `SubscriptionBillingAttempt` réussi |

### Commandes utiles

```bash
# État local
npx tsx -e "
import db from './app/db.server.ts';
const s = await db.subscriptionMealSelection.findFirst({
  where: { subscriptionContractId: 'CONTRACT_ID' },
});
console.log(JSON.stringify(s, null, 2));
await db.\$disconnect();
"

# Cron
curl -s "http://localhost:3000/api/cron/process-subscriptions?secret=$CRON_SECRET" | jq .
```

### Critère de succès

Le contrat disparaît des candidats cron (`terminal_contract`) et ne peut plus être modifié via les actions portail (message métier terminal).

---

## 2. FAILED terminal réel (≠ payment recovery local)

### Distinction métier à valider

| | Shopify `FAILED` (terminal) | Payment recovery Mileyo (récupérable) |
|---|---|---|
| Statut Shopify | `FAILED` | généralement `PAUSED` |
| Statut local Patch 1 | `failed` | `paused` + `SubscriptionPaymentRecovery` ouverte |
| `nextBillingDate` | `null` | souvent conservée |
| Cron normal | `terminal_contract` | `payment_recovery` ou facturation recovery |
| Reprise client | impossible (terminal) | possible via portail / mise à jour CB |

### Préparation

1. **Ne pas confondre** avec `SubscriptionPaymentRecovery.status = final_failed` : c’est une pause locale après 3 échecs, pas le statut Shopify `FAILED`.
2. Pour obtenir un vrai `FAILED` Shopify : laisser Shopify épuiser le dunning natif du contrat **ou** utiliser la mutation `subscriptionContractFail` en dev si disponible sur votre shop.
3. Contrat test jetable uniquement.

### Déclenchement

- Laisser les tentatives Shopify échouer jusqu’au statut terminal `FAILED`, **ou**
- Webhook `subscription_contracts/fail` reçu après action Shopify.

### Vérifications obligatoires

| Zone | Attendu |
|---|---|
| GraphQL | `status: FAILED` |
| Local | `status: failed`, `active: false`, `nextBillingDate: null` |
| Recovery locale | peut exister historiquement mais ne doit **pas** relancer de facturation si local = `failed` (voir audit § recovery) |
| Cron | `terminal_contract`, jamais `processed` pour ce contrat |
| Webhook | `subscription_contracts/fail` traité ; sync via GraphQL, pas le payload seul |
| Contrôle négatif recovery | un contrat en recovery (`paused` + recovery ouverte) doit rester `paused`, **pas** `failed`, tant que Shopify n’est pas `FAILED` |

### Scénario de contrôle recovery (contrôle négatif)

1. Provoquer 1–2 échecs de paiement sur un contrat actif (recovery ouverte, statut local `paused` ou `active` selon flux).
2. Vérifier GraphQL = `PAUSED` (pas `FAILED`).
3. Local ≠ `failed` ; cron recovery peut tourner ; cron normal skip `payment_recovery` ou `paused_or_inactive`.

### Critère de succès

`FAILED` Shopify mappe en `failed` local, traité comme terminal par le cron. Le flux recovery existant sur un contrat **non** `FAILED` continue de fonctionner comme avant Patch 1.

---

## 3. Erreur GraphQL / token invalide temporaire

### Objectif

Vérifier que la sync ne corrompt pas l’état local quand Shopify est injoignable.

### Préparation

1. Choisir un contrat **actif** avec `nextBillingDate` **dans le passé ou aujourd’hui** (candidat cron) — pas le contrat référence.
2. Noter l’état local exact avant test.

### Déclenchement (une méthode suffit)

- **A** : invalider temporairement le token offline en base (`Session.accessToken` → valeur bidon) puis lancer cron ou une action portail.
- **B** : couper le réseau sortant du process Node le temps d’un cron.
- **C** : en dev, appeler `syncSubscriptionContractState` via script avec admin mock qui renvoie une erreur réseau.

### Vérifications obligatoires

| Zone | Attendu |
|---|---|
| Log | `[SUBSCRIPTION_CONTRACT_SYNC]` avec `action: 'error'` et `reason: 'shopify_status_unavailable'` ou message d’erreur explicite |
| Base | `status`, `active`, `nextBillingDate` **identiques** à avant |
| Pas de passage terminal | local ne doit pas passer à `cancelled` / `expired` / `failed` par défaut |

### Comportement cron attendu (à valider explicitement)

**État actuel Patch 1 :** si la sync retourne `action: 'error'` sans exception, le cron peut encore tenter une facturation sur l’état local inchangé.  
**Comportement cible pré-prod :** documenter le résultat observé :

- Si facturation déclenchée malgré sync en erreur → **gap à traiter avant prod** (bloquer `processed` quand `syncResult.action === 'error'`).
- Si Shopify rejette la tentative → pas de commande créée, mais noter que `subscriptionBillingAttemptCreate` a quand même été appelé.

### Restauration

Remettre le token valide / réseau, relancer sync ; l’état doit converger vers Shopify sans doublon de sélection.

### Critère de succès minimal (Patch 1)

- État local **jamais** dégradé arbitrairement vers terminal lors d’une erreur GraphQL.
- Log `[SUBSCRIPTION_CONTRACT_SYNC]` exploitable pour alerting.

---

## Checklist globale avant deploy production

- [ ] Tests pause / reprise / cancel / idempotence (dev) — validés
- [ ] EXPIRED réel
- [ ] FAILED terminal réel (distinct recovery)
- [ ] Erreur GraphQL documentée + décision sur blocage cron
- [ ] Webhooks enregistrés via `shopify app deploy --config shopify.app.production.toml` uniquement
- [ ] Contrat `25688637580` intact après tous les tests
- [ ] Aucune nouvelle `SubscriptionMealSelection` sur les scénarios terminal
