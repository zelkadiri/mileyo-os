/**
 * Business regression — PORTAL-ACCOUNT-UX
 * Address (SubscriptionContract shipping) + payment email + logout.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MILEYO_CUSTOMER_LOGOUT_PATH,
  MILEYO_PORTAL_PATH,
} from "../../app/constants/mileyoPortal";
import {
  PORTAL_ADDRESS_ORDER_LOCKED_MESSAGE,
  PORTAL_ADDRESS_PREPARATION_MESSAGE,
  PORTAL_ADDRESS_SUCCESS_MESSAGE,
  PORTAL_PAYMENT_UPDATE_HINT,
} from "../../app/constants/subscriptionContractAddress";
import { validatePortalDeliveryAddressInput } from "../../app/services/subscriptionContractAddress.server";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = async () => {
  const ctx = createBusinessTestContext("88-portal-account-address-payment-logout");

  const addressService = readRepoFile(
    "app/services/subscriptionContractAddress.server.ts",
  );
  const portalActions = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const portalData = readRepoFile("app/features/portal/portal-data.server.ts");
  const portalRender = readRepoFile("app/features/portal/portal-render.ts");
  const portalClient = readRepoFile("app/features/portal/portal-client.ts");
  const portalTypes = readRepoFile("app/features/portal/portal-types.ts");
  const mileyoPortal = readRepoFile("app/constants/mileyoPortal.ts");

  const updateAddressBlock = portalActions.slice(
    portalActions.indexOf("const handleUpdateDeliveryAddressAction"),
    portalActions.indexOf("const handleResumeSubscriptionAction"),
  );

  const paymentActionBlock = portalActions.slice(
    portalActions.indexOf("const handleSendPaymentUpdateEmailAction"),
    portalActions.indexOf("const handleUpdateDeliveryAddressAction"),
  );

  ctx.scenario("A. Constants + logout helper");
  ctx.assertEqual(
    "logout path",
    MILEYO_CUSTOMER_LOGOUT_PATH,
    "/account/logout",
  );
  ctx.assertTrue(
    "logout constant in mileyoPortal",
    mileyoPortal.includes("MILEYO_CUSTOMER_LOGOUT_PATH"),
  );
  ctx.assertFalse(
    "logout has no return_to",
    MILEYO_CUSTOMER_LOGOUT_PATH.includes("return_to"),
  );
  ctx.assertFalse(
    "logout not portal path",
    MILEYO_CUSTOMER_LOGOUT_PATH.includes(MILEYO_PORTAL_PATH),
  );
  ctx.assertTrue(
    "preparation message present",
    PORTAL_ADDRESS_PREPARATION_MESSAGE.includes("préparation"),
  );
  ctx.assertTrue(
    "order locked message present",
    PORTAL_ADDRESS_ORDER_LOCKED_MESSAGE.includes("Contactez-nous"),
  );
  ctx.assertTrue(
    "payment hint present",
    PORTAL_PAYMENT_UPDATE_HINT.includes("sécurisée"),
  );
  ctx.assertTrue(
    "success message present",
    PORTAL_ADDRESS_SUCCESS_MESSAGE.includes("mise à jour"),
  );

  ctx.scenario("B. Validation serveur adresse");
  {
    const valid = validatePortalDeliveryAddressInput({
      address1: "6 rue d'Armaille",
      address2: "",
      city: "Paris",
      countryCode: "FR",
      firstName: "Khalid",
      lastName: "Ramdani",
      zip: "75017",
    });
    ctx.assertTrue("adresse FR valide", valid.ok);

    const cases: Array<{ name: string; patch: Record<string, string> }> = [
      { name: "firstName vide", patch: { firstName: "  " } },
      { name: "lastName vide", patch: { lastName: "" } },
      { name: "address1 vide", patch: { address1: "" } },
      { name: "zip invalide", patch: { zip: "7501" } },
      { name: "city vide", patch: { city: "" } },
      { name: "country invalide", patch: { countryCode: "US" } },
    ];

    for (const testCase of cases) {
      const result = validatePortalDeliveryAddressInput({
        address1: "6 rue d'Armaille",
        address2: "",
        city: "Paris",
        countryCode: "FR",
        firstName: "Khalid",
        lastName: "Ramdani",
        zip: "75017",
        ...testCase.patch,
      });
      ctx.assertFalse(testCase.name, result.ok);
    }
  }

  ctx.scenario("C. Lecture + mutation Shopify (source)");
  ctx.assertTrue(
    "query SubscriptionDeliveryMethodShipping",
    addressService.includes("SubscriptionDeliveryMethodShipping"),
  );
  ctx.assertTrue(
    "subscriptionContractUpdate",
    addressService.includes("subscriptionContractUpdate"),
  );
  ctx.assertTrue(
    "subscriptionDraftUpdate",
    addressService.includes("subscriptionDraftUpdate"),
  );
  ctx.assertTrue(
    "subscriptionDraftCommit",
    addressService.includes("subscriptionDraftCommit"),
  );
  ctx.assertTrue(
    "deliveryMethod.shipping.address",
    addressService.includes("deliveryMethod:") &&
      addressService.includes("shipping:") &&
      addressService.includes("address:"),
  );
  ctx.assertTrue(
    "refuse non-shipping",
    addressService.includes("not_shipping") &&
      addressService.includes("PORTAL_ADDRESS_UNSUPPORTED_METHOD_MESSAGE"),
  );
  ctx.assertTrue(
    "userErrors checked on update",
    addressService.includes("shopify_update"),
  );
  ctx.assertTrue(
    "userErrors checked on draft",
    addressService.includes("shopify_draft"),
  );
  ctx.assertTrue(
    "userErrors checked on commit",
    addressService.includes("shopify_commit"),
  );
  ctx.assertFalse(
    "no customer.defaultAddress mutation",
    /customerAddressUpdate|defaultAddress|customerUpdate/.test(addressService),
  );
  ctx.assertFalse(
    "no orderUpdate",
    addressService.includes("orderUpdate") ||
      addressService.includes("orderEdit"),
  );

  ctx.scenario("D. Ownership + guards action portal");
  ctx.assertTrue(
    "intent updateDeliveryAddress",
    portalActions.includes('intent === "updateDeliveryAddress"'),
  );
  ctx.assertTrue(
    "uses loadSyncedSelectionForAction",
    updateAddressBlock.includes("loadSyncedSelectionForAction"),
  );
  ctx.assertTrue(
    "uses getPortalModificationBlockReason",
    updateAddressBlock.includes("getPortalModificationBlockReason"),
  );
  ctx.assertTrue(
    "uses resolveCurrentDeliveryCoverage lock",
    updateAddressBlock.includes("resolveCurrentDeliveryCoverage") &&
      updateAddressBlock.includes("coverage.locked"),
  );
  ctx.assertTrue(
    "cutoff/prep message on block",
    updateAddressBlock.includes("PORTAL_ADDRESS_PREPARATION_MESSAGE"),
  );
  ctx.assertTrue(
    "order locked message",
    updateAddressBlock.includes("PORTAL_ADDRESS_ORDER_LOCKED_MESSAGE"),
  );
  ctx.assertTrue(
    "validates before Shopify",
    updateAddressBlock.indexOf("validatePortalDeliveryAddressInput") <
      updateAddressBlock.indexOf("updateSubscriptionContractShippingAddress"),
  );
  ctx.assertTrue(
    "derives contract from selection",
    updateAddressBlock.includes("selection.subscriptionContractId"),
  );
  ctx.assertFalse(
    "no formData contractId",
    updateAddressBlock.includes('formData.get("contractId")') ||
      updateAddressBlock.includes('formData.get("subscriptionContractId")'),
  );
  ctx.assertFalse(
    "action does not call orderUpdate",
    updateAddressBlock.includes("orderUpdate"),
  );
  ctx.assertFalse(
    "action does not update BoxOrder",
    /boxOrder\.update|prisma\.boxOrder/.test(updateAddressBlock),
  );
  ctx.assertFalse(
    "action does not touch Customer address",
    /defaultAddress|customerAddressUpdate/.test(updateAddressBlock),
  );
  ctx.assertTrue(
    "success message constant",
    updateAddressBlock.includes("PORTAL_ADDRESS_SUCCESS_MESSAGE") ||
      portalActions.includes(PORTAL_ADDRESS_SUCCESS_MESSAGE),
  );

  ctx.scenario("E. Loader DTO adresse contrat");
  ctx.assertTrue(
    "fetchSubscriptionContractShippingAddress in loader",
    portalData.includes("fetchSubscriptionContractShippingAddress"),
  );
  ctx.assertTrue(
    "PortalSelection.deliveryAddress",
    portalTypes.includes("deliveryAddress: PortalDeliveryAddressState"),
  );
  ctx.assertTrue(
    "buildDeliveryAddressState",
    portalData.includes("buildDeliveryAddressState"),
  );
  ctx.assertTrue(
    "order lock via deliveryLocked",
    portalData.includes("deliveryLocked"),
  );

  ctx.scenario("F. Paiement — email sécurisé, pas profile deep-link");
  ctx.assertTrue(
    "settings payment uses sendPaymentUpdateEmail",
    portalClient.includes("settings-payment-update-button") &&
      portalClient.includes('set("intent", "sendPaymentUpdateEmail")'),
  );
  ctx.assertTrue(
    "payment action ownership-safe",
    paymentActionBlock.includes("loadSyncedSelectionForAction") &&
      paymentActionBlock.includes("sendPaymentUpdateEmailForSelection"),
  );
  ctx.assertFalse(
    "no /account/profile payment deep-link",
    /account\/profile/.test(portalRender) ||
      /account\/profile/.test(portalClient),
  );
  ctx.assertTrue(
    "payment success feedback",
    paymentActionBlock.includes(
      "Un email sécurisé vous a été envoyé pour mettre à jour votre moyen de paiement.",
    ),
  );
  ctx.assertTrue(
    "payment hint in settings",
    portalRender.includes("PORTAL_PAYMENT_UPDATE_HINT") ||
      portalRender.includes(PORTAL_PAYMENT_UPDATE_HINT),
  );

  ctx.scenario("G. Logout UX Paramètres");
  ctx.assertTrue(
    "render uses MILEYO_CUSTOMER_LOGOUT_PATH",
    portalRender.includes("MILEYO_CUSTOMER_LOGOUT_PATH"),
  );
  ctx.assertTrue(
    "logout link class",
    portalRender.includes("settings-logout-link"),
  );
  ctx.assertTrue(
    "Se déconnecter label",
    portalRender.includes("Se déconnecter"),
  );
  ctx.assertFalse(
    "no localStorage logout",
    /localStorage/.test(portalClient) &&
      portalClient.includes("logout") &&
      /localStorage[\s\S]{0,80}logout|logout[\s\S]{0,80}localStorage/.test(
        portalClient,
      ),
  );
  ctx.assertFalse(
    "logout href has no return_to in render",
    /logout[^"]*return_to|return_to[^"]*logout/.test(portalRender),
  );

  ctx.scenario("H. UX Paramètres ordre");
  ctx.assertTrue(
    "Adresse de livraison label",
    portalRender.includes("Adresse de livraison"),
  );
  ctx.assertTrue(
    "Moyen de paiement label",
    portalRender.includes("Moyen de paiement"),
  );
  {
    const addressIdx = portalRender.indexOf("Adresse de livraison");
    const paymentIdx = portalRender.indexOf("Moyen de paiement");
    const logoutIdx = portalRender.indexOf("Se déconnecter");
    ctx.assertTrue(
      "adresse avant paiement",
      addressIdx >= 0 && paymentIdx > addressIdx,
    );
    ctx.assertTrue(
      "paiement avant logout",
      paymentIdx >= 0 && logoutIdx > paymentIdx,
    );
  }

  ctx.scenario("I. UX — succès adresse effacé avant erreur validation");
  {
    const clearFnIdx = portalClient.indexOf("function clearAddressSuccessFlash");
    const editHandlerIdx = portalClient.indexOf(
      'editAddressButton.addEventListener("click"',
    );
    const submitHandlerIdx = portalClient.indexOf(
      'addressForm.addEventListener("submit"',
    );
    const addressErrorShowIdx = portalClient.indexOf(
      "Vérifiez les champs de l’adresse.",
    );
    const paymentSuccessIdx = portalClient.indexOf(
      'set("intent", "sendPaymentUpdateEmail")',
    );

    ctx.assertTrue("clearAddressSuccessFlash défini", clearFnIdx >= 0);
    ctx.assertTrue(
      "clear cible le message succès adresse constant",
      portalClient.includes("PORTAL_ADDRESS_SUCCESS_MESSAGE") ||
        portalClient.includes(PORTAL_ADDRESS_SUCCESS_MESSAGE),
    );
    ctx.assertTrue(
      "clear retire .success dans .portal-header-flash",
      portalClient.includes('.portal-header-flash') &&
        portalClient.includes(".success") &&
        portalClient.includes("node.remove()"),
    );
    ctx.assertTrue(
      "édition adresse appelle clear avant ouverture",
      editHandlerIdx >= 0 &&
        clearFnIdx < editHandlerIdx &&
        portalClient
          .slice(editHandlerIdx, editHandlerIdx + 400)
          .includes("clearAddressSuccessFlash()"),
    );
    ctx.assertTrue(
      "soumission adresse appelle clear avant validation",
      submitHandlerIdx >= 0 &&
        addressErrorShowIdx > submitHandlerIdx &&
        portalClient
          .slice(submitHandlerIdx, addressErrorShowIdx)
          .includes("clearAddressSuccessFlash()"),
    );
    ctx.assertTrue(
      "validation invalide affiche erreur adresse locale",
      portalClient.includes("settings-address-error") &&
        addressErrorShowIdx >= 0 &&
        portalClient
          .slice(submitHandlerIdx, addressErrorShowIdx + 120)
          .includes("classList.remove(\"hidden\")"),
    );
    ctx.assertTrue(
      "paiement n’appelle pas clearAddressSuccessFlash",
      paymentSuccessIdx >= 0 &&
        !portalClient
          .slice(
            portalClient.indexOf("function submitPaymentUpdateEmail"),
            paymentSuccessIdx + 200,
          )
          .includes("clearAddressSuccessFlash"),
    );
    ctx.assertTrue(
      "succès adresse serveur conserve PORTAL_ADDRESS_SUCCESS_MESSAGE",
      updateAddressBlock.includes("PORTAL_ADDRESS_SUCCESS_MESSAGE"),
    );
    ctx.assertTrue(
      "header flash rend successMessage serveur",
      portalRender.includes("successMessage") &&
        portalRender.includes('class="success"'),
    );
  }

  finishSuite("88-portal-account-address-payment-logout", ctx);
};

void runSuite();
