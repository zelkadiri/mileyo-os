import type { LineItemProperty } from "../../utils/orderLineItemProperties";

export type { LineItemProperty };

export type OrderLineItem = {
  name?: string;
  properties?: LineItemProperty[];
  selling_plan_allocation?: unknown;
  selling_plan_id?: number | string | null;
  title?: string;
  /** Shopify REST orders/create — numeric variant id of the paid line. */
  variant_id?: number | string | null;
};

export type OrderCustomerPayload = {
  email?: string | null;
  first_name?: string | null;
  id?: number | string | null;
  last_name?: string | null;
};

export type OrdersCreateWebhookPayload = {
  created_at?: string | null;
  contact_email?: string | null;
  customer?: OrderCustomerPayload | null;
  email?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  id?: number | string;
  line_items?: OrderLineItem[];
  name?: string | null;
  subscription_contracts?: unknown[];
};
