import {
  ALLERGEN_FILTER_OPTIONS,
  ALLERGEN_FILTER_SYNONYMS,
} from "../../utils/mealAllergenFilters";
import {
  BADGE_FILTER_OPTIONS,
  BADGE_FILTER_SYNONYMS,
} from "../../utils/mealBadgeFilters";

/** Browser runtime for meal filters — generated from shared synonym maps. */
export const mealFilterRuntimeScript = `
  var ALLERGEN_FILTER_SYNONYMS = ${JSON.stringify(ALLERGEN_FILTER_SYNONYMS)};
  var BADGE_FILTER_SYNONYMS = ${JSON.stringify(BADGE_FILTER_SYNONYMS)};

  function normalizeAllergenText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[()_]/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
  }

  function normalizeBadgeText(value) {
    return normalizeAllergenText(value);
  }

  function allergenEntryMatchesFilter(entry, filterId) {
    if (!filterId) return false;
    var haystack = normalizeAllergenText(entry);
    if (!haystack) return false;
    var synonyms = ALLERGEN_FILTER_SYNONYMS[filterId];
    if (synonyms) {
      return synonyms.some(function (synonym) {
        var needle = normalizeAllergenText(synonym);
        if (!needle) return false;
        if (haystack.indexOf(needle) !== -1) return true;
        return haystack.split(/[\\s,;/]+/).some(function (token) {
          return token === needle || token.indexOf(needle) === 0;
        });
      });
    }
    var normalizedKey = haystack.replace(/\\s+/g, "_");
    return normalizedKey === filterId || haystack.indexOf(filterId.replace(/_/g, " ")) !== -1;
  }

  function mealExcludedByAllergens(meal) {
    if (!selectedAllergenFilters.length) return false;
    if (!meal.allergenes || !meal.allergenes.length) return false;
    return meal.allergenes.some(function (entry) {
      return selectedAllergenFilters.some(function (filterId) {
        return allergenEntryMatchesFilter(entry, filterId);
      });
    });
  }

  function badgeTextMatchesFilter(badgeText, filterId) {
    var haystack = normalizeBadgeText(badgeText);
    if (!haystack) return false;
    var synonyms = BADGE_FILTER_SYNONYMS[filterId];
    if (!synonyms) return false;
    return synonyms.some(function (synonym) {
      var needle = normalizeBadgeText(synonym);
      if (!needle) return false;
      if (haystack.indexOf(needle) !== -1) return true;
      return haystack.split(/[\\s,;/]+/).some(function (token) {
        return token === needle || token.indexOf(needle) === 0;
      });
    });
  }

  function mealMatchesBadgeFilters(meal) {
    if (!selectedBadgeFilters.length) return true;
    if (!meal.badges || !meal.badges.length) return false;
    return meal.badges.some(function (badge) {
      return selectedBadgeFilters.some(function (filterId) {
        return badgeTextMatchesFilter(badge, filterId);
      });
    });
  }

  function mealMatchesFilter(meal) {
    if (mealExcludedByAllergens(meal)) return false;
    if (!mealMatchesBadgeFilters(meal)) return false;
    return true;
  }

  function getBadgeColorSlug(badgeText) {
    var haystack = normalizeBadgeText(badgeText);
    if (!haystack) return "neutral";
    var slugs = Object.keys(BADGE_FILTER_SYNONYMS);
    for (var i = 0; i < slugs.length; i += 1) {
      var slug = slugs[i];
      var synonyms = BADGE_FILTER_SYNONYMS[slug];
      var matched = synonyms.some(function (synonym) {
        var needle = normalizeBadgeText(synonym);
        if (!needle) return false;
        if (haystack.indexOf(needle) !== -1) return true;
        return haystack.split(/[\\s,;/]+/).some(function (token) {
          return token === needle || token.indexOf(needle) === 0;
        });
      });
      if (matched) return slug;
    }
    return "neutral";
  }

  function formatAllergenDisplay(entry) {
    return String(entry || "")
      .replace(/_/g, " ")
      .replace(/\\bble\\b/g, "blé");
  }

  var ALLERGEN_FILTER_OPTIONS = ${JSON.stringify(ALLERGEN_FILTER_OPTIONS)};
  var BADGE_FILTER_OPTIONS = ${JSON.stringify(BADGE_FILTER_OPTIONS)};
`;
