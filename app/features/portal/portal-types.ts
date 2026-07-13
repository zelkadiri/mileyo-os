import type { PaymentUpdateUnavailableReason } from "../../constants/subscriptionPaymentRecovery";
import type { PortalSubscriptionState } from "../../constants/subscriptionStatus";

export type { PortalSubscriptionState };

export type PortalMeal = {
  id: string;
  imageAlt: string;
  imageUrl: string | null;
  title: string;
  variantTitle: string;
};

export type PortalRecovery = {
  failureCount: number;
  isFinalFailed: boolean;
  nextRetryAt: string | null;
  paymentUpdateAvailable: boolean;
  paymentUpdateUnavailableReason: PaymentUpdateUnavailableReason;
  status: string;
};

export type MerchantSupportContact = {
  href: string;
  isConfigured: boolean;
  label: string;
};

export type PortalForecastCycle = {
  boxSubscriptionPrice: string | null;
  boxTitle: string | null;
  estimatedBillingDate: string;
  mealsCount: number;
};

export type PortalHistoryOrder = {
  boxTitle: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  id: string;
  orderDate: string;
  price: string | null;
  selectedMeals: string[];
  shopifyOrderName: string | null;
  statusPageUrl: string | null;
};

export type PortalDeliveryCutoffStatus = {
  deadlineLabel: string | null;
  isKnown: boolean;
  isPassed: boolean;
};

export type PortalSelection = {
  boxChangeBlocked: boolean;
  boxChangeBlockedReason: string | null;
  modificationBlocked: boolean;
  modificationBlockedReason: string | null;
  deliveryCutoff: PortalDeliveryCutoffStatus;
  boxProductShopifyId: string | null;
  boxSubscriptionPrice: string | null;
  boxTitle: string | null;
  forecastCycles: PortalForecastCycle[];
  id: string;
  mealsCount: number;
  nextBillingDate: string | null;
  /** ISO date `YYYY-MM-DD` — prochaine livraison planifiée. */
  nextScheduledDeliveryDate: string | null;
  portalState: PortalSubscriptionState;
  recovery: PortalRecovery | null;
  resumeBlockedMessage: string | null;
  resumeRequiresPayment: boolean;
  selectedMeals: string[];
  shopifyOrderName: string | null;
  status: string;
};

/** Lecture seule — affichée depuis la base locale, sans sync Shopify. */
export type PortalTerminalSelection = {
  boxTitle: string | null;
  id: string;
  lastOrderDate: string | null;
  mealsCount: number;
  selectedMeals: string[];
  shopifyOrderName: string | null;
  status: string;
  statusLabel: string;
  subscriptionContractId: string | null;
  updatedAt: string;
};
