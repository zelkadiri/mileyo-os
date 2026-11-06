/**
 * Native Shopify meal image upload (Admin GraphQL October 2025).
 *
 * Flow:
 * 1. Validate MIME + size locally
 * 2. stagedUploadsCreate (resource IMAGE) — requires write_files
 * 3. POST multipart to staged URL
 * 4. productUpdate(media: …) — ADDS media (does not replace files/variants)
 * 5. Poll / verify featuredImage or IMAGE media presence
 *
 * Intentionally avoids:
 * - productCreateMedia (deprecated in 2025-10)
 * - productSet.files (list replace — would wipe omitted media / risk variants if misused)
 *
 * Never uses Supabase Storage.
 */

export const MEAL_IMAGE_OPTIONAL_SCOPE = "write_files" as const;

export const MEAL_IMAGE_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** 8 MiB — coherent with typical Shopify product image uploads. */
export const MEAL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Async media processing poll (Shopify processes media asynchronously). */
export const MEAL_IMAGE_VERIFY_MAX_ATTEMPTS = 5;
export const MEAL_IMAGE_VERIFY_DELAY_MS = 250;

export const hasWriteFilesScope = (
  grantedScopes: readonly string[],
): boolean => grantedScopes.includes(MEAL_IMAGE_OPTIONAL_SCOPE);

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type MealImageValidationResult =
  | { ok: true; file: File; mimeType: string; filename: string }
  | { ok: false; errors: string[] };

export const validateMealImageFile = (
  file: File | null | undefined,
): MealImageValidationResult => {
  if (!file || file.size <= 0) {
    return { ok: false, errors: ["Aucune image sélectionnée."] };
  }

  const mimeType = (file.type || "").trim().toLowerCase();
  if (
    !(MEAL_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)
  ) {
    return {
      ok: false,
      errors: [
        "Format d’image non supporté. Utilisez JPEG, PNG, WebP ou GIF.",
      ],
    };
  }

  if (file.size > MEAL_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      errors: [
        `L’image dépasse la taille maximale autorisée (${Math.floor(
          MEAL_IMAGE_MAX_BYTES / (1024 * 1024),
        )} Mo).`,
      ],
    };
  }

  const rawName = (file.name || "meal-image").trim() || "meal-image";
  const safeName = rawName.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120);
  const hasExtension = /\.[a-z0-9]+$/i.test(safeName);
  const extension =
    mimeType === "image/png"
      ? ".png"
      : mimeType === "image/webp"
        ? ".webp"
        : mimeType === "image/gif"
          ? ".gif"
          : ".jpg";

  return {
    ok: true,
    file,
    mimeType,
    filename: hasExtension ? safeName : `${safeName}${extension}`,
  };
};

export const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation StageMealProductImage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * productUpdate + media ADDS images without replacing the product file list.
 * Only { id } is sent in ProductUpdateInput — variants/collections/metafields untouched.
 */
export const PRODUCT_UPDATE_MEDIA_MUTATION = `#graphql
  mutation AttachMealProductImage(
    $product: ProductUpdateInput!
    $media: [CreateMediaInput!]
  ) {
    productUpdate(product: $product, media: $media) {
      product {
        id
        featuredImage {
          altText
          url
        }
        media(first: 5) {
          nodes {
            alt
            mediaContentType
            status
            ... on MediaImage {
              id
              image {
                url
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MEAL_PRODUCT_IMAGE_VERIFY_QUERY = `#graphql
  query VerifyMealProductImage($id: ID!) {
    product(id: $id) {
      id
      featuredImage {
        altText
        url
      }
      media(first: 5) {
        nodes {
          alt
          mediaContentType
          status
          ... on MediaImage {
            id
            image {
              url
            }
          }
        }
      }
    }
  }
