import prisma from "../../db.server";
import { resetSubscriptionPausedEmailSentAt } from "../../services/email/email.server";
import {
  activateSubscriptionContractWithVerification,
  fetchSubscriptionContractNextBillingDate,
  pauseSubscriptionContractOnShopify,
} from "../../services/subscriptionBillingWorker.server";
import {
  alignScheduledResumeWithDeliverySchedule,
  resolveResumeDeliverySchedule,
} from "../../services/deliverySchedule.server";
import type { ResumeDeliveryScheduleResolution } from "../../utils/deliveryDate";

/** Calendar was not secured after activate — never treat resume as successful. */
export const PORTAL_SCHEDULED_RESUME_CALENDAR_UNSECURED_ERROR =
  "Impossible de reprendre l’abonnement : la date de prochaine facturation n’a pas pu être sécurisée. Réessayez plus tard.";

/** Activate succeeded, align failed, and pause rollback also failed. */
export const PORTAL_SCHEDULED_RESUME_ROLLBACK_FAILED_ERROR =
  "Impossible de sécuriser la reprise de l’abonnement. Contactez le support avant toute nouvelle tentative.";

/** DB could not be marked active after a secured Shopify calendar. */
export const PORTAL_SCHEDULED_RESUME_DB_SYNC_FAILED_ERROR =
  "Votre calendrier de facturation a été mis à jour, mais la reprise n’a pas pu être finalisée. Réessayez dans un instant ou contactez le support.";

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

export type CompletePortalScheduledResumeDeps = {
  activate?: typeof activateSubscriptionContractWithVerification;
  align?: typeof alignScheduledResumeWithDeliverySchedule;
  pause?: typeof pauseSubscriptionContractOnShopify;
  markSelectionActive?: (input: {
    selectionId: string;
  }) => Promise<void>;
  ensureSelectionPaused?: (input: {
    selectionId: string;
  }) => Promise<void>;
  resetPausedEmail?: typeof resetSubscriptionPausedEmailSentAt;
  now?: () => Date;
};

const defaultMarkSelectionActive = async ({
  selectionId,
}: {
  selectionId: string;
}) => {
  await prisma.subscriptionMealSelection.update({
    data: {
      active: true,
      status: "active",
    },
    where: { id: selectionId },
  });
};

const defaultEnsureSelectionPaused = async ({
  selectionId,
}: {
  selectionId: string;
}) => {
  await prisma.subscriptionMealSelection.update({
    data: {
      active: false,
      status: "paused",
    },
    where: { id: selectionId },
  });
};

/**
 * Fail-closed schedule-only resume:
 * activate → align calendar → only then mark local active.
 * If alignment is not secured, pause Shopify again and keep DB paused so an
 * old nextBillingDate can never become billable after a partial resume.
 */
export const completePortalScheduledResume = async ({
  admin,
  deps = {},
  resumeSchedule,
  selectionId,
  subscriptionContractId,
}: {
  admin: Parameters<typeof activateSubscriptionContractWithVerification>[0];
  deps?: CompletePortalScheduledResumeDeps;
  resumeSchedule: ResumeDeliveryScheduleResolution;
  selectionId: string;
  subscriptionContractId: string;
}): Promise<{ error?: string; ok: true } | { error: string; ok: false }> => {
  const activate =
    deps.activate ?? activateSubscriptionContractWithVerification;
  const align = deps.align ?? alignScheduledResumeWithDeliverySchedule;
  const pause = deps.pause ?? pauseSubscriptionContractOnShopify;
  const markSelectionActive =
    deps.markSelectionActive ?? defaultMarkSelectionActive;
  const ensureSelectionPaused =
    deps.ensureSelectionPaused ?? defaultEnsureSelectionPaused;
  const resetPausedEmail =
    deps.resetPausedEmail ?? resetSubscriptionPausedEmailSentAt;
  const now = deps.now ?? (() => new Date());

  const activateResult = await activate(admin, subscriptionContractId, {
    selectionId,
  });

  if (!activateResult.ok) {
    return {
      error: activateResult.error ?? "Impossible de reprendre l’abonnement.",
      ok: false,
    };
  }

  const alignmentResult = await align({
    admin,
    resumeSchedule,
    selectionId,
    subscriptionContractId,
  });

  const calendarSecured =
    alignmentResult.status === "aligned" &&
    alignmentResult.alignedNextBillingDate.getTime() > now().getTime();

  if (!calendarSecured) {
    const alignError =
      alignmentResult.status === "failed"
        ? alignmentResult.error
        : alignmentResult.status === "skipped"
          ? alignmentResult.reason
          : "aligned_next_billing_date_not_in_future";

    console.log("[portal-resume] schedule_only calendar unsecured — rolling back", {
      alignError,
      alignStatus: alignmentResult.status,
      selectionId,
      subscriptionContractId,
      targetNextBillingDate: resumeSchedule.alignedNextBillingDate.toISOString(),
    });

    const pauseResult = await pause(admin, subscriptionContractId);

    try {
      await ensureSelectionPaused({ selectionId });
    } catch (error) {
      console.log("[portal-resume] failed to keep selection paused after align failure", {
        error: error instanceof Error ? error.message : String(error),
        selectionId,
        subscriptionContractId,
      });
    }

    if (pauseResult.error) {
      console.log("[portal-resume] CRITICAL pause rollback failed after activate", {
        alignError,
        pauseError: pauseResult.error,
        selectionId,
        subscriptionContractId,
      });

      return {
        error: PORTAL_SCHEDULED_RESUME_ROLLBACK_FAILED_ERROR,
        ok: false,
      };
    }

    return {
      error: PORTAL_SCHEDULED_RESUME_CALENDAR_UNSECURED_ERROR,
      ok: false,
    };
  }

  try {
    await markSelectionActive({ selectionId });
    await resetPausedEmail({ selectionId });
  } catch (error) {
    console.log("[portal-resume] DB sync failed after secured calendar", {
      error: error instanceof Error ? error.message : String(error),
      selectionId,
      subscriptionContractId,
    });

    return {
      error: PORTAL_SCHEDULED_RESUME_DB_SYNC_FAILED_ERROR,
      ok: false,
    };
  }

  return { ok: true };
};
