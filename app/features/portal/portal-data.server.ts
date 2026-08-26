import type { Prisma } from "@prisma/client";

import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import {
  calculateNextBillingDateFromPolicy,
  derivePortalSubscriptionState,
  fetchSubscriptionContractBillingPolicy,
  fetchSubscriptionContractNextBillingDate,
  reconcilePortalSelectionShopifyState,
} from "../../services/subscriptionBillingWorker.server";
import {
  getPortalRecoveryForSelection,
  resolvePaymentUpdateEligibility,
} from "../../services/subscriptionPaymentRecovery.server";
import {
  getPortalModificationBlockMessage,
  getPortalModificationBlockReason,
} from "../../services/subscriptionModificationBlock.server";
import { fetchSubscriptionContractCurrentVariantId } from "../../services/subscriptionContractBoxChange.server";
import {
  getPendingSubscriptionBoxChange,
  isRecoveryBlockingBoxChange,
  resolveCurrentDeliveryCoverage,
} from "../../services/subscriptionBoxChange.server";
import { getMerchantSupportContact } from "../../utils/merchantSupport.server";
import { fetchBuilderBoxOptions } from "../builder/builder-catalog.server";
import { findBuilderBoxByVariantId } from "../builder/builder-box-selection";
import type { PaymentUpdateUnavailableReason } from "../../constants/subscriptionPaymentRecovery";
import { BOX_CHANGE_RECOVERY_BLOCK_MESSAGE } from "../../constants/subscriptionBoxChange";
import {
  PORTAL_ADDRESS_ORDER_LOCKED_MESSAGE,
  PORTAL_ADDRESS_PREPARATION_MESSAGE,
  PORTAL_ADDRESS_UNAVAILABLE_MESSAGE,
  PORTAL_ADDRESS_UNSUPPORTED_METHOD_MESSAGE,
} from "../../constants/subscriptionContractAddress";
import { getCutoffNow } from "../../services/deliveryCutoff.server";
import { getDeliveryCutoffStatus, projectActiveScheduledDeliveryDate } from "../../utils/deliveryDate";
import {
  formatMealSelectionStatusLabel,
  isTerminalPortalDisplayStatus,
  TERMINAL_PORTAL_DISPLAY_STATUSES,
} from "../../constants/subscriptionStatus";
import { normalizeShopifyId } from "../../utils/shopifyIds.server";
import { dedupeSubscriptionSelectionsByContract } from "../../services/subscriptionMealSelection.server";
import { fetchSubscriptionContractShippingAddress } from "../../services/subscriptionContractAddress.server";
import { derivePortalResumeUi } from "./portal-resume.server";
import {
  fetchPortalMealOptions,
  toPortalMealsFromBuilder,
} from "./portal-catalog.server";
import {
  getPortalObjectiveLabel,
  getPortalV2BoxTitle,
  shouldIncludeInPortalNextBox,
  toPortalV2BoxProducts,
} from "./portal-boxes";
import {
  extractOrderPrice,
  extractOrderStatusUrl,
  getSelectedMeals,
  isPortalForecastEligible,
} from "./portal-formatters";
import {
  buildPortalHistoryOrderFilters,
  PORTAL_INVALID_SUBSCRIPTION_NOTICE,
  resolveSelectedPortalSubscriptionId,
} from "./portal-multi-subscription";
import type {
  PortalAddressBlockKind,
  PortalBoxProduct,
  PortalDeliveryAddressState,
  PortalForecastCycle,
  PortalHistoryOrder,
  PortalLegacySubscription,
  PortalMeal,
  PortalPendingBoxChange,
  PortalSelection,
  PortalTerminalSelection,
  MerchantSupportContact,
} from "./portal-types";

export type PortalData = {
  boxes: PortalBoxProduct[];
  historyOrders: PortalHistoryOrder[];
  legacySubscriptions: PortalLegacySubscription[];
  meals: PortalMeal[];
  merchantSupport: MerchantSupportContact;
  /** Manageable V2 active+paused selections (selector source). */
  selections: PortalSelection[];
  selectedSubscriptionId: string | null;
  /** Soft notice when `?subscription=` was invalid — never leaks ownership. */
  selectionNotice: string | null;
  terminalSelections: PortalTerminalSelection[];
};

const FORECAST_CYCLE_COUNT = 3;

