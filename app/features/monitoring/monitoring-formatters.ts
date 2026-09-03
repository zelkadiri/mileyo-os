import type { CronHealthLevel } from "../../constants/cronRun";
import type { EmailCronHealthLevel } from "../../constants/emailCron";
import {
  formatCronCount,
  formatDurationMs,
  formatEmailCronHealthLevelLabel,
  formatEmailCronRunStatusLabel,
} from "../emails/emails-formatters";

const CRON_HEALTH_LABELS_FR: Record<CronHealthLevel, string> = {
  attention: "En retard",
  awaiting_first_run: "En attente du premier run",
  incident: "Incident",
  ok: "OK",
};

export const formatCronHealthLevelLabel = (level: CronHealthLevel): string =>
  CRON_HEALTH_LABELS_FR[level] ?? level;

export const formatMonitoringEmailHealthLabel = (
  level: EmailCronHealthLevel,
): string => formatEmailCronHealthLevelLabel(level);

export const formatMonitoringDateTime = (
  value: string | null | undefined,
): string => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("fr-FR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export {
  formatCronCount,
  formatDurationMs,
  formatEmailCronRunStatusLabel,
};
