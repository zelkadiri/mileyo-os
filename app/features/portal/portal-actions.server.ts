import type { Prisma } from "@prisma/client";

import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import {
  activateSubscriptionContractWithVerification,
  archiveResumeAttemptOnPause,
  ensureResumeAttemptForBilling,
  handleResumeBillingFailure,
  prepareResumeBillingFlow,
  releaseResumeBillingLock,
  RESUME_LOCK_STATUS,
  scheduleNextBillingDateAfterResumePayment,
  setResumeBillingProcessingLock,
  triggerSubscriptionBillingAttempt,
} from "../../services/subscriptionBillingWorker.server";
import {
  closeRecoveryOnSuccessfulOrder,
  getPortalRecoveryForSelection,
  resolvePaymentUpdateEligibility,
  sendPaymentUpdateEmailForSelection,
} from "../../services/subscriptionPaymentRecovery.server";
import { resetSubscriptionPausedEmailSentAt } from "../../services/email/email.server";
import {
  markMealSelectionExplicitForCurrentDelivery,
  resolveMealSelectionCycle,
} from "../../services/email/meal-selection-email.server";
import { applyCurrentDeliveryMealSelectionUpdate } from "../../services/subscriptionCurrentDeliveryMeals.server";
import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import {
  backfillMealSelectionConfirmedStampFromSentEvent,
  backfillSubscriptionPausedStampFromSentEvent,
  buildCampaignEmailEventMetaJson,
  buildMealSelectionConfirmedEmailEventIdempotencyKey,
  buildSubscriptionPausedEmailEventIdempotencyKey,
  buildSubscriptionPausedEmailEventMetaJson,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  ensureAndProcessEmailEventImmediately,
  ensureSubscriptionPauseEmailEpisode,
} from "../../services/email/email-outbox-event-driven.server";
import {
  fetchSubscriptionContractCurrentVariantId,
  updateSubscriptionContractBoxViaDraft,
} from "../../services/subscriptionContractBoxChange.server";
import {
  BOX_CHANGE_EFFECT,
  BOX_CHANGE_IMMEDIATE_PAUSED_SUCCESS_MESSAGE,
  BOX_CHANGE_IMMEDIATE_SUCCESS_MESSAGE,
  BOX_CHANGE_RECOVERY_BLOCK_MESSAGE,
  buildBoxChangePendingSuccessMessage,
} from "../../constants/subscriptionBoxChange";
import {
  PORTAL_ADDRESS_ORDER_LOCKED_MESSAGE,
  PORTAL_ADDRESS_PREPARATION_MESSAGE,
  PORTAL_ADDRESS_SUCCESS_MESSAGE,
} from "../../constants/subscriptionContractAddress";
import {
  isRecoveryBlockingBoxChange,
  requestSubscriptionBoxChange,
  resolveCurrentDeliveryCoverage,
} from "../../services/subscriptionBoxChange.server";
import {
  updateSubscriptionContractShippingAddress,
  validatePortalDeliveryAddressInput,
} from "../../services/subscriptionContractAddress.server";
import { getCutoffNow } from "../../services/deliveryCutoff.server";
import {
  getPortalModificationBlockMessage,
  getPortalModificationBlockReason,
  type PortalModificationActionKind,
} from "../../services/subscriptionModificationBlock.server";
import {
  filterBuilderBoxesByObjective,
  findBuilderBoxByVariantId,
} from "../builder/builder-box-selection";
import {
  fetchBuilderBoxOptions,
  fetchBuilderMealOptions,
} from "../builder/builder-catalog.server";
import { getPortalMealsForObjective } from "./portal-catalog.server";
import { getPortalV2BoxTitle, isPortalV2MealCount } from "./portal-boxes";
import {
  getCustomerIdFromRequest,
  getShopFromRequest,
  loadPortalData,
} from "./portal-data.server";
import {
  parseMealQuantities,
  validateMealSelection,
  formatFrenchDate,
} from "./portal-formatters";
import {
  completePortalScheduledResume,
  resolvePortalResumeMode,
} from "./portal-resume.server";
import {
  syncAndAssertSubscriptionContractActionAllowed,
} from "../../services/subscriptionContractSync.server";
import { renderMessage, renderPortal } from "./portal-render";

