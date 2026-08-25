import { unauthenticated } from "../../shopify.server";
import {
  BUILDER_CART_MEAL_COUNT_PROPERTY,
  BUILDER_CART_ORDER_TYPE_PROPERTY,
  BUILDER_CART_ORDER_TYPE_SUBSCRIPTION,
  BUILDER_CART_PREPARE_ERROR,
  getShopifyNumericId,
} from "./builder-cart";
import { describeBuilderCheckoutThrownError } from "./builder-checkout-errors";
import {
  CREATE_BUILDER_CHECKOUT_INTENT,
  normalizeBuilderEmail,
} from "./builder-email";
import {
  DELIVERY_DATE_PROPERTY_TECHNICAL,
  DELIVERY_DATE_PROPERTY_VISIBLE,
} from "../../utils/orderLineItemProperties";
import { parseDeliveryDate } from "../../utils/deliveryDate";
import { parseMealCountMetafield } from "../../utils/mealCountMetafield";

export { CREATE_BUILDER_CHECKOUT_INTENT };

export type BuilderCheckoutMealLine = {
  quantity: number;
  title: string;
};

export type BuilderCheckoutCartAttribute = {
  key: string;
  value: string;
};

export type CreateBuilderCheckoutInput = {
  boxVariantId: string;
  deliveryRangeLabel: string;
  email: string;
  mealCount: number;
  meals: BuilderCheckoutMealLine[];
  scheduledDeliveryDate: string;
  sellingPlanId: string;
};

export type CreateBuilderCheckoutResult =
  | { checkoutUrl: string; ok: true }
  | { message: string; ok: false };

const asOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** Normalize numeric or GID ids to a Shopify GID for Storefront Cart lines. */
export const toShopifyResourceGid = (
  resource: "ProductVariant" | "SellingPlan",
  value: unknown,
): string | null => {
  const raw = asOptionalString(value);
  if (!raw) {
    return null;
  }

  const prefix = `gid://shopify/${resource}/`;
  if (raw.startsWith(prefix)) {
    return raw;
  }

  const numericId = getShopifyNumericId(raw);
  if (!numericId || !/^\d+$/.test(numericId)) {
    return null;
  }

  return `${prefix}${numericId}`;
};

export const buildBuilderCheckoutLineAttributes = ({
  deliveryRangeLabel,
  mealCount,
  meals,
  scheduledDeliveryDate,
}: {
  deliveryRangeLabel: string;
  mealCount: number;
  meals: readonly BuilderCheckoutMealLine[];
  scheduledDeliveryDate: string;
}): BuilderCheckoutCartAttribute[] => {
  const attributes: BuilderCheckoutCartAttribute[] = [
    {
      key: BUILDER_CART_ORDER_TYPE_PROPERTY,
      value: BUILDER_CART_ORDER_TYPE_SUBSCRIPTION,
    },
    {
      key: BUILDER_CART_MEAL_COUNT_PROPERTY,
      value: String(mealCount),
    },
    {
      key: DELIVERY_DATE_PROPERTY_TECHNICAL,
      value: scheduledDeliveryDate,
    },
    {
      key: DELIVERY_DATE_PROPERTY_VISIBLE,
      value: `${deliveryRangeLabel} (${scheduledDeliveryDate})`,
    },
  ];

  let propertyIndex = 1;
  for (const meal of meals) {
    const quantity = Math.max(0, Math.floor(meal.quantity));
    const title = meal.title.trim();
    if (!title || quantity <= 0) {
      continue;
    }
    for (let index = 0; index < quantity; index += 1) {
      attributes.push({
        key: `Plat ${propertyIndex}`,
        value: title,
      });
      propertyIndex += 1;
    }
  }

  return attributes;
};

export const parseCreateBuilderCheckoutBody = (
  payload: unknown,
): {
  boxVariantId?: unknown;
  deliveryRangeLabel?: unknown;
  email?: unknown;
  intent?: unknown;
  mealCount?: unknown;
  meals?: unknown;
  scheduledDeliveryDate?: unknown;
  sellingPlanId?: unknown;
} | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const body = payload as Record<string, unknown>;
  return {
    boxVariantId: body.boxVariantId,
    deliveryRangeLabel: body.deliveryRangeLabel,
    email: body.email,
    intent: body.intent,
    mealCount: body.mealCount,
    meals: body.meals,
    scheduledDeliveryDate: body.scheduledDeliveryDate,
    sellingPlanId: body.sellingPlanId,
  };
};

