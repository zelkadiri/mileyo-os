export const PORTAL_CRISP_ENABLE_ENV = "ENABLE_PORTAL_CRISP";
export const PORTAL_CRISP_WEBSITE_ID_ENV = "CRISP_WEBSITE_ID";

export type PortalCrispConfig = {
  enabled: boolean;
  websiteId: string | null;
};

export const resolvePortalCrispConfig = ({
  crispWebsiteId = process.env[PORTAL_CRISP_WEBSITE_ID_ENV],
  enablePortalCrisp = process.env[PORTAL_CRISP_ENABLE_ENV],
}: {
  crispWebsiteId?: string | null;
  enablePortalCrisp?: string | null;
} = {}): PortalCrispConfig => {
  const websiteId = crispWebsiteId?.trim() || null;
  const enabled = enablePortalCrisp?.trim() === "true" && Boolean(websiteId);

  return {
    enabled,
    websiteId: enabled ? websiteId : null,
  };
};

/** Official Crisp widget bootstrap — no user/session data. */
export const renderPortalCrispScript = (websiteId: string): string => {
  const safeWebsiteId = JSON.stringify(websiteId);

  return `window.$crisp=[];
window.CRISP_WEBSITE_ID=${safeWebsiteId};
(function(){
  var d=document;
  var s=d.createElement("script");
  s.src="https://client.crisp.chat/l.js";
  s.async=1;
  d.getElementsByTagName("head")[0].appendChild(s);
})();`;
};