type SubscriptionContractStatusResponse = {
  data?: {
    subscriptionContractPause?: {
      contract?: { id?: string | null; status?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

const subscriptionContractPauseMutation = `#graphql
  mutation SubscriptionContractPause($subscriptionContractId: ID!) {
    subscriptionContractPause(subscriptionContractId: $subscriptionContractId) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const toSubscriptionContractGid = (subscriptionContractId: string) =>
  subscriptionContractId.includes("/")
    ? subscriptionContractId
    : `gid://shopify/SubscriptionContract/${subscriptionContractId}`;

const getGraphqlUserErrors = (
  userErrors: { message?: string | null }[] | undefined,
) =>
  userErrors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join(" ") ?? "";

const pauseSubscriptionContract = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { subscriptionContractId: string } },
    ) => Promise<Response>;
  },
  subscriptionContractId: string,
) => {
  const response = await admin.graphql(subscriptionContractPauseMutation, {
    variables: {
      subscriptionContractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractStatusResponse;

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de la mise en pause.",
    };
  }

  const result = json.data?.subscriptionContractPause;
  const userErrorMessage = getGraphqlUserErrors(result?.userErrors);

  if (userErrorMessage) {
    return { error: userErrorMessage };
  }

  if (!result?.contract?.id) {
    return { error: "Shopify n’a pas confirmé la mise en pause." };
  }

  return { ok: true as const };
};


type PortalActionContext = {
  customerShopifyId: string;
  formData: FormData;
  requestUrl: string;
  selectionId: string;
  shop: string;
};

const resolveSelectionObjective = async (
  admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"],
  selection: {
    boxVariantShopifyId: string | null;
    subscriptionContractId: string | null;
  },
  boxCatalog: Awaited<ReturnType<typeof fetchBuilderBoxOptions>>,
) => {
  const currentVariantId =
    (selection.subscriptionContractId
      ? await fetchSubscriptionContractCurrentVariantId(
          admin,
          selection.subscriptionContractId,
        )
      : null) ?? selection.boxVariantShopifyId;

  return findBuilderBoxByVariantId(boxCatalog, currentVariantId)?.objective ?? null;
};

const loadSyncedSelectionForAction = async ({
  admin,
  customerShopifyId,
  selectionId,
  shop,
  statusFilter,
}: {
  admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
  customerShopifyId: string;
  selectionId: string;
  shop: string;
  statusFilter?: string | { in: string[] };
}) => {
  const selection = await prisma.subscriptionMealSelection.findFirst({
    where: {
      customerShopifyId,
      id: selectionId,
      shop,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
  });

  if (!selection) {
    return { error: "Abonnement introuvable.", selection: null };
  }

  const guard = await syncAndAssertSubscriptionContractActionAllowed({
    admin,
    selection,
    shop,
    source: "portal_action",
  });

  if (!guard.allowed) {
    return { error: guard.message, selection: guard.selection };
  }

  return { error: null, selection: guard.selection };
};

const renderPortalModificationBlocked = async ({
  actionKind,
  blockReason,
  customerShopifyId,
  intent,
  requestUrl,
  selectionId,
  shop,
}: {
  actionKind: PortalModificationActionKind;
  blockReason: NonNullable<ReturnType<typeof getPortalModificationBlockReason>>;
  customerShopifyId: string;
  intent: string;
  requestUrl: string;
  selectionId: string;
  shop: string;
}) => {
  console.log("[portal] modification blocked by getPortalModificationBlockReason", {
    blockReason,
    intent,
    selectionId,
    shop,
  });

  const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

  if (!portalData) {
    return renderMessage("Configuration incomplète.");
  }

  return renderPortal({
    ...portalData,
    portalRequestUrl: requestUrl,
    errorMessage: getPortalModificationBlockMessage(blockReason, actionKind),
  });
};

const getPortalModificationBlockResponse = async ({
  actionKind,
  customerShopifyId,
  intent,
  recoveryRecord,
  requestUrl,
  selection,
  shop,
}: {
  actionKind: PortalModificationActionKind;
  customerShopifyId: string;
  intent: string;
  recoveryRecord?: { status: string } | null;
  requestUrl: string;
  selection: {
    active: boolean;
    id: string;
    lastBillingAttemptAt: Date | null;
    lastBillingAttemptStatus: string | null;
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday?: number | null;
    resumeAttemptOrderId: string | null;
    resumeAttemptStatus: string | null;
    status: string;
    subscriptionContractId: string | null;
  };
  shop: string;
}) => {
  const blockReason = getPortalModificationBlockReason(
    selection,
    recoveryRecord,
    getCutoffNow(),
  );

  if (!blockReason) {
    return null;
  }

  return renderPortalModificationBlocked({
    actionKind,
    blockReason,
    customerShopifyId,
    intent,
    requestUrl,
    selectionId: selection.id,
    shop,
  });
};

const handlePauseSubscriptionAction = async ({
  customerShopifyId,
  requestUrl,
  selectionId,
  shop,
}: Omit<PortalActionContext, "formData">) => {
    const { admin } = await unauthenticated.admin(shop);
    const loaded = await loadSyncedSelectionForAction({
      admin,
      customerShopifyId,
      selectionId,
      shop,
      statusFilter: "active",
    });

    if (loaded.error || !loaded.selection) {
      return renderMessage(loaded.error ?? "Abonnement introuvable.");
    }

    const selection = loaded.selection;

    const blockedResponse = await getPortalModificationBlockResponse({
      actionKind: "subscription_control",
      customerShopifyId,
      intent: "pauseSubscription",
      requestUrl,
      selection,
      shop,
    });

    if (blockedResponse) {
      return blockedResponse;
    }

    if (!selection.subscriptionContractId) {
      return renderMessage("Contrat d’abonnement Shopify manquant.");
    }

    const shopifyResult = await pauseSubscriptionContract(
      admin,
      selection.subscriptionContractId,
    );

    if ("error" in shopifyResult) {
      return renderMessage(
        shopifyResult.error ?? "Erreur lors de l’opération Shopify.",
      );
    }

    await prisma.subscriptionMealSelection.update({
      data: { active: false, status: "paused" },
      where: { id: selection.id },
    });

    await archiveResumeAttemptOnPause(selection.id);

    try {
      const episodeId = await ensureSubscriptionPauseEmailEpisode(selection.id);
      await ensureAndProcessEmailEventImmediately({
        backfillStamp: (event) =>
          backfillSubscriptionPausedStampFromSentEvent({
            episodeId,
            event,
            selectionId: selection.id,
          }),
        input: {
          eventType: EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED,
          idempotencyKey: buildSubscriptionPausedEmailEventIdempotencyKey(
            selection.id,
            episodeId,
          ),
          metaJson: buildSubscriptionPausedEmailEventMetaJson({
            cause: "user_voluntary",
            episodeId,
          }),
          referenceId: selection.id,
          referenceType: EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
          shop,
        },
      });
    } catch (error) {
      console.log("[PORTAL] subscription-paused EmailEvent failed", {
        error: error instanceof Error ? error.message : error,
        selectionId: selection.id,
      });
    }

    const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      portalRequestUrl: requestUrl,
      successMessage: "Ton abonnement a bien été mis en pause.",
    });
};

