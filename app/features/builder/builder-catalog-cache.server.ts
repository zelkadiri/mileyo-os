/**
 * Process-local short TTL cache for GET /apps/box-builder Shopify Admin catalog.
 *
 * Scope (intentional):
 * - Used by fetchCachedBuilder* (Builder loader) and public-meals App Proxy
 * - Shared only within the same Node isolate / Vercel function instance
 * - Lost on cold start; not shared across all serverless instances
 * - Opportunistic optimization — no distributed coherence required
 *
 * Never stores sessions, tokens, admin clients, customer data, or AppSettings.
 * Only serializable catalog DTOs (plain objects / arrays).
 *
 * cacheHit semantics:
 * - true  → served from a warm VALUE entry (instant)
 * - false → miss or joined an in-flight fetch (waited for GraphQL / peer)
 */

/** Default TTL for builder boxes/meals + public meals catalog entries. */
export const BUILDER_CATALOG_CACHE_TTL_MS = 30_000;

/** Alias — public meals share the same short TTL as the Builder catalog. */
export const PUBLIC_MEALS_CACHE_TTL_MS = BUILDER_CATALOG_CACHE_TTL_MS;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type CacheBucket = {
  entries: Map<string, CacheEntry<unknown>>;
  inFlight: Map<string, Promise<unknown>>;
};

const buckets: {
  boxes: CacheBucket;
  meals: CacheBucket;
  publicMeals: CacheBucket;
} = {
  boxes: { entries: new Map(), inFlight: new Map() },
  meals: { entries: new Map(), inFlight: new Map() },
  publicMeals: { entries: new Map(), inFlight: new Map() },
};

export type BuilderCatalogCacheKind = keyof typeof buckets;

const nowMs = () => Date.now();

const requireNonEmpty = (label: string, value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Builder catalog cache requires a non-empty ${label}.`);
  }
  return trimmed;
};

/** Drop expired entries from a bucket (bounds growth across shops/collections). */
const purgeExpired = (bucket: CacheBucket, now: number): void => {
  for (const [key, entry] of bucket.entries) {
    if (entry.expiresAt <= now) {
      bucket.entries.delete(key);
    }
  }
};

/**
 * Stable keys via JSON array — avoids delimiter collisions between shop and
 * mealCollectionId (GIDs contain `:`).
 */
export const builderBoxesCacheKey = (shop: string): string =>
  JSON.stringify(["boxes", requireNonEmpty("shop", shop)]);

export const builderMealsCacheKey = (
  shop: string,
  mealCollectionId: string,
): string =>
  JSON.stringify([
    "meals",
    requireNonEmpty("shop", shop),
    requireNonEmpty("mealCollectionId", mealCollectionId),
  ]);

/** Public storefront meals DTO — keyed by shop + mealCollectionId (never mix shops). */
export const publicMealsCacheKey = (
  shop: string,
  mealCollectionId: string,
): string =>
  JSON.stringify([
    "publicMeals",
    requireNonEmpty("shop", shop),
    requireNonEmpty("mealCollectionId", mealCollectionId),
  ]);

export type BuilderCatalogCacheGetResult<T> = {
  /** True only for a warm value-cache hit — not for in-flight joins. */
  cacheHit: boolean;
  value: T;
};

/**
 * Get-or-fetch with TTL + single-flight per key.
 * Only successful, structuredClone-compatible values are stored.
 * Rejected fetches leave no entry. Expired entries are never served
 * (no stale-while-revalidate).
 */
export const getOrFetchBuilderCatalog = async <T>({
  fetch,
  key,
  kind,
  ttlMs = BUILDER_CATALOG_CACHE_TTL_MS,
}: {
  fetch: () => Promise<T>;
  key: string;
  kind: BuilderCatalogCacheKind;
  ttlMs?: number;
}): Promise<BuilderCatalogCacheGetResult<T>> => {
  const bucket = buckets[kind];
  const now = nowMs();
  purgeExpired(bucket, now);

  const cached = bucket.entries.get(key) as CacheEntry<T> | undefined;
  // Valid only while now < expiresAt (strict). At equality → miss + refetch.
  if (cached && cached.expiresAt > now) {
    return {
      cacheHit: true,
      value: structuredClone(cached.value),
    };
  }

  const existing = bucket.inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    // Join in-flight — not a value-cache hit (wall-clock waits for peer fetch).
    const value = await existing;
    return { cacheHit: false, value: structuredClone(value) };
  }

  const pending = (async () => {
    const value = await fetch();
    // Clone before store: proves serializability; failed clone → no cache entry.
    const stored = structuredClone(value);
    bucket.entries.set(key, {
      expiresAt: nowMs() + ttlMs,
      value: stored,
    });
    return stored;
  })();

  bucket.inFlight.set(key, pending);

  try {
    const value = await pending;
    return { cacheHit: false, value: structuredClone(value) };
  } finally {
    // Only clear if we are still the registered in-flight promise for this key.
    if (bucket.inFlight.get(key) === pending) {
      bucket.inFlight.delete(key);
    }
  }
};

/** @internal Mileyo business regression tests only. */
export const __resetBuilderCatalogCacheForTests = (): void => {
  for (const bucket of Object.values(buckets)) {
    bucket.entries.clear();
    bucket.inFlight.clear();
  }
};

/** @internal Mileyo business regression tests only. */
export const __getBuilderCatalogCacheSizeForTests = (
  kind: BuilderCatalogCacheKind,
): { entries: number; inFlight: number } => ({
  entries: buckets[kind].entries.size,
  inFlight: buckets[kind].inFlight.size,
});

/** @internal Mileyo business regression tests only — force-expire a key. */
export const __expireBuilderCatalogCacheEntryForTests = (
  kind: BuilderCatalogCacheKind,
  key: string,
): void => {
  const entry = buckets[kind].entries.get(key);
  if (entry) {
    entry.expiresAt = 0;
  }
};
