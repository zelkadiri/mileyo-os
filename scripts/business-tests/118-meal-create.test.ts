/**
 * Business regression — Créer un plat (back-office meal create).
 *
 * Pure helpers + mocked Admin GraphQL only. No live Shopify mutations.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEAL_V2_EXPECTED_VARIANT_COUNT,
  MEAL_V2_VARIANT_PRICE,
  getMealV2VariantSpecs,
} from "../../app/constants/subscriptionMealCatalogV2";
import {
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
  SUBSCRIPTION_OBJECTIVES,
} from "../../app/constants/subscriptionObjective";
import {
  CREATE_MEAL_INTENT,
  createEmptyMealCreateFormValues,
  mealCreateHasBlockedImageInput,
  parseMealCreateFormData,
  validateMealCreateFormValues,
} from "../../app/features/meals/meals-create-form";
import {
  MEAL_CREATE_ATTEMPT_METAFIELD,
  MEAL_CREATE_MAX_PRODUCTS,
  assertMealCreateProductSetInputSafe,
  buildMealCreateProductSetInput,
  createMealProductForCollection,
  findMealProductOwnedByCreateAttempt,
  findOrphanMealDraftByTitle,
  verifyCreatedMealVariants,
} from "../../app/features/meals/meals-create.server";
import { MEAL_V2_METAFIELD_DEFINITIONS } from "../../app/features/settings/settings-metafields.server";
import {
  MEAL_CATALOG_PRODUCTS_MAX_PAGES,
  MEAL_CATALOG_PRODUCTS_PAGE_SIZE,
  fetchMealCatalogProducts,
  fetchMealCatalogProductTitles,
} from "../../app/services/subscriptionMealCatalog.server";
import {
  MEAL_IMAGE_OPTIONAL_SCOPE,
  validateMealImageFile,
} from "../../app/services/mealProductImage.server";
import { MEAL_PUBLICATION_OPTIONAL_SCOPE } from "../../app/services/mealOnlineStoreUnpublish.server";
import {
  MEAL_IMAGE_OPTIONAL_SCOPE as MEAL_IMAGE_SCOPE_CLIENT,
  MEAL_IMAGE_SCOPE_DECLINED_MESSAGE,
  MEAL_IMAGE_SCOPE_UNAVAILABLE_MESSAGE,
  hasMealImageWriteFilesScope,
  interpretMealImageScopeRequestResult,
  reloadEmbeddedAdminAfterScopeChange,
  requestMealImageWriteFilesScope,
} from "../../app/features/meals/meals-create-image-scopes";
import {
  interpretOptionalScopeRequestResult,
  reloadEmbeddedAdminAfterScopeChange as reloadShared,
} from "../../app/utils/shopify-optional-scope-consent";
import {
  MEAL_PRODUCT_METAFIELD_TYPES,
  buildMealProductMetafieldValues,
  buildMealProductMetafieldsSetInputs,
  serializeMealListMetafieldValue,
} from "../../app/utils/mealProductMetafields";
import {
  parseAllergenesMetafield,
  parseListMetafield,
  parseMealBadges,
} from "../../app/utils/mealMetafields";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const jsonResponse = (body: unknown) =>
  ({ json: async () => body }) as unknown as Response;

type GraphqlCall = {
  query: string;
  variables?: Record<string, unknown>;
};

const MEAL_COLLECTION_ID = "gid://shopify/Collection/meals";
const PUBLICATION_ID = "gid://shopify/Publication/online-store";
const PRODUCT_ID = "gid://shopify/Product/new-meal";
const CREATE_ATTEMPT_ID = "11111111-2222-4333-8444-555555555555";
const FOREIGN_ATTEMPT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const validNutritionForObjective = () => ({
  calories: "420",
  proteins: "35.5",
  carbs: "28",
  fat: "12",
  portionGrams: "350",
  saturatedFat: "3",
  sugars: "4",
  fiber: "5",
  salt: "1.2",
});

const buildValidFormData = (
  overrides: Record<string, string> = {},
): FormData => {
  const formData = new FormData();
  formData.set("intent", CREATE_MEAL_INTENT);
  formData.set("title", overrides.title ?? "Poulet curry maison");
  formData.set("description", overrides.description ?? "Un plat équilibré");
  formData.set("ingredients", overrides.ingredients ?? "");
  formData.set("allergenes", overrides.allergenes ?? "");
  formData.set("badge1", overrides.badge1 ?? "");
  formData.set("badge2", overrides.badge2 ?? "");
  formData.set("badge3", overrides.badge3 ?? "");
  formData.set(
    "createAttemptId",
    overrides.createAttemptId ?? CREATE_ATTEMPT_ID,
  );
  formData.set("resumeProductId", overrides.resumeProductId ?? "");

  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    const nutrition = validNutritionForObjective();
    for (const [key, value] of Object.entries(nutrition)) {
      const overrideKey = `nutrition_${objective}_${key}`;
      formData.set(
        overrideKey,
        overrides[overrideKey] ?? value,
      );
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (
      key.startsWith("nutrition_") ||
      [
        "title",
        "description",
        "ingredients",
        "allergenes",
        "badge1",
        "badge2",
        "badge3",
        "createAttemptId",
        "resumeProductId",
      ].includes(key)
    ) {
      continue;
    }
    formData.set(key, value);
  }

  return formData;
};

const createdVariants = () =>
  getMealV2VariantSpecs().map((spec, index) => ({
    id: `gid://shopify/ProductVariant/${index + 1}`,
    title: spec.objectiveOptionLabel,
    price: MEAL_V2_VARIANT_PRICE,
    selectedOptions: [
      {
        name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
        value: spec.objectiveOptionLabel,
      },
    ],
    objectiveMetafield: { value: spec.objective },
    sellingPlanGroups: { nodes: [] },
  }));

const createMealCreateMockAdmin = ({
  titles = [] as Array<{ id: string; title: string }>,
  titlesHasNextPage = false,
  collectionMissing = false,
  productSetUserErrors = [] as { message: string }[],
  metafieldsUserErrors = [] as { message: string }[],
  productMetafieldsUserErrors = [] as { message: string }[],
  unpublishPublished = false,
  unpublishAfterActivePublished = false,
  unpublishUserErrors = [] as { message: string }[],
  activateUserErrors = [] as { message: string }[],
  collectionAddUserErrors = [] as { message: string }[],
  stagedUploadUserErrors = [] as { message: string }[],
  mediaUserErrors = [] as { message: string }[],
  skipProductSet = false,
  publicationsMissing = false,
  alreadyInCollection = false,
  seedCreateAttemptId = null as string | null,
  missingDefinitionKeys = [] as string[],
  incompatibleDefinitionTypes = {} as Record<string, string>,
}: {
  titles?: Array<{ id: string; title: string }>;
  titlesHasNextPage?: boolean;
  collectionMissing?: boolean;
  productSetUserErrors?: { message: string }[];
  metafieldsUserErrors?: { message: string }[];
  productMetafieldsUserErrors?: { message: string }[];
  unpublishPublished?: boolean;
  unpublishAfterActivePublished?: boolean;
  unpublishUserErrors?: { message: string }[];
  activateUserErrors?: { message: string }[];
  collectionAddUserErrors?: { message: string }[];
  stagedUploadUserErrors?: { message: string }[];
  mediaUserErrors?: { message: string }[];
  skipProductSet?: boolean;
  publicationsMissing?: boolean;
  alreadyInCollection?: boolean;
  /** Pre-seed ownership metafield (resume / already-in-collection paths). */
  seedCreateAttemptId?: string | null;
  /** Keys (e.g. saturated_fat) omitted from LookupMetafieldDefinition. */
  missingDefinitionKeys?: string[];
  /** key → wrong Shopify type name for LookupMetafieldDefinition. */
  incompatibleDefinitionTypes?: Record<string, string>;
} = {}) => {
  const calls: GraphqlCall[] = [];
  let created = false;
  let unpublishCount = 0;
  let storedCreateAttemptId = seedCreateAttemptId;
  const productMetafieldStore: Record<string, string> = {};

  return {
    admin: {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        calls.push({ query, variables: options?.variables });

        if (query.includes("MealCatalogCollection")) {
          return jsonResponse({
            data: {
              collection: collectionMissing
                ? null
                : {
                    id: MEAL_COLLECTION_ID,
                    handle: "plats",
                    title: "Plats",
                  },
            },
          });
        }

        if (query.includes("SubscriptionMealCatalogTitles")) {
          return jsonResponse({
            data: {
              collection: {
                id: MEAL_COLLECTION_ID,
                products: {
                  pageInfo: {
                    hasNextPage: titlesHasNextPage,
                    endCursor: titlesHasNextPage ? "cursor-1" : null,
                  },
                  nodes: titles,
                },
              },
            },
          });
        }

        if (query.includes("LookupMetafieldDefinition")) {
          const variables = (options?.variables ?? {}) as {
            namespace?: string;
            key?: string;
            ownerType?: string;
          };
          const expected = MEAL_V2_METAFIELD_DEFINITIONS.find(
            (definition) =>
              definition.namespace === variables.namespace &&
              definition.key === variables.key &&
              definition.ownerType === variables.ownerType,
          );
          if (
            !expected ||
            missingDefinitionKeys.includes(variables.key ?? "")
          ) {
            return jsonResponse({
              data: { metafieldDefinitions: { nodes: [] } },
            });
          }
          const typeName =
            incompatibleDefinitionTypes[variables.key ?? ""] ?? expected.type;
          return jsonResponse({
            data: {
              metafieldDefinitions: {
                nodes: [
                  {
                    id: `gid://shopify/MetafieldDefinition/${expected.key}`,
                    namespace: expected.namespace,
                    key: expected.key,
                    ownerType: expected.ownerType,
                    type: { name: typeName },
                  },
                ],
              },
            },
          });
        }

        if (query.includes("AppPublicationsForOnlineStore")) {
          if (publicationsMissing) {
            return jsonResponse({ data: { publications: { nodes: [] } } });
          }
          return jsonResponse({
            data: {
              publications: {
                nodes: [
                  {
                    id: PUBLICATION_ID,
                    catalog: {
                      id: "gid://shopify/Catalog/1",
                      title: "Online Store",
                      apps: {
                        nodes: [
                          {
                            id: "gid://shopify/App/1",
                            handle: "online_store",
                            title: "Online Store",
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          });
        }

        if (query.includes("FindMealCreateAttemptByTitle")) {
          return jsonResponse({
            data: { products: { nodes: [] } },
          });
        }

        if (query.includes("CreateMealCatalogProduct")) {
          if (skipProductSet) {
            throw new Error("productSet CREATE should not be called");
          }
          const input = options?.variables?.input as
            | {
                metafields?: Array<{
                  namespace?: string;
                  key?: string;
                  value?: string;
                }>;
              }
            | undefined;
          const attempt = input?.metafields?.find(
            (metafield) =>
              metafield.namespace === MEAL_CREATE_ATTEMPT_METAFIELD.namespace &&
              metafield.key === MEAL_CREATE_ATTEMPT_METAFIELD.key,
          );
          if (attempt?.value) {
            storedCreateAttemptId = attempt.value;
          }
          created = true;
          return jsonResponse({
            data: {
              productSet: {
                product: productSetUserErrors.length
                  ? null
                  : {
                      id: PRODUCT_ID,
                      title: "Poulet curry maison",
                      status: "DRAFT",
                      createAttemptMetafield: {
                        value: storedCreateAttemptId,
                      },
                      variants: { nodes: createdVariants() },
                      collections: { nodes: [] },
                    },
                userErrors: productSetUserErrors,
              },
            },
          });
        }

        if (query.includes("SaveMealNutritionMetafields")) {
          return jsonResponse({
            data: {
              metafieldsSet: {
                metafields: metafieldsUserErrors.length
                  ? []
                  : [{ id: "1", key: "calories", value: "420" }],
                userErrors: metafieldsUserErrors.map((error) => ({
                  message: error.message,
                  elementIndex: 0,
                })),
              },
            },
          });
        }

        if (query.includes("SaveMealProductMetafields")) {
          const metafields = (options?.variables?.metafields ?? []) as Array<{
            key: string;
            value: string;
          }>;
          if (productMetafieldsUserErrors.length === 0) {
            for (const metafield of metafields) {
              productMetafieldStore[metafield.key] = metafield.value;
            }
          }
          return jsonResponse({
            data: {
              metafieldsSet: {
                metafields: productMetafieldsUserErrors.length
                  ? []
                  : metafields.map((metafield, index) => ({
                      id: `gid://shopify/Metafield/${index + 1}`,
                      key: metafield.key,
                      value: metafield.value,
                    })),
                userErrors: productMetafieldsUserErrors.map((error) => ({
                  message: error.message,
                  elementIndex: 0,
                })),
              },
            },
          });
        }

        if (query.includes("VerifyMealProductMetafields")) {
          return jsonResponse({
            data: {
              product: {
                id: PRODUCT_ID,
                ingredientsMetafield: productMetafieldStore.ingredients
                  ? {
                      type: "list.single_line_text_field",
                      value: productMetafieldStore.ingredients,
                    }
                  : null,
                allergenesMetafield: productMetafieldStore.allergenes
                  ? {
                      type: "list.single_line_text_field",
                      value: productMetafieldStore.allergenes,
                    }
                  : null,
                badge1Metafield: productMetafieldStore.badge_1
                  ? {
                      type: "single_line_text_field",
                      value: productMetafieldStore.badge_1,
                    }
                  : null,
                badge2Metafield: productMetafieldStore.badge_2
                  ? {
                      type: "single_line_text_field",
                      value: productMetafieldStore.badge_2,
                    }
                  : null,
                badge3Metafield: productMetafieldStore.badge_3
                  ? {
                      type: "single_line_text_field",
                      value: productMetafieldStore.badge_3,
                    }
                  : null,
              },
            },
          });
        }

        if (query.includes("StageMealProductImage")) {
          return jsonResponse({
            data: {
              stagedUploadsCreate: {
                stagedTargets: stagedUploadUserErrors.length
                  ? []
                  : [
                      {
                        url: "https://upload.example/staged",
                        resourceUrl: "https://shopify.example/resource",
                        parameters: [
                          { name: "key", value: "tmp/key" },
                          { name: "policy", value: "policy" },
                        ],
                      },
                    ],
                userErrors: stagedUploadUserErrors,
              },
            },
          });
        }

        if (query.includes("AttachMealProductImage")) {
          return jsonResponse({
            data: {
              productUpdate: {
                product: mediaUserErrors.length
                  ? null
                  : {
                      id: PRODUCT_ID,
                      featuredImage: {
                        altText: "Poulet curry maison",
                        url: "https://cdn.example/meal.jpg",
                      },
                      media: {
                        nodes: [
                          {
                            id: "gid://shopify/MediaImage/1",
                            alt: "Poulet curry maison",
                            mediaContentType: "IMAGE",
                            status: "READY",
                            image: { url: "https://cdn.example/meal.jpg" },
                          },
                        ],
                      },
                    },
                userErrors: mediaUserErrors,
              },
            },
          });
        }

        if (query.includes("VerifyMealProductImage")) {
          return jsonResponse({
            data: {
              product: {
                id: PRODUCT_ID,
                featuredImage: {
                  altText: "Poulet curry maison",
                  url: "https://cdn.example/meal.jpg",
                },
                media: {
                  nodes: [
                    {
                      id: "gid://shopify/MediaImage/1",
                      alt: "Poulet curry maison",
                      mediaContentType: "IMAGE",
                      status: "READY",
                      image: { url: "https://cdn.example/meal.jpg" },
                    },
                  ],
                },
              },
            },
          });
        }

        if (query.includes("UnpublishMealFromOnlineStore")) {
          unpublishCount += 1;
          const published =
            unpublishCount === 1
              ? unpublishPublished
              : unpublishAfterActivePublished;
          return jsonResponse({
            data: {
              publishableUnpublish: {
                publishable: {
                  id: PRODUCT_ID,
                  publishedOnPublication: published,
                },
                userErrors: unpublishUserErrors,
              },
            },
          });
        }

        if (query.includes("VerifyCreatedMealProduct")) {
          const activated =
            calls.filter((call) =>
              call.query.includes("ActivateMealCatalogProduct"),
            ).length > 0;
          const inCollection =
            alreadyInCollection ||
            calls.filter((call) =>
              call.query.includes("AddMealToCollection"),
            ).length > 0;
          return jsonResponse({
            data: {
              product: {
                id: PRODUCT_ID,
                title: "Poulet curry maison",
                status: activated || inCollection ? "ACTIVE" : "DRAFT",
                createAttemptMetafield: {
                  value: storedCreateAttemptId,
                },
                publishedOnOnlineStore: false,
                collections: {
                  nodes: inCollection ? [{ id: MEAL_COLLECTION_ID }] : [],
                },
                variants: { nodes: createdVariants() },
              },
            },
          });
        }

        if (query.includes("ActivateMealCatalogProduct")) {
          return jsonResponse({
            data: {
              productSet: {
                product: activateUserErrors.length
                  ? null
                  : { id: PRODUCT_ID, status: "ACTIVE" },
                userErrors: activateUserErrors,
              },
            },
          });
        }

        if (query.includes("AddMealToCollection")) {
          return jsonResponse({
            data: {
              collectionAddProducts: {
                collection: collectionAddUserErrors.length
                  ? null
                  : { id: MEAL_COLLECTION_ID },
                userErrors: collectionAddUserErrors,
              },
            },
          });
        }

        throw new Error(`Unexpected GraphQL operation: ${query.slice(0, 140)}`);
      },
    },
    calls,
    wasCreated: () => created,
    productMetafieldStore,
  };
};

const run = async () => {
  const ctx = createBusinessTestContext("118-meal-create");

  ctx.scenario("A. Form validation + tab value retention shape");
  const empty = createEmptyMealCreateFormValues();
  ctx.assertEqual("empty title", empty.title, "");
  ctx.assertTrue(
    "empty form has createAttemptId",
    empty.createAttemptId.length >= 8,
  );
  ctx.assertEqual(
    "three objective buckets",
    Object.keys(empty.nutrition).length,
    3,
  );

  const invalid = validateMealCreateFormValues(empty);
  ctx.assertFalse("empty form invalid", invalid.ok);
  ctx.assertTrue(
    "title required",
    invalid.errors.some((error) => error.field === "title"),
  );

  const formData = buildValidFormData();
  const parsed = parseMealCreateFormData(formData);
  const valid = validateMealCreateFormValues(parsed);
  ctx.assertTrue("valid form ok", valid.ok);
  ctx.assertEqual("nutrition rows = 3", valid.nutritionRows.length, 3);
  ctx.assertEqual(
    "createAttemptId parsed",
    parsed.createAttemptId,
    CREATE_ATTEMPT_ID,
  );

  const withTabsPreserved = parseMealCreateFormData(
    buildValidFormData({
      nutrition_bulk_calories: "900",
      nutrition_weight_loss_proteins: "40.5",
    }),
  );
  ctx.assertEqual(
    "bulk calories preserved",
    withTabsPreserved.nutrition.bulk.calories,
    "900",
  );
  ctx.assertEqual(
    "weight_loss proteins preserved",
    withTabsPreserved.nutrition.weight_loss.proteins,
    "40.5",
  );

  ctx.assertTrue(
    "image blocked without write_files",
    mealCreateHasBlockedImageInput(
      { size: 12, name: "x.jpg", type: "image/jpeg" } as File,
      false,
    ),
  );
  ctx.assertFalse(
    "image allowed with write_files",
    mealCreateHasBlockedImageInput(
      { size: 12, name: "x.jpg", type: "image/jpeg" } as File,
      true,
    ),
  );

  const optionalZero = validateMealCreateFormValues(
    parseMealCreateFormData(
      buildValidFormData({
        nutrition_weight_loss_saturatedFat: "0",
        nutrition_weight_loss_sugars: "0",
        nutrition_weight_loss_fiber: "0",
        nutrition_weight_loss_salt: "0",
        nutrition_balanced_saturatedFat: "0",
        nutrition_balanced_sugars: "0",
        nutrition_balanced_fiber: "0",
        nutrition_balanced_salt: "0",
        nutrition_bulk_saturatedFat: "0",
        nutrition_bulk_sugars: "0",
        nutrition_bulk_fiber: "0",
        nutrition_bulk_salt: "0",
      }),
    ),
  );
  ctx.assertTrue("optional zero is valid", optionalZero.ok);
  if (optionalZero.ok) {
    ctx.assertEqual(
      "optional zero stored as 0 not null",
      optionalZero.nutritionRows[0]?.saturatedFat,
      0,
    );
    ctx.assertEqual(
      "optional zero sugars stored as 0",
      optionalZero.nutritionRows[0]?.sugars,
      0,
    );
  }

  const optionalBlank = validateMealCreateFormValues(
    parseMealCreateFormData(
      buildValidFormData({
        nutrition_weight_loss_saturatedFat: "",
        nutrition_weight_loss_sugars: "",
        nutrition_weight_loss_fiber: "",
        nutrition_weight_loss_salt: "",
        nutrition_balanced_saturatedFat: "",
        nutrition_balanced_sugars: "",
        nutrition_balanced_fiber: "",
        nutrition_balanced_salt: "",
        nutrition_bulk_saturatedFat: "",
        nutrition_bulk_sugars: "",
        nutrition_bulk_fiber: "",
        nutrition_bulk_salt: "",
      }),
    ),
  );
  ctx.assertTrue("optional blank valid", optionalBlank.ok);
  if (optionalBlank.ok) {
    ctx.assertNull(
      "blank saturatedFat → null",
      optionalBlank.nutritionRows[0]?.saturatedFat ?? null,
    );
  }

  ctx.scenario("B. productSet CREATE payload — 3 variants @ 0.00");
  const input = buildMealCreateProductSetInput(
    "Poulet curry",
    "Desc",
    CREATE_ATTEMPT_ID,
  );
  const safety = assertMealCreateProductSetInputSafe(input);
  ctx.assertTrue("payload safe", safety.ok);
  ctx.assertEqual("status DRAFT", input.status, "DRAFT");
  ctx.assertEqual(
    "exactly 3 variants",
    input.variants.length,
    MEAL_V2_EXPECTED_VARIANT_COUNT,
  );
  ctx.assertTrue(
    "all prices 0.00",
    input.variants.every((variant) => variant.price === MEAL_V2_VARIANT_PRICE),
  );
  ctx.assertEqual(
    "option name Objectif",
    input.productOptions[0]?.name,
    SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
  );
  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    ctx.assertTrue(
      `label ${objective}`,
      input.productOptions[0]?.values.some(
        (value) =>
          value.name === SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[objective],
      ) === true,
    );
  }
  ctx.assertEqual(
    "create_attempt_id metafield present",
    input.metafields[0]?.key,
    MEAL_CREATE_ATTEMPT_METAFIELD.key,
  );
  ctx.assertEqual(
    "create_attempt_id value",
    input.metafields[0]?.value,
    CREATE_ATTEMPT_ID,
  );
  ctx.assertFalse(
    "no collections on create",
    "collections" in (input as Record<string, unknown>),
  );
  ctx.assertFalse(
    "no files on create",
    "files" in (input as Record<string, unknown>),
  );

  const missingAttempt = assertMealCreateProductSetInputSafe({
    ...input,
    metafields: [],
  });
  ctx.assertFalse("missing create_attempt_id rejected", missingAttempt.ok);

  const fourthRejected = assertMealCreateProductSetInputSafe({
    ...input,
    variants: [
      ...input.variants,
      {
        ...input.variants[0]!,
        price: "1.00",
      },
    ],
  });
  ctx.assertFalse("fourth variant rejected", fourthRejected.ok);

  const verified = verifyCreatedMealVariants(createdVariants());
  ctx.assertTrue("verify variants ok", verified.ok);
  if (verified.ok) {
    ctx.assertEqual(
      "mapped objectives",
      Object.keys(verified.byObjective).sort().join("|"),
      [...SUBSCRIPTION_OBJECTIVES].sort().join("|"),
    );
  }

  const withSellingPlan = verifyCreatedMealVariants([
    {
      ...createdVariants()[0]!,
      sellingPlanGroups: { nodes: [{ id: "gid://shopify/SellingPlanGroup/1" }] },
    },
    ...createdVariants().slice(1),
  ]);
  ctx.assertFalse("selling plan rejected", withSellingPlan.ok);

  ctx.scenario("C. Happy path create (mocked Shopify)");
  const happy = createMealCreateMockAdmin();
  const happyResult = await createMealProductForCollection({
    admin: happy.admin,
    formData: buildValidFormData({
      nutrition_weight_loss_saturatedFat: "3",
      nutrition_weight_loss_sugars: "4",
      nutrition_weight_loss_fiber: "5",
      nutrition_weight_loss_salt: "1.2",
      nutrition_balanced_saturatedFat: "3",
      nutrition_balanced_sugars: "4",
      nutrition_balanced_fiber: "5",
      nutrition_balanced_salt: "1.2",
      nutrition_bulk_saturatedFat: "0",
      nutrition_bulk_sugars: "0",
      nutrition_bulk_fiber: "0",
      nutrition_bulk_salt: "0",
    }),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE, "write_products"],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertTrue("happy path ok", happyResult.ok);
  ctx.assertEqual("tracking id set", happyResult.trackingProductId, PRODUCT_ID);
  const nutritionCalls = happy.calls.filter((call) =>
    call.query.includes("SaveMealNutritionMetafields"),
  );
  ctx.assertTrue("nutrition metafields written", nutritionCalls.length > 0);
  const nutritionPayload = JSON.stringify(nutritionCalls[0]?.variables ?? {});
  ctx.assertTrue(
    "writes saturated_fat",
    nutritionPayload.includes("saturated_fat"),
  );
  ctx.assertTrue("writes sugars", nutritionPayload.includes('"sugars"'));
  ctx.assertTrue("writes fiber", nutritionPayload.includes('"fiber"'));
  ctx.assertTrue("writes salt", nutritionPayload.includes('"salt"'));
  const zeroOptionalWritten = nutritionCalls.some((call) => {
    const metafields = (call.variables?.metafields ?? []) as Array<{
      key?: string;
      value?: string;
    }>;
    return metafields.some(
      (metafield) =>
        metafield.key === "salt" && String(metafield.value) === "0",
    );
  });
  ctx.assertTrue("writes optional zero as value 0", zeroOptionalWritten);

  ctx.scenario("C2. Missing / incompatible meal V2 definitions gate");
  const missingDefs = createMealCreateMockAdmin({
    missingDefinitionKeys: ["saturated_fat", "sugars", "fiber", "salt"],
  });
  const missingResult = await createMealProductForCollection({
    admin: missingDefs.admin,
    formData: buildValidFormData({ title: "Plat defs manquantes" }),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE, "write_products"],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("missing defs refuse create", missingResult.ok);
  ctx.assertNull(
    "no tracking when defs missing",
    missingResult.trackingProductId,
  );
  ctx.assertFalse(
    "no productSet when defs missing",
    missingDefs.calls.some((call) =>
      call.query.includes("CreateMealCatalogProduct"),
    ),
  );
  ctx.assertTrue(
    "message points to Réglages",
    missingResult.message.includes("Réglages"),
  );
  ctx.assertTrue(
    "lists missing keys",
    missingResult.message.includes("saturated_fat") &&
      missingResult.message.includes("salt"),
  );
  ctx.assertEqual(
    "preserves user title",
    missingResult.values.title,
    "Plat defs manquantes",
  );

  const oneMissing = createMealCreateMockAdmin({
    missingDefinitionKeys: ["fiber"],
  });
  const oneMissingResult = await createMealProductForCollection({
    admin: oneMissing.admin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE, "write_products"],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("single missing def refuses", oneMissingResult.ok);
  ctx.assertFalse(
    "single missing — no productSet",
    oneMissing.calls.some((call) =>
      call.query.includes("CreateMealCatalogProduct"),
    ),
  );

  const badType = createMealCreateMockAdmin({
    incompatibleDefinitionTypes: { salt: "number_integer" },
  });
  const badTypeResult = await createMealProductForCollection({
    admin: badType.admin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE, "write_products"],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("incompatible type refuses", badTypeResult.ok);
  ctx.assertTrue(
    "incompatible mentions salt",
    badTypeResult.message.includes("salt") ||
      badTypeResult.errors.some((error) => error.includes("salt")),
  );
  ctx.assertFalse(
    "incompatible — no productSet",
    badType.calls.some((call) =>
      call.query.includes("CreateMealCatalogProduct"),
    ),
  );
  ctx.assertTrue(
    "productSet called",
    happy.calls.some((call) => call.query.includes("CreateMealCatalogProduct")),
  );
  ctx.assertTrue(
    "metafieldsSet called",
    happy.calls.some((call) => call.query.includes("SaveMealNutritionMetafields")),
  );
  const unpublishCalls = happy.calls.filter((call) =>
    call.query.includes("UnpublishMealFromOnlineStore"),
  );
  ctx.assertEqual("unpublish before and after ACTIVE", unpublishCalls.length, 2);
  ctx.assertTrue(
    "activate called",
    happy.calls.some((call) =>
      call.query.includes("ActivateMealCatalogProduct"),
    ),
  );
  const collectionCallIndex = happy.calls.findIndex((call) =>
    call.query.includes("AddMealToCollection"),
  );
  const activateCallIndex = happy.calls.findIndex((call) =>
    call.query.includes("ActivateMealCatalogProduct"),
  );
  const secondUnpublishIndex = happy.calls
    .map((call, index) =>
      call.query.includes("UnpublishMealFromOnlineStore") ? index : -1,
    )
    .filter((index) => index >= 0)[1];
  ctx.assertTrue(
    "collection after activate",
    collectionCallIndex > activateCallIndex && collectionCallIndex >= 0,
  );
  ctx.assertTrue(
    "second unpublish after activate before collection",
    typeof secondUnpublishIndex === "number" &&
      secondUnpublishIndex > activateCallIndex &&
      secondUnpublishIndex < collectionCallIndex,
  );
  const createInput = happy.calls.find((call) =>
    call.query.includes("CreateMealCatalogProduct"),
  )?.variables?.input as Record<string, unknown> | undefined;
  ctx.assertTrue(
    "create without collections",
    createInput != null && !("collections" in createInput),
  );
  ctx.assertEqual(
    "create status DRAFT",
    (createInput as { status?: string } | undefined)?.status,
    "DRAFT",
  );

  ctx.scenario("D. Failures — permissions / productSet / metafields / collection");
  const noScope = await createMealProductForCollection({
    admin: createMealCreateMockAdmin().admin,
    formData: buildValidFormData(),
    grantedScopes: ["write_products"],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("missing write_publications refused", noScope.ok);
  ctx.assertTrue(
    "no mutation without scope",
    !noScope.trackingProductId,
  );

  const productSetFail = createMealCreateMockAdmin({
    productSetUserErrors: [{ message: "productSet boom" }],
  });
  const productSetResult = await createMealProductForCollection({
    admin: productSetFail.admin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("productSet failure", productSetResult.ok);
  ctx.assertNull("no tracking on failed create", productSetResult.trackingProductId);
  ctx.assertFalse(
    "no collection add after productSet fail",
    productSetFail.calls.some((call) =>
      call.query.includes("AddMealToCollection"),
    ),
  );

  const metafieldFail = createMealCreateMockAdmin({
    metafieldsUserErrors: [{ message: "metafieldsSet boom" }],
  });
  const metafieldResult = await createMealProductForCollection({
    admin: metafieldFail.admin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("metafieldsSet failure", metafieldResult.ok);
  ctx.assertEqual(
    "tracking kept after metafield fail",
    metafieldResult.trackingProductId,
    PRODUCT_ID,
  );
  ctx.assertFalse(
    "no collection add after metafield fail",
    metafieldFail.calls.some((call) =>
      call.query.includes("AddMealToCollection"),
    ),
  );
  ctx.assertTrue(
    "form values retained",
    metafieldResult.values.title === "Poulet curry maison",
  );

  const collectionFail = createMealCreateMockAdmin({
    collectionAddUserErrors: [{ message: "collection boom" }],
  });
  const collectionResult = await createMealProductForCollection({
    admin: collectionFail.admin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("collection add failure", collectionResult.ok);
  ctx.assertEqual(
    "tracking kept after collection fail",
    collectionResult.trackingProductId,
    PRODUCT_ID,
  );
  ctx.assertFalse("no partial success flag", collectionResult.ok);

  const unpublishFail = createMealCreateMockAdmin({
    unpublishPublished: true,
  });
  const unpublishResult = await createMealProductForCollection({
    admin: unpublishFail.admin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("unpublish verify failure", unpublishResult.ok);
  ctx.assertFalse(
    "no collection after unpublish fail",
    unpublishFail.calls.some((call) =>
      call.query.includes("AddMealToCollection"),
    ),
  );

  ctx.scenario("E. Duplicate title + catalog limit");
  const duplicate = await createMealProductForCollection({
    admin: createMealCreateMockAdmin({
      titles: [{ id: "gid://shopify/Product/1", title: "Poulet curry maison" }],
    }).admin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("duplicate title blocked", duplicate.ok);
  ctx.assertNull("no create on duplicate", duplicate.trackingProductId);

  const atLimitTitles = Array.from({ length: MEAL_CREATE_MAX_PRODUCTS }, (_, index) => ({
    id: `gid://shopify/Product/${index + 1}`,
    title: `Plat ${index + 1}`,
  }));
  // Titles helper paginates — mock returns all in one page when hasNextPage false.
  // For limit test we only need titles.length >= MEAL_CREATE_MAX_PRODUCTS.
  // Cap mock to avoid huge arrays in CI when limit is large: simulate via titlesHasNextPage overflow path
  // by returning exactly MEAL_CREATE_MAX_PRODUCTS titles.
  const limitMock = createMealCreateMockAdmin({
    titles: atLimitTitles.slice(0, Math.min(MEAL_CREATE_MAX_PRODUCTS, 60)),
  });
  // Force length check with a custom admin that returns count >= limit
  const limitAdmin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("SubscriptionMealCatalogTitles")) {
        return jsonResponse({
          data: {
            collection: {
              id: MEAL_COLLECTION_ID,
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: Array.from({ length: MEAL_CREATE_MAX_PRODUCTS }, (_, i) => ({
                  id: `gid://shopify/Product/${i + 1}`,
                  title: `Plat ${i + 1}`,
                })),
              },
            },
          },
        });
      }
      return limitMock.admin.graphql(query, options);
    },
  };
  const limitResult = await createMealProductForCollection({
    admin: limitAdmin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("catalog limit blocks create", limitResult.ok);
  ctx.assertTrue(
    "limit message",
    limitResult.message.includes(String(MEAL_CREATE_MAX_PRODUCTS)),
  );

  ctx.scenario("F. Catalog pagination — no silent truncate");
  let titlePages = 0;
  const pagedTitlesAdmin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (!query.includes("SubscriptionMealCatalogTitles")) {
        throw new Error("unexpected");
      }
      titlePages += 1;
      const after = options?.variables?.after;
      if (!after) {
        return jsonResponse({
          data: {
            collection: {
              id: MEAL_COLLECTION_ID,
              products: {
                pageInfo: { hasNextPage: true, endCursor: "c1" },
                nodes: Array.from({ length: MEAL_CATALOG_PRODUCTS_PAGE_SIZE }, (_, i) => ({
                  id: `gid://shopify/Product/${i + 1}`,
                  title: `A${i}`,
                })),
              },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          collection: {
            id: MEAL_COLLECTION_ID,
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ id: "gid://shopify/Product/last", title: "Last" }],
            },
          },
        },
      });
    },
  };
  const titles = await fetchMealCatalogProductTitles(
    pagedTitlesAdmin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertTrue("titles pagination ok", titles.ok);
  if (titles.ok) {
    ctx.assertEqual(
      "titles aggregated across pages",
      titles.titles.length,
      MEAL_CATALOG_PRODUCTS_PAGE_SIZE + 1,
    );
  }
  ctx.assertEqual("titles pages fetched", titlePages, 2);

  let productPages = 0;
  const pagedProductsAdmin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (!query.includes("SubscriptionMealCatalogProducts")) {
        throw new Error("unexpected");
      }
      productPages += 1;
      const after = options?.variables?.after;
      const baseNode = {
        id: "gid://shopify/Product/x",
        title: "X",
        description: null,
        featuredImage: null,
        variants: { nodes: [] },
      };
      if (!after) {
        return jsonResponse({
          data: {
            collection: {
              products: {
                pageInfo: { hasNextPage: true, endCursor: "p1" },
                nodes: Array.from(
                  { length: MEAL_CATALOG_PRODUCTS_PAGE_SIZE },
                  (_, i) => ({
                    ...baseNode,
                    id: `gid://shopify/Product/${i + 1}`,
                    title: `P${i}`,
                  }),
                ),
              },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          collection: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ ...baseNode, id: "gid://shopify/Product/last", title: "Last" }],
            },
          },
        },
      });
    },
  };
  const products = await fetchMealCatalogProducts(
    pagedProductsAdmin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertEqual(
    "products aggregated",
    products.length,
    MEAL_CATALOG_PRODUCTS_PAGE_SIZE + 1,
  );
  ctx.assertEqual("product pages fetched", productPages, 2);
  ctx.assertTrue(
    "hard ceiling defined",
    MEAL_CATALOG_PRODUCTS_MAX_PAGES >= 2,
  );

  ctx.scenario("G. Source wiring / non-regression guards");
  const route = readRepoFile("app/routes/app.meals.new.tsx");
  const nav = readRepoFile("app/routes/app.tsx");
  const render = readRepoFile("app/features/meals/meals-create-render.tsx");
  const server = readRepoFile("app/features/meals/meals-create.server.ts");
  const catalog = readRepoFile("app/services/subscriptionMealCatalog.server.ts");
  const boxV2 = readRepoFile(
    "app/features/settings/settings-box-catalog-v2.server.ts",
  );

  ctx.assertTrue("route exports loader/action", route.includes("export const loader") && route.includes("export const action"));
  ctx.assertTrue("nav link present", nav.includes('/app/meals/new'));
  ctx.assertTrue("nav label FR", nav.includes("Créer un plat"));
  ctx.assertTrue("page title", render.includes("Créer un plat"));
  ctx.assertTrue("submit label", render.includes("Créer le plat"));
  ctx.assertTrue("double-submit disable", render.includes("disabled={formDisabled}"));
  ctx.assertTrue("tabs keep mounted", render.includes("hidden={activeObjective !== objective}"));
  const createStyles = readRepoFile("app/features/meals/meals-create-styles.ts");
  ctx.assertTrue(
    "responsive shell uses container queries",
    createStyles.includes("container-type: inline-size") &&
      createStyles.includes("meals-create-shell"),
  );
  ctx.assertTrue(
    "nutrition grid avoids fixed minmax overflow",
    createStyles.includes("minmax(0, 1fr)") &&
      !createStyles.includes("minmax(140px"),
  );
  ctx.assertTrue(
    "nutrition groups in UI",
    render.includes("Valeurs principales") &&
      render.includes("Informations complémentaires") &&
      render.includes("Valeurs pour une portion"),
  );
  ctx.assertTrue("uses productSet", server.includes("productSet"));
  ctx.assertTrue("uses getMealV2VariantSpecs", server.includes("getMealV2VariantSpecs"));
  ctx.assertTrue("uses applyMealNutritionMetafields", server.includes("applyMealNutritionMetafields"));
  ctx.assertTrue("uses unpublish helper", server.includes("unpublishProductFromOnlineStore"));
  ctx.assertTrue("collection last comment", server.includes("EN DERNIER") || server.includes("collectionAddProducts"));
  ctx.assertTrue("no selling plan attach", !server.includes("sellingPlanGroupAddProducts") && !server.includes("productJoinSellingPlanGroups"));
  ctx.assertTrue("catalog paginated", catalog.includes("MEAL_CATALOG_PRODUCTS_MAX_PAGES") && catalog.includes("endCursor"));
  ctx.assertTrue(
    "box V2 untouched pattern still create-only",
    boxV2.includes("CREATE-only via productSet"),
  );
  ctx.assertTrue(
    "image gated when scope missing",
    render.includes("Autoriser l’ajout de photos") ||
      render.includes("autorisation"),
  );
  ctx.assertTrue(
    "photo scope uses App Bridge client request",
    render.includes("requestMealImageWriteFilesScope") &&
      render.includes("getShopifyAppBridgeScopesApi"),
  );
  ctx.assertTrue(
    "photo scope reloads document after grant (no soft revalidate 401)",
    render.includes("reloadEmbeddedAdminAfterScopeChange") &&
      !render.includes("revalidator.revalidate()"),
  );
  ctx.assertTrue(
    "photo scope button is type=button (no Form POST redirect)",
    render.includes('type="button"') &&
      render.includes("handleRequestPhotoScope"),
  );
  ctx.assertFalse(
    "route action must not call server scopes.request for photos",
    route.includes("scopes.request("),
  );
  ctx.assertTrue(
    "createAttemptId hidden field",
    render.includes('name="createAttemptId"'),
  );
  ctx.assertTrue(
    "attempt metafield wired",
    server.includes("MEAL_CREATE_ATTEMPT_METAFIELD") &&
      server.includes("findMealProductOwnedByCreateAttempt"),
  );
  ctx.assertTrue(
    "product metafield types confirmed list/single",
    MEAL_PRODUCT_METAFIELD_TYPES.ingredients ===
      "list.single_line_text_field" &&
      MEAL_PRODUCT_METAFIELD_TYPES.allergenes ===
        "list.single_line_text_field" &&
      MEAL_PRODUCT_METAFIELD_TYPES.badge_1 === "single_line_text_field",
  );

  ctx.scenario("H. Product metafields serialization + write");
  const productValues = buildMealProductMetafieldValues({
    ingredients: "poulet, riz,  riz",
    allergenes: "Gluten, lait, GLUTEN",
    badge1: "Bio",
    badge2: " ",
    badge3: "Léger",
  });
  ctx.assertEqual(
    "ingredients deduped",
    productValues.ingredients.join("|"),
    "poulet|riz",
  );
  ctx.assertEqual(
    "allergenes deduped normalized",
    productValues.allergenes.join("|"),
    "Gluten|lait",
  );
  ctx.assertNull("blank badge2 omitted", productValues.badge2);
  const productInputs = buildMealProductMetafieldsSetInputs(
    PRODUCT_ID,
    productValues,
  );
  ctx.assertEqual("writes 4 metafields", productInputs.length, 4);
  const ingredientsValue = productInputs.find(
    (entry) => entry.key === "ingredients",
  )?.value;
  ctx.assertEqual(
    "ingredients JSON list",
    ingredientsValue,
    serializeMealListMetafieldValue(["poulet", "riz"]),
  );
  ctx.assertEqual(
    "catalog parser ingredients",
    parseListMetafield(ingredientsValue).join("|"),
    "poulet|riz",
  );
  ctx.assertEqual(
    "catalog parser allergenes",
    parseAllergenesMetafield(
      productInputs.find((entry) => entry.key === "allergenes")?.value,
    ).join("|"),
    "gluten|lait",
  );
  ctx.assertEqual(
    "catalog parser badges",
    parseMealBadges(
      productInputs.find((entry) => entry.key === "badge_1")?.value,
      null,
      productInputs.find((entry) => entry.key === "badge_3")?.value,
    ).join("|"),
    "Bio|Léger",
  );

  const emptyProductInputs = buildMealProductMetafieldsSetInputs(PRODUCT_ID, {
    ingredients: [],
    allergenes: [],
    badge1: null,
    badge2: null,
    badge3: null,
  });
  ctx.assertEqual("empty product fields skip write", emptyProductInputs.length, 0);

  const productMock = createMealCreateMockAdmin();
  const withProductFields = await createMealProductForCollection({
    admin: productMock.admin,
    formData: buildValidFormData({
      ingredients: "poulet, curry",
      allergenes: "Gluten",
      badge1: "Bio",
    }),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertTrue("create with product metafields ok", withProductFields.ok);
  ctx.assertTrue(
    "SaveMealProductMetafields called",
    productMock.calls.some((call) =>
      call.query.includes("SaveMealProductMetafields"),
    ),
  );
  ctx.assertEqual(
    "stored ingredients",
    productMock.productMetafieldStore.ingredients,
    '["poulet","curry"]',
  );

  const productFail = createMealCreateMockAdmin({
    productMetafieldsUserErrors: [{ message: "product metafield boom" }],
  });
  const productFailResult = await createMealProductForCollection({
    admin: productFail.admin,
    formData: buildValidFormData({ ingredients: "poulet" }),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("product metafield failure", productFailResult.ok);
  ctx.assertFalse(
    "no collection after product metafield fail",
    productFail.calls.some((call) =>
      call.query.includes("AddMealToCollection"),
    ),
  );

  ctx.scenario("I. Image scope App Bridge consent outcomes");
  ctx.assertEqual(
    "client/server write_files constant aligned",
    MEAL_IMAGE_SCOPE_CLIENT,
    MEAL_IMAGE_OPTIONAL_SCOPE,
  );
  ctx.assertTrue(
    "hasMealImageWriteFilesScope true",
    hasMealImageWriteFilesScope(["write_products", "write_files"]),
  );
  ctx.assertFalse(
    "hasMealImageWriteFilesScope false",
    hasMealImageWriteFilesScope(["write_products"]),
  );

  const grantedOutcome = interpretMealImageScopeRequestResult({
    result: "granted-all",
    detail: { granted: ["write_files", "write_products"] },
  });
  ctx.assertEqual("granted-all → granted", grantedOutcome.kind, "granted");

  const grantedUnconfirmed = interpretMealImageScopeRequestResult({
    result: "granted-all",
    detail: { granted: ["write_products"] },
  });
  ctx.assertEqual(
    "granted-all without write_files → error",
    grantedUnconfirmed.kind,
    "error",
  );

  const declinedOutcome = interpretMealImageScopeRequestResult({
    result: "declined-all",
    detail: { granted: [] },
  });
  ctx.assertEqual("declined-all → declined", declinedOutcome.kind, "declined");

  const unavailable = await requestMealImageWriteFilesScope(null);
  ctx.assertEqual("null scopes api → unavailable", unavailable.kind, "unavailable");
  ctx.assertTrue(
    "unavailable message constant",
    MEAL_IMAGE_SCOPE_UNAVAILABLE_MESSAGE.includes("Rechargez"),
  );

  const alreadyApi = {
    query: async () => ({ granted: ["write_files"] }),
    request: async () => {
      throw new Error("request should not run when already granted");
    },
  };
  const already = await requestMealImageWriteFilesScope(alreadyApi);
  ctx.assertEqual("already granted skips modal", already.kind, "already_granted");

  let requestCalled = false;
  const acceptApi = {
    query: async () => ({ granted: [] as string[] }),
    request: async (scopes: readonly string[]) => {
      requestCalled = true;
      ctx.assertEqual("requests write_files only", scopes.join(","), "write_files");
      return {
        result: "granted-all" as const,
        detail: { granted: ["write_files"] },
      };
    },
  };
  const accepted = await requestMealImageWriteFilesScope(acceptApi);
  ctx.assertTrue("request invoked on missing scope", requestCalled);
  ctx.assertEqual("accept → granted", accepted.kind, "granted");

  const declineApi = {
    query: async () => ({ granted: [] as string[] }),
    request: async () => ({
      result: "declined-all" as const,
      detail: { granted: [] as string[] },
    }),
  };
  const declined = await requestMealImageWriteFilesScope(declineApi);
  ctx.assertEqual("merchant decline → declined", declined.kind, "declined");
  ctx.assertTrue(
    "decline message readable",
    MEAL_IMAGE_SCOPE_DECLINED_MESSAGE.includes("refusée"),
  );

  const networkApi = {
    query: async () => ({ granted: [] as string[] }),
    request: async () => {
      throw new Error("network down");
    },
  };
  const networkFail = await requestMealImageWriteFilesScope(networkApi);
  ctx.assertEqual("network throw → error", networkFail.kind, "error");
  if (networkFail.kind === "error") {
    ctx.assertEqual("network error message kept", networkFail.message, "network down");
  }

  ctx.assertEqual(
    "reload helper re-exported",
    typeof reloadEmbeddedAdminAfterScopeChange,
    "function",
  );
  ctx.assertEqual(
    "shared reload helper available",
    typeof reloadShared,
    "function",
  );
  const sharedGranted = interpretOptionalScopeRequestResult("write_files", {
    result: "granted-all",
    detail: { granted: ["write_files"] },
  });
  ctx.assertEqual(
    "shared helper granted-all",
    sharedGranted.kind,
    "granted",
  );

  ctx.scenario("I2. Image upload + validation + failures");
  const badMime = validateMealImageFile({
    name: "x.txt",
    type: "text/plain",
    size: 12,
  } as File);
  ctx.assertFalse("rejects non-image mime", badMime.ok);

  const tooBig = validateMealImageFile({
    name: "x.jpg",
    type: "image/jpeg",
    size: 9 * 1024 * 1024,
  } as File);
  ctx.assertFalse("rejects oversized image", tooBig.ok);

  const noFilesScope = await createMealProductForCollection({
    admin: createMealCreateMockAdmin().admin,
    formData: (() => {
      const form = buildValidFormData();
      form.set(
        "image",
        new File(["fake"], "meal.jpg", { type: "image/jpeg" }),
      );
      return form;
    })(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("image without write_files refused", noFilesScope.ok);
  ctx.assertNull("no create without write_files", noFilesScope.trackingProductId);

  const imageMock = createMealCreateMockAdmin();
  const fetchImpl: typeof fetch = async () =>
    ({ ok: true, status: 201 }) as Response;
  const imageOk = await createMealProductForCollection({
    admin: imageMock.admin,
    formData: (() => {
      const form = buildValidFormData();
      form.set(
        "image",
        new File(["fake-bytes"], "meal.jpg", { type: "image/jpeg" }),
      );
      return form;
    })(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE, MEAL_IMAGE_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
    fetchImpl,
  });
  ctx.assertTrue("image happy path ok", imageOk.ok);
  ctx.assertTrue(
    "staged upload called",
    imageMock.calls.some((call) => call.query.includes("StageMealProductImage")),
  );
  ctx.assertTrue(
    "productUpdate media attach called",
    imageMock.calls.some(
      (call) =>
        call.query.includes("AttachMealProductImage") &&
        call.query.includes("productUpdate"),
    ),
  );
  const attachVars = imageMock.calls.find((call) =>
    call.query.includes("AttachMealProductImage"),
  )?.variables as
    | { product?: Record<string, unknown>; media?: unknown[] }
    | undefined;
  ctx.assertTrue(
    "productUpdate only sends id (no variants wipe)",
    Boolean(
      attachVars?.product &&
        Object.keys(attachVars.product).length === 1 &&
        attachVars.product.id === PRODUCT_ID,
    ),
  );
  ctx.assertFalse(
    "deprecated productCreateMedia unused",
    imageMock.calls.some((call) => call.query.includes("productCreateMedia(")),
  );

  const uploadFailFetch: typeof fetch = async () => {
    throw new Error("network");
  };
  const uploadFail = await createMealProductForCollection({
    admin: createMealCreateMockAdmin().admin,
    formData: (() => {
      const form = buildValidFormData();
      form.set(
        "image",
        new File(["fake"], "meal.jpg", { type: "image/jpeg" }),
      );
      return form;
    })(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE, MEAL_IMAGE_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
    fetchImpl: uploadFailFetch,
  });
  ctx.assertFalse("upload network failure", uploadFail.ok);
  ctx.assertEqual("tracking after upload fail", uploadFail.trackingProductId, PRODUCT_ID);

  const mediaFail = createMealCreateMockAdmin({
    mediaUserErrors: [{ message: "media boom" }],
  });
  const mediaFailResult = await createMealProductForCollection({
    admin: mediaFail.admin,
    formData: (() => {
      const form = buildValidFormData();
      form.set(
        "image",
        new File(["fake"], "meal.jpg", { type: "image/jpeg" }),
      );
      return form;
    })(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE, MEAL_IMAGE_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
    fetchImpl,
  });
  ctx.assertFalse("media attach failure", mediaFailResult.ok);
  ctx.assertFalse(
    "no collection after media fail",
    mediaFail.calls.some((call) => call.query.includes("AddMealToCollection")),
  );

  ctx.scenario("J. Post-ACTIVE publication guard + idempotent retry");
  const afterActiveFail = createMealCreateMockAdmin({
    unpublishAfterActivePublished: true,
  });
  const afterActiveResult = await createMealProductForCollection({
    admin: afterActiveFail.admin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("post-ACTIVE unpublish failure", afterActiveResult.ok);
  ctx.assertFalse(
    "no collection when post-ACTIVE publish guard fails",
    afterActiveFail.calls.some((call) =>
      call.query.includes("AddMealToCollection"),
    ),
  );

  const resumeDone = createMealCreateMockAdmin({
    alreadyInCollection: true,
    seedCreateAttemptId: CREATE_ATTEMPT_ID,
  });
  const resumeResult = await createMealProductForCollection({
    admin: resumeDone.admin,
    formData: buildValidFormData({ resumeProductId: PRODUCT_ID }),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertTrue("idempotent resume success", resumeResult.ok);
  ctx.assertFalse(
    "idempotent resume skips productSet CREATE",
    resumeDone.calls.some((call) =>
      call.query.includes("CreateMealCatalogProduct"),
    ),
  );
  ctx.assertTrue(
    "idempotent message",
    resumeResult.message.includes("déjà dans le catalogue"),
  );

  ctx.scenario("K. Idempotence — createAttemptId ownership");

  // Timeout after productSet CREATE: resume by matching create_attempt_id (not title alone).
  const orphanVariants = createdVariants();
  const orphanMock = createMealCreateMockAdmin({
    skipProductSet: true,
    seedCreateAttemptId: CREATE_ATTEMPT_ID,
  });
  const orphanAdmin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("FindMealCreateAttemptByTitle")) {
        return jsonResponse({
          data: {
            products: {
              nodes: [
                {
                  id: PRODUCT_ID,
                  title: "Poulet curry maison",
                  status: "DRAFT",
                  createAttemptMetafield: { value: CREATE_ATTEMPT_ID },
                  collections: { nodes: [] },
                  variants: { nodes: orphanVariants },
                },
              ],
            },
          },
        });
      }
      return orphanMock.admin.graphql(query, options);
    },
  };
  const orphanResult = await createMealProductForCollection({
    admin: orphanAdmin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertTrue("owned orphan draft resume ok", orphanResult.ok);
  ctx.assertEqual(
    "owned orphan resume tracking id",
    orphanResult.trackingProductId,
    PRODUCT_ID,
  );
  ctx.assertFalse(
    "owned orphan skips CREATE",
    orphanMock.calls.some((call) =>
      call.query.includes("CreateMealCatalogProduct"),
    ),
  );

  // Timeout after ACTIVE: owned ACTIVE product outside collection is resumed.
  const activeOrphanMock = createMealCreateMockAdmin({
    skipProductSet: true,
    seedCreateAttemptId: CREATE_ATTEMPT_ID,
  });
  const activeOrphanAdmin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("FindMealCreateAttemptByTitle")) {
        return jsonResponse({
          data: {
            products: {
              nodes: [
                {
                  id: PRODUCT_ID,
                  title: "Poulet curry maison",
                  status: "ACTIVE",
                  createAttemptMetafield: { value: CREATE_ATTEMPT_ID },
                  collections: { nodes: [] },
                  variants: { nodes: orphanVariants },
                },
              ],
            },
          },
        });
      }
      return activeOrphanMock.admin.graphql(query, options);
    },
  };
  const activeOrphanResult = await createMealProductForCollection({
    admin: activeOrphanAdmin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertTrue("owned ACTIVE orphan resume ok", activeOrphanResult.ok);
  ctx.assertEqual(
    "owned ACTIVE orphan tracking id",
    activeOrphanResult.trackingProductId,
    PRODUCT_ID,
  );

  // Manual homonym DRAFT without create_attempt_id — must NOT be adopted.
  const homonymMock = createMealCreateMockAdmin();
  const homonymAdmin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("FindMealCreateAttemptByTitle")) {
        return jsonResponse({
          data: {
            products: {
              nodes: [
                {
                  id: "gid://shopify/Product/manual-homonym",
                  title: "Poulet curry maison",
                  status: "DRAFT",
                  createAttemptMetafield: null,
                  collections: { nodes: [] },
                  variants: { nodes: orphanVariants },
                },
              ],
            },
          },
        });
      }
      return homonymMock.admin.graphql(query, options);
    },
  };
  const homonymResult = await createMealProductForCollection({
    admin: homonymAdmin,
    formData: buildValidFormData(),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertTrue("homonym ignored — create still ok", homonymResult.ok);
  ctx.assertTrue(
    "homonym triggers fresh CREATE",
    homonymMock.wasCreated(),
  );
  ctx.assertEqual(
    "fresh product id after ignoring homonym",
    homonymResult.trackingProductId,
    PRODUCT_ID,
  );

  // Foreign resumeProductId with mismatched attempt — refuse, do not mutate.
  const foreignMock = createMealCreateMockAdmin({
    skipProductSet: true,
    seedCreateAttemptId: FOREIGN_ATTEMPT_ID,
    alreadyInCollection: false,
  });
  const foreignResult = await createMealProductForCollection({
    admin: foreignMock.admin,
    formData: buildValidFormData({ resumeProductId: PRODUCT_ID }),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertFalse("foreign productId refused", foreignResult.ok);
  ctx.assertNull(
    "foreign refusal clears tracking",
    foreignResult.trackingProductId,
  );
  ctx.assertTrue(
    "foreign refusal mentions ownership",
    foreignResult.errors.some((error) =>
      error.includes("n’appartient pas à la tentative"),
    ),
  );
  ctx.assertFalse(
    "foreign product never added to collection",
    foreignMock.calls.some((call) =>
      call.query.includes("AddMealToCollection"),
    ),
  );

  // New submission with same title but different attempt id — CREATE (not adopt other).
  const otherAttemptMock = createMealCreateMockAdmin();
  const otherAttemptAdmin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("FindMealCreateAttemptByTitle")) {
        return jsonResponse({
          data: {
            products: {
              nodes: [
                {
                  id: "gid://shopify/Product/other-attempt",
                  title: "Poulet curry maison",
                  status: "DRAFT",
                  createAttemptMetafield: { value: FOREIGN_ATTEMPT_ID },
                  collections: { nodes: [] },
                  variants: { nodes: orphanVariants },
                },
              ],
            },
          },
        });
      }
      return otherAttemptMock.admin.graphql(query, options);
    },
  };
  const otherAttemptResult = await createMealProductForCollection({
    admin: otherAttemptAdmin,
    formData: buildValidFormData({ createAttemptId: CREATE_ATTEMPT_ID }),
    grantedScopes: [MEAL_PUBLICATION_OPTIONAL_SCOPE],
    mealCollectionId: MEAL_COLLECTION_ID,
    shop: "dev.myshopify.com",
  });
  ctx.assertTrue("different attempt creates new product", otherAttemptResult.ok);
  ctx.assertTrue(
    "different attempt does not adopt foreign draft",
    otherAttemptMock.wasCreated(),
  );

  // Pure finder: title match without attempt metafield → null.
  const finderAdmin = {
    graphql: async (query: string) => {
      if (query.includes("FindMealCreateAttemptByTitle")) {
        return jsonResponse({
          data: {
            products: {
              nodes: [
                {
                  id: "gid://shopify/Product/manual",
                  title: "Poulet curry maison",
                  status: "DRAFT",
                  createAttemptMetafield: null,
                  collections: { nodes: [] },
                  variants: { nodes: orphanVariants },
                },
              ],
            },
          },
        });
      }
      throw new Error(`unexpected ${query.slice(0, 80)}`);
    },
  };
  const finderMiss = await findMealProductOwnedByCreateAttempt(
    finderAdmin,
    "Poulet curry maison",
    CREATE_ATTEMPT_ID,
    MEAL_COLLECTION_ID,
  );
  ctx.assertTrue("finder ok without match", finderMiss.ok);
  if (finderMiss.ok) {
    ctx.assertNull("finder ignores title-only homonym", finderMiss.productId);
  }

  const titleOnlyDisabled = await findOrphanMealDraftByTitle(
    finderAdmin,
    "Poulet curry maison",
    MEAL_COLLECTION_ID,
  );
  ctx.assertFalse("title-only orphan helper disabled", titleOnlyDisabled.ok);

  const serverSource = readRepoFile("app/features/meals/meals-create.server.ts");
  const imageSource = readRepoFile("app/services/mealProductImage.server.ts");
  ctx.assertTrue(
    "attempt-owned finder wired",
    serverSource.includes("findMealProductOwnedByCreateAttempt"),
  );
  ctx.assertTrue(
    "create_attempt_id metafield constant",
    serverSource.includes('key: "create_attempt_id"'),
  );
  ctx.assertTrue(
    "image uses productUpdate not productSet.files",
    imageSource.includes("productUpdate") &&
      !imageSource.includes("productCreateMedia(") &&
      !imageSource.includes("files:"),
  );
  ctx.assertTrue(
    "image docs warn against productSet files wipe",
    imageSource.includes("list replace") ||
      imageSource.includes("does not replace"),
  );

  return finishSuite("118-meal-create", ctx);
};

process.exit(await run());
