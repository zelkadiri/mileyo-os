/**
 * Meal nutrition CSV parse + import preview (pure, no Shopify I/O).
 *
 * Dual schema: legacy 9 columns + new 13 columns.
 * Preview-only: no Shopify writes.
 */

import {
  MEAL_NUTRITION_EXPORT_HEADERS,
  MEAL_NUTRITION_LEGACY_EXPORT_HEADERS,
} from "./mealNutritionExport";
import {
  validateMealNutritionImportRows,
  type MealNutritionImportIssue,
  type MealNutritionImportRow,
} from "./mealNutritionImport";

export const MEAL_NUTRITION_CSV_MAX_BYTES = 2 * 1024 * 1024;

export type MealNutritionCsvSchema = "legacy" | "new";

export type MealNutritionMacroSnapshot = {
  calories: number | null;
  proteins: number | null;
  carbs: number | null;
  fat: number | null;
  saturatedFat: number | null;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  portionGrams: number | null;
};

export type MealNutritionImportDiff = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  objective: string;
  before: MealNutritionMacroSnapshot;
  after: MealNutritionMacroSnapshot;
};

export type MealNutritionImportValidEntry = {
  rowIndex: number;
  row: MealNutritionImportRow;
};

/** Minimal catalog variant shape for business preview (no Shopify I/O here). */
export type MealNutritionCatalogVariantRef = {
  variantId: string;
  variantTitle: string;
  productTitle: string;
  objective: string | null;
  calories: number | null;
  proteins: number | null;
  carbs: number | null;
  fat: number | null;
  saturatedFat?: number | null;
  sugars?: number | null;
  fiber?: number | null;
  salt?: number | null;
  portionGrams: number | null;
};

export type MealNutritionImportPreview = {
  csvSchema?: MealNutritionCsvSchema;
  diffs: MealNutritionImportDiff[];
  issues: MealNutritionImportIssue[];
  ok: boolean;
  /**
   * Data rows considered (identity+empty macros ignored + rows sent to validation).
   * Totally blank CSV lines are excluded (see skippedEmptyRowCount).
   */
  rowCount: number;
  /** Rows with variantId but all nutrition cells empty — skipped, not errors. */
  ignoredRowCount: number;
  skippedEmptyRowCount: number;
  validEntries: MealNutritionImportValidEntry[];
  validRowCount: number;
  validRows: MealNutritionImportRow[];
};

const LEGACY_SEPARATOR_COUNT = MEAL_NUTRITION_LEGACY_EXPORT_HEADERS.length - 1;
const NEW_SEPARATOR_COUNT = MEAL_NUTRITION_EXPORT_HEADERS.length - 1;

const emptyPreview = (
  partial: Partial<MealNutritionImportPreview> & {
    issues: MealNutritionImportIssue[];
  },
): MealNutritionImportPreview => ({
  diffs: [],
  ok: false,
  rowCount: 0,
  ignoredRowCount: 0,
  skippedEmptyRowCount: 0,
  validEntries: [],
  validRowCount: 0,
  validRows: [],
  ...partial,
});

const stripBom = (text: string) =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

const countUnquotedDelimiters = (
  line: string,
  delimiter: "," | ";",
): number => {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? "";
    const next = line[i + 1] ?? "";

    if (inQuotes) {
      if (char === '"' && next === '"') {
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      count += 1;
    }
  }

  return count;
};

const extractFirstLogicalLine = (text: string): string => {
  let inQuotes = false;
  let line = "";

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    const next = text[i + 1] ?? "";

    if (inQuotes) {
      line += char;
      if (char === '"' && next === '"') {
        line += next;
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      line += char;
      continue;
    }
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      break;
    }
    line += char;
  }

  return line;
};

const headersMatchSchema = (
  headerRow: readonly string[],
  schema: MealNutritionCsvSchema,
): boolean => {
  const expected =
    schema === "legacy"
      ? MEAL_NUTRITION_LEGACY_EXPORT_HEADERS
      : MEAL_NUTRITION_EXPORT_HEADERS;

  if (headerRow.length !== expected.length) {
    return false;
  }

  return expected.every(
    (expectedHeader, index) => headerRow[index]?.trim() === expectedHeader,
  );
};

