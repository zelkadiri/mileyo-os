import prisma from "../../db.server";
import { resetSubscriptionPausedEmailSentAt } from "../../services/email/email.server";
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

type ResumeSelectionScheduleInput = {
  nextScheduledDeliveryDate: string | null;
  preferredDeliveryWeekday: number | null;
};

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

/**
 * Portal resume payment is owed only for a real overdue recovery.
 * A stale nextBillingDate frozen during a voluntary pause is not a debt.
 */
export const derivePortalResumeUi = ({
  freshNextBillingDate,
  localNextBillingDate,
  now = new Date(),
  recovery,
  selection,
}: {
  freshNextBillingDate?: Date | null;
  localNextBillingDate: Date | null;
  now?: Date;
  recovery: RecoverySnapshot;
  selection?: ResumeSelectionScheduleInput;
}): {
  resumeBlockedMessage: string | null;
  resumeDisplayNextBillingDate: Date | null;
  resumeRequiresPayment: boolean;
} => {
  if (isPortalRecoveryOverdue(recovery)) {
    return {
      resumeBlockedMessage: null,
      resumeDisplayNextBillingDate: null,
      resumeRequiresPayment: true,
    };
  }

  const existingNextBillingDate = freshNextBillingDate ?? localNextBillingDate;

  const resumeSchedule = selection
    ? resolveResumeDeliverySchedule({
        existingNextBillingDate,
        mode: "schedule_only",
        now,
        selection,
      })
    : null;

  if (!existingNextBillingDate && !resumeSchedule) {
    return {
      resumeBlockedMessage:
        "Impossible de confirmer la date de votre prochain prélèvement. Réessayez plus tard ou contactez le support.",
      resumeDisplayNextBillingDate: null,
      resumeRequiresPayment: false,
    };
  }

  return {
    resumeBlockedMessage: null,
    resumeDisplayNextBillingDate:
      resumeSchedule?.alignedNextBillingDate ??
      (existingNextBillingDate &&
      existingNextBillingDate.getTime() > now.getTime()
        ? existingNextBillingDate
        : null),
    resumeRequiresPayment: false,
  };
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

  if (freshNextBillingDate) {
    await prisma.subscriptionMealSelection.update({
      data: { nextBillingDate: freshNextBillingDate },
      where: { id: selection.id },
    });
  }

  const existingNextBillingDate = freshNextBillingDate ?? localNextBillingDate;

  const resumeSchedule = resolveResumeDeliverySchedule({
    existingNextBillingDate,
    mode: "schedule_only",
    selection: {
      nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
      preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
    },
    selectionId: selection.id,
  });

  if (!resumeSchedule) {
    if (!existingNextBillingDate) {
      return {
        error:
          "Impossible de confirmer la date de votre prochain prélèvement. Réessayez plus tard ou contactez le support.",
        mode: "blocked",
      };
    }

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

    await resetSubscriptionPausedEmailSentAt({ selectionId });

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

    await resetSubscriptionPausedEmailSentAt({ selectionId });

    return { ok: true };
  }

  await prisma.subscriptionMealSelection.update({
    data: {
      active: true,
      status: "active",
    },
    where: { id: selectionId },
  });

  await resetSubscriptionPausedEmailSentAt({ selectionId });

  return { ok: true };
};
