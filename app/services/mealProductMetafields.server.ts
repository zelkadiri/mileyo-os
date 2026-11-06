/**
 * PRODUCT metafield writes for meal create — custom.ingredients / allergenes / badges.
 * Types confirmed on DEV (list.single_line_text_field + single_line_text_field).
 */

import { getGraphqlUserErrors } from "../utils/graphql";
import {
  assertMealProductMetafieldsRoundTrip,
  buildMealProductMetafieldsSetInputs,
  type MealProductMetafieldSetInput,
  type MealProductMetafieldValues,
} from "../utils/mealProductMetafields";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const metafieldsSetMutation = `#graphql
  mutation SaveMealProductMetafields($metafields: [MetafieldsSetInput!]!) {
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

export const MEAL_PRODUCT_METAFIELDS_VERIFY_QUERY = `#graphql
  query VerifyMealProductMetafields($id: ID!) {
    product(id: $id) {
      id
      ingredientsMetafield: metafield(namespace: "custom", key: "ingredients") {
        type
        value
      }
      allergenesMetafield: metafield(namespace: "custom", key: "allergenes") {
        type
        value
      }
      badge1Metafield: metafield(namespace: "custom", key: "badge_1") {
        type
        value
      }
      badge2Metafield: metafield(namespace: "custom", key: "badge_2") {
        type
        value
      }
      badge3Metafield: metafield(namespace: "custom", key: "badge_3") {
        type
        value
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

type VerifyResponse = {
  data?: {
    product?: {
      id?: string | null;
      ingredientsMetafield?: { type?: string | null; value?: string | null } | null;
      allergenesMetafield?: { type?: string | null; value?: string | null } | null;
      badge1Metafield?: { type?: string | null; value?: string | null } | null;
      badge2Metafield?: { type?: string | null; value?: string | null } | null;
      badge3Metafield?: { type?: string | null; value?: string | null } | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

export type ApplyMealProductMetafieldsResult = {
  errors: string[];
  writtenCount: number;
};

const executeMetafieldsSet = async (
  admin: ShopifyAdmin,
  metafields: readonly MealProductMetafieldSetInput[],
): Promise<string[]> => {
  if (metafields.length === 0) {
    return [];
  }

  const response = await admin.graphql(metafieldsSetMutation, {
    variables: {
      metafields: metafields.map((metafield) => ({
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
    ).concat("Erreur GraphQL lors de l’écriture des informations produit.");
  }

  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  return userErrors.map((error) => {
    const message =
      getGraphqlUserErrors(
        error.message ? [{ message: error.message }] : [],
      ) || "Erreur Shopify inconnue.";
    return `Information produit : ${message}`;
  });
};

export const verifyMealProductMetafields = async (
  admin: ShopifyAdmin,
  productId: string,
  expected: MealProductMetafieldValues,
): Promise<{ ok: true } | { ok: false; errors: string[] }> => {
  const needsVerify =
    expected.ingredients.length > 0 ||
    expected.allergenes.length > 0 ||
    Boolean(expected.badge1 || expected.badge2 || expected.badge3);

  if (!needsVerify) {
    return { ok: true };
  }

  const response = await admin.graphql(MEAL_PRODUCT_METAFIELDS_VERIFY_QUERY, {
    variables: { id: productId },
  });
  const json = (await response.json()) as VerifyResponse;
  if (json.errors?.length) {
    return {
      ok: false,
      errors: json.errors
        .map((error) => error.message)
        .filter((message): message is string => Boolean(message)),
    };
  }

  const product = json.data?.product;
  if (!product?.id) {
    return {
      ok: false,
      errors: ["Impossible de relire les informations produit du plat."],
    };
  }

  const roundTrip = assertMealProductMetafieldsRoundTrip(expected, {
    ingredients: product.ingredientsMetafield?.value,
    allergenes: product.allergenesMetafield?.value,
    badge1: product.badge1Metafield?.value,
    badge2: product.badge2Metafield?.value,
    badge3: product.badge3Metafield?.value,
  });

  if (!roundTrip.ok) {
    return {
      ok: false,
      errors: [
        "Les informations produit enregistrées ne correspondent pas à la saisie.",
        ...roundTrip.reasons,
      ],
    };
  }

  return { ok: true };
};

export const applyMealProductMetafields = async (
  admin: ShopifyAdmin,
  productId: string,
  values: MealProductMetafieldValues,
): Promise<ApplyMealProductMetafieldsResult> => {
  const metafields = buildMealProductMetafieldsSetInputs(productId, values);
  if (metafields.length === 0) {
    return { errors: [], writtenCount: 0 };
  }

  const writeErrors = await executeMetafieldsSet(admin, metafields);
  if (writeErrors.length > 0) {
    return { errors: writeErrors, writtenCount: 0 };
  }

  const verified = await verifyMealProductMetafields(admin, productId, values);
  if (!verified.ok) {
    return { errors: verified.errors, writtenCount: 0 };
  }

  return { errors: [], writtenCount: metafields.length };
};
