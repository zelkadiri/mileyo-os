/**
 * Admin email observability (EMAIL-6G-A) — Prisma loader (read-only).
 * Mutations live in emails-actions.server.ts (EMAIL-6G-B).
 */

import {
  EMAIL_EVENT_MAX_ATTEMPTS,
  EMAIL_EVENT_STATUS,
} from "../../constants/emailEvent";
import db from "../../db.server";
import { authenticate } from "../../shopify.server";
import {
  buildEmailEventTimeline,
  computeSuccessRate24h,
  isEmailEventExhausted,
  isEmailEventStaleProcessing,
  maskRecipientEmail,
  parseEmailAdminEventTypeFilter,
  parseEmailAdminPage,
  parseEmailAdminPeriodFilter,
  parseEmailAdminStatusFilter,
  parseEmailEventSafeMeta,
  periodToCreatedAtGte,
} from "./emails-formatters";
import type {
  EmailAdminDetail,
  EmailAdminFilters,
  EmailAdminListItem,
  EmailAdminMetrics,
  EmailAdminPageData,
} from "./emails-types";
import { EMAIL_ADMIN_PAGE_SIZE } from "./emails-types";

type EmailEventRow = {
  attemptCount: number;
  cancelledAt: Date | null;
  createdAt: Date;
  eventType: string;
  id: string;
  idempotencyKey: string;
  lastAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  metaJson: string | null;
  nextAttemptAt: Date | null;
  processingStartedAt: Date | null;
  providerId: string | null;
  recipientEmail: string | null;
  referenceId: string;
  referenceType: string;
  sentAt: Date | null;
  status: string;
  updatedAt: Date;
};

const toIso = (value: Date | null): string | null =>
  value == null ? null : value.toISOString();

const mapListItem = (
  row: EmailEventRow,
  now: Date,
): EmailAdminListItem => ({
  attemptCount: row.attemptCount,
  createdAt: row.createdAt.toISOString(),
  eventType: row.eventType,
  id: row.id,
  isExhausted: isEmailEventExhausted({
    attemptCount: row.attemptCount,
    status: row.status,
  }),
  isStaleProcessing: isEmailEventStaleProcessing({
    now,
    processingStartedAt: row.processingStartedAt,
    status: row.status,
  }),
  lastErrorCode: row.lastErrorCode,
  lastErrorMessage: row.lastErrorMessage,
  nextAttemptAt: toIso(row.nextAttemptAt),
  providerId: row.providerId,
  recipientMasked: maskRecipientEmail(row.recipientEmail),
  referenceId: row.referenceId,
  referenceType: row.referenceType,
  sentAt: toIso(row.sentAt),
  status: row.status,
});

const mapDetail = (row: EmailEventRow, now: Date): EmailAdminDetail => {
  const list = mapListItem(row, now);
  const { metaSafe, metaUnavailable } = parseEmailEventSafeMeta(row.metaJson);

  return {
    ...list,
    cancelledAt: toIso(row.cancelledAt),
    idempotencyKey: row.idempotencyKey,
    lastAttemptAt: toIso(row.lastAttemptAt),
    metaSafe,
    metaUnavailable,
    processingStartedAt: toIso(row.processingStartedAt),
    recipientEmailMasked: list.recipientMasked,
    timeline: buildEmailEventTimeline({
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
      lastAttemptAt: row.lastAttemptAt,
      processingStartedAt: row.processingStartedAt,
      sentAt: row.sentAt,
      status: row.status,
    }),
    updatedAt: row.updatedAt.toISOString(),
  };
};

const parseFilters = (url: URL): EmailAdminFilters => ({
  eventType: parseEmailAdminEventTypeFilter(url.searchParams.get("eventType")),
  page: parseEmailAdminPage(url.searchParams.get("page")),
  period: parseEmailAdminPeriodFilter(url.searchParams.get("period")),
  q: (url.searchParams.get("q") ?? "").trim(),
  status: parseEmailAdminStatusFilter(url.searchParams.get("status")),
});

const buildListWhere = ({
  filters,
  now,
  shop,
}: {
  filters: EmailAdminFilters;
  now: Date;
  shop: string;
}) => {
  const where: Record<string, unknown> = { shop };

  if (filters.status !== "all") {
    where.status = filters.status;
  }
  if (filters.eventType !== "all") {
    where.eventType = filters.eventType;
  }

  const createdAtGte = periodToCreatedAtGte(filters.period, now);
  if (createdAtGte) {
    where.createdAt = { gte: createdAtGte };
  }

  if (filters.q) {
    where.OR = [
      { recipientEmail: { contains: filters.q } },
      { referenceId: { contains: filters.q } },
      { providerId: { contains: filters.q } },
      { idempotencyKey: { contains: filters.q } },
    ];
  }

  return where;
};

const loadMetrics = async ({
  now,
  shop,
}: {
  now: Date;
  shop: string;
}): Promise<EmailAdminMetrics> => {
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    pending,
    processing,
    failed,
    cancelled,
    exhausted,
    sentLast24h,
    failedLast24h,
  ] = await Promise.all([
    db.emailEvent.count({
      where: { shop, status: EMAIL_EVENT_STATUS.PENDING },
    }),
    db.emailEvent.count({
      where: { shop, status: EMAIL_EVENT_STATUS.PROCESSING },
    }),
    db.emailEvent.count({
      where: { shop, status: EMAIL_EVENT_STATUS.FAILED },
    }),
    db.emailEvent.count({
      where: { shop, status: EMAIL_EVENT_STATUS.CANCELLED },
    }),
    db.emailEvent.count({
      where: {
        shop,
        status: EMAIL_EVENT_STATUS.FAILED,
        attemptCount: { gte: EMAIL_EVENT_MAX_ATTEMPTS },
      },
    }),
    db.emailEvent.count({
      where: {
        shop,
        status: EMAIL_EVENT_STATUS.SENT,
        sentAt: { gte: since24h },
      },
    }),
    db.emailEvent.count({
      where: {
        shop,
        status: EMAIL_EVENT_STATUS.FAILED,
        updatedAt: { gte: since24h },
      },
    }),
  ]);

  return {
    cancelled,
    exhausted,
    failed,
    pending,
    processing,
    sentLast24h,
    successRate24h: computeSuccessRate24h({
      failed: failedLast24h,
      sent: sentLast24h,
    }),
  };
};

export const loadEmailsPageData = async (
  request: Request,
): Promise<EmailAdminPageData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const filters = parseFilters(url);
  const now = new Date();
  const where = buildListWhere({ filters, now, shop });
  const selectedId = url.searchParams.get("event");

  const skip = (filters.page - 1) * EMAIL_ADMIN_PAGE_SIZE;

  const [metrics, totalCount, rows, detailRow] = await Promise.all([
    loadMetrics({ now, shop }),
    db.emailEvent.count({ where }),
    db.emailEvent.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: EMAIL_ADMIN_PAGE_SIZE,
      where,
    }),
    selectedId
      ? db.emailEvent.findFirst({
          where: { id: selectedId, shop },
        })
      : Promise.resolve(null),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / EMAIL_ADMIN_PAGE_SIZE));
  const safePage = Math.min(filters.page, totalPages);
  // If page was clamped, re-fetch would be needed — keep simple: empty ok when past end.
  const events = (rows as EmailEventRow[]).map((row) => mapListItem(row, now));

  return {
    detail: detailRow
      ? mapDetail(detailRow as EmailEventRow, now)
      : null,
    events,
    filters: { ...filters, page: safePage },
    metrics,
    pageSize: EMAIL_ADMIN_PAGE_SIZE,
    shop,
    totalCount,
    totalPages,
  };
};
