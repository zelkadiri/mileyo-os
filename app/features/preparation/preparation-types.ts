import type { DeliveryDateString } from "../../utils/deliveryDate";

export type PreparationDaySummary = {
  scheduledDeliveryDate: DeliveryDateString;
  totalOrders: number;
  totalMeals: number;
  subscriptionOrders: number;
  oneTimeOrders: number;
  rescheduledOrders: number;
};

export type PreparationMealTotal = {
  mealTitle: string;
  totalQuantity: number;
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
  desiredDeliveryDate: string | null;
  scheduledDeliveryDate: string | null;
  deliveryRescheduleReason: string | null;
  isSubscriptionRenewal: boolean;
  /** Simulated test orders must never appear in kitchen preparation. */
  simulated: boolean;
  cancelledAt?: Date | null;
  createdAt: Date;
};
