/**
 * Synonym matching for builder allergen filter chips.
 * Shopify metafields use free-form labels (e.g. `gluten (blé)`, `lait`).
 * Filters match normalized text, not exact keys only.
 */
export const ALLERGEN_FILTER_SYNONYMS = {
  gluten: ["gluten", "ble", "blé", "seigle", "orge"],
  lactose: [
    "lactose",
    "lait",
    "produit laitier",
    "produits laitiers",
    "lactoserum",
  ],
  oeuf: ["oeuf", "oeufs", "œuf", "œufs"],
  poisson: ["poisson", "poissons", "saumon", "merlan"],
  crustaces: [
    "crustace",
    "crustaces",
    "crustacé",
    "crustacés",
    "crevette",
    "crevettes",
    "homard",
    "crabe",
  ],
  fruits_a_coque: [
    "fruit a coque",
    "fruits a coque",
    "fruits à coque",
    "noix",
    "amande",
    "amandes",
    "noisette",
    "pistache",
  ],
} as const;

export type AllergenFilterId = keyof typeof ALLERGEN_FILTER_SYNONYMS;

export const ALLERGEN_FILTER_OPTIONS = [
  { id: "gluten", label: "Gluten" },
  { id: "lactose", label: "Lactose" },
  { id: "oeuf", label: "Œuf" },
  { id: "poisson", label: "Poisson" },
  { id: "crustaces", label: "Crustacés" },
  { id: "fruits_a_coque", label: "Fruits à coque" },
] as const;

export const normalizeAllergenText = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const allergenEntryMatchesFilter = (
  entry: string,
  filterId: string,
): boolean => {
  if (!filterId || filterId === "all") return true;

  const haystack = normalizeAllergenText(entry);
  if (!haystack) return false;

  const synonyms =
    ALLERGEN_FILTER_SYNONYMS[
      filterId as keyof typeof ALLERGEN_FILTER_SYNONYMS
    ];

  if (synonyms) {
    return synonyms.some((synonym) => {
      const needle = normalizeAllergenText(synonym);
      if (!needle) return false;
      if (haystack.includes(needle)) return true;
      return haystack
        .split(/[\s,;/]+/)
        .some((token) => token === needle || token.startsWith(needle));
    });
  }

  const normalizedKey = haystack.replace(/\s+/g, "_");
  return (
    normalizedKey === filterId ||
    haystack.includes(filterId.replace(/_/g, " "))
  );
};

export const mealExcludedByAllergenFilters = (
  allergenes: string[] | undefined,
  selectedFilters: string[],
): boolean => {
  if (!selectedFilters.length) return false;
  if (!allergenes?.length) return false;
  return allergenes.some((entry) =>
    selectedFilters.some((filterId) =>
      allergenEntryMatchesFilter(entry, filterId),
    ),
  );
};

export const mealMatchesAllergenFilter = (
  allergenes: string[] | undefined,
  filterId: string,
): boolean => {
  if (filterId === "all") return true;
  if (!allergenes?.length) return true;
  return !allergenes.some((entry) =>
    allergenEntryMatchesFilter(entry, filterId),
  );
};
