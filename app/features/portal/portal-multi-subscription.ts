/**
 * Multi-subscription portal selection — pure helpers (no Prisma / Shopify I/O).
 *
 * Ownership is enforced upstream: candidates are already scoped to
 * shop + logged-in customer. Query `?subscription=` only picks among them.
 *
 * Internal portal hrefs must never replay Shopify App Proxy signed params
 * (shop, signature, timestamp, logged_in_customer_id, …). Only app-owned
 * query keys from PORTAL_APP_OWNED_QUERY_PARAMS may appear in generated links.
 */

import { MILEYO_PORTAL_PATH } from "../../constants/mileyoPortal";

const WEEKDAY_LABELS_FR = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

export const PORTAL_SUBSCRIPTION_QUERY_PARAM = "subscription";

/**
 * Positive allowlist of Mileyo-owned portal query params safe to keep in
 * internal hrefs / client POSTs. Never include Shopify App Proxy auth params.
 */
export const PORTAL_APP_OWNED_QUERY_PARAMS = [
  PORTAL_SUBSCRIPTION_QUERY_PARAM,
] as const;

export type PortalAppOwnedQueryParam =
  (typeof PORTAL_APP_OWNED_QUERY_PARAMS)[number];

export const PORTAL_INVALID_SUBSCRIPTION_NOTICE =
  "Abonnement introuvable — affichage de votre abonnement principal.";
export type PortalSubscriptionPickCandidate = {
  createdAt: string;
  id: string;
  nextScheduledDeliveryDate: string | null;
  status: string;
};

export const formatPortalWeekdayLabel = (
  weekday: number | null | undefined,
  { capitalize = true }: { capitalize?: boolean } = {},
): string | null => {
  if (weekday == null || weekday < 0 || weekday > 6) {
    return null;
  }

  const label = WEEKDAY_LABELS_FR[weekday]!;
  if (!capitalize) {
    return label;
  }

  return label.charAt(0).toUpperCase() + label.slice(1);
};

/**
 * Compact selector label.
 * Active: `{Objectif} · {N} repas · {Jour}` or `{N} repas · livraison {jour}`
 * Paused: `En pause · {N} repas · {Jour}`
 */
export const formatPortalSubscriptionSelectorLabel = ({
  mealsCount,
  objectiveLabel,
  preferredDeliveryWeekday,
  status,
}: {
  mealsCount: number;
  objectiveLabel: string | null | undefined;
  preferredDeliveryWeekday: number | null | undefined;
  status: string;
}): string => {
  const mealsPart = `${mealsCount} repas`;
  const dayCapital = formatPortalWeekdayLabel(preferredDeliveryWeekday, {
    capitalize: true,
  });
  const dayLower = formatPortalWeekdayLabel(preferredDeliveryWeekday, {
    capitalize: false,
  });

  if (status === "paused") {
    return dayCapital
      ? `En pause · ${mealsPart} · ${dayCapital}`
      : `En pause · ${mealsPart}`;
  }

  const objective = objectiveLabel?.trim() || null;

  if (objective && dayCapital) {
    return `${objective} · ${mealsPart} · ${dayCapital}`;
  }

  if (objective) {
    return `${objective} · ${mealsPart}`;
  }

  if (dayLower) {
    return `${mealsPart} · livraison ${dayLower}`;
  }

  return mealsPart;
};