const toPortalAddressBlockKind = (
  reason: NonNullable<ReturnType<typeof getPortalModificationBlockReason>>,
): PortalAddressBlockKind => reason;

const buildDeliveryAddressState = async ({
  admin,
  deliveryLocked,
  modificationBlockReason,
  subscriptionContractId,
}: {
  admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
  deliveryLocked: boolean;
  modificationBlockReason: ReturnType<typeof getPortalModificationBlockReason>;
  subscriptionContractId: string | null;
}): Promise<PortalDeliveryAddressState> => {
  if (!subscriptionContractId) {
    return {
      address: null,
      blockKind: "missing_contract",
      blockMessage: PORTAL_ADDRESS_UNAVAILABLE_MESSAGE,
      editable: false,
    };
  }

  const fetched = await fetchSubscriptionContractShippingAddress(
    admin,
    subscriptionContractId,
  );

  if (fetched.kind === "unsupported_method") {
    return {
      address: null,
      blockKind: "non_shipping",
      blockMessage: PORTAL_ADDRESS_UNSUPPORTED_METHOD_MESSAGE,
      editable: false,
    };
  }

  if (fetched.kind === "missing_contract" || fetched.kind === "error") {
    return {
      address: null,
      blockKind: "unavailable",
      blockMessage: PORTAL_ADDRESS_UNAVAILABLE_MESSAGE,
      editable: false,
    };
  }

  const address = fetched.address;

  if (modificationBlockReason) {
    return {
      address,
      blockKind: toPortalAddressBlockKind(modificationBlockReason),
      blockMessage: PORTAL_ADDRESS_PREPARATION_MESSAGE,
      editable: false,
    };
  }

  if (deliveryLocked) {
    return {
      address,
      blockKind: "order_locked",
      blockMessage: PORTAL_ADDRESS_ORDER_LOCKED_MESSAGE,
      editable: false,
    };
  }

  return {
    address,
    blockKind: null,
    blockMessage: null,
    editable: true,
  };
};

/**
 * Upcoming billing previews (read-only).
 * Starts after `nextBillingDate` (first push is next+interval).
 *
 * When an active portal pending exists, cycles whose estimatedBillingDate is
 * on/after pending.effectiveBillingDate use the pending target box/price/count.
 * Failed/stale/applying are not passed here — only the DTO from status=pending.
 */
export const buildForecastCycles = ({
  billingPolicy,
  boxSubscriptionPrice,
  boxTitle,
  mealsCount,
  nextBillingDate,
  pendingBoxChange = null,
}: {
  billingPolicy: { interval: string; intervalCount: number };
  boxSubscriptionPrice: string | null;
  boxTitle: string | null;
  mealsCount: number;
  nextBillingDate: Date;
  pendingBoxChange?: Pick<
    PortalPendingBoxChange,
    "boxSubscriptionPrice" | "boxTitle" | "effectiveBillingDate" | "mealsCount"
  > | null;
}): PortalForecastCycle[] => {
  const cycles: PortalForecastCycle[] = [];
  let cursor = nextBillingDate;

  for (let index = 0; index < FORECAST_CYCLE_COUNT; index += 1) {
    cursor = calculateNextBillingDateFromPolicy(cursor, billingPolicy);
    const estimatedBillingDate = cursor.toISOString();
    const usePending =
      pendingBoxChange != null &&
      estimatedBillingDate >= pendingBoxChange.effectiveBillingDate;

    cycles.push({
      boxSubscriptionPrice: usePending
        ? pendingBoxChange.boxSubscriptionPrice
        : boxSubscriptionPrice,
      boxTitle: usePending ? pendingBoxChange.boxTitle : boxTitle,
      estimatedBillingDate,
      mealsCount: usePending ? pendingBoxChange.mealsCount : mealsCount,
    });
  }

  return cycles;
};

const mapBoxOrdersToPortalHistory = (
  boxOrders: Awaited<ReturnType<typeof prisma.boxOrder.findMany>>,
): PortalHistoryOrder[] => {
  const seenOrderIds = new Set<string>();

  return boxOrders
    .filter((order) => {
      if (seenOrderIds.has(order.shopifyOrderId)) {
        return false;
      }

      seenOrderIds.add(order.shopifyOrderId);
      return true;
    })
    .map((order) => ({
      boxTitle: order.boxTitle,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      id: order.id,
      orderDate: order.createdAt.toISOString(),
      price: extractOrderPrice(order.rawOrder),
      selectedMeals: getSelectedMeals(order.selectedMeals),
      shopifyOrderName: order.shopifyOrderName,
      statusPageUrl: extractOrderStatusUrl(order.rawOrder),
    }));
};

