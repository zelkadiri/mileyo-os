/**
 * Client-safe App Bridge helpers for optional Shopify access scopes.
 *
 * Prefer `shopify.scopes.request` (modal) over server `scopes.request`
 * (full-page redirect → "Handling response" / iframe auth failures).
 *
 * After a grant, use a document reload — not React Router soft revalidate —
 * so authenticate.admin can bounce / exchange a fresh session token.
 * Soft revalidate against a stale ID token surfaces as HTTP 401 Unauthorized.
 */

export type OptionalScopesDetail = {
  granted: readonly string[];
  required?: readonly string[];
  optional?: readonly string[];
};

export type OptionalScopesRequestResponse = {
  result: "granted-all" | "declined-all" | string;
  detail: OptionalScopesDetail;
};

export type OptionalScopesApi = {
  query: () => Promise<OptionalScopesDetail>;
  request: (
    scopes: readonly string[],
  ) => Promise<OptionalScopesRequestResponse>;
};

export type OptionalScopeRequestOutcome =
  | { kind: "granted"; granted: readonly string[]; scope: string }
  | { kind: "already_granted"; granted: readonly string[]; scope: string }
  | { kind: "declined"; scope: string }
  | { kind: "unavailable"; scope: string }
  | { kind: "error"; scope: string; message: string };

export const OPTIONAL_SCOPE_DECLINED_MESSAGE =
  "Autorisation refusée. Vous pouvez réessayer plus tard." as const;

export const OPTIONAL_SCOPE_UNAVAILABLE_MESSAGE =
  "Impossible d’ouvrir l’autorisation Shopify. Rechargez l’application dans l’admin Shopify, puis réessayez." as const;

export const OPTIONAL_SCOPE_UNCONFIRMED_MESSAGE =
  "L’autorisation n’a pas été confirmée. Réessayez ou rechargez la page." as const;

export const OPTIONAL_SCOPE_ERROR_MESSAGE =
  "Une erreur est survenue pendant la demande d’autorisation. Réessayez." as const;

export const hasGrantedOptionalScope = (
  grantedScopes: readonly string[] | null | undefined,
  scope: string,
): boolean => (grantedScopes ?? []).includes(scope);

export const interpretOptionalScopeRequestResult = (
  scope: string,
  response: OptionalScopesRequestResponse | null | undefined,
): OptionalScopeRequestOutcome => {
  if (!response || typeof response.result !== "string") {
    return {
      kind: "error",
      scope,
      message: OPTIONAL_SCOPE_UNCONFIRMED_MESSAGE,
    };
  }

  if (response.result === "declined-all") {
    return { kind: "declined", scope };
  }

  if (response.result === "granted-all") {
    const granted = response.detail?.granted ?? [];
    if (!hasGrantedOptionalScope(granted, scope)) {
      return {
        kind: "error",
        scope,
        message: OPTIONAL_SCOPE_UNCONFIRMED_MESSAGE,
      };
    }
    return { kind: "granted", granted, scope };
  }

  return {
    kind: "error",
    scope,
    message: OPTIONAL_SCOPE_UNCONFIRMED_MESSAGE,
  };
};

export const requestOptionalScopeViaAppBridge = async (
  scopesApi: OptionalScopesApi | null | undefined,
  scope: string,
): Promise<OptionalScopeRequestOutcome> => {
  if (!scopesApi?.query || !scopesApi?.request) {
    return { kind: "unavailable", scope };
  }

  try {
    const current = await scopesApi.query();
    if (hasGrantedOptionalScope(current.granted, scope)) {
      return {
        kind: "already_granted",
        granted: current.granted,
        scope,
      };
    }

    const response = await scopesApi.request([scope]);
    return interpretOptionalScopeRequestResult(scope, response);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : OPTIONAL_SCOPE_ERROR_MESSAGE;
    return { kind: "error", scope, message };
  }
};

/** Resolve App Bridge global scopes API when running inside Shopify Admin. */
export const getShopifyAppBridgeScopesApi = (): OptionalScopesApi | null => {
  if (typeof window === "undefined") return null;
  const shopify = (
    window as unknown as {
      shopify?: { scopes?: OptionalScopesApi };
    }
  ).shopify;
  return shopify?.scopes ?? null;
};

/**
 * Full document reload after optional-scope consent.
 * Soft React Router revalidate can hit authenticate.admin with a stale ID
 * token and surface HTTP 401 Unauthorized in the embedded admin.
 */
export const reloadEmbeddedAdminAfterScopeChange = (): void => {
  if (typeof window === "undefined") return;
  window.location.reload();
};
