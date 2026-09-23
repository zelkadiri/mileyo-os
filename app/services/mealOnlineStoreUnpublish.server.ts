/**
 * Unpublish Mileyo meal catalog products from the Online Store sales channel only.
 *
 * Meals are identified exclusively via AppSettings.mealCollectionId membership.
 * Never uses price == 0. Never changes product status, variants, price, metafields,
 * images, or collection membership. Never targets non–Online Store publications.
 *
 * Online Store publication is resolved structurally via AppCatalog app handle
 * `online_store` — never by localized publication/catalog title matching.
 */

export const UNPUBLISH_MEALS_ONLINE_STORE_INTENT =
  "unpublishMealsOnlineStore" as const;

export const REQUEST_MEAL_PUBLICATION_SCOPES_INTENT =
  "requestMealPublicationScopes" as const;

/** Form checkbox name — must equal "1" for the Settings ops action. */
export const CONFIRM_UNPUBLISH_MEALS_ONLINE_STORE_FIELD =
  "confirmUnpublishMealsOnlineStore" as const;

/**
 * Optional scope for meal Online Store unpublish.
 * Shopify write scopes include read — declare write only (see Shopify access-scopes docs).
 */
export const MEAL_PUBLICATION_OPTIONAL_SCOPE = "write_publications" as const;

/** Structural Shopify app handle for the Online Store sales channel. */
export const ONLINE_STORE_APP_HANDLE = "online_store" as const;

export const MEAL_ONLINE_STORE_UNPUBLISH_PAGE_SIZE = 50;
export const MEAL_ONLINE_STORE_UNPUBLISH_MAX_PAGES = 20;

export type MealOnlineStoreUnpublishAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ShopifyAppPublicationNode = {
  id?: string | null;
  catalog?: {
    id?: string | null;
    title?: string | null;
    apps?: {
      nodes?: Array<{
        id?: string | null;
        handle?: string | null;
        title?: string | null;
      } | null> | null;
    } | null;
  } | null;
};

export type MealPublicationProductNode = {
  id: string;
  title: string;
  handle?: string | null;
  status?: string | null;
  publishedOnOnlineStore?: boolean | null;
};

export type MealOnlineStoreUnpublishResult = {
  alreadyUnpublished: number;
  errors: string[];
  failed: number;
  message: string;
  ok: boolean;
  onlineStorePublicationId: string | null;
  totalMeals: number;
  unpublished: number;
};

type GraphqlErrorResponse = {
  data?: unknown;
  errors?: { message?: string | null }[];
};