/** Deterministic default when `?subscription=` is absent or invalid. */
export const pickDefaultPortalSubscriptionId = (
  candidates: readonly PortalSubscriptionPickCandidate[],
): string | null => {
  if (candidates.length === 0) {
    return null;
  }

  const statusRank = (status: string) => {
    if (status === "active") {
      return 0;
    }
    if (status === "paused") {
      return 1;
    }
    return 2;
  };

  const sorted = [...candidates].sort((left, right) => {
    const byStatus = statusRank(left.status) - statusRank(right.status);
    if (byStatus !== 0) {
      return byStatus;
    }

    const leftDate = left.nextScheduledDeliveryDate;
    const rightDate = right.nextScheduledDeliveryDate;

    if (leftDate && rightDate) {
      const byDate = leftDate.localeCompare(rightDate);
      if (byDate !== 0) {
        return byDate;
      }
    } else if (leftDate && !rightDate) {
      return -1;
    } else if (!leftDate && rightDate) {
      return 1;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });

  return sorted[0]!.id;
};

/**
 * Resolve selected manageable id from an optional query value.
 * Unknown / foreign / terminal ids never win — soft fallback to default.
 */
export const resolveSelectedPortalSubscriptionId = ({
  candidates,
  requestedSubscriptionId,
}: {
  candidates: readonly PortalSubscriptionPickCandidate[];
  requestedSubscriptionId: string | null | undefined;
}): {
  selectedSubscriptionId: string | null;
  usedFallback: boolean;
} => {
  if (candidates.length === 0) {
    return { selectedSubscriptionId: null, usedFallback: false };
  }

  const requested = requestedSubscriptionId?.trim() || null;
  if (requested && candidates.some((candidate) => candidate.id === requested)) {
    return { selectedSubscriptionId: requested, usedFallback: false };
  }

  return {
    selectedSubscriptionId: pickDefaultPortalSubscriptionId(candidates),
    usedFallback: Boolean(requested),
  };
};

/**
 * Extract only Mileyo app-owned query params from an incoming URL/search.
 * Shopify App Proxy signed params are dropped intentionally.
 */
export const pickPortalAppOwnedSearchParams = (
  requestUrlOrSearch: string,
): URLSearchParams => {
  const owned = new URLSearchParams();
  let incoming: URLSearchParams;

  try {
    if (requestUrlOrSearch.includes("://")) {
      incoming = new URL(requestUrlOrSearch).searchParams;
    } else if (requestUrlOrSearch.startsWith("/")) {
      incoming = new URL(
        requestUrlOrSearch,
        "https://mileyo.invalid",
      ).searchParams;
    } else {
      incoming = new URLSearchParams(
        requestUrlOrSearch.startsWith("?")
          ? requestUrlOrSearch.slice(1)
          : requestUrlOrSearch,
      );
    }
  } catch {
    return owned;
  }

  for (const key of PORTAL_APP_OWNED_QUERY_PARAMS) {
    const value = incoming.get(key)?.trim();
    if (value) {
      owned.set(key, value);
    }
  }

  return owned;
};

/**
 * Canonical portal href for switching subscription.
 * Path is always MILEYO_PORTAL_PATH; query is allowlisted app-owned params only.
 */
export const buildPortalSubscriptionHref = (
  requestUrl: string,
  selectionId: string,
): string => {
  const params = pickPortalAppOwnedSearchParams(requestUrl);
  params.set(PORTAL_SUBSCRIPTION_QUERY_PARAM, selectionId);
  const query = params.toString();
  return query ? `${MILEYO_PORTAL_PATH}?${query}` : MILEYO_PORTAL_PATH;
};

/** Path + allowlisted query for portal action POSTs (never replay proxy auth). */
export const buildPortalActionRequestUrl = (
  requestUrlOrSearch: string,
  pathname: string = MILEYO_PORTAL_PATH,
): string => {
  const params = pickPortalAppOwnedSearchParams(requestUrlOrSearch);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

export const getRequestedSubscriptionIdFromRequest = (
  request: Request,
): string | null => {
  const url = new URL(request.url);
  const value = url.searchParams.get(PORTAL_SUBSCRIPTION_QUERY_PARAM)?.trim();
  return value || null;
};

/**
 * History isolation keys for a subscription.
 * Prefer local selection / contract; originating order as secondary link.
 * Email fallback is opt-in (single-subscription legacy safety only).
 */
export const buildPortalHistoryOrderFilters = ({
  allowEmailFallback,
  customerEmail,
  selectionId,
  shopifyOrderId,
  subscriptionContractId,
}: {
  allowEmailFallback: boolean;
  customerEmail: string | null | undefined;
  selectionId: string;
  shopifyOrderId: string | null | undefined;
  subscriptionContractId: string | null | undefined;
}): Array<Record<string, unknown>> => {
  const filters: Array<Record<string, unknown>> = [
    { subscriptionSelectionId: selectionId },
  ];

  const contractId = subscriptionContractId?.trim();
  if (contractId) {
    filters.push({ subscriptionContractId: contractId });
  }

  const orderId = shopifyOrderId?.trim();
  if (orderId) {
    filters.push({ shopifyOrderId: orderId });
  }

  const email = customerEmail?.trim();
  if (allowEmailFallback && email) {
    filters.push({ customerEmail: email });
  }

  return filters;
};