/** History for one subscription.
 * Prefer subscriptionSelectionId / contract / originating order.
 * Email fallback only when the customer has a single non-terminal sub
 * (legacy BoxOrders may lack selection/contract links).
 */
const loadPortalHistoryOrdersForSelection = async ({
  allowEmailFallback,
  selection,
  shop,
}: {
  allowEmailFallback: boolean;
  selection: {
    customerEmail: string | null;
    id: string;
    shopifyOrderId: string;
    subscriptionContractId: string | null;
  };
  shop: string;
}): Promise<PortalHistoryOrder[]> => {
  const orFilters = buildPortalHistoryOrderFilters({
    allowEmailFallback,
    customerEmail: selection.customerEmail,
    selectionId: selection.id,
    shopifyOrderId: selection.shopifyOrderId,
    subscriptionContractId: normalizeShopifyId(selection.subscriptionContractId),
  }) as Prisma.BoxOrderWhereInput[];

  if (orFilters.length === 0) {
    return [];
  }

  const boxOrders = await prisma.boxOrder.findMany({
    orderBy: { createdAt: "desc" },
    where: {
      OR: orFilters,
      shop,
      simulated: false,
    },
  });

  return mapBoxOrdersToPortalHistory(boxOrders);
};

/**
 * Raw query helpers — DO NOT use for authorization.
 * Shop / customer identity must come from `authenticateMileyoAppProxy` first.
 * Kept for non-auth URL parsing / tests only.
 */
export const getShopFromRequest = (request: Request) => {
  const url = new URL(request.url);
  return url.searchParams.get("shop")?.trim() ?? null;
};

export const getCustomerIdFromRequest = (request: Request) => {
  const url = new URL(request.url);
  return normalizeShopifyId(url.searchParams.get("logged_in_customer_id"));
};

