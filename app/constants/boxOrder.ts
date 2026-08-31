/** Prisma `where` fragment — non-cancelled operational box orders. */
export const ACTIVE_BOX_ORDER_WHERE = {
  cancelledAt: null,
} as const;

/** Kitchen / production queries — excludes simulated test orders and cancellations. */
export const KITCHEN_PREPARATION_BOX_ORDER_WHERE = {
  cancelledAt: null,
  simulated: false,
} as const;

export const isActiveKitchenBoxOrder = (order: {
  cancelledAt?: Date | string | null;
  simulated?: boolean | null;
}) =>
  order.simulated !== true &&
  (order.cancelledAt == null || order.cancelledAt === "");
