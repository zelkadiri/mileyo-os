export type AdminOrderDto = {
  boxTitle: string | null;
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