export const detectMealNutritionCsvSchema = (
  headerRow: readonly string[],
): MealNutritionCsvSchema | null => {
  if (headersMatchSchema(headerRow, "new")) {
    return "new";
  }
  if (headersMatchSchema(headerRow, "legacy")) {
    return "legacy";
  }
  return null;
};

/**
 * Detect Excel FR (;) vs Mileyo export (,) from the header line.
 * Prefers the delimiter that yields a recognized schema column count.
 */
export const detectMealNutritionCsvDelimiter = (
  raw: string,
): "," | ";" => {
  const firstLine = extractFirstLogicalLine(stripBom(raw));
  const commaCount = countUnquotedDelimiters(firstLine, ",");
  const semicolonCount = countUnquotedDelimiters(firstLine, ";");

  if (semicolonCount === NEW_SEPARATOR_COUNT) {
    return ";";
  }
  if (commaCount === NEW_SEPARATOR_COUNT) {
    return ",";
  }
  if (semicolonCount === LEGACY_SEPARATOR_COUNT) {
    return ";";
  }
  if (commaCount === LEGACY_SEPARATOR_COUNT) {
    return ",";
  }
  if (semicolonCount > commaCount) {
    return ";";
  }

  return ",";
};

/** RFC-style CSV parse with auto-detected "," or ";" delimiter. */
export const parseMealNutritionCsv = (raw: string): string[][] => {
  const text = stripBom(raw);
  const delimiter = detectMealNutritionCsvDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    const next = text[i + 1] ?? "";

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        continue;
      }
      field += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (inQuotes) {
    throw new Error("CSV mal formé : guillemet non fermé.");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const isTotallyEmptyRow = (cells: readonly string[]) =>
  cells.every((cell) => cell.trim() === "");

const LEGACY_NUTRITION_CELL_INDEXES = [4, 5, 6, 7, 8] as const;
const NEW_NUTRITION_CELL_INDEXES = [4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const nutritionCellIndexesForSchema = (schema: MealNutritionCsvSchema) =>
  schema === "legacy"
    ? LEGACY_NUTRITION_CELL_INDEXES
    : NEW_NUTRITION_CELL_INDEXES;

const isNutritionCellEmpty = (raw: string | undefined) =>
  (raw ?? "").trim() === "";

const areAllNutritionCellsEmpty = (
  cells: readonly string[],
  schema: MealNutritionCsvSchema,
) =>
  nutritionCellIndexesForSchema(schema).every((index) =>
    isNutritionCellEmpty(cells[index]),
  );

/**
 * Export-template row not filled yet: has variantId, all nutrition blank.
 * Ignored — not an error (partial Excel workflow).
 */
export const isIgnorableUnfilledNutritionRow = (
  cells: readonly string[],
  schema: MealNutritionCsvSchema = "new",
): boolean => {
  const variantId = (cells[0] ?? "").trim();
  return Boolean(variantId) && areAllNutritionCellsEmpty(cells, schema);
};

const parseRequiredMacroNumber = (raw: string): number => {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) {
    return Number.NaN;
  }
  return Number(trimmed);
};

/** Empty cell → null; invalid non-empty → NaN (validation error). */
const parseOptionalMacroNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const mapLegacyCsvRowToImportCandidate = (
  cells: readonly string[],
): MealNutritionImportRow => {
  const [
    variantId = "",
    productTitle = "",
    _variantTitle = "",
    objective = "",
    caloriesRaw = "",
    proteinsRaw = "",
    carbsRaw = "",
    fatRaw = "",
    portionRaw = "",
  ] = cells;

  return {
    variantId,
    productTitle: productTitle.trim() || undefined,
    objective: objective.trim() || undefined,
    calories: parseRequiredMacroNumber(caloriesRaw),
    proteins: parseRequiredMacroNumber(proteinsRaw),
    carbs: parseRequiredMacroNumber(carbsRaw),
    fat: parseRequiredMacroNumber(fatRaw),
    saturatedFat: null,
    sugars: null,
    fiber: null,
    salt: null,
    portionGrams: parseRequiredMacroNumber(portionRaw),
  };
};

const mapNewCsvRowToImportCandidate = (
  cells: readonly string[],
): MealNutritionImportRow => {
  const [
    variantId = "",
    productTitle = "",
    _variantTitle = "",
    objective = "",
    caloriesRaw = "",
    proteinsRaw = "",
    carbsRaw = "",
    fatRaw = "",
    saturatedFatRaw = "",
    sugarsRaw = "",
    fiberRaw = "",
    saltRaw = "",
    portionRaw = "",
  ] = cells;

  return {
    variantId,
    productTitle: productTitle.trim() || undefined,
    objective: objective.trim() || undefined,
    calories: parseRequiredMacroNumber(caloriesRaw),
    proteins: parseRequiredMacroNumber(proteinsRaw),
    carbs: parseRequiredMacroNumber(carbsRaw),
    fat: parseRequiredMacroNumber(fatRaw),
    saturatedFat: parseOptionalMacroNumber(saturatedFatRaw),
    sugars: parseOptionalMacroNumber(sugarsRaw),
    fiber: parseOptionalMacroNumber(fiberRaw),
    salt: parseOptionalMacroNumber(saltRaw),
    portionGrams: parseRequiredMacroNumber(portionRaw),
  };
};

const mapCsvRowToImportCandidate = (
  cells: readonly string[],
  schema: MealNutritionCsvSchema,
): MealNutritionImportRow =>
  schema === "legacy"
    ? mapLegacyCsvRowToImportCandidate(cells)
    : mapNewCsvRowToImportCandidate(cells);

const expectedHeadersLabel = () =>
  [
    `legacy (${MEAL_NUTRITION_LEGACY_EXPORT_HEADERS.join(", ")})`,
    `new (${MEAL_NUTRITION_EXPORT_HEADERS.join(", ")})`,
  ].join(" ou ");

const collectDuplicateVariantIdIssues = (
  rows: readonly MealNutritionImportValidEntry[],
): MealNutritionImportIssue[] => {
  const firstIndexById = new Map<string, number>();
  const duplicateIds = new Set<string>();
  const issues: MealNutritionImportIssue[] = [];

  for (const { rowIndex, row } of rows) {
    const variantId = row.variantId.trim();
    if (!variantId) {
      continue;
    }
    const first = firstIndexById.get(variantId);
    if (first === undefined) {
      firstIndexById.set(variantId, rowIndex);
      continue;
    }
    duplicateIds.add(variantId);
    issues.push({
      code: "duplicate_variant_id",
      message: `variantId en double : ${variantId}.`,
      rowIndex,
    });
  }

  for (const variantId of duplicateIds) {
    const firstIndex = firstIndexById.get(variantId);
    if (firstIndex === undefined) {
      continue;
    }
    issues.push({
      code: "duplicate_variant_id",
      message: `variantId en double : ${variantId}.`,
      rowIndex: firstIndex,
    });
  }

  return issues;
};

const resolveAfterOptionalValue = (
  csvValue: number | null,
  catalogValue: number | null | undefined,
): number | null => (csvValue === null ? (catalogValue ?? null) : csvValue);

/**
 * Pure CSV → format preview. Does not touch Shopify.
 * Catalog checks live in enrichMealNutritionImportPreviewWithCatalog.
 */
export const previewMealNutritionImportCsv = (
  raw: string,
): MealNutritionImportPreview => {
  let matrix: string[][];
  try {
    matrix = parseMealNutritionCsv(raw);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de parser le CSV.";
    return emptyPreview({
      issues: [{ code: "parse_error", message, rowIndex: -1 }],
    });
  }

  if (matrix.length === 0) {
    return emptyPreview({
      issues: [
        {
          code: "empty_file",
          message: "Fichier CSV vide.",
          rowIndex: -1,
        },
      ],
    });
  }

  const [headerRow, ...dataRows] = matrix;
  const csvSchema = headerRow ? detectMealNutritionCsvSchema(headerRow) : null;

  if (!headerRow || csvSchema === null) {
    return emptyPreview({
      issues: [
        {
          code: "invalid_headers",
          message: `En-têtes CSV invalides. Attendu : ${expectedHeadersLabel()}.`,
          rowIndex: 0,
        },
      ],
    });
  }

  const mapped: MealNutritionImportValidEntry[] = [];
  let skippedEmptyRowCount = 0;
  let ignoredRowCount = 0;

  for (let i = 0; i < dataRows.length; i += 1) {
    const cells = dataRows[i] ?? [];
    const rowIndex = i + 1;
    if (isTotallyEmptyRow(cells)) {
      skippedEmptyRowCount += 1;
      continue;
    }
    if (isIgnorableUnfilledNutritionRow(cells, csvSchema)) {
      ignoredRowCount += 1;
      continue;
    }
    mapped.push({
      rowIndex,
      row: mapCsvRowToImportCandidate(cells, csvSchema),
    });
  }

  if (mapped.length === 0) {
    if (ignoredRowCount > 0) {
      return {
        csvSchema,
        diffs: [],
        issues: [],
        ok: true,
        rowCount: ignoredRowCount,
        ignoredRowCount,
        skippedEmptyRowCount,
        validEntries: [],
        validRowCount: 0,
        validRows: [],
      };
    }
    return emptyPreview({
      csvSchema,
      issues: [
        {
          code: "empty_file",
          message: "Aucune ligne de données à importer.",
          rowIndex: -1,
        },
      ],
      skippedEmptyRowCount,
      ignoredRowCount,
    });
  }

  const valueValidation = validateMealNutritionImportRows(
    mapped.map((entry) => entry.row),
  );

  const valueIssues: MealNutritionImportIssue[] = valueValidation.issues.map(
    (issue) => ({
      ...issue,
      rowIndex: mapped[issue.rowIndex]?.rowIndex ?? issue.rowIndex,
    }),
  );

  const duplicateIssues = collectDuplicateVariantIdIssues(mapped);
  const duplicateIds = new Set(
    duplicateIssues
      .map((issue) => {
        const match = issue.message.match(/variantId en double : (.+)\.$/);
        return match?.[1];
      })
      .filter((id): id is string => Boolean(id)),
  );

  const validById = new Map(
    valueValidation.validRows.map((row) => [row.variantId, row] as const),
  );

  const validEntries: MealNutritionImportValidEntry[] = [];
  for (const entry of mapped) {
    const trimmedId = entry.row.variantId.trim();
    if (duplicateIds.has(trimmedId)) {
      continue;
    }
    const validated = validById.get(trimmedId);
    if (!validated) {
      continue;
    }
    validEntries.push({ rowIndex: entry.rowIndex, row: validated });
  }

  const issues = [...valueIssues, ...duplicateIssues];
  const seenIssueKeys = new Set<string>();
  const uniqueIssues = issues.filter((issue) => {
    const key = `${issue.code}:${issue.rowIndex}:${issue.message}`;
    if (seenIssueKeys.has(key)) {
      return false;
    }
    seenIssueKeys.add(key);
    return true;
  });

  const validRows = validEntries.map((entry) => entry.row);

  return {
    csvSchema,
    diffs: [],
    issues: uniqueIssues,
    ok: uniqueIssues.length === 0,
    rowCount: mapped.length + ignoredRowCount,
    ignoredRowCount,
    skippedEmptyRowCount,
    validEntries,
    validRowCount: validRows.length,
    validRows,
  };
};

export const indexMealNutritionCatalogVariants = (
  products: readonly {
    title: string;
    variants: readonly {
      variantId: string;
      variantTitle: string;
      objective: string | null;
      calories: number | null;
      proteins: number | null;
      carbs: number | null;
      fat: number | null;
      saturatedFat?: number | null;
      sugars?: number | null;
      fiber?: number | null;
      salt?: number | null;
      portionGrams: number | null;
    }[];
  }[],
): Map<string, MealNutritionCatalogVariantRef> => {
  const map = new Map<string, MealNutritionCatalogVariantRef>();

  for (const product of products) {
    for (const variant of product.variants) {
      const variantId = variant.variantId?.trim() ?? "";
      if (!variantId) {
        continue;
      }
      map.set(variantId, {
        variantId,
        variantTitle: variant.variantTitle,
        productTitle: product.title,
        objective: variant.objective,
        calories: variant.calories,
        proteins: variant.proteins,
        carbs: variant.carbs,
        fat: variant.fat,
        saturatedFat: variant.saturatedFat ?? null,
        sugars: variant.sugars ?? null,
        fiber: variant.fiber ?? null,
        salt: variant.salt ?? null,
        portionGrams: variant.portionGrams,
      });
    }
  }

  return map;
};

/**
 * Business preview: catalog identity + objective + before/after macros.
 * Still no Shopify writes.
 */
export const enrichMealNutritionImportPreviewWithCatalog = (
  formatPreview: MealNutritionImportPreview,
  catalogByVariantId: ReadonlyMap<string, MealNutritionCatalogVariantRef>,
): MealNutritionImportPreview => {
  if (formatPreview.validEntries.length === 0) {
    return {
      ...formatPreview,
      diffs: [],
    };
  }

  const catalogIssues: MealNutritionImportIssue[] = [];
  const diffs: MealNutritionImportDiff[] = [];
  const validEntries: MealNutritionImportValidEntry[] = [];

  for (const entry of formatPreview.validEntries) {
    const variantId = entry.row.variantId.trim();
    const catalog = catalogByVariantId.get(variantId);

    if (!catalog) {
      catalogIssues.push({
        code: "variant_not_found",
        message: `variantId inconnu dans le catalogue repas : ${variantId}.`,
        rowIndex: entry.rowIndex,
      });
      continue;
    }

    const csvObjective = (entry.row.objective ?? "").trim();
    const shopObjective = catalog.objective ?? "";
    if (csvObjective !== shopObjective) {
      catalogIssues.push({
        code: "objective_mismatch",
        message: `objective CSV (« ${csvObjective || "vide"} ») ≠ mileyo.objective Shopify (« ${shopObjective || "vide"} ») pour ${variantId}.`,
        rowIndex: entry.rowIndex,
      });
      continue;
    }

    diffs.push({
      variantId,
      productTitle: catalog.productTitle,
      variantTitle: catalog.variantTitle,
      objective: shopObjective,
      before: {
        calories: catalog.calories,
        proteins: catalog.proteins,
        carbs: catalog.carbs,
        fat: catalog.fat,
        saturatedFat: catalog.saturatedFat ?? null,
        sugars: catalog.sugars ?? null,
        fiber: catalog.fiber ?? null,
        salt: catalog.salt ?? null,
        portionGrams: catalog.portionGrams,
      },
      after: {
        calories: entry.row.calories,
        proteins: entry.row.proteins,
        carbs: entry.row.carbs,
        fat: entry.row.fat,
        saturatedFat: resolveAfterOptionalValue(
          entry.row.saturatedFat,
          catalog.saturatedFat,
        ),
        sugars: resolveAfterOptionalValue(entry.row.sugars, catalog.sugars),
        fiber: resolveAfterOptionalValue(entry.row.fiber, catalog.fiber),
        salt: resolveAfterOptionalValue(entry.row.salt, catalog.salt),
        portionGrams: entry.row.portionGrams,
      },
    });
    validEntries.push(entry);
  }

  const issues = [...formatPreview.issues, ...catalogIssues];
  const validRows = validEntries.map((entry) => entry.row);

  return {
    ...formatPreview,
    diffs,
    issues,
    ok: issues.length === 0,
    validEntries,
    validRowCount: validRows.length,
    validRows,
  };
};
