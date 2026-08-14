import prisma from "../../db.server";
import { parseSubscriptionObjective } from "../../utils/subscriptionObjective";
import { parseDeliveryDate } from "../../utils/deliveryDate";
import { parseMealCountMetafield } from "../../utils/mealCountMetafield";
import {
  CAPTURE_CHECKOUT_LEAD_INTENT,
  normalizeBuilderEmail,
} from "./builder-email";

export { CAPTURE_CHECKOUT_LEAD_INTENT };

/**
 * CheckoutLead capture (13H).
 *
 * convertedAt is intentionally unused here — mark conversion from the order
 * webhook once Shopify has a customer email (13I/13J).
 * Abandoned leads may later need a retention purge; no cron in 13H.
 */

export type CheckoutLeadContext = {
  boxVariantId: string | null;
  mealCount: number | null;
  objective: string | null;
  scheduledDeliveryDate: string | null;
};

export type CaptureCheckoutLeadResult =
  | { ok: true }
  | { message: string; ok: false };

const MAX_BOX_VARIANT_ID_LENGTH = 255;

const asOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const parseCheckoutLeadContext = (input: {
  boxVariantId?: unknown;
  mealCount?: unknown;
  objective?: unknown;
  scheduledDeliveryDate?: unknown;
}): CheckoutLeadContext => {
  const rawObjective = asOptionalString(input.objective);
  const objective = rawObjective
    ? parseSubscriptionObjective(rawObjective)
    : null;

  const rawVariantId = asOptionalString(input.boxVariantId);
  const boxVariantId =
    rawVariantId && rawVariantId.length <= MAX_BOX_VARIANT_ID_LENGTH
      ? rawVariantId
      : null;

  const mealCount =
    typeof input.mealCount === "number" && Number.isInteger(input.mealCount)
      ? parseMealCountMetafield(String(input.mealCount))
      : parseMealCountMetafield(asOptionalString(input.mealCount));

  const rawDeliveryDate = asOptionalString(input.scheduledDeliveryDate);
  const scheduledDeliveryDate = rawDeliveryDate
    ? parseDeliveryDate(rawDeliveryDate)
    : null;

  return {
    boxVariantId,
    mealCount,
    objective,
    scheduledDeliveryDate,
  };
};

export const getBuilderShopFromRequest = (request: Request): string | null => {
  const url = new URL(request.url);
  return url.searchParams.get("shop")?.trim() || null;
};

export const parseCaptureCheckoutLeadBody = (
  payload: unknown,
): {
  boxVariantId?: unknown;
  email?: unknown;
  intent?: unknown;
  mealCount?: unknown;
  objective?: unknown;
  scheduledDeliveryDate?: unknown;
} | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const body = payload as Record<string, unknown>;
  return {
    boxVariantId: body.boxVariantId,
    email: body.email,
    intent: body.intent,
    mealCount: body.mealCount,
    objective: body.objective,
    scheduledDeliveryDate: body.scheduledDeliveryDate,
  };
};

const LEAD_CAPTURE_FAILURE_MESSAGE =
  "Impossible de continuer pour le moment. Réessayez.";

export const captureCheckoutLead = async ({
  context,
  emailInput,
  shop,
}: {
  context: CheckoutLeadContext;
  emailInput: unknown;
  shop: string | null;
}): Promise<CaptureCheckoutLeadResult> => {
  if (!shop) {
    return { message: "Boutique introuvable.", ok: false };
  }

  const email = normalizeBuilderEmail(emailInput);
  if (!email.valid) {
    return { message: "Entrez une adresse e-mail valide.", ok: false };
  }

  const now = new Date();

  try {
    await prisma.checkoutLead.upsert({
      create: {
        boxVariantId: context.boxVariantId,
        email: email.value,
        lastSeenAt: now,
        mealCount: context.mealCount,
        objective: context.objective,
        scheduledDeliveryDate: context.scheduledDeliveryDate,
        shop,
      },
      update: {
        boxVariantId: context.boxVariantId,
        lastSeenAt: now,
        mealCount: context.mealCount,
        objective: context.objective,
        scheduledDeliveryDate: context.scheduledDeliveryDate,
      },
      where: {
        shop_email: {
          email: email.value,
          shop,
        },
      },
    });
  } catch (error) {
    const err = error as { code?: string; name?: string };
    console.error("[checkout_lead] capture failed", {
      code: err.code ?? err.name ?? "unknown",
      operation: CAPTURE_CHECKOUT_LEAD_INTENT,
      shop,
    });
    return { message: LEAD_CAPTURE_FAILURE_MESSAGE, ok: false };
  }

  return { ok: true };
};
