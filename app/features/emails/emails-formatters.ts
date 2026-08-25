/**
 * Admin email observability (EMAIL-6G-A) — pure formatters.
 * No Prisma / no EmailEvent writes.
 */

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES,
  EMAIL_EVENT_STATUS,
  EMAIL_EVENT_TYPE,
  type EmailEventStatus,
  type EmailEventType,
  isEmailEventStatus,
  isEmailEventType,
} from "../../constants/emailEvent";
import type {
  EmailAdminPeriod,
  EmailAdminSafeMeta,
  EmailAdminTimelineStep,
} from "./emails-types";
import { isEmailAdminPeriod } from "./emails-types";

const SAFE_META_KEYS = [
  "deliveryDate",
  "orderId",
  "recoveryId",
  "recoveryIds",
  "pauseCause",
  "cause",
  "episodeId",
] as const;

const SAFE_META_LABELS_FR: Record<(typeof SAFE_META_KEYS)[number], string> = {
  deliveryDate: "Date de livraison",
  orderId: "Commande",
  recoveryId: "Récupération",
  recoveryIds: "Récupérations",
  pauseCause: "Cause de pause",
  cause: "Cause",
  episodeId: "Épisode",
};

const EVENT_TYPE_LABELS_FR: Record<EmailEventType, string> = {
  [EMAIL_EVENT_TYPE.PAYMENT_FAILED]: "Paiement échoué",
  [EMAIL_EVENT_TYPE.PAYMENT_RECOVERED]: "Paiement récupéré",
  [EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED]: "Abonnement créé",
  [EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED]: "Abonnement mis en pause",
  [EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED]: "Sélection de repas confirmée",
  [EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER]: "Rappel sélection de repas",
  [EMAIL_EVENT_TYPE.UPCOMING_DELIVERY]: "Livraison à venir",
};

const STATUS_LABELS_FR: Record<EmailEventStatus, string> = {
  [EMAIL_EVENT_STATUS.PENDING]: "En attente",
  [EMAIL_EVENT_STATUS.PROCESSING]: "En traitement",
  [EMAIL_EVENT_STATUS.SENT]: "Envoyé",
  [EMAIL_EVENT_STATUS.FAILED]: "Échoué",
  [EMAIL_EVENT_STATUS.CANCELLED]: "Annulé",
};

export type EmailStatusBadgeTone =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "exhausted"
  | "cancelled"
  | "other";

export const formatAdminDateTime = (value: Date | string | null | undefined) => {
  if (value == null) return null;
  return new Date(value).toLocaleString("fr-FR");
};