const handleSendPaymentUpdateEmailAction = async ({
  customerShopifyId,
  requestUrl,
  selectionId,
  shop,
}: Omit<PortalActionContext, "formData">) => {
    const { admin } = await unauthenticated.admin(shop);
    const loaded = await loadSyncedSelectionForAction({
      admin,
      customerShopifyId,
      selectionId,
      shop,
      statusFilter: { in: ["active", "paused"] },
    });

    if (loaded.error || !loaded.selection) {
      return renderMessage(loaded.error ?? "Abonnement introuvable.");
    }

    const selection = loaded.selection;

    if (!selection.subscriptionContractId) {
      return renderMessage("Contrat d’abonnement Shopify manquant.");
    }

    const eligibility = await resolvePaymentUpdateEligibility(
      admin,
      selection.subscriptionContractId,
    );

    const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    if (!eligibility.available) {
      return renderPortal({
        ...portalData,
        portalRequestUrl: requestUrl,
      });
    }

    const emailResult = await sendPaymentUpdateEmailForSelection({
      admin,
      forceResendAfterFailure: true,
      selection,
    });

    if (!emailResult.ok) {
      const isCustomerFacingRateLimit =
        emailResult.error.includes("déjà été envoyé récemment");

      if (!isCustomerFacingRateLimit) {
        return renderPortal({
          ...portalData,
          portalRequestUrl: requestUrl,
        });
      }

      return renderPortal({
        ...portalData,
        portalRequestUrl: requestUrl,
        errorMessage: emailResult.error,
      });
    }

    return renderPortal({
      ...portalData,
      portalRequestUrl: requestUrl,
      successMessage:
        "Un email sécurisé vous a été envoyé pour mettre à jour votre moyen de paiement.",
    });
};

const handleUpdateDeliveryAddressAction = async ({
  customerShopifyId,
  formData,
  requestUrl,
  selectionId,
  shop,
}: PortalActionContext) => {
  const { admin } = await unauthenticated.admin(shop);
  const loaded = await loadSyncedSelectionForAction({
    admin,
    customerShopifyId,
    selectionId,
    shop,
    statusFilter: { in: ["active", "paused"] },
  });

  if (loaded.error || !loaded.selection) {
    return renderMessage(loaded.error ?? "Abonnement introuvable.");
  }

  const selection = loaded.selection;

  if (!selection.subscriptionContractId) {
    return renderMessage("Contrat d’abonnement Shopify manquant.");
  }

  const recoveryRecord = await getPortalRecoveryForSelection(selection.id);
  const blockReason = getPortalModificationBlockReason(
    selection,
    recoveryRecord,
    getCutoffNow(),
  );

  if (blockReason) {
    console.log("[portal] modification blocked by getPortalModificationBlockReason", {
      blockReason,
      intent: "updateDeliveryAddress",
      selectionId,
      shop,
    });

    const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      portalRequestUrl: requestUrl,
      errorMessage: PORTAL_ADDRESS_PREPARATION_MESSAGE,
    });
  }

  const coverage = await resolveCurrentDeliveryCoverage({ selection });

  if (coverage.locked) {
    const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      portalRequestUrl: requestUrl,
      errorMessage: PORTAL_ADDRESS_ORDER_LOCKED_MESSAGE,
    });
  }

  const validated = validatePortalDeliveryAddressInput({
    address1: formData.get("address1"),
    address2: formData.get("address2"),
    city: formData.get("city"),
    countryCode: formData.get("countryCode"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    zip: formData.get("zip"),
  });

  if (!validated.ok) {
    const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      portalRequestUrl: requestUrl,
      errorMessage:
        validated.errors[0]?.message ?? "Adresse invalide. Vérifiez les champs.",
    });
  }

  const updateResult = await updateSubscriptionContractShippingAddress({
    address: validated.address,
    admin,
    subscriptionContractId: selection.subscriptionContractId,
  });

  const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

  if (!portalData) {
    return renderMessage("Configuration incomplète.");
  }

  if (!updateResult.ok) {
    return renderPortal({
      ...portalData,
      portalRequestUrl: requestUrl,
      errorMessage: updateResult.error,
    });
  }

  return renderPortal({
    ...portalData,
    portalRequestUrl: requestUrl,
    successMessage: PORTAL_ADDRESS_SUCCESS_MESSAGE,
  });
};

const handleResumeSubscriptionAction = async ({
  customerShopifyId,
  formData,
  requestUrl,
  selectionId,
  shop,
}: PortalActionContext) => {
  const selectedMealsRaw = String(formData.get("selectedMeals") ?? "");
  const parsedQuantities = parseMealQuantities(selectedMealsRaw);

  if ("error" in parsedQuantities) {
    return renderMessage(parsedQuantities.error);
  }

  const { admin } = await unauthenticated.admin(shop);
  const loaded = await loadSyncedSelectionForAction({
    admin,
    customerShopifyId,
    selectionId,
    shop,
    statusFilter: "paused",
  });

  if (loaded.error || !loaded.selection) {
    return renderMessage(loaded.error ?? "Abonnement introuvable.");
  }

  const selection = loaded.selection;

  if (typeof selection.mealsCount !== "number") {
    return renderMessage("Abonnement introuvable.");
  }

  if (!selection.subscriptionContractId) {
    return renderMessage("Contrat d’abonnement Shopify manquant.");
  }

  const recoveryRecord = await getPortalRecoveryForSelection(selection.id);
  const blockedResponse = await getPortalModificationBlockResponse({
    actionKind: "subscription_control",
    customerShopifyId,
    intent: "resumeSubscription",
    recoveryRecord,
    requestUrl,
    selection,
    shop,
  });

  if (blockedResponse) {
    return blockedResponse;
  }

  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings?.mealCollectionId) {
    return renderMessage("Configuration incomplète.");
  }

  const [boxCatalog, mealCatalog] = await Promise.all([
    fetchBuilderBoxOptions(admin),
    fetchBuilderMealOptions(admin, settings.mealCollectionId),
  ]);
  const objective = await resolveSelectionObjective(admin, selection, boxCatalog);
  const meals = getPortalMealsForObjective(mealCatalog, objective);

  if (!objective) {
    return renderMessage(
      "Impossible de modifier les plats : l’objectif actuel n’a pas pu être déterminé.",
    );
  }

  const validation = validateMealSelection({
    meals,
    mealsCount: selection.mealsCount,
    objective,
    quantities: parsedQuantities.quantities,
  });

  if ("error" in validation) {
    return renderMessage(validation.error);
  }

  await prisma.subscriptionMealSelection.update({
    data: {
      selectedMeals: validation.titles as Prisma.InputJsonValue,
    },
    where: { id: selection.id },
  });

  const resumeMode = await resolvePortalResumeMode({
    admin,
    localNextBillingDate: selection.nextBillingDate,
    recovery: recoveryRecord,
    selection,
  });

  if (resumeMode.mode === "blocked") {
    return renderMessage(resumeMode.error);
  }

  if (resumeMode.mode === "pay_now") {
    const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      portalRequestUrl: requestUrl,
      errorMessage:
        "Votre abonnement nécessite un prélèvement immédiat. Utilisez le bouton de reprise avec paiement.",
    });
  }

  const resumeResult = await completePortalScheduledResume({
    admin,
    resumeSchedule: resumeMode.resumeSchedule,
    selectionId: selection.id,
    subscriptionContractId: selection.subscriptionContractId,
  });

  if (!resumeResult.ok) {
    return renderMessage(
      resumeResult.error ?? "Impossible de reprendre l’abonnement.",
    );
  }

  try {
    await markMealSelectionExplicitForCurrentDelivery({
      selectionId: selection.id,
    });
  } catch (error) {
    console.log("[portal] meal selection explicit tracking failed", {
      error: error instanceof Error ? error.message : error,
      intent: "resumeSubscription",
      selectionId: selection.id,
    });
  }

  const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

  if (!portalData) {
    return renderMessage("Configuration incomplète.");
  }

  return renderPortal({
    ...portalData,
    portalRequestUrl: requestUrl,
    successMessage: `Votre abonnement est repris. Votre prochain prélèvement reste prévu le ${formatFrenchDate(resumeMode.nextBillingDate.toISOString())}.`,
  });
};

