/**
 * Client-safe optional scope helpers for meal photo upload consent.
 *
 * Prefer App Bridge `shopify.scopes.request` (modal) over React Router
 * server `scopes.request` (full-page redirect → "Handling response" blank page
 * inside the embedded admin iframe).
 */

import {
  OPTIONAL_SCOPE_DECLINED_MESSAGE,
  OPTIONAL_SCOPE_ERROR_MESSAGE,
  OPTIONAL_SCOPE_UNAVAILABLE_MESSAGE,
  OPTIONAL_SCOPE_UNCONFIRMED_MESSAGE,
  getShopifyAppBridgeScopesApi,
  hasGrantedOptionalScope,
  interpretOptionalScopeRequestResult,
  reloadEmbeddedAdminAfterScopeChange,
  requestOptionalScopeViaAppBridge,
  type OptionalScopeRequestOutcome,
  type OptionalScopesApi,
  type OptionalScopesDetail,
  type OptionalScopesRequestResponse,
} from "../../utils/shopify-optional-scope-consent";

export const MEAL_IMAGE_OPTIONAL_SCOPE = "write_files" as const;

export const MEAL_IMAGE_SCOPE_DECLINED_MESSAGE = OPTIONAL_SCOPE_DECLINED_MESSAGE;
export const MEAL_IMAGE_SCOPE_UNAVAILABLE_MESSAGE =
  OPTIONAL_SCOPE_UNAVAILABLE_MESSAGE;
export const MEAL_IMAGE_SCOPE_UNCONFIRMED_MESSAGE =
  OPTIONAL_SCOPE_UNCONFIRMED_MESSAGE;
export const MEAL_IMAGE_SCOPE_ERROR_MESSAGE = OPTIONAL_SCOPE_ERROR_MESSAGE;

export type MealImageScopesDetail = OptionalScopesDetail;
export type MealImageScopesRequestResponse = OptionalScopesRequestResponse;
export type MealImageScopesApi = OptionalScopesApi;

export type MealImageScopeRequestOutcome =
  | { kind: "granted"; granted: readonly string[] }
  | { kind: "already_granted"; granted: readonly string[] }
  | { kind: "declined" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

const toMealImageOutcome = (
  outcome: OptionalScopeRequestOutcome,
): MealImageScopeRequestOutcome => {
  if (outcome.kind === "granted") {
    return { kind: "granted", granted: outcome.granted };
  }
  if (outcome.kind === "already_granted") {
    return { kind: "already_granted", granted: outcome.granted };
  }
  if (outcome.kind === "declined") return { kind: "declined" };
  if (outcome.kind === "unavailable") return { kind: "unavailable" };
  return { kind: "error", message: outcome.message };
};

export const hasMealImageWriteFilesScope = (
  grantedScopes: readonly string[] | null | undefined,
): boolean =>
  hasGrantedOptionalScope(grantedScopes, MEAL_IMAGE_OPTIONAL_SCOPE);

export const interpretMealImageScopeRequestResult = (
  response: MealImageScopesRequestResponse | null | undefined,
): MealImageScopeRequestOutcome =>
  toMealImageOutcome(
    interpretOptionalScopeRequestResult(MEAL_IMAGE_OPTIONAL_SCOPE, response),
  );

/**
 * Request write_files via App Bridge Scopes API.
 * Never marks the scope as granted without detail.granted confirmation.
 */
export const requestMealImageWriteFilesScope = async (
  scopesApi: MealImageScopesApi | null | undefined,
): Promise<MealImageScopeRequestOutcome> =>
  toMealImageOutcome(
    await requestOptionalScopeViaAppBridge(
      scopesApi,
      MEAL_IMAGE_OPTIONAL_SCOPE,
    ),
  );

export { getShopifyAppBridgeScopesApi, reloadEmbeddedAdminAfterScopeChange };
