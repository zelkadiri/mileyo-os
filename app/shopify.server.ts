import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { instrumentSessionStorage } from "./utils/instrumentedSessionStorage.server";
import { resilientShopifySessionStorage } from "./utils/resilientShopifySessionStorage.server";

/**
 * Shopify PrismaSessionStorage permanently rejects `ready` after one failed
 * pollForTable() (often a transient pool/timeout), then every Admin/cron call
 * throws MissingSessionTableError even though `Session` exists. Heal via
 * isReady() before giving up — see resilientShopifySessionStorage.
 */
const prismaSessionStorage = new PrismaSessionStorage(prisma);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  // Wall-clock load/store timings when builder perf ALS is active (no secrets).
  sessionStorage: instrumentSessionStorage(
    resilientShopifySessionStorage(prismaSessionStorage),
  ),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
