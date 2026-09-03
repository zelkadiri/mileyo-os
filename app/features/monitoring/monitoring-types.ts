import type { EmailCronHealthLevel } from "../../constants/emailCron";
import type { CronHealthLevel } from "../../constants/cronRun";
import type { BillingCronHealth } from "../../services/monitoring/billing-cron-health.server";
import type { RecoveryHealthCounts } from "../../services/monitoring/payment-recovery-health.server";
import type { EmailAdminCronHealth } from "../emails/emails-types";

export type MonitoringPageData = {
  billing: BillingCronHealth;
  email: EmailAdminCronHealth;
  recoveries: RecoveryHealthCounts;
  shop: string;
};

export type MonitoringHealthDisplayLevel =
  | CronHealthLevel
  | EmailCronHealthLevel;
