export const SUBSCRIPTION_SELECTION_STATUS = {
  ACTIVE: "active",
  ARCHIVED_DUPLICATE: "archived_duplicate",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  FAILED: "failed",
  PAUSED: "paused",
} as const;

export type SubscriptionSelectionStatus =
  (typeof SUBSCRIPTION_SELECTION_STATUS)[keyof typeof SUBSCRIPTION_SELECTION_STATUS];

export const TERMINAL_SUBSCRIPTION_SELECTION_STATUSES = [
  SUBSCRIPTION_SELECTION_STATUS.CANCELLED,
  SUBSCRIPTION_SELECTION_STATUS.EXPIRED,
  SUBSCRIPTION_SELECTION_STATUS.FAILED,
  SUBSCRIPTION_SELECTION_STATUS.ARCHIVED_DUPLICATE,
] as const;

export type TerminalSubscriptionSelectionStatus =
  (typeof TERMINAL_SUBSCRIPTION_SELECTION_STATUSES)[number];

export const isArchivedDuplicateSelection = (status: string) =>
  status === SUBSCRIPTION_SELECTION_STATUS.ARCHIVED_DUPLICATE;

export const isTerminalSubscriptionSelectionStatus = (status: string) =>
  (TERMINAL_SUBSCRIPTION_SELECTION_STATUSES as readonly string[]).includes(status);

export const isManageableSubscriptionSelectionStatus = (status: string) =>
  status === SUBSCRIPTION_SELECTION_STATUS.ACTIVE ||
  status === SUBSCRIPTION_SELECTION_STATUS.PAUSED;
