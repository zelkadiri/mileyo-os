import { getGraphqlUserErrors } from "../../utils/graphql";
import {
  MILEYO_MEAL_COUNT_METAFIELD_KEY,
  MILEYO_MEAL_COUNT_METAFIELD_NAMESPACE,
  isValidMealCountInput,
  parseMealCountMetafield,
} from "../../utils/mealCountMetafield";

const metafieldsSetMutation = `#graphql
  mutation SaveBoxMealCountMetafields($metafields: [MetafieldsSetInput!]!) {
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

export type BoxMealCountEntry = {
  mealCount: number;
  productId: string;
  title: string;
};

export const parseBoxMealCountFormEntries = (
  formData: FormData,
  products: { id: string; title: string }[],
): { entries: BoxMealCountEntry[]; errors: string[] } => {
  const productIds = formData.getAll("boxProductIds").map((value) => String(value));
  const mealCountValues = formData
    .getAll("boxMealCounts")
    .map((value) => String(value).trim());
  const errors: string[] = [];
  const entries: BoxMealCountEntry[] = [];

  if (productIds.length !== mealCountValues.length) {
    return {
      entries: [],
      errors: ["Données de formulaire invalides pour les tailles de box."],
    };
  }

  const productById = new Map(products.map((product) => [product.id, product]));

  for (let index = 0; index < productIds.length; index += 1) {
    const productId = productIds[index] ?? "";
    const rawValue = mealCountValues[index] ?? "";
    const product = productById.get(productId);

    if (!product) {
      errors.push(`Produit inconnu à la ligne ${index + 1}.`);
      continue;
    }

    if (!rawValue) {
      continue;
    }

    if (!isValidMealCountInput(rawValue)) {
      errors.push(
        `${product.title} : saisissez un nombre entier entre 1 et 100.`,
      );
      continue;
    }

    entries.push({
      mealCount: parseMealCountMetafield(rawValue) as number,
      productId,
      title: product.title,
    });
  }

  return { entries, errors };
};

export const saveBoxMealCountMetafields = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  entries: BoxMealCountEntry[],
): Promise<string[]> => {
  if (entries.length === 0) {
    return [];
  }

  const response = await admin.graphql(metafieldsSetMutation, {
    variables: {
      metafields: entries.map((entry) => ({
        key: MILEYO_MEAL_COUNT_METAFIELD_KEY,
        namespace: MILEYO_MEAL_COUNT_METAFIELD_NAMESPACE,
        ownerId: entry.productId,
        type: "number_integer",
        value: String(entry.mealCount),
      })),
    },
  });
  const json = (await response.json()) as MetafieldsSetResponse;

  if (json.errors?.length) {
    return (
      json.errors
        .map((error) => error.message)
        .filter(Boolean) as string[]
    ).concat("Erreur GraphQL lors de l’enregistrement des tailles de box.");
  }

  const result = json.data?.metafieldsSet;
  const userErrors = result?.userErrors ?? [];
  const messages: string[] = [];

  for (const error of userErrors) {
    const index = error.elementIndex ?? -1;
    const productTitle = entries[index]?.title ?? "Produit";
    const message =
      getGraphqlUserErrors(
        error.message ? [{ message: error.message }] : [],
      ) || "Erreur Shopify inconnue.";

    messages.push(`${productTitle} : ${message}`);
  }

  return messages;
};
