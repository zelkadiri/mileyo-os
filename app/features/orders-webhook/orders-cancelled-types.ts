export type OrdersCancelledWebhookPayload = {
  cancelled_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  id?: number | string;
};
