/**
 * Business regression — portal pause must fail-closed on Shopify contract status.
 *
 * subscriptionContractPause already returns contract.id + contract.status;
 * local DB must only become paused when status === "PAUSED".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { confirmShopifyPauseContract } from "../../app/features/portal/portal-pause-shopify-confirmation";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepoFile = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

const runSuite = () => {
  const ctx = createBusinessTestContext("108-portal-pause-shopify-status");

  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const confirmationSource = readRepoFile(
    "app/features/portal/portal-pause-shopify-confirmation.ts",
  );
  const pauseHelperSource = portalActionsSource.slice(
    portalActionsSource.indexOf("const pauseSubscriptionContract = async"),
    portalActionsSource.indexOf("type PortalActionContext"),
  );
  const pauseActionSource = portalActionsSource.slice(
    portalActionsSource.indexOf(
      "const handlePauseSubscriptionAction = async",
    ),
    portalActionsSource.indexOf(
      "const handleSendPaymentUpdateEmailAction = async",
    ),
  );

  ctx.scenario("A. Mutation GraphQL demande déjà id + status");
  ctx.assertTrue(
    "pause mutation selects contract.id and status",
    portalActionsSource.includes("subscriptionContractPause") &&
      /subscriptionContractPause[\s\S]*?contract\s*\{\s*id\s*status/s.test(
        portalActionsSource,
      ),
  );
  ctx.assertTrue(
    "pause helper does not invent a second GraphQL mutation",
    (pauseHelperSource.match(/admin\.graphql/g) ?? []).length === 1,
  );
  ctx.assertTrue(
    "helper wires confirmShopifyPauseContract",
    pauseHelperSource.includes("confirmShopifyPauseContract(result?.contract)"),
  );

  ctx.scenario("1. id valide + status PAUSED → succès");
  const pausedOk = confirmShopifyPauseContract({
    id: "gid://shopify/SubscriptionContract/1",
    status: "PAUSED",
  });
  ctx.assertEqual("PAUSED with id succeeds", "ok" in pausedOk, true);

  ctx.scenario("2. id valide + status ACTIVE → erreur");
  const activeRejected = confirmShopifyPauseContract({
    id: "gid://shopify/SubscriptionContract/1",
    status: "ACTIVE",
  });
  ctx.assertEqual("ACTIVE with id is rejected", "error" in activeRejected, true);
  ctx.assertEqual(
    "ACTIVE rejection message",
    "error" in activeRejected ? activeRejected.error : null,
    "Shopify n’a pas confirmé la mise en pause de l’abonnement.",
  );

  ctx.scenario("3. id valide + status absent/null → erreur");
  const nullRejected = confirmShopifyPauseContract({
    id: "gid://shopify/SubscriptionContract/1",
    status: null,
  });
  ctx.assertEqual("null status rejected", "error" in nullRejected, true);
  ctx.assertEqual(
    "null status rejection message",
    "error" in nullRejected ? nullRejected.error : null,
    "Shopify n’a pas confirmé la mise en pause de l’abonnement.",
  );
  const undefinedRejected = confirmShopifyPauseContract({
    id: "gid://shopify/SubscriptionContract/1",
  });
  ctx.assertEqual(
    "undefined status rejected",
    "error" in undefinedRejected,
    true,
  );
  ctx.assertEqual(
    "undefined status rejection message",
    "error" in undefinedRejected ? undefinedRejected.error : null,
    "Shopify n’a pas confirmé la mise en pause de l’abonnement.",
  );

  ctx.scenario("4–5. userErrors / GraphQL errors — ordre fail-closed inchangé");
  ctx.assertTrue(
    "GraphQL errors checked before contract confirmation",
    pauseHelperSource.indexOf("json.errors?.length") <
      pauseHelperSource.indexOf("confirmShopifyPauseContract") &&
      pauseHelperSource.includes("Erreur GraphQL lors de la mise en pause."),
  );
  ctx.assertTrue(
    "userErrors checked before contract confirmation",
    pauseHelperSource.indexOf("getGraphqlUserErrors(result?.userErrors)") <
      pauseHelperSource.indexOf("confirmShopifyPauseContract") &&
      pauseHelperSource.indexOf("if (userErrorMessage)") <
        pauseHelperSource.indexOf("confirmShopifyPauseContract"),
  );
  ctx.assertTrue(
    "missing contract.id still fails closed with prior message",
    confirmationSource.includes("Shopify n’a pas confirmé la mise en pause.") &&
      confirmationSource.includes('contract.status !== "PAUSED"'),
  );

  ctx.scenario("F. Handler — DB locale paused seulement après ok Shopify");
  ctx.assertTrue(
    "handler calls pauseSubscriptionContract before local update",
    pauseActionSource.indexOf("pauseSubscriptionContract(") <
      pauseActionSource.indexOf('active: false, status: "paused"'),
  );
  ctx.assertTrue(
    "handler returns on shopify error before local paused update",
    pauseActionSource.indexOf('if ("error" in shopifyResult)') <
      pauseActionSource.indexOf('active: false, status: "paused"') &&
      pauseActionSource
        .slice(
          pauseActionSource.indexOf('if ("error" in shopifyResult)'),
          pauseActionSource.indexOf('active: false, status: "paused"'),
        )
        .includes("return renderMessage"),
  );
  ctx.assertTrue(
    "contract.id alone is not sufficient (status PAUSED required)",
    confirmationSource.includes('contract.status !== "PAUSED"') &&
      confirmationSource.indexOf("!contract?.id") <
        confirmationSource.indexOf('contract.status !== "PAUSED"'),
  );

  return finishSuite("108-portal-pause-shopify-status", ctx);
};

process.exitCode = runSuite();
