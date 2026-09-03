/**
 * Admin « Santé système » (MONITORING-1) — read-only, no PII.
 */

import { Link, useLoaderData } from "react-router";

import type { CronHealthLevel } from "../../constants/cronRun";
import type { EmailCronHealthLevel } from "../../constants/emailCron";
import {
  formatCronCount,
  formatCronHealthLevelLabel,
  formatDurationMs,
  formatEmailCronRunStatusLabel,
  formatMonitoringDateTime,
  formatMonitoringEmailHealthLabel,
} from "./monitoring-formatters";
import type { MonitoringPageData } from "./monitoring-types";

const pageStyle = {
  display: "grid",
  gap: "1.25rem",
  maxWidth: "960px",
} as const;

const panelStyle = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  display: "grid",
  gap: "0.85rem",
  padding: "0.9rem 1rem",
} as const;

const headerRowStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.65rem",
  justifyContent: "space-between",
} as const;

const titleStyle = {
  fontSize: "0.95rem",
  fontWeight: 700,
  margin: 0,
} as const;

const metaGridStyle = {
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
} as const;

const metaLabelStyle = {
  color: "#6b7280",
  fontSize: "0.7rem",
  fontWeight: 600,
  margin: 0,
} as const;

const metaValueStyle = {
  fontSize: "0.85rem",
  fontWeight: 600,
  margin: "0.15rem 0 0",
} as const;

const mutedStyle = {
  color: "#6b7280",
  fontSize: "0.8rem",
  margin: 0,
} as const;

const linkStyle = {
  color: "#1d4ed8",
  fontSize: "0.8rem",
  fontWeight: 600,
  textDecoration: "none",
} as const;