const handleResumeSubscriptionAndPayAction = async ({
  customerShopifyId,
  formData,
  requestUrl,
  selectionId,
  shop,
}: PortalActionContext) => {
    const selectedMealsRaw = String(formData.get("selectedMeals") ?? "");
    const parsedQuantities = parseMealQuantities(selectedMealsRaw);

    if ("error" in parsedQuantities) {
      return renderMessage(parsedQuantities.error);
    }

    const { admin } = await unauthenticated.admin(shop);
    const loaded = await loadSyncedSelectionForAction({
      admin,
      customerShopifyId,
      selectionId,
      shop,
      statusFilter: "paused",
    });

    if (loaded.error || !loaded.selection) {
      return renderMessage(loaded.error ?? "Abonnement introuvable.");
    }

    const selection = loaded.selection;

    if (typeof selection.mealsCount !== "number") {
      return renderMessage("Abonnement introuvable.");
    }

    if (!selection.subscriptionContractId) {
      return renderMessage("Contrat d’abonnement Shopify manquant.");
    }

    const recoveryRecord = await getPortalRecoveryForSelection(selection.id);
    const blockedResponse = await getPortalModificationBlockResponse({
      actionKind: "subscription_control",
      customerShopifyId,
      intent: "resumeSubscriptionAndPay",
      recoveryRecord,
      requestUrl,
      selection,
      shop,
    });

    if (blockedResponse) {
      return blockedResponse;
    }

    const settings = await prisma.appSettings.findUnique({ where: { shop } });

    if (!settings?.mealCollectionId) {
      return renderMessage("Configuration incomplète.");
    }

    const [boxCatalog, mealCatalog] = await Promise.all([
      fetchBuilderBoxOptions(admin),
      fetchBuilderMealOptions(admin, settings.mealCollectionId),
    ]);
    const objective = await resolveSelectionObjective(admin, selection, boxCatalog);
    const meals = getPortalMealsForObjective(mealCatalog, objective);

    if (!objective) {
      return renderMessage(
        "Impossible de modifier les plats : l’objectif actuel n’a pas pu être déterminé.",
      );
    }

    const validation = validateMealSelection({
      meals,
      mealsCount: selection.mealsCount,
      objective,
      quantities: parsedQuantities.quantities,
    });

    if ("error" in validation) {
      return renderMessage(validation.error);
    }

    await prisma.subscriptionMealSelection.update({
      data: {
        selectedMeals: validation.titles as Prisma.InputJsonValue,
      },
      where: { id: selection.id },
    });

    const resumeMode = await resolvePortalResumeMode({
      admin,
      localNextBillingDate: selection.nextBillingDate,
      recovery: recoveryRecord,
      selection,
    });

    if (resumeMode.mode === "blocked") {
      return renderMessage(resumeMode.error);
    }

    if (resumeMode.mode === "schedule_only") {
      const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

      if (!portalData) {
        return renderMessage("Configuration incomplète.");
      }

      return renderPortal({
        ...portalData,
        portalRequestUrl: requestUrl,
        errorMessage:
          "Votre abonnement n’est pas dû pour un prélèvement immédiat. Utilisez Reprendre mon abonnement.",
      });
    }

    const resumeAttempt = await ensureResumeAttemptForBilling(selection.id);
    const { isNewCycle, isRetry, resumeAttemptKey, retryNumber } = resumeAttempt;
    let idempotencyKey = resumeAttempt.idempotencyKey;
    const oldNextBillingDate = selection.nextBillingDate;
    let resumeLockStatus: (typeof RESUME_LOCK_STATUS)[keyof typeof RESUME_LOCK_STATUS] | null =
      null;
    let resumeLockAttemptId: string | null = null;
    let resumeLockError: string | null = null;
    let resumeLockOrderId: string | null = null;
    let billingStarted = false;

    try {
      const prepareResult = await prepareResumeBillingFlow({
        admin,
        idempotencyKey,
        resumeAttemptKey,
        selectionId: selection.id,
        subscriptionContractId: selection.subscriptionContractId,
      });

      if (
        prepareResult.action === "proceed" &&
        prepareResult.idempotencyKey
      ) {
        idempotencyKey = prepareResult.idempotencyKey;
      }

      const isFreshRetry =
        prepareResult.action === "proceed" && prepareResult.isFreshRetry === true;
      const effectiveRetryNumber =
        prepareResult.action === "proceed"
          ? (prepareResult.retryNumber ?? retryNumber)
          : retryNumber;

      if (prepareResult.action === "block_processing") {
        const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

        if (!portalData) {
          return renderMessage("Configuration incomplète.");
        }

        return renderPortal({
          ...portalData,
          portalRequestUrl: requestUrl,
          errorMessage:
            "Votre reprise est déjà en cours de traitement. Patientez quelques instants avant de réessayer.",
        });
      }

      const completeResumeWithSchedule = async ({
        attemptId,
        orderId,
        paymentAt,
      }: {
        attemptId: string;
        orderId: string;
        paymentAt: Date;
      }) => {
        console.log("[resumeBilling] billing confirmed with order", {
          attemptId,
          idempotencyKey,
          isNewCycle,
          isRetry,
          localStatusBefore: selection.status,
          orderId,
          paymentAt: paymentAt.toISOString(),
          resumeAttemptKey,
          selectionId: selection.id,
        });

        resumeLockAttemptId = attemptId;
        resumeLockOrderId = orderId;

        await closeRecoveryOnSuccessfulOrder({
          orderId,
          selectionId: selection.id,
        });

        const scheduleResult = await scheduleNextBillingDateAfterResumePayment({
          admin,
          paymentAt,
          selection: {
            nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
            preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
          },
          selectionId: selection.id,
          subscriptionContractId: selection.subscriptionContractId!,
        });

        const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

        if (!portalData) {
          resumeLockStatus = scheduleResult.ok
            ? RESUME_LOCK_STATUS.SUCCEEDED
            : RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED;
          resumeLockError = scheduleResult.ok ? null : scheduleResult.error;

          return renderMessage("Configuration incomplète.");
        }

        if (!scheduleResult.ok) {
          resumeLockStatus = RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED;
          resumeLockError = scheduleResult.error;

          console.log("[resumeBilling] nextBillingDate-only retry needed", {
            error: scheduleResult.error,
            orderId,
            selectionId: selection.id,
          });

          return renderPortal({
            ...portalData,
            portalRequestUrl: requestUrl,
            successMessage:
              "Votre abonnement est repris et votre box confirmée. La date de prochaine facturation n’a pas pu être mise à jour automatiquement — réessayez dans un instant ou contactez le support.",
          });
        }

        resumeLockStatus = RESUME_LOCK_STATUS.SUCCEEDED;

        try {
          await markMealSelectionExplicitForCurrentDelivery({
            selectionId: selection.id,
          });
        } catch (error) {
          console.log("[portal] meal selection explicit tracking failed", {
            error: error instanceof Error ? error.message : error,
            intent: "resumeSubscriptionAndPay",
            selectionId: selection.id,
          });
        }

        return renderPortal({
          ...portalData,
          portalRequestUrl: requestUrl,
          successMessage:
            "Votre abonnement est repris. Votre prochaine box a été confirmée.",
        });
      };

      const ensureShopifyContractActive = async () => {
        const activateResult = await activateSubscriptionContractWithVerification(
          admin,
          selection.subscriptionContractId!,
          { selectionId: selection.id },
        );

        if (!activateResult.ok) {
          resumeLockStatus = RESUME_LOCK_STATUS.FAILED;
          resumeLockError =
            activateResult.error ?? "Impossible de reprendre l’abonnement.";

          console.log("[resumeBilling] activation failed", {
            selectionId: selection.id,
            shopifyStatus: activateResult.shopifyStatus,
          });

          return activateResult.error;
        }

        return null;
      };

      if (prepareResult.action === "billing_already_succeeded") {
        const activationError = await ensureShopifyContractActive();

        if (activationError) {
          const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

          if (!portalData) {
            return renderMessage(activationError);
          }

          return renderPortal({
            ...portalData,
            portalRequestUrl: requestUrl,
            errorMessage: activationError,
          });
        }

        return completeResumeWithSchedule({
          attemptId: prepareResult.attemptId,
          orderId: prepareResult.orderId,
          paymentAt: prepareResult.paymentAt,
        });
      }

      if (prepareResult.action === "retry_schedule_only") {
        console.log("[resumeBilling] nextBillingDate-only retry", {
          orderId: prepareResult.orderId,
          selectionId: selection.id,
        });

        return completeResumeWithSchedule({
          attemptId: prepareResult.attemptId,
          orderId: prepareResult.orderId,
          paymentAt: prepareResult.paymentAt,
        });
      }

      await setResumeBillingProcessingLock({
        resumeAttemptKey,
        selectionId: selection.id,
      });
      billingStarted = true;

      const activationError = await ensureShopifyContractActive();

      if (activationError) {
        const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

        if (!portalData) {
          return renderMessage(activationError);
        }

        return renderPortal({
          ...portalData,
          portalRequestUrl: requestUrl,
          errorMessage: activationError,
        });
      }

      console.log("[resumeBilling] creating billing attempt", {
        createdNewAttempt: isNewCycle || isFreshRetry,
        idempotencyKey,
        isFreshRetry,
        isNewCycle,
        isRetry,
        resumeAttemptKey,
        retryNumber: effectiveRetryNumber,
        selectionId: selection.id,
      });

      const billingResult = await triggerSubscriptionBillingAttempt({
        admin,
        idempotencyKey,
        selectionId: selection.id,
        subscriptionContractId: selection.subscriptionContractId,
        syncNextBillingDateFromShopify: false,
      });

      resumeLockAttemptId = billingResult.attemptId;
      resumeLockOrderId = billingResult.orderId;

      console.log("[resumeBilling] billing attempt result", {
        attemptId: billingResult.attemptId,
        createdNewAttempt: isNewCycle || isFreshRetry,
        idempotencyKey,
        isFreshRetry,
        localActive: selection.active,
        localStatus: selection.status,
        orderId: billingResult.orderId,
        resumeAttemptKey,
        retryNumber: effectiveRetryNumber,
        selectionId: selection.id,
        status: billingResult.status,
      });

      if (
        billingResult.status === "failure" ||
        billingResult.status === "unknown"
      ) {
        resumeLockError =
          billingResult.errorMessage ??
          "Le paiement n’a pas pu être effectué.";

        await handleResumeBillingFailure({
          admin,
          attemptId: billingResult.attemptId,
          errorMessage: resumeLockError,
          selection,
          source: "portal_resume",
        });
        billingStarted = false;
        resumeLockStatus = null;

        const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

        if (!portalData) {
          return renderMessage("Configuration incomplète.");
        }

        console.log("[resumeBilling] retry allowed after billing failure", {
          selectionId: selection.id,
        });

        return renderPortal({
          ...portalData,
          portalRequestUrl: requestUrl,
          errorMessage:
            "Le paiement n’a pas pu être effectué. Vos choix de plats ont été enregistrés. Vous pouvez réessayer.",
        });
      }

      if (
        billingResult.status === "success" &&
        billingResult.orderId &&
        billingResult.paymentAt
      ) {
        console.log("[resumeBilling] immediate billing succeeded", {
          oldNextBillingDate: oldNextBillingDate?.toISOString() ?? null,
          orderId: billingResult.orderId,
          paymentAt: billingResult.paymentAt.toISOString(),
          selectionId: selection.id,
          subscriptionContractId: selection.subscriptionContractId,
        });

        billingStarted = false;

        return completeResumeWithSchedule({
          attemptId: billingResult.attemptId ?? billingResult.orderId,
          orderId: billingResult.orderId,
          paymentAt: billingResult.paymentAt,
        });
      }

      resumeLockStatus = RESUME_LOCK_STATUS.PROCESSING;
      resumeLockError = null;
      resumeLockAttemptId = billingResult.attemptId;

      if (isFreshRetry || isNewCycle) {
        console.log("[resumeBilling] new retry submitted", {
          attemptId: billingResult.attemptId,
          createdNewAttempt: true,
          idempotencyKey,
          resumeAttemptKey,
          retryNumber: effectiveRetryNumber,
          selectionId: selection.id,
          status: billingResult.status,
        });
      }

      const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

      if (!portalData) {
        return renderMessage("Configuration incomplète.");
      }

      return renderPortal({
        ...portalData,
        portalRequestUrl: requestUrl,
        processingMessage:
          "Votre paiement est en cours de confirmation. Ne relancez pas la demande.",
      });
    } catch (error) {
      resumeLockStatus = RESUME_LOCK_STATUS.FAILED;
      resumeLockError =
        error instanceof Error
          ? error.message
          : "Une erreur inattendue est survenue lors de la reprise.";

      console.error("[resumeBilling] unexpected error", {
        error: resumeLockError,
        selectionId: selection.id,
      });

      return renderMessage(resumeLockError);
    } finally {
      if (resumeLockStatus) {
        await releaseResumeBillingLock({
          attemptId: resumeLockAttemptId,
          errorMessage: resumeLockError,
          orderId: resumeLockOrderId,
          resumeAttemptKey,
          selectionId: selection.id,
          status: resumeLockStatus,
        });

        if (
          resumeLockOrderId &&
          resumeLockStatus !== RESUME_LOCK_STATUS.FAILED &&
          resumeLockStatus !== RESUME_LOCK_STATUS.PROCESSING
        ) {
          try {
            await resetSubscriptionPausedEmailSentAt({
              selectionId: selection.id,
            });
          } catch (error) {
            console.log("[PORTAL] subscription-paused email reset failed", {
              error: error instanceof Error ? error.message : error,
              selectionId: selection.id,
            });
          }
        }
      } else if (billingStarted) {
        await releaseResumeBillingLock({
          attemptId: resumeLockAttemptId,
          errorMessage:
            resumeLockError ??
            "La reprise a été interrompue. Vous pouvez réessayer.",
          orderId: resumeLockOrderId,
          resumeAttemptKey,
          selectionId: selection.id,
          status: RESUME_LOCK_STATUS.FAILED,
        });

        console.log("[resumeBilling] lock released after interrupted flow", {
          selectionId: selection.id,
        });
      }
    }
};

