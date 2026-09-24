import type { SubscriptionObjective } from "../../constants/subscriptionObjective";
import type { DeliveryDateString } from "../../utils/deliveryDate";

export type PreparationDaySummary = {
  scheduledDeliveryDate: DeliveryDateString;
  totalOrders: number;
  totalMeals: number;
  subscriptionOrders: number;
  oneTimeOrders: number;
  rescheduledOrders: number;
};

/** Per-objective kitchen counts. `unknown` = BoxOrder.objective is null. */
export type PreparationObjectiveQuantities = {
  weight_loss: number;
  balanced: number;
  bulk: number;
  unknown: number;
};

export type PreparationMealTotal = {
  mealTitle: string;
  totalQuantity: number;
  objectiveQuantities: PreparationObjectiveQuantities;
  /**
   * Live catalog bulk portion grams (custom.portion_grams).
   * null when bulk=0, unresolved, ambiguous title, or catalog unavailable.
   * Never invent a default — 0 is not used for "unknown".
   */
  bulkPortionGrams: number | null;
};

export type PreparationOrder = {
  id: string;
  orderName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  orderType: string | null;
  boxTitle: string | null;
  mealsCount: number | null;
  selectedMeals: string[];
  /** Historical snapshot from BoxOrder — never invent a default. */
  objective: SubscriptionObjective | null;
  desiredDeliveryDate: string | null;
  scheduledDeliveryDate: DeliveryDateString;
  deliveryRescheduleReason: string | null;
  createdAt: Date;
};

export type PreparationDayData = {
  summary: PreparationDaySummary;
  mealTotals: PreparationMealTotal[];
  orders: PreparationOrder[];
};

export type UpcomingPreparationDate = {
  cutoff: {
    deadlineLabel: string | null;
    isKnown: boolean;
    isPassed: boolean;
  };
  orderCount: number;
  scheduledDeliveryDate: DeliveryDateString;
};

export type PreparationPageData = {
  selectedCutoff: {
    deadlineLabel: string | null;
    isKnown: boolean;
    isPassed: boolean;
  } | null;
  dateQueryInvalid: boolean;
  dayData: PreparationDayData | null;
  selectedDate: DeliveryDateString | null;
  upcomingDates: UpcomingPreparationDate[];
};

export type PreparationBoxOrderRecord = {
  id: string;
  shopifyOrderName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  orderType: string | null;
  boxTitle: string | null;
  mealsCount: number | null;
  selectedMeals: unknown;
  /** Historical snapshot — null for legacy / unresolved. */
  objective?: string | null;
  desiredDeliveryDate: string | null;
  scheduledDeliveryDate: string | null;
  deliveryRescheduleReason: string | null;
  isSubscriptionRenewal: boolean;
  /** Simulated test orders must never appear in kitchen preparation. */
  simulated: boolean;
  cancelledAt?: Date | null;
  createdAt: Date;
};
