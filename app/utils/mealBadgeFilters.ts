import { normalizeAllergenText } from "./mealAllergenFilters";

export const BADGE_FILTER_OPTIONS = [
  { id: "poulet", label: "Poulet" },
  { id: "boeuf", label: "Bœuf" },
  { id: "poisson", label: "Poisson" },
  { id: "vegetarien", label: "Végé" },
  { id: "epice", label: "Épicé" },
  { id: "doux", label: "Doux" },
  { id: "leger", label: "Léger" },
  { id: "gourmand", label: "Gourmand" },
  { id: "equilibre", label: "Équilibré" },
] as const;

/** Synonyms used to match Shopify badge labels and assign colors. */
export const BADGE_FILTER_SYNONYMS = {
  poulet: ["poulet"],
  boeuf: ["boeuf", "bœuf"],
  poisson: ["poisson", "saumon", "merlan", "omega-3", "oméga-3"],
  vegetarien: ["vege", "vegetarien", "végétarien", "végé"],
  epice: ["epice", "épicé", "epice fort", "épicé fort"],
  doux: ["doux", "epice doux", "épicé doux"],
  leger: ["leger", "léger", "frais"],
  gourmand: ["gourmand", "reconfortant", "réconfortant"],
  equilibre: ["equilibre", "équilibré", "proteine", "protéiné"],
  saumon: ["saumon"],
  merlan: ["merlan"],
  crevettes: ["crevette", "crevettes"],
} as const;

export type BadgeColorSlug = keyof typeof BADGE_FILTER_SYNONYMS | "neutral";

export const normalizeBadgeText = (value: string): string =>
  normalizeAllergenText(value);

export const badgeTextMatchesFilter = (
  badgeText: string,
  filterId: string,
): boolean => {
  const haystack = normalizeBadgeText(badgeText);
  if (!haystack) return false;

  const synonyms =
    BADGE_FILTER_SYNONYMS[filterId as keyof typeof BADGE_FILTER_SYNONYMS];
  if (!synonyms) return false;

  return synonyms.some((synonym) => {
    const needle = normalizeBadgeText(synonym);
    if (!needle) return false;
    if (haystack.includes(needle)) return true;
    return haystack
      .split(/[\s,;/]+/)
      .some((token) => token === needle || token.startsWith(needle));
  });
};

export const mealMatchesBadgeFilters = (
  badges: string[] | undefined,
  selectedFilters: string[],
): boolean => {
  if (!selectedFilters.length) return true;
  if (!badges?.length) return false;
  return badges.some((badge) =>
    selectedFilters.some((filterId) => badgeTextMatchesFilter(badge, filterId)),
  );
};

export const getBadgeColorSlug = (badgeText: string): BadgeColorSlug => {
  const haystack = normalizeBadgeText(badgeText);
  if (!haystack) return "neutral";

  const entries = Object.entries(BADGE_FILTER_SYNONYMS) as [
    BadgeColorSlug,
    readonly string[],
  ][];

  for (const [slug, synonyms] of entries) {
    if (
      synonyms.some((synonym) => {
        const needle = normalizeBadgeText(synonym);
        return (
          haystack.includes(needle) ||
          haystack
            .split(/[\s,;/]+/)
            .some((token) => token === needle || token.startsWith(needle))
        );
      })
    ) {
      return slug;
    }
  }

  return "neutral";
};
