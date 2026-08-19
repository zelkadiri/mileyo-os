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
import {
  fetchSubscriptionContractCurrentVariantId,
  updateSubscriptionContractBoxViaDraft,
} from "../../services/subscriptionContractBoxChange.server";
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
  selectionId,
  shop,
}: {
  actionKind: PortalModificationActionKind;
  blockReason: NonNullable<ReturnType<typeof getPortalModificationBlockReason>>;
  customerShopifyId: string;
  intent: string;
  selectionId: string;
  shop: string;
}) => {
  console.log("[portal] modification blocked by getPortalModificationBlockReason", {
    blockReason,
    intent,
    selectionId,
    shop,
  });

  const portalData = await loadPortalData({ customerShopifyId, shop });

  if (!portalData) {
    return renderMessage("Configuration incomplète.");
  }

  return renderPortal({
    ...portalData,
    errorMessage: getPortalModificationBlockMessage(blockReason, actionKind),
  });
};

const getPortalModificationBlockResponse = async ({
  actionKind,
  customerShopifyId,
  intent,
  recoveryRecord,
  selection,
  shop,
}: {
  actionKind: PortalModificationActionKind;
  customerShopifyId: string;
  intent: string;
  recoveryRecord?: { status: string } | null;
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
    selectionId: selection.id,
    shop,
  });
};

const handlePauseSubscriptionAction = async ({
  customerShopifyId,
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

    const portalData = await loadPortalData({ customerShopifyId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      successMessage: "Ton abonnement a bien été mis en pause.",
    });
};

const handleSendPaymentUpdateEmailAction = async ({
  customerShopifyId,
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

    const portalData = await loadPortalData({ customerShopifyId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    if (!eligibility.available) {
      return renderPortal({
        ...portalData,
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
        });
      }

      return renderPortal({
        ...portalData,
        errorMessage: emailResult.error,
      });
    }

    return renderPortal({
      ...portalData,
      successMessage:
        "Si votre email est valide, vous recevrez un lien sécurisé Shopify pour mettre à jour votre carte.",
    });
};

const handleResumeSubscriptionAction = async ({
  customerShopifyId,
  formData,
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
    const portalData = await loadPortalData({ customerShopifyId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
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

  const portalData = await loadPortalData({ customerShopifyId, shop });

  if (!portalData) {
    return renderMessage("Configuration incomplète.");
  }

  return renderPortal({
    ...portalData,
    successMessage: `Votre abonnement est repris. Votre prochain prélèvement reste prévu le ${formatFrenchDate(resumeMode.nextBillingDate.toISOString())}.`,
  });
};

const handleResumeSubscriptionAndPayAction = async ({
  customerShopifyId,
  formData,
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
      const portalData = await loadPortalData({ customerShopifyId, shop });

      if (!portalData) {
        return renderMessage("Configuration incomplète.");
      }

      return renderPortal({
        ...portalData,
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
        const portalData = await loadPortalData({ customerShopifyId, shop });

        if (!portalData) {
          return renderMessage("Configuration incomplète.");
        }

        return renderPortal({
          ...portalData,
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

        const portalData = await loadPortalData({ customerShopifyId, shop });

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
            successMessage:
              "Votre abonnement est repris et votre box confirmée. La date de prochaine facturation n’a pas pu être mise à jour automatiquement — réessayez dans un instant ou contactez le support.",
          });
        }

        resumeLockStatus = RESUME_LOCK_STATUS.SUCCEEDED;

        return renderPortal({
          ...portalData,
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
          const portalData = await loadPortalData({ customerShopifyId, shop });

          if (!portalData) {
            return renderMessage(activationError);
          }

          return renderPortal({
            ...portalData,
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
        const portalData = await loadPortalData({ customerShopifyId, shop });

        if (!portalData) {
          return renderMessage(activationError);
        }

        return renderPortal({
          ...portalData,
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

        const portalData = await loadPortalData({ customerShopifyId, shop });

        if (!portalData) {
          return renderMessage("Configuration incomplète.");
        }

        console.log("[resumeBilling] retry allowed after billing failure", {
          selectionId: selection.id,
        });

        return renderPortal({
          ...portalData,
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

      const portalData = await loadPortalData({ customerShopifyId, shop });

      if (!portalData) {
        return renderMessage("Configuration incomplète.");
      }

      return renderPortal({
        ...portalData,
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
  selectionId,
  shop,
}: PortalActionContext) => {
    const productVariantId = String(formData.get("productVariantId") ?? "").trim();
    const selectedMealsRaw = String(formData.get("selectedMeals") ?? "");
    const parsedQuantities = parseMealQuantities(selectedMealsRaw);

    if ("error" in parsedQuantities) {
      return renderMessage(parsedQuantities.error);
    }

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
    const blockedResponse = await getPortalModificationBlockResponse({
      actionKind: "modification",
      customerShopifyId,
      intent: "changeSubscriptionBox",
      recoveryRecord,
      selection,
      shop,
    });

    if (blockedResponse) {
      return blockedResponse;
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
      const portalData = await loadPortalData({ customerShopifyId, shop });

      if (!portalData) {
        return renderMessage("Configuration incomplète.");
      }

      return renderPortal({
        ...portalData,
        errorMessage:
          "Vous avez déjà cette box. Choisissez une autre taille pour continuer.",
      });
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

    const portalData = await loadPortalData({ customerShopifyId, shop });

    if (!portalData) {
      return renderMessage("Configuration incomplète.");
    }

    return renderPortal({
      ...portalData,
      successMessage:
        selection.status === "paused"
          ? "Votre nouvelle box et vos plats ont été enregistrés. Vous pourrez reprendre l’abonnement quand vous le souhaitez."
          : "Votre box et vos plats ont été modifiés pour votre prochaine commande.",
    });
};

const handleUpdateFutureMealSelectionAction = async ({
  customerShopifyId,
  formData,
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

  const portalData = await loadPortalData({ customerShopifyId, shop });

  if (!portalData) {
    return renderMessage("Configuration incomplète.");
  }

  return renderPortal({
    ...portalData,
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
    selectionId,
    shop,
  };

  if (intent === "pauseSubscription") {
    return handlePauseSubscriptionAction(context);
  }

  if (intent === "sendPaymentUpdateEmail") {
    return handleSendPaymentUpdateEmailAction(context);
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

