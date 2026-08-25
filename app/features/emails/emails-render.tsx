/**
 * Admin email observability (EMAIL-6G-A / EMAIL-6G-B / EMAIL-6G-C).
 * List + detail; manual retry for failed events; cron health read-only.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";

import {
  EMAIL_EVENT_STATUSES,
  EMAIL_EVENT_TYPES,
} from "../../constants/emailEvent";
import type { loadEmailsPageData } from "./emails-data.server";
import {
  formatAdminDateTime,
  formatAdminDateTimeCompact,
  formatAttemptCountLabel,
  formatCronCount,
  formatDurationMs,
  formatEmailCronHealthLevelLabel,
  formatEmailCronRunStatusLabel,
  formatEmailEventStatusLabel,
  formatEmailEventTypeLabel,
  formatEmailNextOrSentLabel,
  formatReferenceLabel,
  formatSafeMetaLabel,
  formatSafeMetaValue,
  formatSuccessRatePercent,
  getEmailStatusBadgeTone,
  truncateErrorMessage,
  truncateForTable,
} from "./emails-formatters";
import {
  alertItemStyle,
  alertLinkStyle,
  alertsListStyle,
  cronHistoryTableStyle,
  detailGridStyle,
  detailKeyStyle,
  detailRowStyle,
  detailSectionStyle,
  detailSectionTitleStyle,
  detailValueStyle,
  drawerBackdropStyle,
  drawerHeaderMetaStyle,
  drawerHeaderStyle,
  drawerPanelStyle,
  drawerSummaryStyle,
  drawerTitleStyle,
  emptyStateStyle,
  errorCellStyle,
  errorPanelStyle,
  emailsLayoutCss,
  filterControlStyle,
  filterFieldStyle,
  filterLabelStyle,
  filterSubmitButtonStyle,
  filtersFormStyle,
  healthHeaderRowStyle,
  healthLevelBadgeStyle,
  healthMetaGridStyle,
  healthMetaLabelStyle,
  healthMetaValueStyle,
  healthPanelStyle,
  healthTitleStyle,
  introStyle,
  introSubStyle,
  metaPairStyle,
  monoStyle,
  mutedStyle,
  noAlertStyle,
  pageShellStyle,
  paginationRowStyle,
  primaryButtonStyle,
  providerCellStyle,
  rowOpenStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  summaryCardIncidentStyle,
  summaryCardStyle,
  summaryGridStyle,
  summaryLabelStyle,
  summarySubLabelStyle,
  summaryValueMutedStyle,
  summaryValueStyle,
  tableStyle,
  tableWrapStyle,
  tdStyle,
  techIdBlockStyle,
  thStyle,
  timelineDisclaimerStyle,
  timelineListStyle,
  truncateCellStyle,
  warningBannerStyle,
} from "./emails-styles";
import type { EmailAdminListItem, EmailsActionData } from "./emails-types";
import {
  EMAIL_ADMIN_PERIODS,
  RETRY_EMAIL_EVENT_INTENT,
} from "./emails-types";

type PageData = Awaited<ReturnType<typeof loadEmailsPageData>>;

const PERIOD_LABELS: Record<(typeof EMAIL_ADMIN_PERIODS)[number], string> = {
  "24h": "24 h",
  "7d": "7 jours",
  "30d": "30 jours",
  all: "Tout",
};

const buildFilterHref = (
  current: URLSearchParams,
  patch: Record<string, string | null>,
): string => {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  const qs = next.toString();
  return qs ? `/app/emails?${qs}` : "/app/emails";
};

const StatusBadge = ({ event }: { event: EmailAdminListItem }) => {
  const tone = getEmailStatusBadgeTone({
    attemptCount: event.attemptCount,
    status: event.status,
  });
  return (
    <span style={statusBadgeStyle(tone)}>
      {formatEmailEventStatusLabel({
        attemptCount: event.attemptCount,
        status: event.status,
      })}
    </span>
  );
};

const actionBannerStyle = (ok: boolean) =>
  ({
    background: ok ? "#ecfdf5" : "#fef2f2",
    border: `1px solid ${ok ? "#a7f3d0" : "#fecaca"}`,
    borderRadius: "10px",
    color: ok ? "#065f46" : "#991b1b",
    fontSize: "0.9rem",
    margin: "0 0 0.75rem",
    padding: "0.65rem 0.85rem",
  }) as const;

const confirmNoteStyle = {
  color: "#6b7280",
  fontSize: "0.8rem",
  margin: "0.5rem 0 0",
} as const;

const confirmCopyStyle = {
  color: "#374151",
  fontSize: "0.9rem",
  margin: "0.35rem 0 0",
} as const;

const confirmActionsStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.5rem",
  marginTop: "0.75rem",
} as const;

export default function EmailsPage() {
  const {
    cronHealth,
    detail,
    events,
    filters,
    metrics,
    pageSize,
    totalCount,
    totalPages,
  } = useLoaderData<PageData>();
  const actionData = useActionData<EmailsActionData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [confirmRetry, setConfirmRetry] = useState(false);

  const isRetrySubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === RETRY_EMAIL_EVENT_INTENT;

  useEffect(() => {
    setConfirmRetry(false);
  }, [detail?.id, actionData]);

  const hasActiveFilters =
    filters.status !== "all" ||
    filters.eventType !== "all" ||
    filters.period !== "all" ||
    filters.q !== "";

  const emptyCopy = (() => {
    if (totalCount === 0 && !hasActiveFilters) {
      return "Aucun événement email pour le moment.";
    }
    if (totalCount === 0 && filters.status === "failed") {
      return "Aucun email en échec pour ces filtres.";
    }
    if (totalCount === 0) {
      return "Aucun résultat pour ces filtres.";
    }
    return null;
  })();

  const successRateLabel = formatSuccessRatePercent(metrics.successRate24h);
  const successRateEmpty = metrics.successRate24h == null;

  const showActionFeedback =
    actionData != null &&
    (actionData.eventId == null ||
      detail == null ||
      actionData.eventId === detail.id);

  return (
    <s-page heading="Emails">
      <style>{emailsLayoutCss}</style>
      <div className="emails-page-shell" style={pageShellStyle}>
        <s-section>
          <s-stack gap="base">
            <div>
              <p style={introStyle}>
                Suivez l’état des emails transactionnels Mileyo.
              </p>
              <p style={introSubStyle}>
                Observabilité en lecture seule — retry manuel possible sur les
                échecs.
              </p>
            </div>

            <div className="emails-metrics-grid" style={summaryGridStyle}>
              <div style={summaryCardStyle}>
                <p style={summaryLabelStyle}>Envoyés</p>
                <p style={summaryValueStyle}>{metrics.sentLast24h}</p>
                <p style={summarySubLabelStyle}>24 h</p>
              </div>
              <div style={summaryCardStyle}>
                <p style={summaryLabelStyle}>En attente</p>
                <p style={summaryValueStyle}>{metrics.pending}</p>
              </div>
              <div style={summaryCardStyle}>
                <p style={summaryLabelStyle}>En traitement</p>
                <p style={summaryValueStyle}>{metrics.processing}</p>
              </div>
              <div style={summaryCardIncidentStyle}>
                <p style={summaryLabelStyle}>Échoués</p>
                <p style={summaryValueStyle}>{metrics.failed}</p>
              </div>
              <div style={summaryCardIncidentStyle}>
                <p style={summaryLabelStyle}>Épuisés</p>
                <p style={summaryValueStyle}>{metrics.exhausted}</p>
              </div>
              <div style={summaryCardStyle}>
                <p style={summaryLabelStyle}>Annulés</p>
                <p style={summaryValueStyle}>{metrics.cancelled}</p>
              </div>
              <div style={summaryCardStyle}>
                <p style={summaryLabelStyle}>Taux de succès</p>
                <p
                  style={
                    successRateEmpty
                      ? summaryValueMutedStyle
                      : summaryValueStyle
                  }
                >
                  {successRateLabel}
                </p>
                {!successRateEmpty ? (
                  <p style={summarySubLabelStyle}>24 h</p>
                ) : null}
              </div>
            </div>
          </s-stack>
        </s-section>

        <s-section heading="Santé du cron email">
          <s-stack gap="base">
            <div style={healthPanelStyle}>
              <div style={healthHeaderRowStyle}>
                <p style={healthTitleStyle}>État</p>
                <span style={healthLevelBadgeStyle(cronHealth.healthLevel)}>
                  {formatEmailCronHealthLevelLabel(cronHealth.healthLevel)}
                </span>
              </div>

              <div className="emails-cron-meta-grid" style={healthMetaGridStyle}>
                <div>
                  <p style={healthMetaLabelStyle}>Dernier run</p>
                  <p style={healthMetaValueStyle}>
                    {formatAdminDateTimeCompact(cronHealth.lastRun?.startedAt) ??
                      "—"}
                    {cronHealth.lastRun
                      ? ` · ${formatEmailCronRunStatusLabel(cronHealth.lastRun.status)}`
                      : ""}
                  </p>
                </div>
                <div>
                  <p style={healthMetaLabelStyle}>Dernier succès</p>
                  <p style={healthMetaValueStyle}>
                    {formatAdminDateTimeCompact(
                      cronHealth.lastSuccess?.startedAt,
                    ) ?? "—"}
                  </p>
                </div>
                <div>
                  <p style={healthMetaLabelStyle}>Dernier échec</p>
                  <p style={healthMetaValueStyle}>
                    {formatAdminDateTimeCompact(
                      cronHealth.lastFailed?.startedAt,
                    ) ?? "—"}
                  </p>
                </div>
                <div>
                  <p style={healthMetaLabelStyle}>Durée dernier run</p>
                  <p style={healthMetaValueStyle}>
                    {formatDurationMs(cronHealth.lastRun?.durationMs)}
                  </p>
                </div>
                <div>
                  <p style={healthMetaLabelStyle}>Traités</p>
                  <p style={healthMetaValueStyle}>
                    {formatCronCount(cronHealth.lastRun?.processedCount)}
                  </p>
                </div>
                <div>
                  <p style={healthMetaLabelStyle}>Envoyés</p>
                  <p style={healthMetaValueStyle}>
                    {formatCronCount(cronHealth.lastRun?.sentCount)}
                  </p>
                </div>
                <div>
                  <p style={healthMetaLabelStyle}>Échoués</p>
                  <p style={healthMetaValueStyle}>
                    {formatCronCount(cronHealth.lastRun?.failedCount)}
                  </p>
                </div>
              </div>

              {cronHealth.lastRun?.isStuckRunning ? (
                <p style={warningBannerStyle}>
                  Run potentiellement interrompu
                </p>
              ) : null}
            </div>

            <div>
              <p style={healthTitleStyle}>Alertes</p>
              {cronHealth.alerts.length === 0 ? (
                <p style={noAlertStyle}>Aucune anomalie détectée.</p>
              ) : (
                <ul style={alertsListStyle}>
                  {cronHealth.alerts.map((alert) => (
                    <li key={alert.id} style={alertItemStyle(alert.severity)}>
                      {alert.href ? (
                        <Link style={alertLinkStyle} to={alert.href}>
                          {alert.message}
                        </Link>
                      ) : (
                        alert.message
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p style={{ ...healthTitleStyle, marginBottom: "0.5rem" }}>
                Derniers runs
              </p>
              {cronHealth.recentRuns.length === 0 ? (
                <p style={noAlertStyle}>Aucun run observé pour le moment.</p>
              ) : (
                <div className="emails-table-wrap" style={tableWrapStyle}>
                  <table style={cronHistoryTableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>Status</th>
                        <th style={thStyle}>Durée</th>
                        <th style={thStyle}>Traités</th>
                        <th style={thStyle}>Envoyés</th>
                        <th style={thStyle}>Échoués</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cronHealth.recentRuns.map((run) => (
                        <tr key={run.id}>
                          <td style={tdStyle}>
                            {formatAdminDateTimeCompact(run.startedAt) ?? "—"}
                            {run.errorMessage ? (
                              <p
                                style={mutedStyle}
                                title={run.errorMessage}
                              >
                                {truncateErrorMessage(run.errorMessage, 60)}
                              </p>
                            ) : null}
                            {run.isStuckRunning ? (
                              <p style={warningBannerStyle}>
                                Run potentiellement interrompu
                              </p>
                            ) : null}
                          </td>
                          <td style={tdStyle}>
                            {formatEmailCronRunStatusLabel(run.status)}
                          </td>
                          <td style={tdStyle}>
                            {formatDurationMs(run.durationMs)}
                          </td>
                          <td style={tdStyle}>
                            {formatCronCount(run.processedCount)}
                          </td>
                          <td style={tdStyle}>
                            {formatCronCount(run.sentCount)}
                          </td>
                          <td style={tdStyle}>
                            {formatCronCount(run.failedCount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </s-stack>
        </s-section>

        <s-section heading="Événements">
          <s-stack gap="base">
            <Form method="get" style={filtersFormStyle}>
              <label style={filterFieldStyle}>
                <span style={filterLabelStyle}>Statut</span>
                <select
                  defaultValue={filters.status}
                  name="status"
                  style={filterControlStyle}
                >
                  <option value="all">Tous</option>
                  {EMAIL_EVENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatEmailEventStatusLabel({
                        attemptCount: 0,
                        status,
                      })}
                    </option>
                  ))}
                </select>
              </label>

              <label style={filterFieldStyle}>
                <span style={filterLabelStyle}>Type</span>
                <select
                  defaultValue={filters.eventType}
                  name="eventType"
                  style={filterControlStyle}
                >
                  <option value="all">Tous</option>
                  {EMAIL_EVENT_TYPES.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {formatEmailEventTypeLabel(eventType)}
                    </option>
                  ))}
                </select>
              </label>

              <label style={filterFieldStyle}>
                <span style={filterLabelStyle}>Période</span>
                <select
                  defaultValue={filters.period}
                  name="period"
                  style={filterControlStyle}
                >
                  {EMAIL_ADMIN_PERIODS.map((period) => (
                    <option key={period} value={period}>
                      {PERIOD_LABELS[period]}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ ...filterFieldStyle, minWidth: "220px", flex: 1 }}>
                <span style={filterLabelStyle}>Recherche</span>
                <input
                  defaultValue={filters.q}
                  name="q"
                  placeholder="email, référence, provider, clé…"
                  style={filterControlStyle}
                  type="search"
                />
              </label>

              <button style={filterSubmitButtonStyle} type="submit">
                Filtrer
              </button>
              {hasActiveFilters ? (
                <Link style={secondaryButtonStyle} to="/app/emails">
                  Réinitialiser
                </Link>
              ) : null}
            </Form>

            {emptyCopy ? (
              <div style={emptyStateStyle}>{emptyCopy}</div>
            ) : (
              <>
                <div className="emails-table-wrap" style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, width: "9%" }}>Créé</th>
                        <th style={{ ...thStyle, width: "13%" }}>Type</th>
                        <th style={{ ...thStyle, width: "11%" }}>
                          Destinataire
                        </th>
                        <th style={{ ...thStyle, width: "9%" }}>Statut</th>
                        <th style={{ ...thStyle, width: "5%" }}>Tentatives</th>
                        <th style={{ ...thStyle, width: "16%" }}>
                          Envoi / prochain essai
                        </th>
                        <th style={{ ...thStyle, width: "14%" }}>Référence</th>
                        <th style={{ ...thStyle, width: "8%" }}>Provider</th>
                        <th style={{ ...thStyle, width: "15%" }}>Erreur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((event) => {
                        const referenceFull = formatReferenceLabel({
                          referenceId: event.referenceId,
                          referenceType: event.referenceType,
                        });
                        const detailHref = buildFilterHref(searchParams, {
                          event: event.id,
                        });
                        return (
                          <tr key={event.id}>
                            <td style={tdStyle}>
                              <Link
                                style={rowOpenStyle}
                                title="Voir le détail"
                                to={detailHref}
                              >
                                {formatAdminDateTime(event.createdAt) ?? "—"}
                              </Link>
                            </td>
                            <td style={tdStyle}>
                              {formatEmailEventTypeLabel(event.eventType)}
                            </td>
                            <td style={{ ...tdStyle, ...monoStyle }}>
                              {event.recipientMasked}
                            </td>
                            <td style={tdStyle}>
                              <StatusBadge event={event} />
                              {event.isStaleProcessing ? (
                                <p style={warningBannerStyle}>
                                  Traitement potentiellement bloqué
                                </p>
                              ) : null}
                            </td>
                            <td style={tdStyle}>{event.attemptCount}</td>
                            <td style={tdStyle}>
                              {formatEmailNextOrSentLabel({
                                nextAttemptAt: event.nextAttemptAt,
                                sentAt: event.sentAt,
                                status: event.status,
                              })}
                            </td>
                            <td
                              style={{
                                ...tdStyle,
                                ...monoStyle,
                                ...truncateCellStyle,
                              }}
                              title={referenceFull}
                            >
                              {truncateForTable(referenceFull, 28)}
                            </td>
                            <td
                              style={{
                                ...tdStyle,
                                ...monoStyle,
                                ...providerCellStyle,
                              }}
                              title={event.providerId ?? undefined}
                            >
                              {truncateForTable(event.providerId, 20)}
                            </td>
                            <td style={{ ...tdStyle, ...errorCellStyle }}>
                              {event.lastErrorCode || event.lastErrorMessage ? (
                                <>
                                  {event.lastErrorCode ? (
                                    <div style={monoStyle}>
                                      {event.lastErrorCode}
                                    </div>
                                  ) : null}
                                  <div>
                                    {truncateErrorMessage(
                                      event.lastErrorMessage,
                                    )}
                                  </div>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={paginationRowStyle}>
                  <p style={mutedStyle}>
                    {totalCount} événement{totalCount === 1 ? "" : "s"} · page{" "}
                    {filters.page}/{totalPages} · {pageSize}/page
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {filters.page > 1 ? (
                      <Link
                        style={secondaryButtonStyle}
                        to={buildFilterHref(searchParams, {
                          event: null,
                          page: String(filters.page - 1),
                        })}
                      >
                        Précédent
                      </Link>
                    ) : null}
                    {filters.page < totalPages ? (
                      <Link
                        style={secondaryButtonStyle}
                        to={buildFilterHref(searchParams, {
                          event: null,
                          page: String(filters.page + 1),
                        })}
                      >
                        Suivant
                      </Link>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </s-stack>
        </s-section>
      </div>

      {detail ? (
        <>
          <Link
            aria-label="Fermer le détail"
            style={drawerBackdropStyle}
            to={buildFilterHref(searchParams, { event: null })}
          />
          <aside aria-label="Détail email" style={drawerPanelStyle}>
            <div style={drawerHeaderStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={drawerTitleStyle}>
                  {formatEmailEventTypeLabel(detail.eventType)}
                </h2>
                <div style={drawerHeaderMetaStyle}>
                  <StatusBadge event={detail} />
                </div>
                <p style={drawerSummaryStyle}>
                  {formatAttemptCountLabel(detail.attemptCount)}
                  <br />
                  Créé le{" "}
                  {formatAdminDateTimeCompact(detail.createdAt) ?? "—"}
                </p>
                {detail.isStaleProcessing ? (
                  <p style={warningBannerStyle}>
                    Traitement potentiellement bloqué (&gt; 10 min)
                  </p>
                ) : null}
              </div>
              <Link
                style={secondaryButtonStyle}
                to={buildFilterHref(searchParams, { event: null })}
              >
                Fermer
              </Link>
            </div>

            <div style={detailGridStyle}>
              {showActionFeedback && actionData ? (
                <p style={actionBannerStyle(actionData.ok)}>
                  {actionData.message}
                </p>
              ) : null}

              <section style={detailSectionStyle}>
                <h3 style={detailSectionTitleStyle}>État</h3>
                <DetailField
                  label="Statut"
                  valueNode={<StatusBadge event={detail} />}
                />
                <DetailField
                  label="Tentatives"
                  value={String(detail.attemptCount)}
                />
                <DetailField
                  label="Créé"
                  value={formatAdminDateTime(detail.createdAt) ?? "—"}
                />
                <DetailField
                  label="Dernière tentative"
                  value={formatAdminDateTime(detail.lastAttemptAt) ?? "—"}
                />
                <DetailField
                  label="Prochain essai"
                  value={
                    detail.status === "pending"
                      ? formatEmailNextOrSentLabel({
                          nextAttemptAt: detail.nextAttemptAt,
                          sentAt: detail.sentAt,
                          status: detail.status,
                        })
                      : "—"
                  }
                />
                <DetailField
                  label="Envoyé"
                  value={formatAdminDateTime(detail.sentAt) ?? "—"}
                />
                <DetailField
                  label="Annulé"
                  value={formatAdminDateTime(detail.cancelledAt) ?? "—"}
                />
              </section>

              <section style={detailSectionStyle}>
                <h3 style={detailSectionTitleStyle}>Destinataire</h3>
                <DetailField
                  label="Email"
                  value={detail.recipientEmailMasked}
                  mono
                />
              </section>

              <section style={detailSectionStyle}>
                <h3 style={detailSectionTitleStyle}>
                  Références techniques
                </h3>
                <TechIdField
                  label="Provider ID"
                  value={detail.providerId ?? "—"}
                />
                <TechIdField
                  label="Type de référence"
                  value={detail.referenceType}
                />
                <TechIdField
                  label="ID de référence"
                  value={detail.referenceId}
                />
                <TechIdField
                  label="Clé d’idempotence"
                  value={detail.idempotencyKey}
                />
              </section>

              {detail.lastErrorCode || detail.lastErrorMessage ? (
                <section style={detailSectionStyle}>
                  <h3 style={detailSectionTitleStyle}>Erreur</h3>
                  <div style={errorPanelStyle}>
                    {detail.lastErrorCode ? (
                      <div>
                        <p style={detailKeyStyle}>Code</p>
                        <p style={{ ...detailValueStyle, ...monoStyle }}>
                          {detail.lastErrorCode}
                        </p>
                      </div>
                    ) : null}
                    {detail.lastErrorMessage ? (
                      <div>
                        <p style={detailKeyStyle}>Message</p>
                        <p style={detailValueStyle}>
                          {detail.lastErrorMessage}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section style={detailSectionStyle}>
                <h3 style={detailSectionTitleStyle}>Métadonnées</h3>
                {detail.metaUnavailable ? (
                  <p style={detailValueStyle}>Métadonnées indisponibles</p>
                ) : detail.metaSafe == null ? (
                  <p style={detailValueStyle}>Aucune métadonnée safe</p>
                ) : (
                  <dl style={{ margin: 0 }}>
                    {Object.entries(detail.metaSafe).map(([key, value]) => (
                      <div key={key} style={metaPairStyle}>
                        <dt style={detailKeyStyle}>
                          {formatSafeMetaLabel(key)}
                        </dt>
                        <dd style={{ ...detailValueStyle, margin: 0 }}>
                          {formatSafeMetaValue(key, value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>

              <section style={detailSectionStyle}>
                <h3 style={detailSectionTitleStyle}>Jalons connus</h3>
                <p style={timelineDisclaimerStyle}>
                  Dérivés des timestamps actuels — pas un historique complet des
                  tentatives.
                </p>
                <ol style={timelineListStyle}>
                  {detail.timeline.map((step, index) => (
                    <li key={`${step.label}-${index}`}>
                      <strong>{step.label}</strong>
                      {step.at ? ` — ${step.at}` : ""}
                    </li>
                  ))}
                </ol>
              </section>

              {detail.status === "failed" ? (
                <section style={detailSectionStyle}>
                  <h3 style={detailSectionTitleStyle}>Actions</h3>
                  {!confirmRetry ? (
                    <>
                      <button
                        disabled={isRetrySubmitting}
                        onClick={() => setConfirmRetry(true)}
                        style={{
                          ...primaryButtonStyle,
                          opacity: isRetrySubmitting ? 0.6 : 1,
                        }}
                        type="button"
                      >
                        Réessayer l’envoi
                      </button>
                      <p style={confirmNoteStyle}>
                        À utiliser après avoir vérifié la cause de l’échec.
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ ...detailValueStyle, fontWeight: 600 }}>
                        Réessayer cet email ?
                      </p>
                      <p style={confirmCopyStyle}>
                        Une nouvelle tentative d’envoi sera effectuée
                        immédiatement avec la même clé d’idempotence.
                      </p>
                      <p style={confirmNoteStyle}>
                        À utiliser après avoir vérifié la cause de l’échec.
                      </p>
                      <div style={confirmActionsStyle}>
                        <button
                          disabled={isRetrySubmitting}
                          onClick={() => setConfirmRetry(false)}
                          style={secondaryButtonStyle}
                          type="button"
                        >
                          Annuler
                        </button>
                        <Form
                          action={buildFilterHref(searchParams, {
                            event: detail.id,
                          })}
                          method="post"
                        >
                          <input
                            name="intent"
                            type="hidden"
                            value={RETRY_EMAIL_EVENT_INTENT}
                          />
                          <input
                            name="eventId"
                            type="hidden"
                            value={detail.id}
                          />
                          <button
                            disabled={isRetrySubmitting}
                            style={{
                              ...primaryButtonStyle,
                              opacity: isRetrySubmitting ? 0.6 : 1,
                            }}
                            type="submit"
                          >
                            {isRetrySubmitting ? "Envoi…" : "Réessayer"}
                          </button>
                        </Form>
                      </div>
                    </>
                  )}
                </section>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </s-page>
  );
}

const DetailField = ({
  label,
  mono,
  value,
  valueNode,
}: {
  label: string;
  mono?: boolean;
  value?: string;
  valueNode?: ReactNode;
}) => (
  <div style={detailRowStyle}>
    <p style={detailKeyStyle}>{label}</p>
    {valueNode != null ? (
      <div style={detailValueStyle}>{valueNode}</div>
    ) : (
      <p style={{ ...detailValueStyle, ...(mono ? monoStyle : null) }}>
        {value}
      </p>
    )}
  </div>
);

const TechIdField = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div style={detailRowStyle}>
    <p style={detailKeyStyle}>{label}</p>
    <p style={techIdBlockStyle}>{value}</p>
  </div>
);
