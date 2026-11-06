/**
 * Client-safe optional scope helpers for meal photo upload consent.
 *
 * Prefer App Bridge `shopify.scopes.request` (modal) over React Router
 * server `scopes.request` (full-page redirect → "Handling response" blank page
 * inside the embedded admin iframe).
 */

export const MEAL_IMAGE_OPTIONAL_SCOPE = "write_files" as const;

export const MEAL_IMAGE_SCOPE_DECLINED_MESSAGE =
  "Autorisation photo refusée. Vous pouvez réessayer plus tard ; sans cette autorisation, le champ photo reste indisponible." as const;

export const MEAL_IMAGE_SCOPE_UNAVAILABLE_MESSAGE =
  "Impossible d’ouvrir l’autorisation Shopify. Rechargez l’application dans l’admin Shopify, puis réessayez." as const;

export const MEAL_IMAGE_SCOPE_UNCONFIRMED_MESSAGE =
  "L’autorisation photo n’a pas été confirmée. Réessayez ou rechargez la page." as const;

export const MEAL_IMAGE_SCOPE_ERROR_MESSAGE =
  "Une erreur est survenue pendant la demande d’autorisation photo. Réessayez." as const;

export type MealImageScopesDetail = {
  granted: readonly string[];
  required?: readonly string[];
  optional?: readonly string[];
};

export type MealImageScopesRequestResponse = {
  result: "granted-all" | "declined-all" | string;
  detail: MealImageScopesDetail;
};

export type MealImageScopesApi = {
  query: () => Promise<MealImageScopesDetail>;
  request: (
    scopes: readonly string[],
  ) => Promise<MealImageScopesRequestResponse>;
};

export type MealImageScopeRequestOutcome =
  | { kind: "granted"; granted: readonly string[] }
  | { kind: "already_granted"; granted: readonly string[] }
  | { kind: "declined" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

export const hasMealImageWriteFilesScope = (
  grantedScopes: readonly string[] | null | undefined,
): boolean =>
  (grantedScopes ?? []).includes(MEAL_IMAGE_OPTIONAL_SCOPE);

export const interpretMealImageScopeRequestResult = (
  response: MealImageScopesRequestResponse | null | undefined,
): MealImageScopeRequestOutcome => {
  if (!response || typeof response.result !== "string") {
    return { kind: "error", message: MEAL_IMAGE_SCOPE_UNCONFIRMED_MESSAGE };
  }

  if (response.result === "declined-all") {
    return { kind: "declined" };
  }

  if (response.result === "granted-all") {
    const granted = response.detail?.granted ?? [];
    if (!hasMealImageWriteFilesScope(granted)) {
      return { kind: "error", message: MEAL_IMAGE_SCOPE_UNCONFIRMED_MESSAGE };
    }
    return { kind: "granted", granted };
  }

  return { kind: "error", message: MEAL_IMAGE_SCOPE_UNCONFIRMED_MESSAGE };
};

/**
 * Request write_files via App Bridge Scopes API.
 * Never marks the scope as granted without detail.granted confirmation.
 */
export const requestMealImageWriteFilesScope = async (
  scopesApi: MealImageScopesApi | null | undefined,
): Promise<MealImageScopeRequestOutcome> => {
  if (!scopesApi?.query || !scopesApi?.request) {
    return { kind: "unavailable" };
  }

  try {
    const current = await scopesApi.query();
    if (hasMealImageWriteFilesScope(current.granted)) {
      return { kind: "already_granted", granted: current.granted };
    }

    const response = await scopesApi.request([MEAL_IMAGE_OPTIONAL_SCOPE]);
    return interpretMealImageScopeRequestResult(response);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : MEAL_IMAGE_SCOPE_ERROR_MESSAGE;
    return { kind: "error", message };
  }
};

/** Resolve App Bridge global scopes API when running inside Shopify Admin. */
export const getShopifyAppBridgeScopesApi = (): MealImageScopesApi | null => {
  if (typeof window === "undefined") return null;
  const shopify = (
    window as unknown as {
      shopify?: { scopes?: MealImageScopesApi };
    }
  ).shopify;
  return shopify?.scopes ?? null;
};
