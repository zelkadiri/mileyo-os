/**
 * Create a Mileyo meal product via Shopify Admin GraphQL (productSet CREATE).
 *
 * Fail-closed flow:
 * 1. Auth + validate + collection + write_publications + catalog capacity
 * 2. Resolve identity via createAttemptId (+ optional resumeProductId); never title alone
 * 3. productSet CREATE DRAFT (3 Objectif variants @ 0.00 + mileyo.objective + create_attempt_id)
 * 4. metafieldsSet nutrition (PRODUCTVARIANT)
 * 5. metafieldsSet PRODUCT (ingredients / allergènes / badges — types confirmed DEV)
 * 6. Image upload if write_files granted + file present
 * 7. Unpublish Online Store + verify
 * 8. Activate product
 * 9. Unpublish + verify AGAIN after ACTIVE
 * 10. collectionAddProducts EN DERNIER
 * 11. Verify membership + invalidate caches
 *
 * Idempotence: mileyo.create_attempt_id on the product is the stable ownership key.
 * Title search is candidate discovery only — homonyms / manual drafts are never adopted.
 * Image requires optional write_files (stagedUploadsCreate). Without it, the
 * photo field is not presented as operational.
 * Never attaches selling plans. Never mutates Box V2.
 */

import {
  MEAL_V2_EXPECTED_VARIANT_COUNT,
  MEAL_V2_OBJECTIVE_METAFIELD,
  MEAL_V2_VARIANT_PRICE,
  getMealV2VariantSpecs,
  type MealV2VariantSpec,
} from "../../constants/subscriptionMealCatalogV2";
import {
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";
import prisma from "../../db.server";
import {
  invalidateBuilderMealsCatalogCache,
  invalidatePublicMealsCatalogCache,
} from "../builder/builder-catalog-cache.server";
import { getCollection } from "../settings/settings-catalog.server";
import {
  applyMealNutritionMetafields,
} from "../../services/mealNutritionImport.server";
import {
  attachMealProductImage,
  hasWriteFilesScope,
  validateMealImageFile,
} from "../../services/mealProductImage.server";
import { applyMealProductMetafields } from "../../services/mealProductMetafields.server";
import {
  fetchOnlineStorePublicationId,
  hasWritePublicationsScope,
  unpublishProductFromOnlineStore,
} from "../../services/mealOnlineStoreUnpublish.server";
import {
  MEAL_CATALOG_PRODUCTS_MAX_PAGES,
  MEAL_CATALOG_PRODUCTS_PAGE_SIZE,
  fetchMealCatalogProductTitles,
} from "../../services/subscriptionMealCatalog.server";
import { parseSubscriptionObjective } from "../../utils/subscriptionObjective";
import { escapeHtml } from "../../utils/html";
import type { MealNutritionImportRow } from "../../utils/mealNutritionImport";
import { buildMealProductMetafieldValues } from "../../utils/mealProductMetafields";
import { verifyMealV2MetafieldDefinitions } from "../settings/settings-metafields.server";
import {
  CREATE_MEAL_INTENT,
  MEAL_CREATE_BLOCKED_FIELD_MESSAGES,
  MEAL_CREATE_IMAGE_SCOPE_MESSAGE,
  REQUEST_MEAL_IMAGE_SCOPES_INTENT,
  createEmptyMealCreateFormValues,
  mealCreateHasBlockedImageInput,
  mealCreateHasBlockedProductInput,
  parseMealCreateFormData,
  validateMealCreateFormValues,
  type MealCreateFormValues,
} from "./meals-create-form";

export { CREATE_MEAL_INTENT, REQUEST_MEAL_IMAGE_SCOPES_INTENT };

/**
 * Create gate below the paginated catalog hard ceiling
 * (PAGE_SIZE × MAX_PAGES) so a successful create cannot exhaust fetch capacity.
 */
export const MEAL_CREATE_MAX_PRODUCTS =
  MEAL_CATALOG_PRODUCTS_PAGE_SIZE * MEAL_CATALOG_PRODUCTS_MAX_PAGES - 50;

type MealsAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/** Stable creation identity — written on productSet CREATE, verified on resume. */
export const MEAL_CREATE_ATTEMPT_METAFIELD = {
  namespace: "mileyo",
  key: "create_attempt_id",
  type: "single_line_text_field",
} as const;

export type MealCreateProductMetafieldInput = {
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type MealCreateProductSetInput = {
  title: string;
  descriptionHtml?: string;
  status: "DRAFT";
  metafields: MealCreateProductMetafieldInput[];
  productOptions: {
    name: string;
    position: number;
    values: { name: string }[];
  }[];
  variants: {
    optionValues: { optionName: string; name: string }[];
    price: string;
    inventoryPolicy: "CONTINUE";
    inventoryItem: { tracked: false };
    metafields: {
      namespace: string;
      key: string;
      type: string;
      value: string;
    }[];
  }[];
};

export type CreateMealResult = {
  errors: string[];
  fieldErrors: { field: string; message: string }[];
  message: string;
  ok: boolean;
  /** Present after productSet even on later failure — for resume / no duplicate. */
  trackingProductId: string | null;
  productTitle: string | null;
  blockedFieldNotices: string[];
  values: MealCreateFormValues;
};

type GraphqlErrorResponse = {
  data?: {
    productSet?: {
      product?: {
        id?: string | null;
        title?: string | null;
        status?: string | null;
        variants?: {
          nodes?: Array<{
            id: string;
            title: string;
            price?: string | null;
            selectedOptions?: { name: string; value: string }[];
            objectiveMetafield?: { value?: string | null } | null;
            sellingPlanGroups?: { nodes?: unknown[] } | null;
          }>;
        } | null;
        collections?: {
          nodes?: Array<{ id: string }>;
        } | null;
        publishedOnOnlineStore?: boolean | null;
      } | null;
      userErrors?: { field?: string[] | null; message: string }[];
    };
    collectionAddProducts?: {
      collection?: { id?: string | null } | null;
      userErrors?: { field?: string[] | null; message: string }[];
    };
    products?: {
      nodes?: Array<{
        id: string;
        title: string;
        status?: string | null;
        createAttemptMetafield?: { value?: string | null } | null;
        variants?: {
          nodes?: Array<{
            id: string;
            title: string;
            price?: string | null;
            selectedOptions?: { name: string; value: string }[];
            objectiveMetafield?: { value?: string | null } | null;
            sellingPlanGroups?: { nodes?: unknown[] } | null;
          }>;
        } | null;
        collections?: {
          nodes?: Array<{ id: string }>;
        } | null;
      }>;
    };
    product?: {
      id?: string | null;
      title?: string | null;
      status?: string | null;
      createAttemptMetafield?: { value?: string | null } | null;
      variants?: {
        nodes?: Array<{
          id: string;
          title: string;
          price?: string | null;
          selectedOptions?: { name: string; value: string }[];
          objectiveMetafield?: { value?: string | null } | null;
          sellingPlanGroups?: { nodes?: unknown[] } | null;
        }>;
      } | null;
      collections?: {
        nodes?: Array<{ id: string }>;
      } | null;
      publishedOnOnlineStore?: boolean | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

export const MEAL_CREATE_PRODUCT_SET_MUTATION = `#graphql
  mutation CreateMealCatalogProduct(
    $input: ProductSetInput!
    $synchronous: Boolean!
  ) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id
        title
        status
        variants(first: 10) {
          nodes {
            id
            title
            price
            selectedOptions {
              name
              value
            }
            objectiveMetafield: metafield(namespace: "mileyo", key: "objective") {
              value
            }
            sellingPlanGroups(first: 1) {
              nodes {
                id
              }
            }
          }
        }
        collections(first: 5) {
          nodes {
            id
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const MEAL_ACTIVATE_PRODUCT_SET_MUTATION = `#graphql
  mutation ActivateMealCatalogProduct(
    $input: ProductSetInput!
    $synchronous: Boolean!
  ) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const MEAL_COLLECTION_ADD_PRODUCTS_MUTATION = `#graphql
  mutation AddMealToCollection($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MEAL_CREATE_PRODUCT_VERIFY_QUERY = `#graphql
  query VerifyCreatedMealProduct($id: ID!, $publicationId: ID!) {
    product(id: $id) {
      id
      title
      status
      createAttemptMetafield: metafield(
        namespace: "${MEAL_CREATE_ATTEMPT_METAFIELD.namespace}"
        key: "${MEAL_CREATE_ATTEMPT_METAFIELD.key}"
      ) {
        value
      }
      publishedOnOnlineStore: publishedOnPublication(publicationId: $publicationId)
      collections(first: 20) {
        nodes {
          id
        }
      }
      variants(first: 10) {
        nodes {
          id
          title
          price
          selectedOptions {
            name
            value
          }
          objectiveMetafield: metafield(namespace: "mileyo", key: "objective") {
            value
          }
          sellingPlanGroups(first: 1) {
            nodes {
              id
            }
          }
        }
      }
    }
  }
`;

/**
 * Candidate discovery by title after timeout (trackingProductId lost).
 * Identity is NEVER title alone — callers must match create_attempt_id.
 */
export const MEAL_CREATE_FIND_ATTEMPT_BY_TITLE_QUERY = `#graphql
  query FindMealCreateAttemptByTitle($query: String!) {
    products(first: 25, query: $query) {
      nodes {
        id
        title
        status
        createAttemptMetafield: metafield(
          namespace: "${MEAL_CREATE_ATTEMPT_METAFIELD.namespace}"
          key: "${MEAL_CREATE_ATTEMPT_METAFIELD.key}"
        ) {
          value
        }
        collections(first: 20) {
          nodes {
            id
          }
        }
        variants(first: 10) {
          nodes {
            id
            title
            price
            selectedOptions {
              name
              value
            }
            objectiveMetafield: metafield(namespace: "mileyo", key: "objective") {
              value
            }
            sellingPlanGroups(first: 1) {
              nodes {
                id
              }
            }
          }
        }
      }
    }
  }
`;

/** @deprecated Title-only DRAFT search — unsafe for identity. Prefer attempt lookup. */
export const MEAL_CREATE_FIND_DRAFT_BY_TITLE_QUERY =
  MEAL_CREATE_FIND_ATTEMPT_BY_TITLE_QUERY;

const graphqlErrorMessages = (json: GraphqlErrorResponse) =>
  (json.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

const isBlank = (value: string | null | undefined) =>
  value == null || value.trim() === "";

const normalizeTitleKey = (title: string) =>
  title.trim().toLocaleLowerCase("fr-FR");

const escapeShopifySearchValue = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Title search for attempt recovery — status not filtered (DRAFT or ACTIVE orphans). */
export const buildMealCreateAttemptTitleSearchQuery = (title: string): string =>
  `title:"${escapeShopifySearchValue(title.trim())}"`;

/** @deprecated Use buildMealCreateAttemptTitleSearchQuery — title+DRAFT is not identity. */
export const buildMealDraftTitleSearchQuery = (
  title: string,
): string => buildMealCreateAttemptTitleSearchQuery(title);

const toDescriptionHtml = (description: string): string | undefined => {
  const trimmed = description.trim();
  if (!trimmed) return undefined;
  const escaped = escapeHtml(trimmed).replace(/\r\n|\r|\n/g, "<br>");
  return `<p>${escaped}</p>`;
};

export const buildMealCreateProductSetInput = (
  title: string,
  description: string,
  createAttemptId: string,
  specs: MealV2VariantSpec[] = getMealV2VariantSpecs(),
): MealCreateProductSetInput => {
  const descriptionHtml = toDescriptionHtml(description);
  return {
    title,
    ...(descriptionHtml ? { descriptionHtml } : {}),
    status: "DRAFT",
    metafields: [
      {
        namespace: MEAL_CREATE_ATTEMPT_METAFIELD.namespace,
        key: MEAL_CREATE_ATTEMPT_METAFIELD.key,
        type: MEAL_CREATE_ATTEMPT_METAFIELD.type,
        value: createAttemptId.trim(),
      },
    ],
    productOptions: [
      {
        name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
        position: 1,
        values: specs.map((spec) => ({ name: spec.objectiveOptionLabel })),
      },
    ],
    variants: specs.map((spec) => ({
      optionValues: [
        {
          optionName: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
          name: spec.objectiveOptionLabel,
        },
      ],
      price: spec.price,
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false },
      metafields: [
        {
          namespace: MEAL_V2_OBJECTIVE_METAFIELD.namespace,
          key: MEAL_V2_OBJECTIVE_METAFIELD.key,
          type: MEAL_V2_OBJECTIVE_METAFIELD.type,
          value: spec.objectiveMetafieldValue,
        },
      ],
    })),
  };
};

/** Pure guard — create payload must never include collections / selling plans / media. */
export const assertMealCreateProductSetInputSafe = (
  input: MealCreateProductSetInput,
): { ok: true } | { ok: false; reasons: string[] } => {
  const reasons: string[] = [];
  const record = input as Record<string, unknown>;

  for (const forbidden of [
    "collections",
    "files",
    "media",
    "id",
    "requiresSellingPlan",
  ]) {
    if (forbidden in record) {
      reasons.push(`input must not include ${forbidden}`);
    }
  }

  if (input.status !== "DRAFT") {
    reasons.push(`status expected DRAFT, got ${input.status}`);
  }

  const attemptMetafields = (input.metafields ?? []).filter(
    (metafield) =>
      metafield.namespace === MEAL_CREATE_ATTEMPT_METAFIELD.namespace &&
      metafield.key === MEAL_CREATE_ATTEMPT_METAFIELD.key,
  );
  if (attemptMetafields.length !== 1) {
    reasons.push("create_attempt_id product metafield is required exactly once");
  } else if (isBlank(attemptMetafields[0]?.value)) {
    reasons.push("create_attempt_id product metafield must be non-empty");
  } else if (
    attemptMetafields[0]!.type !== MEAL_CREATE_ATTEMPT_METAFIELD.type
  ) {
    reasons.push(
      `create_attempt_id type expected ${MEAL_CREATE_ATTEMPT_METAFIELD.type}`,
    );
  }

  if (input.variants.length !== MEAL_V2_EXPECTED_VARIANT_COUNT) {
    reasons.push(
      `expected ${MEAL_V2_EXPECTED_VARIANT_COUNT} variants, got ${input.variants.length}`,
    );
  }

  for (const variant of input.variants) {
    if (variant.price !== MEAL_V2_VARIANT_PRICE) {
      reasons.push(
        `price expected ${MEAL_V2_VARIANT_PRICE}, got ${variant.price}`,
      );
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return { ok: true };
};

type CreatedVariantSnapshot = {
  id: string;
  title: string;
  price?: string | null;
  selectedOptions?: { name: string; value: string }[];
  objectiveMetafield?: { value?: string | null } | null;
  sellingPlanGroups?: { nodes?: unknown[] } | null;
};

export const verifyCreatedMealVariants = (
  variants: readonly CreatedVariantSnapshot[],
  specs: MealV2VariantSpec[] = getMealV2VariantSpecs(),
): { ok: true; byObjective: Record<SubscriptionObjective, string> } | {
  ok: false;
  reasons: string[];
} => {
  const reasons: string[] = [];
  const byObjective = {} as Record<SubscriptionObjective, string>;

  if (variants.length !== specs.length) {
    reasons.push(
      `expected ${specs.length} variants, got ${variants.length}`,
    );
  }

  for (const variant of variants) {
    const sellingPlans = variant.sellingPlanGroups?.nodes?.length ?? 0;
    if (sellingPlans > 0) {
      reasons.push(`variant ${variant.id} has a selling plan`);
    }

    if ((variant.price ?? "").trim() !== MEAL_V2_VARIANT_PRICE) {
      reasons.push(
        `variant ${variant.id}: price expected ${MEAL_V2_VARIANT_PRICE}, got ${variant.price ?? "null"}`,
      );
    }

    const objective = parseSubscriptionObjective(
      variant.objectiveMetafield?.value ?? null,
    );
    if (!objective) {
      reasons.push(
        `variant ${variant.id}: missing or invalid mileyo.objective`,
      );
      continue;
    }

    if (byObjective[objective]) {
      reasons.push(`duplicate objective ${objective}`);
      continue;
    }

    const expected = specs.find((spec) => spec.objective === objective);
    if (!expected) {
      reasons.push(`unexpected objective ${objective}`);
      continue;
    }

    const optionValue = variant.selectedOptions?.find(
      (option) => option.name === SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
    )?.value;
    if (optionValue !== expected.objectiveOptionLabel) {
      reasons.push(
        `${objective}: option expected "${expected.objectiveOptionLabel}", got "${optionValue ?? "null"}"`,
      );
    }

    byObjective[objective] = variant.id;
  }

  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    if (!byObjective[objective]) {
      reasons.push(`missing objective ${objective}`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true, byObjective };
};

const emptyResult = (
  values: MealCreateFormValues,
  overrides: Partial<CreateMealResult> = {},
): CreateMealResult => ({
  errors: [],
  fieldErrors: [],
  message: "",
  ok: false,
  trackingProductId: null,
  productTitle: null,
  blockedFieldNotices: [],
  values,
  ...overrides,
});

const blockedNoticesForImage = (
  imageFile: File | null | undefined,
  hasWriteFiles: boolean,
): string[] => {
  if (mealCreateHasBlockedImageInput(imageFile, hasWriteFiles)) {
    return [MEAL_CREATE_IMAGE_SCOPE_MESSAGE];
  }
  return [];
};

const failPartial = (
  values: MealCreateFormValues,
  trackingProductId: string | null,
  errors: string[],
  blockedFieldNotices: string[],
): CreateMealResult =>
  emptyResult(values, {
    errors,
    message:
      errors[0] ??
      "La création du plat a échoué. Aucun succès partiel n’est annoncé.",
    ok: false,
    trackingProductId,
    productTitle: values.title.trim() || null,
    blockedFieldNotices,
    values: {
      ...values,
      // Only keep resume id when this attempt owns the product — never echo a foreign id.
      resumeProductId: trackingProductId ?? "",
    },
  });

export type CreateMealPageLoaderData = {
  blockedFieldMessages: typeof MEAL_CREATE_BLOCKED_FIELD_MESSAGES;
  catalogCount: number;
  catalogLimit: number;
  canCreate: boolean;
  hasWritePublications: boolean;
  hasWriteFiles: boolean;
  mealCollectionConfigured: boolean;
  mealCollectionTitle: string | null;
  createBlockedReason: string | null;
  imageUploadAvailable: boolean;
};

export const loadMealCreatePageData = async (
  admin: MealsAdmin,
  shop: string,
  options: { hasWritePublications: boolean; hasWriteFiles: boolean },
): Promise<CreateMealPageLoaderData> => {
  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  const mealCollectionId = settings?.mealCollectionId?.trim() ?? "";
  const mealCollectionConfigured = Boolean(mealCollectionId);

  let catalogCount = 0;
  let createBlockedReason: string | null = null;

  if (!options.hasWritePublications) {
    createBlockedReason =
      "La permission de protection boutique en ligne est requise avant de créer un plat. Accordez-la depuis Réglages.";
  } else if (!mealCollectionConfigured) {
    createBlockedReason =
      "Configurez d’abord la collection de plats dans Réglages.";
  } else {
    const titles = await fetchMealCatalogProductTitles(admin, mealCollectionId);
    if (!titles.ok) {
      createBlockedReason = titles.errors[0] ?? "Impossible de lire le catalogue.";
    } else {
      catalogCount = titles.titles.length;
      if (catalogCount >= MEAL_CREATE_MAX_PRODUCTS) {
        createBlockedReason =
          `Le catalogue a atteint la limite de ${MEAL_CREATE_MAX_PRODUCTS} plats. ` +
          "Création bloquée pour ne pas rendre le catalogue inutilisable.";
      } else {
        const defs = await verifyMealV2MetafieldDefinitions(admin);
        if (!defs.ok) {
          createBlockedReason = defs.message;
        }
      }
    }
  }

  return {
    blockedFieldMessages: MEAL_CREATE_BLOCKED_FIELD_MESSAGES,
    catalogCount,
    catalogLimit: MEAL_CREATE_MAX_PRODUCTS,
    canCreate: createBlockedReason == null,
    hasWritePublications: options.hasWritePublications,
    hasWriteFiles: options.hasWriteFiles,
    mealCollectionConfigured,
    mealCollectionTitle: settings?.mealCollectionTitle ?? null,
    createBlockedReason,
    imageUploadAvailable: options.hasWriteFiles,
  };
};

const productBelongsToCreateAttempt = (
  node: {
    createAttemptMetafield?: { value?: string | null } | null;
  },
  createAttemptId: string,
): boolean => {
  const stored = node.createAttemptMetafield?.value?.trim() ?? "";
  return stored.length > 0 && stored === createAttemptId.trim();
};

/**
 * Find the product owned by this createAttemptId (title used only as candidate
 * discovery). Never adopts a homonym or manual draft without matching attempt id.
 */
export const findMealProductOwnedByCreateAttempt = async (
  admin: MealsAdmin,
  title: string,
  createAttemptId: string,
  mealCollectionId: string,
): Promise<
  | {
      ok: true;
      productId: string;
      variants: CreatedVariantSnapshot[];
      inCollection: boolean;
      status: string | null;
    }
  | { ok: true; productId: null }
  | { ok: false; errors: string[] }
> => {
  const response = await admin.graphql(
    MEAL_CREATE_FIND_ATTEMPT_BY_TITLE_QUERY,
    {
      variables: { query: buildMealCreateAttemptTitleSearchQuery(title) },
    },
  );
  const json = (await response.json()) as GraphqlErrorResponse;
  const topErrors = graphqlErrorMessages(json);
  if (topErrors.length > 0) {
    return { ok: false, errors: topErrors };
  }

  const titleKey = normalizeTitleKey(title);
  const owned = (json.data?.products?.nodes ?? []).filter((node) => {
    if (normalizeTitleKey(node.title) !== titleKey) return false;
    return productBelongsToCreateAttempt(node, createAttemptId);
  });

  if (owned.length === 0) {
    return { ok: true, productId: null };
  }

  if (owned.length > 1) {
    return {
      ok: false,
      errors: [
        `Plusieurs produits portent le même identifiant de création. Contactez le support avant de réessayer.`,
      ],
    };
  }

  const candidate = owned[0]!;
  const variantCheck = verifyCreatedMealVariants(
    candidate.variants?.nodes ?? [],
  );
  if (!variantCheck.ok) {
    return {
      ok: false,
      errors: [
        `Le produit de cette tentative a une structure invalide. Corrigez-le dans Shopify Admin avant de réessayer.`,
        ...variantCheck.reasons,
      ],
    };
  }

  const inCollection = (candidate.collections?.nodes ?? []).some(
    (collection) => collection.id === mealCollectionId,
  );

  return {
    ok: true,
    productId: candidate.id,
    variants: candidate.variants?.nodes ?? [],
    inCollection,
    status: candidate.status ?? null,
  };
};

/**
 * @deprecated Title-only orphan adoption is unsafe. Use
 * findMealProductOwnedByCreateAttempt.
 */
export const findOrphanMealDraftByTitle = async (
  admin: MealsAdmin,
  _title: string,
  _mealCollectionId: string,
): Promise<
  | { ok: true; productId: string; variants: CreatedVariantSnapshot[] }
  | { ok: true; productId: null }
  | { ok: false; errors: string[] }
> => ({
  ok: false,
  errors: [
    "Reprise par titre seul désactivée. Relancez depuis le formulaire (identifiant de création).",
  ],
});

const variantsFromByObjective = (
  byObjective: Record<SubscriptionObjective, string>,
): CreatedVariantSnapshot[] =>
  Object.entries(byObjective).map(([objective, id]) => ({
    id,
    title: SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[
      objective as SubscriptionObjective
    ],
    price: MEAL_V2_VARIANT_PRICE,
    objectiveMetafield: { value: objective },
    selectedOptions: [
      {
        name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
        value:
          SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[
            objective as SubscriptionObjective
          ],
      },
    ],
    sellingPlanGroups: { nodes: [] },
  }));

const createMealProductDraft = async (
  admin: MealsAdmin,
  input: MealCreateProductSetInput,
): Promise<{ errors: string[]; productId?: string; variants?: CreatedVariantSnapshot[] }> => {
  const response = await admin.graphql(MEAL_CREATE_PRODUCT_SET_MUTATION, {
    variables: {
      input,
      synchronous: true,
    },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const userErrors =
    json.data?.productSet?.userErrors?.map((error) => error.message) ?? [];
  const errors = [...graphqlErrorMessages(json), ...userErrors];
  if (errors.length > 0) {
    return { errors };
  }

  const product = json.data?.productSet?.product;
  const productId = product?.id ?? undefined;
  if (!productId) {
    return { errors: ["La création Shopify n’a renvoyé aucun identifiant de plat."] };
  }

  return {
    errors: [],
    productId,
    variants: product?.variants?.nodes ?? [],
  };
};

const activateMealProduct = async (
  admin: MealsAdmin,
  productId: string,
): Promise<{ errors: string[] }> => {
  const response = await admin.graphql(MEAL_ACTIVATE_PRODUCT_SET_MUTATION, {
    variables: {
      input: {
        id: productId,
        status: "ACTIVE",
      },
      synchronous: true,
    },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const userErrors =
    json.data?.productSet?.userErrors?.map((error) => error.message) ?? [];
  const errors = [...graphqlErrorMessages(json), ...userErrors];
  if (errors.length > 0) {
    return { errors };
  }
  if (json.data?.productSet?.product?.status !== "ACTIVE") {
    return {
      errors: [
        "Le plat n’a pas pu être activé. Il reste en brouillon, hors catalogue.",
      ],
    };
  }
  return { errors: [] };
};

const addMealToCollection = async (
  admin: MealsAdmin,
  mealCollectionId: string,
  productId: string,
): Promise<{ errors: string[] }> => {
  const response = await admin.graphql(MEAL_COLLECTION_ADD_PRODUCTS_MUTATION, {
    variables: {
      id: mealCollectionId,
      productIds: [productId],
    },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const userErrors =
    json.data?.collectionAddProducts?.userErrors?.map(
      (error) => error.message,
    ) ?? [];
  const errors = [...graphqlErrorMessages(json), ...userErrors];
  if (errors.length > 0) {
    return { errors };
  }
  if (!json.data?.collectionAddProducts?.collection?.id) {
    return {
      errors: [
        "L’ajout à la collection repas n’a pas confirmé l’appartenance.",
      ],
    };
  }
  return { errors: [] };
};

const verifyMealProductState = async (
  admin: MealsAdmin,
  productId: string,
  publicationId: string,
  mealCollectionId: string,
  options: {
    expectInCollection: boolean;
    expectStatus?: "ACTIVE" | "DRAFT";
    /** When set, refuse to operate on a product that does not own this attempt. */
    expectedCreateAttemptId?: string;
  },
): Promise<{
  errors: string[];
  byObjective?: Record<SubscriptionObjective, string>;
  inCollection: boolean;
  publishedOnOnlineStore: boolean | null;
  status: string | null;
  createAttemptId: string | null;
}> => {
  const response = await admin.graphql(MEAL_CREATE_PRODUCT_VERIFY_QUERY, {
    variables: { id: productId, publicationId },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const topErrors = graphqlErrorMessages(json);
  if (topErrors.length > 0) {
    return {
      errors: topErrors,
      inCollection: false,
      publishedOnOnlineStore: null,
      status: null,
      createAttemptId: null,
    };
  }

  const product = json.data?.product;
  if (!product?.id) {
    return {
      errors: ["Impossible de relire le plat créé."],
      inCollection: false,
      publishedOnOnlineStore: null,
      status: null,
      createAttemptId: null,
    };
  }

  const errors: string[] = [];
  const storedAttemptId =
    product.createAttemptMetafield?.value?.trim() || null;

  if (options.expectedCreateAttemptId) {
    if (
      !storedAttemptId ||
      storedAttemptId !== options.expectedCreateAttemptId.trim()
    ) {
      errors.push(
        "Ce produit n’appartient pas à la tentative de création en cours. Aucune reprise n’est effectuée.",
      );
    }
  }

  const inCollection = (product.collections?.nodes ?? []).some(
    (collection) => collection.id === mealCollectionId,
  );

  if (options.expectInCollection && !inCollection) {
    errors.push("Le plat n’appartient pas encore à la collection repas.");
  }
  if (!options.expectInCollection && inCollection) {
    errors.push(
      "Le plat a été trouvé dans la collection trop tôt (état incohérent).",
    );
  }

  if (
    options.expectStatus &&
    (product.status ?? "").toUpperCase() !== options.expectStatus
  ) {
    errors.push(
      `Statut attendu ${options.expectStatus}, obtenu ${product.status ?? "null"}.`,
    );
  }

  if (product.publishedOnOnlineStore === true) {
    errors.push("Le plat est encore publié sur la boutique en ligne.");
  }

  const variantCheck = verifyCreatedMealVariants(product.variants?.nodes ?? []);
  if (!variantCheck.ok) {
    errors.push(...variantCheck.reasons);
  }

  return {
    errors,
    byObjective: variantCheck.ok ? variantCheck.byObjective : undefined,
    inCollection,
    publishedOnOnlineStore: product.publishedOnOnlineStore ?? null,
    status: product.status ?? null,
    createAttemptId: storedAttemptId,
  };
};

/**
 * Core create orchestration with an explicit mealCollectionId (testable without Prisma).
 * Never calls live Shopify from tests — inject a mock admin.
 */
export const createMealProductForCollection = async ({
  admin,
  formData,
  grantedScopes,
  mealCollectionId,
  shop,
  fetchImpl = fetch,
}: {
  admin: MealsAdmin;
  formData: FormData;
  grantedScopes: readonly string[];
  mealCollectionId: string;
  shop: string;
  fetchImpl?: typeof fetch;
}): Promise<CreateMealResult> => {
  const values = parseMealCreateFormData(formData);
  const imageEntry = formData.get("image");
  const imageFile =
    typeof File !== "undefined" && imageEntry instanceof File
      ? imageEntry
      : null;
  const canUploadImage = hasWriteFilesScope(grantedScopes);
  const blockedFieldNotices = blockedNoticesForImage(imageFile, canUploadImage);

  const validation = validateMealCreateFormValues(values);
  if (!validation.ok) {
    return emptyResult(validation.values, {
      fieldErrors: validation.errors,
      errors: validation.errors.map((error) => error.message),
      message: "Corrigez les erreurs du formulaire avant de créer le plat.",
      blockedFieldNotices,
    });
  }

  // Image selected without write_files: refuse before mutation (field not operational).
  if (mealCreateHasBlockedImageInput(imageFile, canUploadImage)) {
    return emptyResult(validation.values, {
      errors: [MEAL_CREATE_IMAGE_SCOPE_MESSAGE],
      message: MEAL_CREATE_IMAGE_SCOPE_MESSAGE,
      fieldErrors: [
        {
          field: "image",
          message:
            "La photo ne peut pas être enregistrée tant que l’autorisation n’est pas accordée.",
        },
      ],
      blockedFieldNotices,
    });
  }

  if (imageFile && imageFile.size > 0 && canUploadImage) {
    const imageValidation = validateMealImageFile(imageFile);
    if (!imageValidation.ok) {
      return emptyResult(validation.values, {
        errors: imageValidation.errors,
        message: imageValidation.errors[0] ?? "Image invalide.",
        fieldErrors: imageValidation.errors.map((message) => ({
          field: "image",
          message,
        })),
        blockedFieldNotices,
      });
    }
  }

  if (!hasWritePublicationsScope(grantedScopes)) {
    return emptyResult(validation.values, {
      errors: [
        "Permission de protection boutique en ligne manquante. Création refusée avant toute modification.",
      ],
      message:
        "Permission de protection boutique en ligne manquante. Création refusée avant toute modification.",
      blockedFieldNotices,
    });
  }

  if (isBlank(mealCollectionId)) {
    return emptyResult(validation.values, {
      errors: ["Collection de plats manquante dans les réglages."],
      message: "Collection de plats manquante dans les réglages.",
      blockedFieldNotices,
    });
  }

  const collection = await getCollection(admin, mealCollectionId);
  if (!collection?.id) {
    return emptyResult(validation.values, {
      errors: ["Collection de plats introuvable dans Shopify."],
      message: "Collection de plats introuvable dans Shopify.",
      blockedFieldNotices,
    });
  }

  const titlesLookup = await fetchMealCatalogProductTitles(
    admin,
    mealCollectionId,
  );
  if (!titlesLookup.ok) {
    return emptyResult(validation.values, {
      errors: titlesLookup.errors,
      message: titlesLookup.errors[0] ?? "Impossible de lire le catalogue.",
      blockedFieldNotices,
    });
  }

  if (titlesLookup.titles.length >= MEAL_CREATE_MAX_PRODUCTS) {
    return emptyResult(validation.values, {
      errors: [
        `Le catalogue a atteint la limite de ${MEAL_CREATE_MAX_PRODUCTS} plats. Création refusée.`,
      ],
      message: `Le catalogue a atteint la limite de ${MEAL_CREATE_MAX_PRODUCTS} plats. Création refusée.`,
      blockedFieldNotices,
    });
  }

  const createAttemptId = validation.values.createAttemptId.trim();
  const titleKey = normalizeTitleKey(validation.values.title);

  const publicationLookup = await fetchOnlineStorePublicationId(admin);
  if (!publicationLookup.ok) {
    return emptyResult(validation.values, {
      errors: publicationLookup.errors,
      message:
        publicationLookup.errors[0] ??
        "Impossible de résoudre la publication boutique en ligne.",
      blockedFieldNotices,
    });
  }

  const input = buildMealCreateProductSetInput(
    validation.values.title,
    validation.values.description,
    createAttemptId,
  );
  const safety = assertMealCreateProductSetInputSafe(input);
  if (!safety.ok) {
    return emptyResult(validation.values, {
      errors: safety.reasons,
      message: safety.reasons[0] ?? "Payload de création invalide.",
      blockedFieldNotices,
    });
  }

  let trackingProductId = validation.values.resumeProductId.trim() || null;
  let variants: CreatedVariantSnapshot[] = [];

  // Resolve owned product by stable createAttemptId before any CREATE / title claim.
  if (!trackingProductId) {
    const owned = await findMealProductOwnedByCreateAttempt(
      admin,
      validation.values.title,
      createAttemptId,
      mealCollectionId,
    );
    if (!owned.ok) {
      return failPartial(
        validation.values,
        null,
        owned.errors,
        blockedFieldNotices,
      );
    }
    if (owned.productId) {
      trackingProductId = owned.productId;
      variants = owned.variants;
    }
  }

  if (trackingProductId) {
    // Idempotent retry: if already fully integrated AND owned by this attempt.
    const alreadyDone = await verifyMealProductState(
      admin,
      trackingProductId,
      publicationLookup.publicationId,
      mealCollectionId,
      {
        expectInCollection: true,
        expectStatus: "ACTIVE",
        expectedCreateAttemptId: createAttemptId,
      },
    );

    // Foreign productId — never continue mutating it.
    const ownershipDenied = alreadyDone.errors.some((error) =>
      error.includes("n’appartient pas à la tentative"),
    );
    if (ownershipDenied) {
      return failPartial(
        validation.values,
        null,
        alreadyDone.errors.filter((error) =>
          error.includes("n’appartient pas à la tentative"),
        ),
        blockedFieldNotices,
      );
    }

    if (
      alreadyDone.inCollection &&
      alreadyDone.errors.length === 0 &&
      alreadyDone.publishedOnOnlineStore === false
    ) {
      invalidateBuilderMealsCatalogCache(shop, mealCollectionId);
      invalidatePublicMealsCatalogCache(shop, mealCollectionId);
      return emptyResult(createEmptyMealCreateFormValues(), {
        ok: true,
        message: `Le plat « ${validation.values.title} » est déjà dans le catalogue (reprise idempotente).`,
        trackingProductId,
        productTitle: validation.values.title,
        blockedFieldNotices,
      });
    }

    // Owned + already in collection but not clean (e.g. still published).
    if (alreadyDone.inCollection) {
      return failPartial(
        validation.values,
        trackingProductId,
        [
          "Le plat de cette tentative est déjà dans le catalogue mais son état n’est pas confirmé.",
          ...alreadyDone.errors,
        ],
        blockedFieldNotices,
      );
    }
  }

  // Fail-closed: never CREATE / resume mutations without complete nutrition defs.
  const mealDefs = await verifyMealV2MetafieldDefinitions(admin);
  if (!mealDefs.ok) {
    return emptyResult(validation.values, {
      errors: [mealDefs.message, ...mealDefs.errors],
      message: mealDefs.message,
      fieldErrors: [],
      blockedFieldNotices,
    });
  }

  if (trackingProductId) {
    const resumed = await verifyMealProductState(
      admin,
      trackingProductId,
      publicationLookup.publicationId,
      mealCollectionId,
      {
        expectInCollection: false,
        expectedCreateAttemptId: createAttemptId,
      },
    );
    if (resumed.errors.length > 0 || !resumed.byObjective) {
      return failPartial(
        validation.values,
        productBelongsToCreateAttempt(
          { createAttemptMetafield: { value: resumed.createAttemptId } },
          createAttemptId,
        )
          ? trackingProductId
          : null,
        [
          "Impossible de reprendre la création précédente. Vérifiez le brouillon hors catalogue ou contactez le support.",
          ...resumed.errors,
        ],
        blockedFieldNotices,
      );
    }
    variants = variantsFromByObjective(resumed.byObjective);
  } else {
    // No owned product yet — refuse if a foreign catalog product already uses the title.
    const duplicate = titlesLookup.titles.find(
      (entry) => normalizeTitleKey(entry.title) === titleKey,
    );
    if (duplicate) {
      return emptyResult(validation.values, {
        errors: [
          `Un plat nommé « ${duplicate.title} » existe déjà dans le catalogue. Choisissez un nom unique (utilisé en cuisine et commandes).`,
        ],
        message: `Un plat nommé « ${duplicate.title} » existe déjà dans le catalogue.`,
        fieldErrors: [
          {
            field: "title",
            message: "Ce nom de plat existe déjà dans le catalogue.",
          },
        ],
        blockedFieldNotices,
      });
    }

    const created = await createMealProductDraft(admin, input);
    if (created.errors.length > 0 || !created.productId) {
      return failPartial(
        validation.values,
        null,
        created.errors.length > 0
          ? created.errors
          : ["Échec de la création Shopify du plat."],
        blockedFieldNotices,
      );
    }
    trackingProductId = created.productId;
    variants = created.variants ?? [];
  }

  const variantCheck = verifyCreatedMealVariants(variants);
  if (!variantCheck.ok) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Le plat créé n’a pas la structure attendue (3 variantes Objectif). Il reste en brouillon hors catalogue.",
        ...variantCheck.reasons,
      ],
      blockedFieldNotices,
    );
  }

  const nutritionRows: MealNutritionImportRow[] = validation.nutritionRows.map(
    (row) => {
      const objective = row.objective as SubscriptionObjective;
      return {
        ...row,
        variantId: variantCheck.byObjective[objective],
      };
    },
  );

  const nutritionWrite = await applyMealNutritionMetafields(
    admin,
    nutritionRows,
  );
  if (nutritionWrite.errors.length > 0) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Impossible d’enregistrer les valeurs nutritionnelles. Le plat reste en brouillon hors catalogue.",
        ...nutritionWrite.errors,
      ],
      blockedFieldNotices,
    );
  }

  const productMetafieldValues = buildMealProductMetafieldValues({
    ingredients: validation.values.ingredients,
    allergenes: validation.values.allergenes,
    badge1: validation.values.badge1,
    badge2: validation.values.badge2,
    badge3: validation.values.badge3,
  });
  const productMetafieldWrite = await applyMealProductMetafields(
    admin,
    trackingProductId,
    productMetafieldValues,
  );
  if (productMetafieldWrite.errors.length > 0) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Impossible d’enregistrer les informations produit (ingrédients, allergènes ou badges). Le plat reste hors catalogue.",
        ...productMetafieldWrite.errors,
      ],
      blockedFieldNotices,
    );
  }

  if (imageFile && imageFile.size > 0 && canUploadImage) {
    const imageAttach = await attachMealProductImage({
      admin,
      productId: trackingProductId,
      file: imageFile,
      altText: validation.values.title,
      fetchImpl,
    });
    if (!imageAttach.ok) {
      return failPartial(
        validation.values,
        trackingProductId,
        [
          "Impossible d’associer la photo au plat. Le plat reste hors catalogue.",
          ...imageAttach.errors,
        ],
        blockedFieldNotices,
      );
    }
  }

  const unpublish = await unpublishProductFromOnlineStore(
    admin,
    trackingProductId,
    publicationLookup.publicationId,
  );
  if (!unpublish.ok) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Impossible de confirmer la protection boutique en ligne. Le plat reste hors catalogue.",
        ...unpublish.errors,
      ],
      blockedFieldNotices,
    );
  }

  const preCollection = await verifyMealProductState(
    admin,
    trackingProductId,
    publicationLookup.publicationId,
    mealCollectionId,
    { expectInCollection: false },
  );
  if (preCollection.errors.length > 0 || preCollection.publishedOnOnlineStore) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Vérifications pré-catalogue échouées. Le plat reste hors collection.",
        ...preCollection.errors,
      ],
      blockedFieldNotices,
    );
  }

  const activation = await activateMealProduct(admin, trackingProductId);
  if (activation.errors.length > 0) {
    return failPartial(
      validation.values,
      trackingProductId,
      activation.errors,
      blockedFieldNotices,
    );
  }

  // Critical: re-verify Online Store protection AFTER ACTIVE, before collection.
  const unpublishAfterActive = await unpublishProductFromOnlineStore(
    admin,
    trackingProductId,
    publicationLookup.publicationId,
  );
  if (!unpublishAfterActive.ok) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Protection boutique en ligne perdue après activation. Le plat reste hors catalogue.",
        ...unpublishAfterActive.errors,
      ],
      blockedFieldNotices,
    );
  }

  const postActiveGuard = await verifyMealProductState(
    admin,
    trackingProductId,
    publicationLookup.publicationId,
    mealCollectionId,
    { expectInCollection: false, expectStatus: "ACTIVE" },
  );
  if (
    postActiveGuard.errors.length > 0 ||
    postActiveGuard.publishedOnOnlineStore === true
  ) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Le plat actif n’est pas confirmé hors boutique en ligne. Ajout catalogue annulé.",
        ...postActiveGuard.errors,
      ],
      blockedFieldNotices,
    );
  }

  const collectionAdd = await addMealToCollection(
    admin,
    mealCollectionId,
    trackingProductId,
  );
  if (collectionAdd.errors.length > 0) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Le plat est prêt mais n’a pas pu être ajouté au catalogue. Il reste hors collection — réessayez sans créer de doublon.",
        ...collectionAdd.errors,
      ],
      blockedFieldNotices,
    );
  }

  const postCollection = await verifyMealProductState(
    admin,
    trackingProductId,
    publicationLookup.publicationId,
    mealCollectionId,
    { expectInCollection: true, expectStatus: "ACTIVE" },
  );
  if (postCollection.errors.length > 0) {
    return failPartial(
      validation.values,
      trackingProductId,
      [
        "Ajout catalogue non confirmé. Aucun succès n’est annoncé.",
        ...postCollection.errors,
      ],
      blockedFieldNotices,
    );
  }

  invalidateBuilderMealsCatalogCache(shop, mealCollectionId);
  invalidatePublicMealsCatalogCache(shop, mealCollectionId);

  return emptyResult(createEmptyMealCreateFormValues(), {
    ok: true,
    errors: [],
    fieldErrors: [],
    message: `Le plat « ${validation.values.title} » a été créé et ajouté au catalogue.`,
    trackingProductId,
    productTitle: validation.values.title,
    blockedFieldNotices: [],
  });
};

/**
 * Orchestrates meal creation. Loads mealCollectionId from AppSettings.
 * Callers must pass granted scopes from authenticate.admin.
 */
export const createMealProduct = async ({
  admin,
  formData,
  grantedScopes,
  shop,
}: {
  admin: MealsAdmin;
  formData: FormData;
  grantedScopes: readonly string[];
  shop: string;
}): Promise<CreateMealResult> => {
  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  return createMealProductForCollection({
    admin,
    formData,
    grantedScopes,
    mealCollectionId: settings?.mealCollectionId?.trim() ?? "",
    shop,
  });
};

/** Re-export for tests that assert blocked product input detection. */
export { mealCreateHasBlockedProductInput };
