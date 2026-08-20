/**
 * Meal nutrition metafield writes — PRODUCTVARIANT owners only via metafieldsSet.
 *
 * Mirrors the error-handling pattern in settings-box-meal-counts.server.ts.
 * Shopify metafieldsSet accepts at most 25 inputs per call — writes are chunked.
 */

import { getGraphqlUserErrors } from "../utils/graphql";
import {
  buildMealNutritionWritePlans,
  type MealNutritionImportRow,
  type MealNutritionMetafieldSetInput,
  type MealNutritionWritePlan,
} from "../utils/mealNutritionImport";

/** Shopify Admin API hard limit for metafieldsSet(metafields: …). */
export const SHOPIFY_METAFIELDS_SET_MAX_INPUT = 25;

const metafieldsSetMutation = `#graphql
  mutation SaveMealNutritionMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
        value
      }
      userErrors {
        elementIndex
        field
        message
      }
    }
  }
`;

type MetafieldsSetResponse = {
  data?: {
    metafieldsSet?: {
      metafields?: { id: string; key: string; value: string }[] | null;
      userErrors?: {
        elementIndex?: number | null;
        field?: string[] | null;
        message?: string | null;
      }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ApplyMealNutritionMetafieldsResult = {
  /** Variants whose full metafield set was written successfully. */
  appliedVariantCount: number;
  errors: string[];
};

const flattenMetafields = (
  plans: readonly MealNutritionWritePlan[],
): {
  flat: MealNutritionMetafieldSetInput[];
  ownerLabelByFlatIndex: string[];
} => {
  const flat: MealNutritionMetafieldSetInput[] = [];
  const ownerLabelByFlatIndex: string[] = [];

  for (const plan of plans) {
    const label = plan.productTitle
      ? `${plan.productTitle} (${plan.variantId})`
      : plan.variantId;

    for (const metafield of plan.metafields) {
      flat.push(metafield);
      ownerLabelByFlatIndex.push(label);
    }
  }

  return { flat, ownerLabelByFlatIndex };
};

/**
 * Groups write plans so each metafieldsSet call stays within Shopify's input limit.
 * Never splits one variant across batches (all its metafields travel together).
 */
export const chunkMealNutritionWritePlans = (
  plans: readonly MealNutritionWritePlan[],
  maxMetafields: number = SHOPIFY_METAFIELDS_SET_MAX_INPUT,
): MealNutritionWritePlan[][] => {
  if (maxMetafields < 1) {
    throw new Error("maxMetafields must be >= 1");
  }

  const batches: MealNutritionWritePlan[][] = [];
  let current: MealNutritionWritePlan[] = [];
  let currentMetafieldCount = 0;

  for (const plan of plans) {
    const planSize = plan.metafields.length;

    if (planSize > maxMetafields) {
      throw new Error(
        `Write plan for ${plan.variantId} has ${planSize} metafields, exceeding the metafieldsSet limit of ${maxMetafields}.`,
      );
    }

    if (
      current.length > 0 &&
      currentMetafieldCount + planSize > maxMetafields
    ) {
      batches.push(current);
      current = [];
      currentMetafieldCount = 0;
    }

    current.push(plan);
    currentMetafieldCount += planSize;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
};

const executeMetafieldsSetBatch = async (
  admin: ShopifyAdmin,
  plans: readonly MealNutritionWritePlan[],
): Promise<string[]> => {
  const { flat, ownerLabelByFlatIndex } = flattenMetafields(plans);

  if (flat.length === 0) {
    return [];
  }

  if (flat.length > SHOPIFY_METAFIELDS_SET_MAX_INPUT) {
    return [
      `Lot metafieldsSet trop grand (${flat.length} > ${SHOPIFY_METAFIELDS_SET_MAX_INPUT}).`,
    ];
  }

  const response = await admin.graphql(metafieldsSetMutation, {
    variables: {
      metafields: flat.map((metafield) => ({
        key: metafield.key,
        namespace: metafield.namespace,
        ownerId: metafield.ownerId,
        type: metafield.type,
        value: metafield.value,
      })),
    },
  });
  const json = (await response.json()) as MetafieldsSetResponse;

  if (json.errors?.length) {
    return (
      json.errors
        .map((error) => error.message)
        .filter(Boolean) as string[]
    ).concat("Erreur GraphQL lors de l’écriture des macros nutrition.");
  }

  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  const messages: string[] = [];

  for (const error of userErrors) {
    const index = error.elementIndex ?? -1;
    const ownerLabel = ownerLabelByFlatIndex[index] ?? "Variante";
    const message =
      getGraphqlUserErrors(
        error.message ? [{ message: error.message }] : [],
      ) || "Erreur Shopify inconnue.";

    messages.push(`${ownerLabel} : ${message}`);
  }

  return messages;
};

export const applyMealNutritionMetafields = async (
  admin: ShopifyAdmin,
  rows: readonly MealNutritionImportRow[],
): Promise<ApplyMealNutritionMetafieldsResult> => {
  if (rows.length === 0) {
    return { appliedVariantCount: 0, errors: [] };
  }

  const plans = buildMealNutritionWritePlans(rows);
  const batches = chunkMealNutritionWritePlans(plans);

  let appliedVariantCount = 0;

  for (const batch of batches) {
    const batchErrors = await executeMetafieldsSetBatch(admin, batch);

    if (batchErrors.length > 0) {
      return {
        appliedVariantCount,
        errors: batchErrors,
      };
    }

    appliedVariantCount += batch.length;
  }

  return { appliedVariantCount, errors: [] };
};
