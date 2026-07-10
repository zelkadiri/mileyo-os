export const CUSTOM_MEAL_METAFIELD_NAMESPACE = "custom";

export const parseCaloriesMetafield = (
  value: string | null | undefined,
): number | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const parseListMetafield = (
  value: string | null | undefined,
): string[] => {
  if (value == null) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry).trim())
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const normalizeAllergenKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");

export const parseAllergenesMetafield = (
  value: string | null | undefined,
): string[] => {
  const unique = new Set<string>();
  parseListMetafield(value).forEach((entry) => {
    const normalized = normalizeAllergenKey(entry);
    if (normalized) unique.add(normalized);
  });
  return [...unique];
};

export const parseMealBadges = (
  badge1?: string | null,
  badge2?: string | null,
  badge3?: string | null,
): string[] =>
  [badge1, badge2, badge3]
    .map((badge) => badge?.trim() ?? "")
    .filter(Boolean);
