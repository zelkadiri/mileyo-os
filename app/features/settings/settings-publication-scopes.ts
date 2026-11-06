/**
 * Client-safe optional scope helpers for Online Store publication consent.
 *
 * Same App Bridge pattern as meal photo write_files — never use server
 * scopes.request in the embedded admin iframe.
 */

import {
  OPTIONAL_SCOPE_DECLINED_MESSAGE,
  OPTIONAL_SCOPE_UNAVAILABLE_MESSAGE,
  getShopifyAppBridgeScopesApi,
  hasGrantedOptionalScope,
  reloadEmbeddedAdminAfterScopeChange,
  requestOptionalScopeViaAppBridge,
  type OptionalScopeRequestOutcome,
  type OptionalScopesApi,
} from "../../utils/shopify-optional-scope-consent";

/** Keep in sync with mealOnlineStoreUnpublish.server MEAL_PUBLICATION_OPTIONAL_SCOPE. */
export const SETTINGS_PUBLICATION_OPTIONAL_SCOPE =
  "write_publications" as const;

export const SETTINGS_PUBLICATION_SCOPE_DECLINED_MESSAGE =
  OPTIONAL_SCOPE_DECLINED_MESSAGE;
export const SETTINGS_PUBLICATION_SCOPE_UNAVAILABLE_MESSAGE =
  OPTIONAL_SCOPE_UNAVAILABLE_MESSAGE;

export type SettingsPublicationScopeRequestOutcome =
  | { kind: "granted"; granted: readonly string[] }
  | { kind: "already_granted"; granted: readonly string[] }
  | { kind: "declined" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

const toSettingsOutcome = (
  outcome: OptionalScopeRequestOutcome,
): SettingsPublicationScopeRequestOutcome => {
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

export const hasSettingsPublicationScope = (
  grantedScopes: readonly string[] | null | undefined,
): boolean =>
  hasGrantedOptionalScope(grantedScopes, SETTINGS_PUBLICATION_OPTIONAL_SCOPE);

export const requestSettingsPublicationScope = async (
  scopesApi: OptionalScopesApi | null | undefined,
): Promise<SettingsPublicationScopeRequestOutcome> =>
  toSettingsOutcome(
    await requestOptionalScopeViaAppBridge(
      scopesApi,
      SETTINGS_PUBLICATION_OPTIONAL_SCOPE,
    ),
  );

export { getShopifyAppBridgeScopesApi, reloadEmbeddedAdminAfterScopeChange };