const parseMealLines = (value: unknown): BuilderCheckoutMealLine[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const meals: BuilderCheckoutMealLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const row = entry as Record<string, unknown>;
    const title = asOptionalString(row.title);
    const quantityRaw = row.quantity;
    const quantity =
      typeof quantityRaw === "number"
        ? quantityRaw
        : typeof quantityRaw === "string"
          ? Number(quantityRaw)
          : NaN;

    if (!title || !Number.isFinite(quantity) || quantity < 0) {
      return null;
    }

    meals.push({
      quantity: Math.floor(quantity),
      title,
    });
  }

  return meals;
};

export const parseCreateBuilderCheckoutInput = (
  body: ReturnType<typeof parseCreateBuilderCheckoutBody>,
): CreateBuilderCheckoutInput | null => {
  if (!body) {
    return null;
  }

  const email = normalizeBuilderEmail(body.email);
  const boxVariantId = toShopifyResourceGid("ProductVariant", body.boxVariantId);
  const sellingPlanId = toShopifyResourceGid("SellingPlan", body.sellingPlanId);
  const deliveryRangeLabel = asOptionalString(body.deliveryRangeLabel);
  const scheduledDeliveryDate = parseDeliveryDate(
    asOptionalString(body.scheduledDeliveryDate),
  );
  const mealCount =
    typeof body.mealCount === "number" && Number.isInteger(body.mealCount)
      ? parseMealCountMetafield(String(body.mealCount))
      : parseMealCountMetafield(asOptionalString(body.mealCount));
  const meals = parseMealLines(body.meals);

  if (
    !email.valid ||
    !boxVariantId ||
    !sellingPlanId ||
    !deliveryRangeLabel ||
    !scheduledDeliveryDate ||
    mealCount == null ||
    !meals
  ) {
    return null;
  }

  return {
    boxVariantId,
    deliveryRangeLabel,
    email: email.value,
    mealCount,
    meals,
    scheduledDeliveryDate,
    sellingPlanId,
  };
};

const CART_CREATE_MUTATION = `#graphql
  mutation CreateBuilderCheckoutCart($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        checkoutUrl
        id
        buyerIdentity {
          email
        }
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

type CartCreateResponse = {
  data?: {
    cartCreate?: {
      cart?: {
        buyerIdentity?: { email?: string | null } | null;
        checkoutUrl?: string | null;
        id?: string | null;
      } | null;
      userErrors?: Array<{
        code?: string | null;
        field?: string[] | null;
        message?: string | null;
      }> | null;
    } | null;
  } | null;
  errors?: Array<{ message?: string }> | null;
};

/**
 * Storefront Cart checkout for the builder: selling plan line + guest email
 * via buyerIdentity, then redirect to cart.checkoutUrl (editable prefill).
 */
export const createBuilderStorefrontCheckout = async ({
  input,
  shop,
}: {
  input: CreateBuilderCheckoutInput;
  shop: string | null;
}): Promise<CreateBuilderCheckoutResult> => {
  if (!shop) {
    return { message: "Boutique introuvable.", ok: false };
  }

  const attributes = buildBuilderCheckoutLineAttributes({
    deliveryRangeLabel: input.deliveryRangeLabel,
    mealCount: input.mealCount,
    meals: input.meals,
    scheduledDeliveryDate: input.scheduledDeliveryDate,
  });

  try {
    const { storefront } = await unauthenticated.storefront(shop);
    const response = await storefront.graphql(CART_CREATE_MUTATION, {
      variables: {
        input: {
          buyerIdentity: {
            email: input.email,
          },
          lines: [
            {
              attributes,
              merchandiseId: input.boxVariantId,
              quantity: 1,
              sellingPlanId: input.sellingPlanId,
            },
          ],
        },
      },
    });

    const json = (await response.json()) as CartCreateResponse;
    const payload = json.data?.cartCreate;
    const checkoutUrl = payload?.cart?.checkoutUrl?.trim() || null;
    const userErrors = payload?.userErrors ?? [];

    if (!checkoutUrl || userErrors.length > 0 || json.errors?.length) {
      console.error("[builder_checkout] storefront cartCreate failed", {
        errorCount: json.errors?.length ?? 0,
        hasCheckoutUrl: Boolean(checkoutUrl),
        intent: CREATE_BUILDER_CHECKOUT_INTENT,
        shop,
        userErrorCodes: userErrors
          .map((error) => error.code)
          .filter(Boolean)
          .slice(0, 5),
      });
      return { message: BUILDER_CART_PREPARE_ERROR, ok: false };
    }

    return { checkoutUrl, ok: true };
  } catch (error) {
    const details = describeBuilderCheckoutThrownError(error);
    console.error("[builder_checkout] storefront cartCreate threw", {
      intent: CREATE_BUILDER_CHECKOUT_INTENT,
      name: details.name,
      message: details.message,
      status: details.status,
      requestId: details.requestId,
      shop,
    });
    return { message: BUILDER_CART_PREPARE_ERROR, ok: false };
  }
};