const graphqlErrorMessages = (json: GraphqlErrorResponse): string[] =>
  (json.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

const isBlank = (value: string | null | undefined) =>
  value == null || value.trim() === "";

export const publicationHasOnlineStoreAppHandle = (
  publication: ShopifyAppPublicationNode,
): boolean => {
  const apps = publication.catalog?.apps?.nodes ?? [];
  return apps.some(
    (app) => (app?.handle ?? "").trim() === ONLINE_STORE_APP_HANDLE,
  );
};

/**
 * Resolve Online Store publication id from APP publications.
 * Match is structural: AppCatalog.apps[].handle === "online_store".
 * Fails closed on 0 or >1 matches. Never uses localized titles.
 */
export const resolveOnlineStorePublicationId = (
  publications: readonly ShopifyAppPublicationNode[],
):
  | { ok: true; publicationId: string }
  | { ok: false; reason: string } => {
  const matches = publications.filter(publicationHasOnlineStoreAppHandle);

  if (matches.length === 0) {
    return {
      ok: false,
      reason:
        "Publication Online Store introuvable (aucun AppCatalog avec handle app « online_store »).",
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason:
        "Plusieurs publications Online Store (handle online_store) détectées — opération annulée.",
    };
  }

  const publicationId = matches[0]?.id?.trim() ?? "";
  if (!publicationId) {
    return {
      ok: false,
      reason: "Publication Online Store sans identifiant Shopify.",
    };
  }

  return { ok: true, publicationId };
};

export const partitionMealsByOnlineStorePublication = (
  products: readonly MealPublicationProductNode[],
): {
  alreadyUnpublished: MealPublicationProductNode[];
  toUnpublish: MealPublicationProductNode[];
} => {
  const alreadyUnpublished: MealPublicationProductNode[] = [];
  const toUnpublish: MealPublicationProductNode[] = [];

  for (const product of products) {
    if (product.publishedOnOnlineStore === true) {
      toUnpublish.push(product);
    } else {
      alreadyUnpublished.push(product);
    }
  }

  return { alreadyUnpublished, toUnpublish };
};

export const formatMealOnlineStoreUnpublishMessage = (
  result: Omit<MealOnlineStoreUnpublishResult, "message">,
): string =>
  `Protection Online Store repas : ${result.totalMeals} analysés, ` +
  `${result.alreadyUnpublished} déjà protégés, ` +
  `${result.unpublished} dépubliés, ` +
  `${result.failed} erreur(s).`;

export const emptyMealOnlineStoreUnpublishResult = (
  overrides: Partial<MealOnlineStoreUnpublishResult> = {},
): MealOnlineStoreUnpublishResult => {
  const base = {
    alreadyUnpublished: 0,
    errors: [] as string[],
    failed: 0,
    ok: true,
    onlineStorePublicationId: null as string | null,
    totalMeals: 0,
    unpublished: 0,
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    message:
      overrides.message ?? formatMealOnlineStoreUnpublishMessage(merged),
  };
};

/** True when write_publications is granted (includes read per Shopify docs). */
export const hasWritePublicationsScope = (
  grantedScopes: readonly string[],
): boolean => grantedScopes.includes(MEAL_PUBLICATION_OPTIONAL_SCOPE);

export const PUBLICATIONS_FOR_ONLINE_STORE_QUERY = `#graphql
  query AppPublicationsForOnlineStore($first: Int!) {
    publications(first: $first, catalogType: APP) {
      nodes {
        id
        catalog {
          id
          title
          ... on AppCatalog {
            apps(first: 10) {
              nodes {
                id
                handle
                title
              }
            }
          }
        }
      }
    }
  }
`;

export const MEAL_COLLECTION_ONLINE_STORE_PUBLICATION_QUERY = `#graphql
  query MealCollectionOnlineStorePublication(
    $id: ID!
    $first: Int!
    $after: String
    $publicationId: ID!
  ) {
    collection(id: $id) {
      id
      products(first: $first, after: $after, sortKey: TITLE) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
          status
          publishedOnOnlineStore: publishedOnPublication(
            publicationId: $publicationId
          )
        }
      }
    }
  }
`;

export const MEAL_PUBLISHABLE_UNPUBLISH_MUTATION = `#graphql
  mutation UnpublishMealFromOnlineStore(
    $id: ID!
    $publicationId: ID!
    $input: [PublicationInput!]!
  ) {
    publishableUnpublish(id: $id, input: $input) {
      publishable {
        ... on Product {
          id
          publishedOnPublication(publicationId: $publicationId)
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type PublicationsResponse = {
  data?: {
    publications?: {
      nodes?: ShopifyAppPublicationNode[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

type CollectionProductsPageResponse = {
  data?: {
    collection?: {
      id?: string | null;
      products?: {
        pageInfo?: {
          hasNextPage?: boolean | null;
          endCursor?: string | null;
        } | null;
        nodes?: MealPublicationProductNode[];
      } | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

type UnpublishMutationResponse = {
  data?: {
    publishableUnpublish?: {
      publishable?: {
        id?: string | null;
        publishedOnPublication?: boolean | null;
      } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

export const fetchOnlineStorePublicationId = async (
  admin: MealOnlineStoreUnpublishAdmin,
): Promise<
  | { ok: true; publicationId: string }
  | { ok: false; errors: string[] }
> => {
  const response = await admin.graphql(PUBLICATIONS_FOR_ONLINE_STORE_QUERY, {
    variables: { first: 50 },
  });
  const json = (await response.json()) as PublicationsResponse;
  const topErrors = graphqlErrorMessages(json);
  if (topErrors.length > 0) {
    return { ok: false, errors: topErrors };
  }

  const resolved = resolveOnlineStorePublicationId(
    json.data?.publications?.nodes ?? [],
  );
  if (!resolved.ok) {
    return { ok: false, errors: [resolved.reason] };
  }

  return { ok: true, publicationId: resolved.publicationId };
};

export const fetchMealCollectionProductsForOnlineStore = async (
  admin: MealOnlineStoreUnpublishAdmin,
  mealCollectionId: string,
  publicationId: string,
): Promise<
  | { ok: true; products: MealPublicationProductNode[] }
  | { ok: false; errors: string[] }
> => {
  if (isBlank(mealCollectionId)) {
    return {
      ok: false,
      errors: ["Collection de plats manquante dans les réglages."],
    };
  }

  const products: MealPublicationProductNode[] = [];
  let after: string | null = null;
  let page = 0;

  while (page < MEAL_ONLINE_STORE_UNPUBLISH_MAX_PAGES) {
    page += 1;
    const response = await admin.graphql(
      MEAL_COLLECTION_ONLINE_STORE_PUBLICATION_QUERY,
      {
        variables: {
          id: mealCollectionId,
          first: MEAL_ONLINE_STORE_UNPUBLISH_PAGE_SIZE,
          after,
          publicationId,
        },
      },
    );
    const json = (await response.json()) as CollectionProductsPageResponse;
    const topErrors = graphqlErrorMessages(json);
    if (topErrors.length > 0) {
      return { ok: false, errors: topErrors };
    }

    if (!json.data?.collection?.id) {
      return {
        ok: false,
        errors: ["Collection de plats introuvable dans Shopify."],
      };
    }

    const connection = json.data.collection.products;
    for (const node of connection?.nodes ?? []) {
      if (node?.id) {
        products.push(node);
      }
    }

    if (!connection?.pageInfo?.hasNextPage) {
      return { ok: true, products };
    }

    const endCursor = connection.pageInfo.endCursor?.trim() ?? "";
    if (!endCursor) {
      return {
        ok: false,
        errors: [
          "Pagination collection repas incomplète (endCursor manquant).",
        ],
      };
    }
    after = endCursor;
  }

  return {
    ok: false,
    errors: [
      `La collection repas dépasse ${
        MEAL_ONLINE_STORE_UNPUBLISH_PAGE_SIZE *
        MEAL_ONLINE_STORE_UNPUBLISH_MAX_PAGES
      } produits. Opération annulée.`,
    ],
  };
};

/**
 * Unpublish one product and verify publishedOnPublication === false.
 * Empty userErrors alone is not enough.
 */
export const unpublishProductFromOnlineStore = async (
  admin: MealOnlineStoreUnpublishAdmin,
  productId: string,
  publicationId: string,
): Promise<{ ok: true } | { ok: false; errors: string[] }> => {
  const response = await admin.graphql(MEAL_PUBLISHABLE_UNPUBLISH_MUTATION, {
    variables: {
      id: productId,
      publicationId,
      input: [{ publicationId }],
    },
  });
  const json = (await response.json()) as UnpublishMutationResponse;
  const topErrors = graphqlErrorMessages(json);
  if (topErrors.length > 0) {
    return { ok: false, errors: topErrors };
  }

  const payload = json.data?.publishableUnpublish;
  const userErrors = (payload?.userErrors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

  if (userErrors.length > 0) {
    return { ok: false, errors: userErrors };
  }

  if (payload?.publishable?.publishedOnPublication !== false) {
    return {
      ok: false,
      errors: [
        "Vérification post-unpublish échouée : le produit n’est pas confirmé hors Online Store.",
      ],
    };
  }

  return { ok: true };
};

/**
 * Unpublish every product in mealCollectionId from Online Store only.
 * Idempotent: already-unpublished meals are counted, not mutated.
 */
export const unpublishMealsFromOnlineStore = async (
  admin: MealOnlineStoreUnpublishAdmin,
  mealCollectionId: string | null | undefined,
): Promise<MealOnlineStoreUnpublishResult> => {
  if (isBlank(mealCollectionId)) {
    return emptyMealOnlineStoreUnpublishResult({
      errors: ["Collection de plats manquante dans les réglages."],
      ok: false,
    });
  }

  const publicationLookup = await fetchOnlineStorePublicationId(admin);
  if (!publicationLookup.ok) {
    return emptyMealOnlineStoreUnpublishResult({
      errors: publicationLookup.errors,
      ok: false,
    });
  }

  const { publicationId } = publicationLookup;
  const productsLookup = await fetchMealCollectionProductsForOnlineStore(
    admin,
    mealCollectionId!,
    publicationId,
  );
  if (!productsLookup.ok) {
    return emptyMealOnlineStoreUnpublishResult({
      errors: productsLookup.errors,
      onlineStorePublicationId: publicationId,
      ok: false,
    });
  }

  const { alreadyUnpublished, toUnpublish } =
    partitionMealsByOnlineStorePublication(productsLookup.products);

  let unpublished = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const product of toUnpublish) {
    const result = await unpublishProductFromOnlineStore(
      admin,
      product.id,
      publicationId,
    );
    if (result.ok) {
      unpublished += 1;
      continue;
    }

    failed += 1;
    errors.push(
      `${product.title} (${product.id}): ${result.errors.join("; ")}`,
    );
  }

  const summary = {
    alreadyUnpublished: alreadyUnpublished.length,
    errors,
    failed,
    ok: failed === 0 && errors.length === 0,
    onlineStorePublicationId: publicationId,
    totalMeals: productsLookup.products.length,
    unpublished,
  };

  return {
    ...summary,
    message: formatMealOnlineStoreUnpublishMessage(summary),
  };
};

/**
 * Merge after a successful Online Store protection step + catalog setup.
 * Callers must run unpublish BEFORE catalog when protection is required.
 */
export const mergeMealCatalogSetupWithOnlineStoreProtection = ({
  catalogMessage,
  catalogOk,
  catalogErrors,
  unpublish,
}: {
  catalogMessage: string;
  catalogOk: boolean;
  catalogErrors: string[];
  unpublish: MealOnlineStoreUnpublishResult;
}): {
  errors: string[];
  message: string;
  ok: boolean;
  mealOnlineStoreUnpublish: {
    alreadyUnpublished: number;
    failed: number;
    totalMeals: number;
    unpublished: number;
  };
} => {
  const errors = [...unpublish.errors, ...catalogErrors];
  const ok = unpublish.ok && catalogOk;
  const message = `${unpublish.message} ${catalogMessage}`.trim();

  return {
    errors,
    message,
    ok,
    mealOnlineStoreUnpublish: {
      alreadyUnpublished: unpublish.alreadyUnpublished,
      failed: unpublish.failed,
      totalMeals: unpublish.totalMeals,
      unpublished: unpublish.unpublished,
    },
  };
};

export const PUBLICATION_SCOPES_MISSING_MESSAGE =
  "Scope optionnel write_publications non accordé. Autorisez l’accès publications depuis Réglages avant de protéger les repas." as const;
