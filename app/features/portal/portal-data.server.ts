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
  getSubscriptionBoxChangeBlockMessage,
  getSubscriptionBoxChangeBlockReason,
} from "../../services/subscriptionContractBoxChange.server";
import {
  fetchBoxCatalogProducts,
  resolveCurrentBoxProduct,
  toPortalBoxProducts,
  toTrustedBoxProducts,
  type PortalBoxProduct,
} from "../../services/subscriptionBoxCatalog.server";
import { getMerchantSupportContact } from "../../utils/merchantSupport.server";
import type { PaymentUpdateUnavailableReason } from "../../constants/subscriptionPaymentRecovery";
import { normalizeShopifyId } from "../../utils/shopifyIds.server";
import { dedupeSubscriptionSelectionsByContract } from "../../services/subscriptionMealSelection.server";
import { derivePortalResumeUi } from "./portal-resume.server";
import { getCollectionProducts, toPortalMeals } from "./portal-catalog.server";
import {
  extractOrderPrice,
  extractOrderStatusUrl,
  getSelectedMeals,
  isPortalForecastEligible,
} from "./portal-formatters";
import type {
  PortalForecastCycle,
  PortalHistoryOrder,
  PortalMeal,
  PortalSelection,
  MerchantSupportContact,
} from "./portal-types";

export type PortalData = {
  boxes: PortalBoxProduct[];
  historyOrders: PortalHistoryOrder[];
  meals: PortalMeal[];
  merchantSupport: MerchantSupportContact;
  selections: PortalSelection[];
};

const FORECAST_CYCLE_COUNT = 3;

const buildForecastCycles = ({
  billingPolicy,
  boxSubscriptionPrice,
  boxTitle,
  mealsCount,
  nextBillingDate,
}: {
  billingPolicy: { interval: string; intervalCount: number };
  boxSubscriptionPrice: string | null;
  boxTitle: string | null;
  mealsCount: number;
  nextBillingDate: Date;
}): PortalForecastCycle[] => {
  const cycles: PortalForecastCycle[] = [];
  let cursor = nextBillingDate;

  for (let index = 0; index < FORECAST_CYCLE_COUNT; index += 1) {
    cursor = calculateNextBillingDateFromPolicy(cursor, billingPolicy);
    cycles.push({
      boxSubscriptionPrice,
      boxTitle,
      estimatedBillingDate: cursor.toISOString(),
      mealsCount,
    });
  }

  return cycles;
};

const loadPortalHistoryOrders = async ({
  shop,
  visibleRecords,
}: {
  shop: string;
  visibleRecords: {
    customerEmail: string | null;
    subscriptionContractId: string | null;
  }[];
}): Promise<PortalHistoryOrder[]> => {
  const contractIds = [
    ...new Set(
      visibleRecords
        .map((record) => normalizeShopifyId(record.subscriptionContractId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const customerEmails = [
    ...new Set(
      visibleRecords
        .map((record) => record.customerEmail?.trim())
        .filter((email): email is string => Boolean(email)),
    ),
  ];

  const orFilters: Prisma.BoxOrderWhereInput[] = [];

  if (contractIds.length > 0) {
    orFilters.push({ subscriptionContractId: { in: contractIds } });
  }

  if (customerEmails.length > 0) {
    orFilters.push({ customerEmail: { in: customerEmails } });
  }

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
  shop,
}: {
  customerShopifyId: string;
  shop: string;
}): Promise<PortalData | null> => {
  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings?.mealCollectionId || !settings.boxCollectionId) {
    return null;
  }

  const { admin } = await unauthenticated.admin(shop);
  const [mealProducts, boxCatalog] = await Promise.all([
    getCollectionProducts(admin, settings.mealCollectionId),
    fetchBoxCatalogProducts(admin, settings.boxCollectionId),
  ]);
  const meals = toPortalMeals(mealProducts);
  const trustedBoxes = toTrustedBoxProducts(boxCatalog);
  const boxes = toPortalBoxProducts(boxCatalog);

  const records = await prisma.subscriptionMealSelection.findMany({
    orderBy: { createdAt: "desc" },
    where: {
      customerShopifyId,
      shop,
      status: { in: ["active", "paused"] },
    },
  });

  const visibleRecords = dedupeSubscriptionSelectionsByContract(records);
  const hiddenCount = records.length - visibleRecords.length;

  if (hiddenCount > 0) {
    console.log("[portal] deduped duplicate contract selections", {
      hiddenCount,
      hiddenSelectionIds: records
        .filter(
          (record) =>
            !visibleRecords.some((visible) => visible.id === record.id),
        )
        .map((record) => ({
          id: record.id,
          shopifyOrderName: record.shopifyOrderName,
        })),
    });
  }

  const merchantSupport = getMerchantSupportContact();

  const selections: PortalSelection[] = await Promise.all(
    visibleRecords
      .filter((record) => typeof record.mealsCount === "number" && record.mealsCount > 0)
      .map(async (record) => {
        const reconciled = await reconcilePortalSelectionShopifyState(
          admin,
          record,
        );
        const portalState = derivePortalSubscriptionState(reconciled);
        const recoveryRecord =
          portalState === "resume_processing"
            ? null
            : await getPortalRecoveryForSelection(reconciled.id);
        let paymentUpdateAvailable = false;
        let paymentUpdateUnavailableReason: PaymentUpdateUnavailableReason = null;

        if (recoveryRecord) {
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
        }

        const boxChangeBlockReason = getSubscriptionBoxChangeBlockReason(
          reconciled,
          recoveryRecord,
        );
        const currentBox = resolveCurrentBoxProduct(trustedBoxes, {
          boxProductShopifyId: reconciled.boxProductShopifyId,
          boxTitle: reconciled.boxTitle,
          mealsCount: reconciled.mealsCount,
        });
        const boxSubscriptionPrice =
          reconciled.boxSubscriptionPrice ??
          currentBox?.subscriptionPrice ??
          null;

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
              boxTitle: reconciled.boxTitle,
              mealsCount: reconciled.mealsCount as number,
              nextBillingDate: reconciled.nextBillingDate,
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
          boxChangeBlocked: boxChangeBlockReason !== null,
          boxChangeBlockedReason: boxChangeBlockReason
            ? getSubscriptionBoxChangeBlockMessage(boxChangeBlockReason)
            : null,
          boxProductShopifyId:
            reconciled.boxProductShopifyId ?? currentBox?.id ?? null,
          boxSubscriptionPrice,
          boxTitle: reconciled.boxTitle,
          forecastCycles,
          id: reconciled.id,
          mealsCount: reconciled.mealsCount as number,
          nextBillingDate: reconciled.nextBillingDate?.toISOString() ?? null,
          portalState,
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
        };
      }),
  );

  const historyOrders = await loadPortalHistoryOrders({
    shop,
    visibleRecords,
  });

  return { boxes, historyOrders, meals, merchantSupport, selections };
};
