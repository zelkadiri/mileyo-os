/**
 * Shared Crisp chatbox bootstrap for customer-facing App Proxy HTML pages
 * (portal + box builder). One website ID, one async loader, no PII.
 *
 * Env:
 * - CRISP_WEBSITE_ID — Crisp website UUID (DEV/PROD via env only)
 * - ENABLE_PORTAL_CRISP — "true" enables Crisp on all gated surfaces
 */

export const CRISP_ENABLE_ENV = "ENABLE_PORTAL_CRISP";
export const CRISP_WEBSITE_ID_ENV = "CRISP_WEBSITE_ID";

/** @deprecated Prefer CRISP_ENABLE_ENV — kept for portal call sites / tests. */
export const PORTAL_CRISP_ENABLE_ENV = CRISP_ENABLE_ENV;
/** @deprecated Prefer CRISP_WEBSITE_ID_ENV — kept for portal call sites / tests. */
export const PORTAL_CRISP_WEBSITE_ID_ENV = CRISP_WEBSITE_ID_ENV;

export type CrispConfig = {
  enabled: boolean;
  websiteId: string | null;
};

/** Alias for existing portal imports. */
export type PortalCrispConfig = CrispConfig;

export const resolveCrispConfig = ({
  crispWebsiteId = process.env[CRISP_WEBSITE_ID_ENV],
  enablePortalCrisp = process.env[CRISP_ENABLE_ENV],
}: {
  crispWebsiteId?: string | null;
  enablePortalCrisp?: string | null;
} = {}): CrispConfig => {
  const websiteId = crispWebsiteId?.trim() || null;
  const enabled = enablePortalCrisp?.trim() === "true" && Boolean(websiteId);

  return {
    enabled,
    websiteId: enabled ? websiteId : null,
  };
};

/** Alias for existing portal imports. */
export const resolvePortalCrispConfig = resolveCrispConfig;

/**
 * Official Crisp widget bootstrap — no user/session data.
 * Idempotent: skips if already initialized on the page.
 */
export const renderCrispScript = (websiteId: string): string => {
  const safeWebsiteId = JSON.stringify(websiteId);

  return `if(!window.__MILEYO_CRISP_LOADED__){
window.__MILEYO_CRISP_LOADED__=true;
window.$crisp=[];
window.CRISP_WEBSITE_ID=${safeWebsiteId};
(function(){
  var d=document;
  var s=d.createElement("script");
  s.src="https://client.crisp.chat/l.js";
  s.async=1;
  d.getElementsByTagName("head")[0].appendChild(s);
})();
}`;
};

/** Alias for existing portal imports. */
export const renderPortalCrispScript = renderCrispScript;

/** HTML snippet or empty string when Crisp is disabled. */
export const renderCrispScriptTag = (
  config: CrispConfig = resolveCrispConfig(),
): string =>
  config.enabled && config.websiteId
    ? `<script>${renderCrispScript(config.websiteId)}</script>`
    : "";
