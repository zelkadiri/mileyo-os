/**
 * Admin email observability (EMAIL-6G-A) — read-only types.
 */

import type {
  EmailEventStatus,
  EmailEventType,
} from "../../constants/emailEvent";

export const EMAIL_ADMIN_PAGE_SIZE = 25;

export const EMAIL_ADMIN_PERIODS = ["24h", "7d", "30d", "all"] as const;
export type EmailAdminPeriod = (typeof EMAIL_ADMIN_PERIODS)[number];

export const isEmailAdminPeriod = (value: string): value is EmailAdminPeriod =>
  (EMAIL_ADMIN_PERIODS as readonly string[]).includes(value);

export type EmailAdminFilters = {
  eventType: EmailEventType | "all";
  page: number;
  period: EmailAdminPeriod;
  q: string;
  status: EmailEventStatus | "all";
};

export type EmailAdminMetrics = {
  cancelled: number;
  exhausted: number;
  failed: number;
  pending: number;
  processing: number;
  sentLast24h: number;
  /** Terminal 24h: sent / (sent + failed). null when denominator is 0. */
  successRate24h: number | null;
};

export type EmailAdminSafeMeta = Record<string, string>;

export type EmailAdminTimelineStep = {
  at: string | null;
  label: string;
};

export type EmailAdminListItem = {
  attemptCount: number;
  createdAt: string;
  eventType: string;
  id: string;
  isExhausted: boolean;
  isStaleProcessing: boolean;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextAttemptAt: string | null;
  providerId: string | null;
  recipientMasked: string;
  referenceId: string;
  referenceType: string;
  sentAt: string | null;
  status: string;
};

export type EmailAdminDetail = EmailAdminListItem & {
  cancelledAt: string | null;
  idempotencyKey: string;
  lastAttemptAt: string | null;
  metaSafe: EmailAdminSafeMeta | null;
  metaUnavailable: boolean;
  processingStartedAt: string | null;
  recipientEmailMasked: string;
  timeline: EmailAdminTimelineStep[];
  updatedAt: string;
};

export type EmailAdminPageData = {
  detail: EmailAdminDetail | null;
  events: EmailAdminListItem[];
  filters: EmailAdminFilters;
  metrics: EmailAdminMetrics;
  pageSize: number;
  shop: string;
  totalCount: number;
  totalPages: number;
};
