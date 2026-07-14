import prisma from "../../db.server";
import {
  activateSubscriptionContractWithVerification,
  fetchSubscriptionContractNextBillingDate,
} from "../../services/subscriptionBillingWorker.server";
import {
  alignScheduledResumeWithDeliverySchedule,
  resolveResumeDeliverySchedule,
} from "../../services/deliverySchedule.server";
import type { ResumeDeliveryScheduleResolution } from "../../utils/deliveryDate";

export type PortalResumeMode =
  | { mode: "blocked"; error: string }
  | { mode: "pay_now" }
  | {
      mode: "schedule_only";
      nextBillingDate: Date;
      resumeSchedule: ResumeDeliveryScheduleResolution;
    };

type RecoverySnapshot = {
  failureCount: number;
  status: string;
} | null;

export const isPortalRecoveryOverdue = (recovery: RecoverySnapshot) => {
  if (!recovery) {
    return false;
  }

  if (recovery.status === "final_failed") {
    return true;
  }

  if (recovery.failureCount > 0 && recovery.status !== "recovered") {
    return true;
  }

  return false;
};

export const isSubscriptionBillingDue = (
  freshNextBillingDate: Date | null,
  localNextBillingDate: Date | null,
): boolean => {
  const candidates = [freshNextBillingDate, localNextBillingDate].filter(
    (date): date is Date =>
      date instanceof Date && !Number.isNaN(date.getTime()),
  );

  if (candidates.length === 0) {
    return false;
  }

  const earliest = new Date(
    Math.min(...candidates.map((date) => date.getTime())),
  );

  return earliest.getTime() <= Date.now();
};

export const derivePortalResumeUi = ({
  freshNextBillingDate,
  localNextBillingDate,
  recovery,
}: {
  freshNextBillingDate?: Date | null;
  localNextBillingDate: Date | null;
  recovery: RecoverySnapshot;
}): {
  resumeBlockedMessage: string | null;
  resumeRequiresPayment: boolean;
} => {
  if (isPortalRecoveryOverdue(recovery)) {
    return { resumeBlockedMessage: null, resumeRequiresPayment: true };
  }

  const hasAnyDate = freshNextBillingDate ?? localNextBillingDate;

  if (!hasAnyDate) {
    return {
      resumeBlockedMessage:
        "Impossible de confirmer la date de votre prochain prélèvement. Réessayez plus tard ou contactez le support.",
      resumeRequiresPayment: false,
    };
  }

  if (
    isSubscriptionBillingDue(
      freshNextBillingDate ?? null,
      localNextBillingDate,
    )
  ) {
    return { resumeBlockedMessage: null, resumeRequiresPayment: true };
  }

  return { resumeBlockedMessage: null, resumeRequiresPayment: false };
};

export const resolvePortalResumeMode = async ({
  admin,
  localNextBillingDate,
  recovery,
  selection,
}: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  };
  localNextBillingDate: Date | null;
  recovery: RecoverySnapshot;
  selection: {
    id: string;
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday: number | null;
    subscriptionContractId: string | null;
  };
}): Promise<PortalResumeMode> => {
  if (!selection.subscriptionContractId) {
    return {
      error: "Contrat d’abonnement Shopify manquant.",
      mode: "blocked",
    };
  }

  if (isPortalRecoveryOverdue(recovery)) {
    return { mode: "pay_now" };
  }

  const freshNextBillingDate = await fetchSubscriptionContractNextBillingDate(
    admin,
    selection.subscriptionContractId,
  );

  if (!freshNextBillingDate && !localNextBillingDate) {
    return {
      error:
        "Impossible de confirmer la date de votre prochain prélèvement. Réessayez plus tard ou contactez le support.",
      mode: "blocked",
    };
  }

  if (freshNextBillingDate) {
    await prisma.subscriptionMealSelection.update({
      data: { nextBillingDate: freshNextBillingDate },
      where: { id: selection.id },
    });
  }

  if (
    !isSubscriptionBillingDue(freshNextBillingDate, localNextBillingDate)
  ) {
    const resumeSchedule = resolveResumeDeliverySchedule({
      mode: "schedule_only",
      selection: {
        nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
        preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
      },
      selectionId: selection.id,
    });

    if (!resumeSchedule) {
      return {
        error:
          "Impossible de calculer la prochaine livraison. Réessayez plus tard ou contactez le support.",
        mode: "blocked",
      };
    }

    return {
      mode: "schedule_only",
      nextBillingDate: resumeSchedule.alignedNextBillingDate,
      resumeSchedule,
    };
  }

  return { mode: "pay_now" };
};

export const completePortalScheduledResume = async ({
  admin,
  resumeSchedule,
  selectionId,
  subscriptionContractId,
}: {
  admin: Parameters<typeof activateSubscriptionContractWithVerification>[0];
  resumeSchedule: ResumeDeliveryScheduleResolution;
  selectionId: string;
  subscriptionContractId: string;
}): Promise<{ error?: string; ok: true } | { error: string; ok: false }> => {
  const activateResult = await activateSubscriptionContractWithVerification(
    admin,
    subscriptionContractId,
    { selectionId },
  );

  if (!activateResult.ok) {
    return {
      error: activateResult.error ?? "Impossible de reprendre l’abonnement.",
      ok: false,
    };
  }

  const alignmentResult = await alignScheduledResumeWithDeliverySchedule({
    admin,
    resumeSchedule,
    selectionId,
    subscriptionContractId,
  });

  if (alignmentResult.status === "failed") {
    await prisma.subscriptionMealSelection.update({
      data: {
        active: true,
        nextScheduledDeliveryDate: resumeSchedule.resumeTargetDeliveryDate,
        status: "active",
      },
      where: { id: selectionId },
    });

    return {
      error:
        "Votre abonnement est repris, mais la date de prochaine facturation n’a pas pu être mise à jour automatiquement.",
      ok: false,
    };
  }

  if (alignmentResult.status === "skipped") {
    await prisma.subscriptionMealSelection.update({
      data: {
        active: true,
        nextBillingDate: resumeSchedule.alignedNextBillingDate,
        nextScheduledDeliveryDate: resumeSchedule.resumeTargetDeliveryDate,
        status: "active",
      },
      where: { id: selectionId },
    });

    return { ok: true };
  }

  await prisma.subscriptionMealSelection.update({
    data: {
      active: true,
      status: "active",
    },
    where: { id: selectionId },
  });

  return { ok: true };
};