const handleChangeSubscriptionBoxAction = async ({
  customerShopifyId,
  formData,
  requestUrl,
  selectionId,
  shop,
}: PortalActionContext) => {
    const productVariantId = String(formData.get("productVariantId") ?? "").trim();
    // selectedMeals: unpaid → current selection; locked → pending toSelectedMeals only
    // (never written onto SubscriptionMealSelection for the current delivery).
    const selectedMealsRaw = String(formData.get("selectedMeals") ?? "");

    if (!productVariantId) {
      return renderMessage("Veuillez sélectionner une box.");
    }

    const { admin } = await unauthenticated.admin(shop);
    const loaded = await loadSyncedSelectionForAction({
      admin,
      customerShopifyId,
      selectionId,
      shop,
      statusFilter: { in: ["active", "paused"] },
    });

    if (loaded.error || !loaded.selection) {
      return renderMessage(loaded.error ?? "Abonnement introuvable.");
    }

    const selection = loaded.selection;

    if (typeof selection.mealsCount !== "number") {
      return renderMessage("Abonnement introuvable.");
    }

    if (!selection.subscriptionContractId) {
      return renderMessage("Contrat d’abonnement Shopify manquant.");
    }

    const settings = await prisma.appSettings.findUnique({ where: { shop } });

    if (!settings?.mealCollectionId) {
      return renderMessage("Configuration incomplète.");
    }

    const recoveryRecord = await getPortalRecoveryForSelection(selection.id);

    // BOX-CHANGE SoT: any open recovery blocks box-size change (not meal edits).
    if (isRecoveryBlockingBoxChange(recoveryRecord?.status)) {
      const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

      if (!portalData) {
        return renderMessage("Configuration incomplète.");
      }

      return renderPortal({
        ...portalData,
        portalRequestUrl: requestUrl,
        errorMessage: BOX_CHANGE_RECOVERY_BLOCK_MESSAGE,
      });
    }

    const blockReason = getPortalModificationBlockReason(
      selection,
      recoveryRecord,
      getCutoffNow(),
    );

    // billing_processing is NOT a hard block for box change: coverage routes it to
    // pending next-cycle (billing_in_flight). Cutoff / resume / missing_contract stay.
    if (blockReason && blockReason !== "billing_processing") {
      return renderPortalModificationBlocked({
        actionKind: "modification",
        blockReason,
        customerShopifyId,
        intent: "changeSubscriptionBox",
        selectionId: selection.id,
        shop,
      });
    }

    const [catalog, mealCatalog] = await Promise.all([
      fetchBuilderBoxOptions(admin),
      fetchBuilderMealOptions(admin, settings.mealCollectionId),
    ]);
    const currentVariantId =
      (await fetchSubscriptionContractCurrentVariantId(
        admin,
        selection.subscriptionContractId,
      )) ?? selection.boxVariantShopifyId;
    const currentBox = findBuilderBoxByVariantId(catalog, currentVariantId);

    if (!currentBox) {
      return renderMessage(
        "Impossible de changer de box : l’objectif actuel n’a pas pu être déterminé.",
      );
    }

    const allowedBoxes = filterBuilderBoxesByObjective(
      catalog,
      currentBox.objective,
    );
    const selectedBox = findBuilderBoxByVariantId(allowedBoxes, productVariantId);

    if (
      !selectedBox ||
      selectedBox.objective !== currentBox.objective ||
      !isPortalV2MealCount(selectedBox.mealCount)
    ) {
      return renderMessage("La box sélectionnée n’est pas disponible.");
    }

    const isSameBox = currentBox.variantId === selectedBox.variantId;

    if (isSameBox) {
      const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

      if (!portalData) {
        return renderMessage("Configuration incomplète.");
      }

      return renderPortal({
        ...portalData,
        portalRequestUrl: requestUrl,
        errorMessage:
          "Vous avez déjà cette box. Choisissez une autre taille pour continuer.",
      });
    }

    const { coverage, locked } = await resolveCurrentDeliveryCoverage({
      selection,
    });

    // Paid / in-flight / ambiguous → pending only. Validate target meals against the
    // NEW box size, store them on SubscriptionBoxChange.toSelectedMeals. Do not mutate
    // Shopify, selection.mealsCount, or selection.selectedMeals (current delivery).
    if (locked) {
      if (!selection.nextBillingDate) {
        return renderMessage(
          "Impossible d’enregistrer le changement de box : date de prochain prélèvement introuvable.",
        );
      }

      const parsedQuantities = parseMealQuantities(selectedMealsRaw);

      if ("error" in parsedQuantities) {
        return renderMessage(parsedQuantities.error);
      }

      const meals = getPortalMealsForObjective(mealCatalog, currentBox.objective);
      const validation = validateMealSelection({
        meals,
        mealsCount: selectedBox.mealCount,
        objective: currentBox.objective,
        quantities: parsedQuantities.quantities,
      });

      if ("error" in validation) {
        return renderMessage(validation.error);
      }

      await requestSubscriptionBoxChange({
        effectiveBillingDate: selection.nextBillingDate,
        fromProductVariantId: currentBox.variantId,
        shop,
        subscriptionContractId: selection.subscriptionContractId,
        subscriptionMealSelectionId: selection.id,
        toMealsCount: selectedBox.mealCount,
        toProductVariantId: selectedBox.variantId,
        toSelectedMeals: validation.titles,
        toSellingPlanId: selectedBox.sellingPlanId,
      });

      const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

      if (!portalData) {
        return renderMessage("Configuration incomplète.");
      }

      console.log("[portal] subscription box change deferred to next cycle", {
        coverage,
        intent: "changeSubscriptionBox",
        selectionId: selection.id,
        toMealsCount: selectedBox.mealCount,
        toProductVariantId: selectedBox.variantId,
        toSelectedMealsCount: validation.titles.length,
      });

      return renderPortal({
        ...portalData,
        portalRequestUrl: requestUrl,
        boxChangeEffect: BOX_CHANGE_EFFECT.NEXT_CYCLE,
        successMessage: buildBoxChangePendingSuccessMessage(
          selectedBox.mealCount,
        ),
      });
    }

    // unpaid → immediate (existing behavior)
    const parsedQuantities = parseMealQuantities(selectedMealsRaw);

    if ("error" in parsedQuantities) {
      return renderMessage(parsedQuantities.error);
    }

    const meals = getPortalMealsForObjective(mealCatalog, currentBox.objective);
    const validation = validateMealSelection({
      meals,
      mealsCount: selectedBox.mealCount,
      objective: currentBox.objective,
      quantities: parsedQuantities.quantities,
    });

    if ("error" in validation) {
      return renderMessage(validation.error);
    }

    await updateSubscriptionContractBoxViaDraft({
      admin,
      box: {
        price: selectedBox.price,
        sellingPlanId: selectedBox.sellingPlanId,
        variantId: selectedBox.variantId,
      },
      subscriptionContractId: selection.subscriptionContractId,
    });

    await prisma.subscriptionMealSelection.update({
      data: {
        boxProductShopifyId: selectedBox.productId,
        boxSellingPlanShopifyId: selectedBox.sellingPlanId,
        boxSubscriptionPrice: selectedBox.price,
        boxTitle: getPortalV2BoxTitle(selectedBox.mealCount),
        boxVariantShopifyId: selectedBox.variantId,
        mealsCount: selectedBox.mealCount,
        selectedMeals: validation.titles as Prisma.InputJsonValue,
      },
      where: { id: selection.id },
    });

    try {
      await markMealSelectionExplicitForCurrentDelivery({
        selectionId: selection.id,
      });
    } catch (error) {
      console.log("[portal] meal selection explicit tracking failed", {
        error: error instanceof Error ? error.message : error,
        intent: "changeSubscriptionBox",
        selectionId: selection.id,
      });
    }

    const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      portalRequestUrl: requestUrl,
      boxChangeEffect: BOX_CHANGE_EFFECT.IMMEDIATE,
      successMessage:
        selection.status === "paused"
          ? BOX_CHANGE_IMMEDIATE_PAUSED_SUCCESS_MESSAGE
          : BOX_CHANGE_IMMEDIATE_SUCCESS_MESSAGE,
    });
};