export const loadPortalData = async ({
  customerShopifyId,
  requestedSubscriptionId = null,
  shop,
}: {
  customerShopifyId: string;
  /** `?subscription=` — must already belong to this customer+shop to win. */
  requestedSubscriptionId?: string | null;
  shop: string;
}): Promise<PortalData | null> => {
  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings?.mealCollectionId) {
    return null;
  }

  const { admin } = await unauthenticated.admin(shop);
  const [mealCatalog, catalog] = await Promise.all([
    fetchPortalMealOptions(admin, settings.mealCollectionId),
    fetchBuilderBoxOptions(admin),
  ]);
  const meals = toPortalMealsFromBuilder(mealCatalog);
  const boxes = toPortalV2BoxProducts(catalog);

  const manageableRecords = await prisma.subscriptionMealSelection.findMany({
    orderBy: { createdAt: "desc" },
    where: {
      customerShopifyId,
      shop,
      status: { in: ["active", "paused"] },
    },
  });

  const terminalRecords = await prisma.subscriptionMealSelection.findMany({
    orderBy: { updatedAt: "desc" },
    where: {
      customerShopifyId,
      shop,
      status: { in: [...TERMINAL_PORTAL_DISPLAY_STATUSES] },
    },
  });

  const visibleManageable = dedupeSubscriptionSelectionsByContract(manageableRecords);
  const visibleTerminal = dedupeSubscriptionSelectionsByContract(terminalRecords);
  const hiddenCount =
    manageableRecords.length -
    visibleManageable.length +
    (terminalRecords.length - visibleTerminal.length);

  if (hiddenCount > 0) {
    console.log("[portal] deduped duplicate contract selections", {
      hiddenCount,
      hiddenSelectionIds: [...manageableRecords, ...terminalRecords]
        .filter(
          (record) =>
            !visibleManageable.some((visible) => visible.id === record.id) &&
            !visibleTerminal.some((visible) => visible.id === record.id),
        )
        .map((record) => ({
          id: record.id,
          shopifyOrderName: record.shopifyOrderName,
        })),
    });
  }

  const merchantSupport = await getMerchantSupportContact(shop);

  const mappedManageable = await Promise.all(
    visibleManageable
      .filter((record) => typeof record.mealsCount === "number" && record.mealsCount > 0)
      .map(async (record) => {
        const reconciled = await reconcilePortalSelectionShopifyState(
          admin,
          record,
        );

        if (isTerminalPortalDisplayStatus(reconciled.status)) {
          return {
            legacy: null as PortalLegacySubscription | null,
            selection: null as PortalSelection | null,
            terminalRecord: reconciled,
          };
        }

        let currentVariantId: string | null = null;

        if (reconciled.subscriptionContractId) {
          currentVariantId = await fetchSubscriptionContractCurrentVariantId(
            admin,
            reconciled.subscriptionContractId,
          );
        }

        if (!currentVariantId) {
          currentVariantId = reconciled.boxVariantShopifyId?.trim() || null;
        }

        const effectiveNextScheduledDeliveryDate =
          projectActiveScheduledDeliveryDate({
            nextScheduledDeliveryDate: reconciled.nextScheduledDeliveryDate,
            preferredDeliveryWeekday: reconciled.preferredDeliveryWeekday,
          }).effectiveDeliveryDate;

        // V1 / non-catalog: visible in "Autres abonnements", never V2 selector.
        if (
          !shouldIncludeInPortalNextBox({
            catalog,
            currentVariantId,
            status: reconciled.status,
          })
        ) {
          return {
            legacy: {
              id: reconciled.id,
              mealsCount:
                typeof reconciled.mealsCount === "number"
                  ? reconciled.mealsCount
                  : null,
              nextScheduledDeliveryDate: effectiveNextScheduledDeliveryDate,
              shopifyOrderName: reconciled.shopifyOrderName,
              status: reconciled.status,
              statusLabel: formatMealSelectionStatusLabel(reconciled.status),
            } satisfies PortalLegacySubscription,
            selection: null,
            terminalRecord: null,
          };
        }

        const portalState = derivePortalSubscriptionState(reconciled);
        const recoveryRecord =
          portalState === "resume_processing"
            ? null
            : await getPortalRecoveryForSelection(reconciled.id);
        let paymentUpdateAvailable = false;
        let paymentUpdateUnavailableReason: PaymentUpdateUnavailableReason = null;

        if (reconciled.subscriptionContractId) {
          const eligibility = await resolvePaymentUpdateEligibility(
            admin,
            reconciled.subscriptionContractId,
          );
          paymentUpdateAvailable = eligibility.available;
          paymentUpdateUnavailableReason = eligibility.reason;
        } else {
          paymentUpdateAvailable = false;
          paymentUpdateUnavailableReason = "unsupported";
        }

        const cutoffNow = getCutoffNow();

        const modificationBlockReason = getPortalModificationBlockReason(
          reconciled,
          recoveryRecord,
          cutoffNow,
        );
        const currentBox = findBuilderBoxByVariantId(catalog, currentVariantId);
        const objective = currentBox?.objective ?? null;
        const boxSubscriptionPrice =
          currentBox?.price ?? reconciled.boxSubscriptionPrice ?? null;
        const boxTitle = currentBox
          ? getPortalV2BoxTitle(currentBox.mealCount)
          : reconciled.boxTitle;

        const [{ locked: boxChangeAppliesNextCycle }, pendingRecord] =
          await Promise.all([
            resolveCurrentDeliveryCoverage({ selection: reconciled }),
            getPendingSubscriptionBoxChange({
              shop,
              subscriptionMealSelectionId: reconciled.id,
            }),
          ]);

        const deliveryAddress = await buildDeliveryAddressState({
          admin,
          deliveryLocked: boxChangeAppliesNextCycle,
          modificationBlockReason,
          subscriptionContractId: reconciled.subscriptionContractId,
        });

        let pendingBoxChange: PortalPendingBoxChange | null = null;

        if (pendingRecord) {
          const targetBox = findBuilderBoxByVariantId(
            catalog,
            pendingRecord.toProductVariantId,
          );
          pendingBoxChange = {
            boxSubscriptionPrice: targetBox?.price ?? null,
            boxTitle: targetBox
              ? getPortalV2BoxTitle(targetBox.mealCount)
              : getPortalV2BoxTitle(pendingRecord.toMealsCount),
            effectiveBillingDate:
              pendingRecord.effectiveBillingDate.toISOString(),
            mealsCount: pendingRecord.toMealsCount,
            productVariantId: pendingRecord.toProductVariantId,
            selectedMeals: getSelectedMeals(pendingRecord.toSelectedMeals),
          };
        }

        const recoveryBlocksBoxChange = isRecoveryBlockingBoxChange(
          recoveryRecord?.status,
        );
        // billing_processing still allows pending next-cycle box change.
        const hardBoxChangeBlockReason =
          modificationBlockReason &&
          modificationBlockReason !== "billing_processing"
            ? modificationBlockReason
            : null;
        const boxChangeBlocked =
          recoveryBlocksBoxChange || hardBoxChangeBlockReason !== null;
        const boxChangeBlockedReason = recoveryBlocksBoxChange
          ? BOX_CHANGE_RECOVERY_BLOCK_MESSAGE
          : hardBoxChangeBlockReason
            ? getPortalModificationBlockMessage(hardBoxChangeBlockReason)
            : null;

        let forecastCycles: PortalForecastCycle[] = [];

        if (
          isPortalForecastEligible(portalState) &&
          reconciled.subscriptionContractId &&
          reconciled.nextBillingDate
        ) {
          const billingPolicy = await fetchSubscriptionContractBillingPolicy(
            admin,
            reconciled.subscriptionContractId,
          );

          if (billingPolicy) {
            forecastCycles = buildForecastCycles({
              billingPolicy,
              boxSubscriptionPrice,
              boxTitle,
              mealsCount: reconciled.mealsCount as number,
              nextBillingDate: reconciled.nextBillingDate,
              // Active pending DTO only (getPendingSubscriptionBoxChange).
              // Per-selection — never shared across mappedManageable rows.
              pendingBoxChange,
            });
          }
        }

        const freshNextBillingDateForResume =
          reconciled.status === "paused" && reconciled.subscriptionContractId
            ? await fetchSubscriptionContractNextBillingDate(
                admin,
                reconciled.subscriptionContractId,
              )
            : null;

        const resumeUi = derivePortalResumeUi({
          freshNextBillingDate: freshNextBillingDateForResume,
          localNextBillingDate: reconciled.nextBillingDate,
          recovery: recoveryRecord,
        });

        return {
          legacy: null,
          selection: {
            boxChangeAppliesNextCycle,
            boxChangeBlocked,
            boxChangeBlockedReason,
            modificationBlocked: modificationBlockReason !== null,
            modificationBlockedReason: modificationBlockReason
              ? getPortalModificationBlockMessage(modificationBlockReason)
              : null,
            deliveryAddress,
            deliveryCutoff: (() => {
              const cutoff = getDeliveryCutoffStatus(
                effectiveNextScheduledDeliveryDate,
                cutoffNow,
              );

              return {
                deadlineLabel: cutoff.deadlineLabel,
                isKnown: cutoff.isKnown,
                isPassed: cutoff.isPassed,
              };
            })(),
            boxSubscriptionPrice,
            boxTitle,
            createdAt: reconciled.createdAt.toISOString(),
            currentVariantId: currentBox?.variantId ?? currentVariantId,
            forecastCycles,
            id: reconciled.id,
            mealsCount: reconciled.mealsCount as number,
            objective,
            objectiveLabel: getPortalObjectiveLabel(objective),
            nextBillingDate: reconciled.nextBillingDate?.toISOString() ?? null,
            nextScheduledDeliveryDate:
              effectiveNextScheduledDeliveryDate ?? null,
            pendingBoxChange,
            paymentUpdateAvailable,
            paymentUpdateUnavailableReason,
            portalState,
            preferredDeliveryWeekday: reconciled.preferredDeliveryWeekday ?? null,
            recovery: recoveryRecord
              ? {
                  failureCount: recoveryRecord.failureCount,
                  isFinalFailed: recoveryRecord.status === "final_failed",
                  nextRetryAt: recoveryRecord.nextRetryAt?.toISOString() ?? null,
                  paymentUpdateAvailable,
                  paymentUpdateUnavailableReason,
                  status: recoveryRecord.status,
                }
              : null,
            resumeBlockedMessage: resumeUi.resumeBlockedMessage,
            resumeRequiresPayment: resumeUi.resumeRequiresPayment,
            selectedMeals: getSelectedMeals(reconciled.selectedMeals),
            shopifyOrderName: reconciled.shopifyOrderName,
            status: reconciled.status,
            subscriptionContractId: normalizeShopifyId(
              reconciled.subscriptionContractId,
            ),
          },
          terminalRecord: null,
        };
      }),
  );

  const selections: PortalSelection[] = mappedManageable.flatMap((mapped) =>
    mapped.selection ? [mapped.selection] : [],
  );
  const legacySubscriptions: PortalLegacySubscription[] =
    mappedManageable.flatMap((mapped) => (mapped.legacy ? [mapped.legacy] : []));
  const extraTerminalRecords = mappedManageable.flatMap((mapped) =>
    mapped.terminalRecord ? [mapped.terminalRecord] : [],
  );
  const visibleTerminalWithReconcile = dedupeSubscriptionSelectionsByContract([
    ...visibleTerminal,
    ...extraTerminalRecords,
  ]);

  const { selectedSubscriptionId, usedFallback } =
    resolveSelectedPortalSubscriptionId({
      candidates: selections.map((selection) => ({
        createdAt: selection.createdAt,
        id: selection.id,
        nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
        status: selection.status,
      })),
      requestedSubscriptionId,
    });

  const selectedSelection =
    selections.find((selection) => selection.id === selectedSubscriptionId) ??
    null;

  // Email history fallback only when a single non-terminal sub exists (legacy links).
  const nonTerminalCount = selections.length + legacySubscriptions.length;
  const allowEmailFallback = nonTerminalCount <= 1;

  const selectedSourceRecord = selectedSelection
    ? visibleManageable.find((record) => record.id === selectedSelection.id)
    : null;

  const historyOrders = selectedSourceRecord
    ? await loadPortalHistoryOrdersForSelection({
        allowEmailFallback,
        selection: selectedSourceRecord,
        shop,
      })
    : [];

  const lastOrderDateByContract = new Map<string, string>();

  for (const order of historyOrders) {
    const matchingSelection = visibleManageable.find(
      (record) => record.shopifyOrderName === order.shopifyOrderName,
    );
    const contractId = normalizeShopifyId(matchingSelection?.subscriptionContractId);

    if (!contractId) {
      continue;
    }

    const existing = lastOrderDateByContract.get(contractId);

    if (!existing || order.orderDate > existing) {
      lastOrderDateByContract.set(contractId, order.orderDate);
    }
  }

  const terminalContractIds = [
    ...new Set(
      visibleTerminalWithReconcile
        .map((record) => normalizeShopifyId(record.subscriptionContractId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (terminalContractIds.length > 0) {
    const terminalOrders = await prisma.boxOrder.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        shop,
        simulated: false,
        subscriptionContractId: { in: terminalContractIds },
      },
    });

    for (const order of terminalOrders) {
      const contractId = normalizeShopifyId(order.subscriptionContractId);

      if (!contractId || lastOrderDateByContract.has(contractId)) {
        continue;
      }

      lastOrderDateByContract.set(contractId, order.createdAt.toISOString());
    }
  }

  const terminalSelections: PortalTerminalSelection[] = visibleTerminalWithReconcile
    .filter((record) => typeof record.mealsCount === "number" && record.mealsCount > 0)
    .map((record) => {
      const contractId = normalizeShopifyId(record.subscriptionContractId);

      return {
        boxTitle: record.boxTitle,
        id: record.id,
        lastOrderDate: contractId
          ? (lastOrderDateByContract.get(contractId) ?? null)
          : null,
        mealsCount: record.mealsCount as number,
        selectedMeals: getSelectedMeals(record.selectedMeals),
        shopifyOrderName: record.shopifyOrderName,
        status: record.status,
        statusLabel: formatMealSelectionStatusLabel(record.status),
        subscriptionContractId: contractId,
        updatedAt: record.updatedAt.toISOString(),
      };
    });

  return {
    boxes,
    historyOrders,
    legacySubscriptions,
    meals,
    merchantSupport,
    selections,
    selectedSubscriptionId,
    selectionNotice: usedFallback ? PORTAL_INVALID_SUBSCRIPTION_NOTICE : null,
    terminalSelections,
  };
};
