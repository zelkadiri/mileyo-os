import type { SubscriptionObjective } from "../../constants/subscriptionObjective";

export type AdminOrderDto = {
  boxTitle: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  customerEmail: string | null;
  customerName: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  futureBoxTitle: string | null;
  futureMealsCount: number | null;
  futureSelectedMeals: unknown;
  futureSubscriptionPrice: string | null;
  futureUpdatedAt: Date | null;
  id: string;
  isSubscriptionRenewal: boolean;
  mealsCount: number | null;
  /** Historical snapshot from BoxOrder — not the live subscription objective. */
  objective: SubscriptionObjective | null;
  orderType: string | null;
  selectedMeals: unknown;
  selectedMealsSource: string | null;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  simulated: boolean;
};

export type OrdersPageData = {
  orders: AdminOrderDto[];
};