const handleUpdateFutureMealSelectionAction = async ({
  customerShopifyId,
  formData,
  requestUrl,
  selectionId,
  shop,
}: PortalActionContext) => {
  const selectedMealsRaw = String(formData.get("selectedMeals") ?? "");
  const parsedQuantities = parseMealQuantities(selectedMealsRaw);

  if ("error" in parsedQuantities) {
    return renderMessage(parsedQuantities.error);
  }

  const { admin } = await unauthenticated.admin(shop);
  const loaded = await loadSyncedSelectionForAction({
    admin,
    customerShopifyId,
    selectionId,
    shop,
    statusFilter: { in: ["active", "paused"] },
  });

  if (loaded.error || !loaded.selection) {
    return renderMessage(loaded.error ?? "Abonnement introuvable.");
  }

  const selection = loaded.selection;

  if (typeof selection.mealsCount !== "number") {
    return renderMessage("Abonnement introuvable.");
  }

  const recoveryRecord = await getPortalRecoveryForSelection(selection.id);
  const blockedResponse = await getPortalModificationBlockResponse({
    actionKind: "modification",
    customerShopifyId,
    intent: "updateFutureMealSelection",
    recoveryRecord,
    requestUrl,
    selection,
    shop,
  });

  if (blockedResponse) {
    return blockedResponse;
  }

  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings?.mealCollectionId) {
    return renderMessage("Configuration incomplète.");
  }

  const [boxCatalog, mealCatalog] = await Promise.all([
    fetchBuilderBoxOptions(admin),
    fetchBuilderMealOptions(admin, settings.mealCollectionId),
  ]);
  const objective = await resolveSelectionObjective(admin, selection, boxCatalog);
  const meals = getPortalMealsForObjective(mealCatalog, objective);

  if (!objective) {
    return renderMessage(
      "Impossible de modifier les plats : l’objectif actuel n’a pas pu être déterminé.",
    );
  }

  const validation = validateMealSelection({
    meals,
    mealsCount: selection.mealsCount,
    objective,
    quantities: parsedQuantities.quantities,
  });

  if ("error" in validation) {
    return renderMessage(validation.error);
  }

  // Same cycle key as cutoff / explicit tracking — do not invent a second date.
  const effectiveDeliveryDate =
    resolveMealSelectionCycle(selection).effectiveDeliveryDate;

  // BOX-CHANGE-7D: Selection + matching current-delivery BoxOrder in one local
  // transaction. Fail closed on BoxOrder mealsCount mismatch (no false success).
  // No BoxOrder (unpaid cycle) → Selection-only. Never mutates mealsCount.
  const syncResult = await applyCurrentDeliveryMealSelectionUpdate({
    db: prisma,
    effectiveDeliveryDate,
    mealsCount: selection.mealsCount,
    selectedMeals: validation.titles,
    shop,
    subscriptionContractId: selection.subscriptionContractId,
    subscriptionSelectionId: selection.id,
  });

  if (!syncResult.ok) {
    console.log("[portal] current delivery meals BoxOrder sync refused", {
      error: syncResult.error,
      intent: "updateFutureMealSelection",
      selectionId: selection.id,
    });

    return renderMessage(
      syncResult.error === "box_order_meals_count_mismatch"
        ? "Impossible de mettre à jour les plats : la commande de livraison ne correspond pas à votre box actuelle. Contactez le support."
        : "Impossible de mettre à jour les plats : plusieurs commandes correspondent à cette livraison. Contactez le support.",
    );
  }

  console.log("[portal] current delivery meals synced", {
    boxOrderId: syncResult.boxOrderId,
    boxOrderSynced: syncResult.boxOrderSynced,
    effectiveDeliveryDate,
    intent: "updateFutureMealSelection",
    selectionId: selection.id,
  });

  try {
    if (effectiveDeliveryDate) {
      await ensureAndProcessEmailEventImmediately({
        backfillStamp: (event) =>
          backfillMealSelectionConfirmedStampFromSentEvent({
            deliveryDate: effectiveDeliveryDate,
            event,
            selectionId: selection.id,
          }),
        input: {
          eventType: EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED,
          idempotencyKey: buildMealSelectionConfirmedEmailEventIdempotencyKey(
            selection.id,
            effectiveDeliveryDate,
          ),
          metaJson: buildCampaignEmailEventMetaJson(effectiveDeliveryDate),
          referenceId: selection.id,
          referenceType: EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
          shop,
        },
      });
    }
  } catch (error) {
    console.log("[portal] meal-selection-confirmed EmailEvent failed", {
      error: error instanceof Error ? error.message : error,
      intent: "updateFutureMealSelection",
      selectionId: selection.id,
    });
  }

  const portalData = await loadPortalData({ customerShopifyId, requestedSubscriptionId: selectionId, shop });

  if (!portalData) {
    return renderMessage("Configuration incomplète.");
  }

  return renderPortal({
    ...portalData,
    portalRequestUrl: requestUrl,
    successMessage: "Tes prochains plats ont bien été mis à jour.",
  });
};