`;

type StagedUploadsResponse = {
  data?: {
    stagedUploadsCreate?: {
      stagedTargets?: Array<{
        url?: string | null;
        resourceUrl?: string | null;
        parameters?: Array<{ name: string; value: string }> | null;
      }> | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

type ProductUpdateMediaResponse = {
  data?: {
    productUpdate?: {
      product?: {
        id?: string | null;
        featuredImage?: { altText?: string | null; url?: string | null } | null;
        media?: {
          nodes?: Array<{
            alt?: string | null;
            mediaContentType?: string | null;
            status?: string | null;
            id?: string | null;
            image?: { url?: string | null } | null;
          }>;
        } | null;
      } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

type VerifyImageResponse = {
  data?: {
    product?: {
      id?: string | null;
      featuredImage?: { altText?: string | null; url?: string | null } | null;
      media?: {
        nodes?: Array<{
          alt?: string | null;
          mediaContentType?: string | null;
          status?: string | null;
          id?: string | null;
          image?: { url?: string | null } | null;
        }>;
      } | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

const graphqlMessages = (errors?: { message?: string | null }[]) =>
  (errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

export type AttachMealProductImageResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export const mealProductHasUsableImage = (product: {
  featuredImage?: { url?: string | null } | null;
  media?: {
    nodes?: Array<{
      mediaContentType?: string | null;
      status?: string | null;
      image?: { url?: string | null } | null;
    }> | null;
  } | null;
}): boolean => {
  const featuredUrl = product.featuredImage?.url?.trim() ?? "";
  if (featuredUrl) return true;

  return (product.media?.nodes ?? []).some((node) => {
    if (node.mediaContentType !== "IMAGE") return false;
    const url = node.image?.url?.trim() ?? "";
    const status = (node.status ?? "").toUpperCase();
    return (
      Boolean(url) ||
      status === "READY" ||
      status === "UPLOADED" ||
      status === "PROCESSING"
    );
  });
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Upload + attach meal image. Caller must gate on hasWriteFilesScope.
 * Inject fetchImpl / sleepImpl in tests to avoid real network / waits.
 */
export const attachMealProductImage = async ({
  admin,
  productId,
  file,
  altText,
  fetchImpl = fetch,
  sleepImpl = sleep,
  verifyAttempts = MEAL_IMAGE_VERIFY_MAX_ATTEMPTS,
  verifyDelayMs = MEAL_IMAGE_VERIFY_DELAY_MS,
}: {
  admin: ShopifyAdmin;
  productId: string;
  file: File;
  altText: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  verifyAttempts?: number;
  verifyDelayMs?: number;
}): Promise<AttachMealProductImageResult> => {
  const validation = validateMealImageFile(file);
  if (!validation.ok) {
    return validation;
  }

  const stagedResponse = await admin.graphql(STAGED_UPLOADS_CREATE_MUTATION, {
    variables: {
      input: [
        {
          filename: validation.filename,
          mimeType: validation.mimeType,
          httpMethod: "POST",
          resource: "IMAGE",
        },
      ],
    },
  });
  const stagedJson = (await stagedResponse.json()) as StagedUploadsResponse;
  const stagedTopErrors = graphqlMessages(stagedJson.errors);
  const stagedUserErrors = (
    stagedJson.data?.stagedUploadsCreate?.userErrors ?? []
  )
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

  if (stagedTopErrors.length > 0 || stagedUserErrors.length > 0) {
    return {
      ok: false,
      errors: [
        ...stagedTopErrors,
        ...stagedUserErrors,
        "Impossible de préparer l’envoi de l’image.",
      ],
    };
  }

  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  const uploadUrl = target?.url?.trim() ?? "";
  const resourceUrl = target?.resourceUrl?.trim() ?? "";
  const parameters = target?.parameters ?? [];

  if (!uploadUrl || !resourceUrl) {
    return {
      ok: false,
      errors: ["Shopify n’a pas renvoyé d’URL d’upload pour l’image."],
    };
  }

  const form = new FormData();
  for (const parameter of parameters) {
    form.append(parameter.name, parameter.value);
  }
  form.append("file", validation.file, validation.filename);

  let uploadResponse: Response;
  try {
    uploadResponse = await fetchImpl(uploadUrl, {
      method: "POST",
      body: form,
    });
  } catch {
    return {
      ok: false,
      errors: ["Échec réseau lors de l’envoi de l’image vers Shopify."],
    };
  }

  if (!uploadResponse.ok) {
    return {
      ok: false,
      errors: [
        `Échec de l’envoi de l’image (HTTP ${uploadResponse.status}).`,
      ],
    };
  }

  const alt = altText.trim() || validation.filename;
  const mediaResponse = await admin.graphql(PRODUCT_UPDATE_MEDIA_MUTATION, {
    variables: {
      // Only id — never pass variants / collections / files / metafields here.
      product: { id: productId },
      media: [
        {
          originalSource: resourceUrl,
          alt,
          mediaContentType: "IMAGE",
        },
      ],
    },
  });
  const mediaJson = (await mediaResponse.json()) as ProductUpdateMediaResponse;
  const mediaTopErrors = graphqlMessages(mediaJson.errors);
  const mediaUserErrors = (mediaJson.data?.productUpdate?.userErrors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

  if (mediaTopErrors.length > 0 || mediaUserErrors.length > 0) {
    return {
      ok: false,
      errors: [
        ...mediaTopErrors,
        ...mediaUserErrors,
        "Impossible d’associer l’image au plat.",
      ],
    };
  }

  const updatedProduct = mediaJson.data?.productUpdate?.product;
  if (!updatedProduct?.id) {
    return {
      ok: false,
      errors: ["Shopify n’a pas confirmé l’association de l’image."],
    };
  }

  if (mealProductHasUsableImage(updatedProduct)) {
    return { ok: true };
  }

  const verified = await verifyMealProductImage(admin, productId, {
    attempts: verifyAttempts,
    delayMs: verifyDelayMs,
    sleepImpl,
  });
  if (!verified.ok) {
    return verified;
  }

  return { ok: true };
};

export const verifyMealProductImage = async (
  admin: ShopifyAdmin,
  productId: string,
  options?: {
    attempts?: number;
    delayMs?: number;
    sleepImpl?: (ms: number) => Promise<void>;
  },
): Promise<AttachMealProductImageResult> => {
  const attempts = options?.attempts ?? MEAL_IMAGE_VERIFY_MAX_ATTEMPTS;
  const delayMs = options?.delayMs ?? MEAL_IMAGE_VERIFY_DELAY_MS;
  const sleepImpl = options?.sleepImpl ?? sleep;
  let lastErrors: string[] = [
    "L’image n’est pas visible sur le plat après association.",
  ];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await admin.graphql(MEAL_PRODUCT_IMAGE_VERIFY_QUERY, {
      variables: { id: productId },
    });
    const json = (await response.json()) as VerifyImageResponse;
    const topErrors = graphqlMessages(json.errors);
    if (topErrors.length > 0) {
      return { ok: false, errors: topErrors };
    }

    const product = json.data?.product;
    if (!product?.id) {
      return {
        ok: false,
        errors: ["Impossible de relire l’image du plat."],
      };
    }

    if (mealProductHasUsableImage(product)) {
      return { ok: true };
    }

    lastErrors = [
      "L’image n’est pas visible sur le plat après association.",
    ];
    if (attempt < attempts) {
      await sleepImpl(delayMs);
    }
  }

  return { ok: false, errors: lastErrors };
};