const healthBadgeStyle = (
  level: CronHealthLevel | EmailCronHealthLevel,
) => {
  const tone =
    level === "ok"
      ? "ok"
      : level === "awaiting_first_run"
        ? "awaiting"
        : level === "attention"
          ? "attention"
          : "incident";

  const palette = {
    attention: { bg: "#fffbeb", border: "#fde68a", color: "#a16207" },
    awaiting: { bg: "#f8fafc", border: "#e2e8f0", color: "#475569" },
    incident: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
    ok: { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d" },
  }[tone];

  return {
    background: palette.bg,
    border: `1px solid ${palette.border}`,
    borderRadius: "999px",
    color: palette.color,
    display: "inline-block",
    fontSize: "0.75rem",
    fontWeight: 700,
    padding: "0.2rem 0.65rem",
    whiteSpace: "nowrap" as const,
  };
};

export default function MonitoringPage() {
  const data = useLoaderData<MonitoringPageData>();
  const { billing, email, recoveries } = data;
  const lastRun = billing.lastRun;

  return (
    <s-page heading="Santé système">
      <s-section>
        <div style={pageStyle}>
          <p style={mutedStyle}>
            Observabilité opérationnelle — heartbeat crons et recoveries. Aucune
            action automatique depuis cette page.
          </p>

          <s-section heading="Facturation automatique">
            <div style={panelStyle}>
              <div style={headerRowStyle}>
                <p style={titleStyle}>Cron process-subscriptions</p>
                <span style={healthBadgeStyle(billing.healthLevel)}>
                  {formatCronHealthLevelLabel(billing.healthLevel)}
                </span>
              </div>

              {billing.healthLevel === "awaiting_first_run" ? (
                <p style={mutedStyle}>
                  Aucun heartbeat enregistré pour le moment. Le statut se
                  mettra à jour après le premier run du cron billing.
                </p>
              ) : (
                <div style={metaGridStyle}>
                  <div>
                    <p style={metaLabelStyle}>Dernier run</p>
                    <p style={metaValueStyle}>
                      {formatMonitoringDateTime(lastRun?.startedAt)}
                      {lastRun
                        ? ` · ${formatEmailCronRunStatusLabel(lastRun.status)}`
                        : ""}
                    </p>
                  </div>
                  <div>
                    <p style={metaLabelStyle}>Dernier succès</p>
                    <p style={metaValueStyle}>
                      {formatMonitoringDateTime(
                        billing.lastSuccess?.startedAt,
                      )}
                    </p>
                  </div>
                  <div>
                    <p style={metaLabelStyle}>Durée</p>
                    <p style={metaValueStyle}>
                      {formatDurationMs(lastRun?.durationMs)}
                    </p>
                  </div>
                  <div>
                    <p style={metaLabelStyle}>Traités</p>
                    <p style={metaValueStyle}>
                      {formatCronCount(lastRun?.processedCount)}
                    </p>
                  </div>
                  <div>
                    <p style={metaLabelStyle}>Ignorés</p>
                    <p style={metaValueStyle}>
                      {formatCronCount(lastRun?.skippedCount)}
                    </p>
                  </div>
                  <div>
                    <p style={metaLabelStyle}>Erreurs</p>
                    <p style={metaValueStyle}>
                      {formatCronCount(lastRun?.errorCount)}
                    </p>
                  </div>
                </div>
              )}

              {lastRun?.isStuckRunning ? (
                <p style={{ ...mutedStyle, color: "#a16207" }}>
                  Run potentiellement interrompu
                </p>
              ) : null}
            </div>
          </s-section>

          <s-section heading="Emails">
            <div style={panelStyle}>
              <div style={headerRowStyle}>
                <p style={titleStyle}>Cron process-email-retries</p>
                <span style={healthBadgeStyle(email.healthLevel)}>
                  {formatMonitoringEmailHealthLabel(email.healthLevel)}
                </span>
              </div>

              <div style={metaGridStyle}>
                <div>
                  <p style={metaLabelStyle}>Dernier run</p>
                  <p style={metaValueStyle}>
                    {formatMonitoringDateTime(email.lastRun?.startedAt)}
                    {email.lastRun
                      ? ` · ${formatEmailCronRunStatusLabel(email.lastRun.status)}`
                      : ""}
                  </p>
                </div>
                <div>
                  <p style={metaLabelStyle}>Dernier succès</p>
                  <p style={metaValueStyle}>
                    {formatMonitoringDateTime(email.lastSuccess?.startedAt)}
                  </p>
                </div>
                <div>
                  <p style={metaLabelStyle}>Alertes emails</p>
                  <p style={metaValueStyle}>
                    {email.alerts.filter(
                      (alert) =>
                        alert.id === "email_failed" ||
                        alert.id === "email_exhausted" ||
                        alert.id === "email_stale_processing",
                    ).length || "Aucune"}
                  </p>
                </div>
              </div>

              <p style={mutedStyle}>
                Détail des événements et historique des runs →{" "}
                <Link style={linkStyle} to="/app/emails">
                  Emails
                </Link>
              </p>
            </div>
          </s-section>

          <s-section heading="Recoveries paiement">
            <div style={panelStyle}>
              <div style={metaGridStyle}>
                <div>
                  <p style={metaLabelStyle}>En attente</p>
                  <p style={metaValueStyle}>{recoveries.pendingCount}</p>
                </div>
                <div>
                  <p style={metaLabelStyle}>En retard</p>
                  <p style={metaValueStyle}>{recoveries.overdueCount}</p>
                </div>
                <div>
                  <p style={metaLabelStyle}>Processing bloqué</p>
                  <p style={metaValueStyle}>
                    {recoveries.processingStuckCount}
                  </p>
                </div>
                <div>
                  <p style={metaLabelStyle}>Échecs définitifs</p>
                  <p style={metaValueStyle}>{recoveries.finalFailedCount}</p>
                </div>
              </div>

              <p style={mutedStyle}>
                Compteurs uniquement — aucune PII. Liste détaillée →{" "}
                <Link style={linkStyle} to="/app/subscriptions">
                  Abonnements
                </Link>
              </p>
            </div>
          </s-section>
        </div>
      </s-section>
    </s-page>
  );
}
