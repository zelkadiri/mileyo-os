/**
 * Admin system health page loader (MONITORING-1) — read-only.
 */

import { loadEmailCronHealth } from "../emails/emails-cron-health.server";
import { loadBillingCronHealth } from "../../services/monitoring/billing-cron-health.server";
import { loadPaymentRecoveryHealth } from "../../services/monitoring/payment-recovery-health.server";
import { authenticate } from "../../shopify.server";
import type { MonitoringPageData } from "./monitoring-types";

export const loadMonitoringPageData = async (
  request: Request,
): Promise<MonitoringPageData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const now = new Date();

  const [billing, email, recoveries] = await Promise.all([
    loadBillingCronHealth({ now, shop }),
    loadEmailCronHealth({ now, shop }),
    loadPaymentRecoveryHealth({ now, shop }),
  ]);

  return {
    billing,
    email,
    recoveries,
    shop,
  };
};
