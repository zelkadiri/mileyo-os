import { isDeliveryCutoffPassed, projectActiveScheduledDeliveryDate } from "../utils/deliveryDate";

export type DeliveryCutoffBlockReason = "cutoff_passed";

export const DELIVERY_CUTOFF_MODIFICATION_BLOCK_MESSAGE =
  "Cette box est déjà en préparation. Les modifications ne sont plus possibles pour cette livraison.";

export const DELIVERY_CUTOFF_LIFECYCLE_BLOCK_MESSAGE =
  "Cette box est déjà en préparation. Cette action ne peut plus s’appliquer à la livraison en cours.";

export const getDeliveryCutoffBlockReason = (
  selection: {
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday?: number | null;
  },
  now: Date = new Date(),
): DeliveryCutoffBlockReason | null => {
  try {
    const effectiveDeliveryDate = projectActiveScheduledDeliveryDate({
      nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
      now,
      preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
    }).effectiveDeliveryDate;

    if (isDeliveryCutoffPassed(effectiveDeliveryDate, now)) {
      return "cutoff_passed";
    }
  } catch {
    return null;
  }

  return null;
};

export const getDeliveryCutoffBlockMessage = (
  reason: DeliveryCutoffBlockReason,
  actionKind: "modification" | "subscription_control" = "modification",
) => {
  if (reason !== "cutoff_passed") {
    return DELIVERY_CUTOFF_MODIFICATION_BLOCK_MESSAGE;
  }

  return actionKind === "subscription_control"
    ? DELIVERY_CUTOFF_LIFECYCLE_BLOCK_MESSAGE
    : DELIVERY_CUTOFF_MODIFICATION_BLOCK_MESSAGE;
};
