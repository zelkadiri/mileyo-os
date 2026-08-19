import { isDeliveryCutoffPassed, projectActiveScheduledDeliveryDate } from "../utils/deliveryDate";

export type DeliveryCutoffBlockReason = "cutoff_passed";

/** DEV-only portal cutoff clock. Ignored when NODE_ENV is production. */
export const CUTOFF_DEV_CLOCK_ENV = "MILEYO_DEV_CUTOFF_NOW";

export const isCutoffDevClockEnabled = () =>
  process.env.NODE_ENV !== "production";

/**
 * Instant used by portal cutoff UI and mutation guards.
 * Production always returns `new Date()`, even if MILEYO_DEV_CUTOFF_NOW is set.
 */
export const getCutoffNow = (): Date => {
  if (!isCutoffDevClockEnabled()) {
    return new Date();
  }

  const raw = process.env[CUTOFF_DEV_CLOCK_ENV]?.trim();

  if (!raw) {
    return new Date();
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    console.log("[cutoff] ignored invalid MILEYO_DEV_CUTOFF_NOW", { raw });
    return new Date();
  }

  console.log("[cutoff] DEV clock override", {
    iso: parsed.toISOString(),
    raw,
  });

  return parsed;
};

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
