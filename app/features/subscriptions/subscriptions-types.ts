export type SubscriptionRecoveryDto = {
  boxSubscriptionPrice: string | null;
  boxTitle: string | null;
  customerEmail: string | null;
  customerName: string | null;
  failureCount: number;
  id: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  mealsCount: number | null;
  nextRetryAt: Date | null;
  selectionId: string;
  shopifyOrderName: string | null;
  status: string;
};

export type SubscriptionStatusCounts = {
  active: number;
  cancelled: number;
  expired: number;
  failed: number;
  other: number;
  paused: number;
};

export type SubscriptionSelectionDto = {
  active: boolean;
  boxSubscriptionPrice: string | null;
  boxTitle: string | null;
  createdAt: Date;
  customerEmail: string | null;
  customerName: string | null;
  id: string;
  isTerminal: boolean;
  lastBillingAttemptAt: Date | null;
  lastBillingAttemptError: string | null;
  lastBillingAttemptStatus: string | null;
  mealsCount: number | null;
  nextBillingDate: Date | null;
  selectedMeals: unknown;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  status: string;
  subscriptionContractId: string | null;
  updatedAt: Date;
};

export type SubscriptionsPageData = {
  hiddenDuplicateCount: number;
  paymentRecoveries: SubscriptionRecoveryDto[];
  selections: SubscriptionSelectionDto[];
  showRecoveryDevRetry: boolean;
  showSubscriptionTestActions: boolean;
  statusCounts: SubscriptionStatusCounts;
};