export const handlePortalAction = async (request: Request) => {
  const shop = getShopFromRequest(request);
  const customerShopifyId = getCustomerIdFromRequest(request);

  if (!shop) {
    return renderMessage("Boutique introuvable.");
  }

  if (!customerShopifyId) {
    return renderMessage(
      "Connecte-toi à ton compte pour modifier tes prochaines box.",
      { loginLink: true },
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const selectionId = String(formData.get("selectionId") ?? "");

  if (!selectionId) {
    return renderMessage("Données de sélection invalides.");
  }

  const context: PortalActionContext = {
    customerShopifyId,
    formData,
    requestUrl: request.url,
    selectionId,
    shop,
  };

  if (intent === "pauseSubscription") {
    return handlePauseSubscriptionAction(context);
  }

  if (intent === "sendPaymentUpdateEmail") {
    return handleSendPaymentUpdateEmailAction(context);
  }

  if (intent === "updateDeliveryAddress") {
    return handleUpdateDeliveryAddressAction(context);
  }

  if (intent === "resumeSubscription") {
    return handleResumeSubscriptionAction(context);
  }

  if (intent === "resumeSubscriptionAndPay") {
    return handleResumeSubscriptionAndPayAction(context);
  }

  if (intent === "changeSubscriptionBox") {
    return handleChangeSubscriptionBoxAction(context);
  }

  if (intent !== "updateFutureMealSelection") {
    return renderMessage("Action non reconnue.");
  }

  return handleUpdateFutureMealSelectionAction(context);
};

