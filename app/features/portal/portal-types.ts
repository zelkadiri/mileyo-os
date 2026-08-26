import type { PaymentUpdateUnavailableReason } from "../../constants/subscriptionPaymentRecovery";
import type { SubscriptionObjective } from "../../constants/subscriptionObjective";
import type { PortalSubscriptionState } from "../../constants/subscriptionStatus";

export type { PortalSubscriptionState };

export type PortalBoxProduct = {
  imageAlt: string;
  imageUrl: string | null;
  mealCount: number;
  objective: SubscriptionObjective;
  price: string;
  title: string;
  variantId: string;
};

export type PortalMeal = {
  allergenes: string[];
  badges: string[];
  calories: number | null;
  carbs: number | null;
  fat: number | null;
  id: string;
  imageAlt: string;
  imageUrl: string | null;
  ingredients: string[];
  objective: SubscriptionObjective;
  portionGrams: number | null;
  proteins: number | null;
  title: string;
  variantId: string;
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

/** Shipping address from SubscriptionContract.deliveryMethod (SoT). */
export type PortalDeliveryAddress = {
  address1: string;
  address2: string | null;
  city: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  provinceCode: string | null;
  zip: string;
};

export type PortalAddressBlockKind =
  | "billing_processing"
  | "cutoff_passed"
  | "missing_contract"
  | "non_shipping"
  | "order_locked"
  | "recovery_processing"
  | "resume_processing"
  | "unavailable";

export type PortalDeliveryAddressState = {
  address: PortalDeliveryAddress | null;
  blockKind: PortalAddressBlockKind | null;
  blockMessage: string | null;
  editable: boolean;
};

/**
 * Pending next-cycle box change for portal display (BOX-CHANGE-6).
 * Price comes from the live catalog — never treat a stored local price as SoT.
 */
export type PortalPendingBoxChange = {
  boxSubscriptionPrice: string | null;
  boxTitle: string;
  effectiveBillingDate: string;
  mealsCount: number;
  productVariantId: string;
  selectedMeals: string[];
};

export type PortalSelection = {
  /** True when a new box change must wait for the next billing cycle. */
  boxChangeAppliesNextCycle: boolean;
  boxChangeBlocked: boolean;
  boxChangeBlockedReason: string | null;
  modificationBlocked: boolean;
  modificationBlockedReason: string | null;
  deliveryAddress: PortalDeliveryAddressState;
  deliveryCutoff: PortalDeliveryCutoffStatus;
  boxSubscriptionPrice: string | null;
  boxTitle: string | null;
  /** ISO timestamp — default-selection tie-break. */
  createdAt: string;
  currentVariantId: string | null;
  forecastCycles: PortalForecastCycle[];
  id: string;
  mealsCount: number;
  objective: SubscriptionObjective | null;
  objectiveLabel: string | null;
  nextBillingDate: string | null;
  /** ISO date `YYYY-MM-DD` — prochaine livraison planifiée. */
  nextScheduledDeliveryDate: string | null;
  /** Active pending box change, if any — future state only. */
  pendingBoxChange: PortalPendingBoxChange | null;
  /** Secure Shopify payment-method update email (contract-bound). */
  paymentUpdateAvailable: boolean;
  paymentUpdateUnavailableReason: PaymentUpdateUnavailableReason;
  portalState: PortalSubscriptionState;
  /** JS Date#getDay weekday (0–6) preferred for delivery. */
  preferredDeliveryWeekday: number | null;
  recovery: PortalRecovery | null;
  resumeBlockedMessage: string | null;
  resumeRequiresPayment: boolean;
  selectedMeals: string[];
  shopifyOrderName: string | null;
  status: string;
  /** Shopify SubscriptionContract GID when known. */
  subscriptionContractId: string | null;
};

/**
 * Active/paused V1 (or non-catalog) subscription — visible, non-editable.
 * Never enters the V2 manageable selector.
 */
export type PortalLegacySubscription = {
  id: string;
  mealsCount: number | null;
  nextScheduledDeliveryDate: string | null;
  shopifyOrderName: string | null;
  status: string;
  statusLabel: string;
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