/** Compact operator copy: "25/08/2026 à 11:28". */
export const formatAdminDateTimeCompact = (
  value: Date | string | null | undefined,
): string | null => {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const datePart = date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart} à ${timePart}`;
};

export const formatAttemptCountLabel = (attemptCount: number): string =>
  attemptCount <= 1
    ? `${attemptCount} tentative`
    : `${attemptCount} tentatives`;

/**
 * Deterministic recipient masking for ops list / detail.
 * john.doe@gmail.com → j***@gmail.com
 */
export const maskRecipientEmail = (
  email: string | null | undefined,
): string => {
  if (email == null || email.trim() === "") {
    return "—";
  }

  const trimmed = email.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return "***";
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const first = local[0] ?? "*";
  return `${first}***@${domain}`;
};

export const formatEmailEventTypeLabel = (eventType: string): string => {
  if (isEmailEventType(eventType)) {
    return EVENT_TYPE_LABELS_FR[eventType];
  }
  return eventType;
};

export const isEmailEventExhausted = ({
  attemptCount,
  status,
}: {
  attemptCount: number;
  status: string;
}): boolean =>
  status === EMAIL_EVENT_STATUS.FAILED &&
  attemptCount >= EMAIL_EVENT_MAX_ATTEMPTS;

export const isEmailEventStaleProcessing = ({
  now = new Date(),
  processingStartedAt,
  status,
}: {
  now?: Date;
  processingStartedAt: Date | string | null | undefined;
  status: string;
}): boolean => {
  if (status !== EMAIL_EVENT_STATUS.PROCESSING || processingStartedAt == null) {
    return false;
  }
  const started = new Date(processingStartedAt).getTime();
  if (Number.isNaN(started)) return false;
  const staleMs = EMAIL_EVENT_PROCESSING_STALE_AFTER_MINUTES * 60 * 1000;
  return started < now.getTime() - staleMs;
};

export const formatEmailEventStatusLabel = ({
  attemptCount,
  status,
}: {
  attemptCount: number;
  status: string;
}): string => {
  if (isEmailEventExhausted({ attemptCount, status })) {
    return "Épuisé";
  }
  if (isEmailEventStatus(status)) {
    return STATUS_LABELS_FR[status];
  }
  return status;
};

export const getEmailStatusBadgeTone = ({
  attemptCount,
  status,
}: {
  attemptCount: number;
  status: string;
}): EmailStatusBadgeTone => {
  if (isEmailEventExhausted({ attemptCount, status })) {
    return "exhausted";
  }
  switch (status) {
    case EMAIL_EVENT_STATUS.PENDING:
      return "pending";
    case EMAIL_EVENT_STATUS.PROCESSING:
      return "processing";
    case EMAIL_EVENT_STATUS.SENT:
      return "sent";
    case EMAIL_EVENT_STATUS.FAILED:
      return "failed";
    case EMAIL_EVENT_STATUS.CANCELLED:
      return "cancelled";
    default:
      return "other";
  }
};

/**
 * Next retry / sent column copy.
 * pending + nextAttemptAt null → due immediately (worker OR clause).
 * failed → never show next retry as if scheduled.
 */
export const formatEmailNextOrSentLabel = ({
  nextAttemptAt,
  sentAt,
  status,
}: {
  nextAttemptAt: Date | string | null | undefined;
  sentAt: Date | string | null | undefined;
  status: string;
}): string => {
  if (status === EMAIL_EVENT_STATUS.SENT) {
    return formatAdminDateTime(sentAt) ?? "—";
  }
  if (status === EMAIL_EVENT_STATUS.PENDING) {
    if (nextAttemptAt == null) {
      return "Dès que possible";
    }
    return formatAdminDateTime(nextAttemptAt) ?? "—";
  }
  if (status === EMAIL_EVENT_STATUS.FAILED) {
    return "—";
  }
  if (status === EMAIL_EVENT_STATUS.PROCESSING) {
    return "En cours";
  }
  if (status === EMAIL_EVENT_STATUS.CANCELLED) {
    return "—";
  }
  return formatAdminDateTime(nextAttemptAt) ?? "—";
};

export const truncateErrorMessage = (
  message: string | null | undefined,
  maxLen = 80,
): string => {
  if (message == null || message.trim() === "") return "—";
  const trimmed = message.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
};

/**
 * Defensive metaJson → safe key/value map.
 * Never throws; returns unavailable flag via null + metaUnavailable helper.
 */
export const parseEmailEventSafeMeta = (
  metaJson: string | null | undefined,
): { metaSafe: EmailAdminSafeMeta | null; metaUnavailable: boolean } => {
  if (metaJson == null || metaJson.trim() === "") {
    return { metaSafe: null, metaUnavailable: false };
  }

  try {
    const parsed: unknown = JSON.parse(metaJson);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { metaSafe: null, metaUnavailable: true };
    }

    const record = parsed as Record<string, unknown>;
    const metaSafe: EmailAdminSafeMeta = {};

    for (const key of SAFE_META_KEYS) {
      if (!(key in record)) continue;
      const value = record[key];
      if (value == null) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        metaSafe[key] = String(value);
      } else if (Array.isArray(value)) {
        const parts = value
          .filter(
            (item): item is string | number | boolean =>
              typeof item === "string" ||
              typeof item === "number" ||
              typeof item === "boolean",
          )
          .map(String);
        if (parts.length > 0) {
          metaSafe[key] = parts.join(", ");
        }
      }
    }

    return {
      metaSafe: Object.keys(metaSafe).length > 0 ? metaSafe : null,
      metaUnavailable: false,
    };
  } catch {
    return { metaSafe: null, metaUnavailable: true };
  }
};

/**
 * Timeline from current timestamps only — not a full attempt history.
 */
export const buildEmailEventTimeline = ({
  cancelledAt,
  createdAt,
  lastAttemptAt,
  processingStartedAt,
  sentAt,
  status,
}: {
  cancelledAt?: Date | string | null;
  createdAt: Date | string;
  lastAttemptAt?: Date | string | null;
  processingStartedAt?: Date | string | null;
  sentAt?: Date | string | null;
  status: string;
}): EmailAdminTimelineStep[] => {
  const steps: EmailAdminTimelineStep[] = [
    { at: formatAdminDateTime(createdAt), label: "Créé" },
  ];

  if (lastAttemptAt != null) {
    steps.push({
      at: formatAdminDateTime(lastAttemptAt),
      label: "Dernière tentative",
    });
  }

  if (processingStartedAt != null) {
    steps.push({
      at: formatAdminDateTime(processingStartedAt),
      label: "En traitement",
    });
  }

  if (sentAt != null) {
    steps.push({ at: formatAdminDateTime(sentAt), label: "Envoyé" });
  }

  if (cancelledAt != null) {
    steps.push({ at: formatAdminDateTime(cancelledAt), label: "Annulé" });
  } else if (status === EMAIL_EVENT_STATUS.FAILED) {
    steps.push({
      at: formatAdminDateTime(lastAttemptAt) ?? null,
      label: "Échec",
    });
  }

  return steps;
};

export const parseEmailAdminStatusFilter = (
  raw: string | null,
): EmailEventStatus | "all" => {
  if (raw == null || raw === "" || raw === "all") return "all";
  return isEmailEventStatus(raw) ? raw : "all";
};

export const parseEmailAdminEventTypeFilter = (
  raw: string | null,
): EmailEventType | "all" => {
  if (raw == null || raw === "" || raw === "all") return "all";
  return isEmailEventType(raw) ? raw : "all";
};

export const parseEmailAdminPeriodFilter = (
  raw: string | null,
): EmailAdminPeriod => {
  if (raw == null || raw === "") return "all";
  return isEmailAdminPeriod(raw) ? raw : "all";
};

export const parseEmailAdminPage = (raw: string | null): number => {
  const n = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
};

export const periodToCreatedAtGte = (
  period: EmailAdminPeriod,
  now = new Date(),
): Date | null => {
  switch (period) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "all":
    default:
      return null;
  }
};

export const computeSuccessRate24h = ({
  failed,
  sent,
}: {
  failed: number;
  sent: number;
}): number | null => {
  const denominator = sent + failed;
  if (denominator <= 0) return null;
  return sent / denominator;
};

export const formatSuccessRatePercent = (
  rate: number | null,
): string => {
  if (rate == null) return "Aucune donnée";
  return `${Math.round(rate * 100)}%`;
};

export const formatReferenceLabel = ({
  referenceId,
  referenceType,
}: {
  referenceId: string;
  referenceType: string;
}): string => `${referenceType}:${referenceId}`;

/** Truncate long ids for table cells; full value stays in drawer / title. */
export const truncateForTable = (
  value: string | null | undefined,
  maxLen = 28,
): string => {
  if (value == null || value.trim() === "") return "—";
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const head = Math.ceil((maxLen - 1) * 0.55);
  const tail = maxLen - 1 - head;
  return `${trimmed.slice(0, head)}…${trimmed.slice(-tail)}`;
};

export const formatSafeMetaLabel = (key: string): string => {
  if (key in SAFE_META_LABELS_FR) {
    return SAFE_META_LABELS_FR[key as keyof typeof SAFE_META_LABELS_FR];
  }
  return key;
};

/** Human-friendly meta values (e.g. ISO date → fr-FR). */
export const formatSafeMetaValue = (key: string, value: string): string => {
  if (key === "deliveryDate") {
    const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (isoDay) {
      const [, y, m, d] = isoDay;
      return `${d}/${m}/${y}`;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("fr-FR");
    }
  }
  return value;
};
