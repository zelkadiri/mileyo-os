/**
 * Portal Crisp surface — re-exports the shared App Proxy Crisp bootstrap.
 * Prefer importing from `app/utils/crisp` for new call sites.
 */
export {
  CRISP_ENABLE_ENV as PORTAL_CRISP_ENABLE_ENV,
  CRISP_WEBSITE_ID_ENV as PORTAL_CRISP_WEBSITE_ID_ENV,
  renderCrispScript as renderPortalCrispScript,
  resolveCrispConfig as resolvePortalCrispConfig,
  type CrispConfig as PortalCrispConfig,
} from "../../utils/crisp";
