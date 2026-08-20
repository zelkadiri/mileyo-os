export type ShopifyCollection = {
  handle: string;
  id: string;
  title: string;
};

export type ShopifyProduct = {
  featuredImage?: {
    altText?: string | null;
    url: string;
  } | null;
  handle: string;
  id: string;
  mealCountMetafield?: {
    value: string;
  } | null;
  publishedAt?: string | null;
  status?: string | null;
  title: string;
  variants: {
    nodes: {
      id: string;
      price?: string | null;
      title: string;
    }[];
  };
};

export type CollectionsResponse = {
  data?: {
    collections?: {
      nodes: ShopifyCollection[];
    };
  };
};

export type CollectionResponse = {
  data?: {
    collection?: ShopifyCollection | null;
  };
};

export type CollectionProductsResponse = {
  data?: {
    collection?: {
      products: {
        nodes: ShopifyProduct[];
      };
    } | null;
  };
};

export type BoxSellingPlanProduct = {
  id: string;
  metafield?: {
    value: string;
  } | null;
  sellingPlanGroups: {
    nodes: {
      id: string;
      name: string;
      sellingPlans: {
        nodes: {
          id: string;
          name: string;
        }[];
      };
    }[];
  };
  title: string;
  variants: {
    nodes: {
      id: string;
      price?: string | null;
    }[];
  };
};

export type BoxSellingPlanProductsResponse = {
  data?: {
    collection?: {
      products: {
        nodes: BoxSellingPlanProduct[];
      };
    } | null;
  };
};

export type SellingPlanMutationResponse = {
  data?: {
    sellingPlanGroupCreate?: {
      userErrors: {
        field?: string[] | null;
        message: string;
      }[];
    };
    sellingPlanGroupUpdate?: {
      userErrors: {
        field?: string[] | null;
        message: string;
      }[];
    };
  };
};

export type MetafieldDefinitionMutationResponse = {
  data?: {
    metafieldDefinitionCreate?: {
      createdDefinition?: {
        id: string;
      } | null;
      userErrors: {
        code?: string | null;
        field?: string[] | null;
        message: string;
      }[];
    };
  };
};

import type { MealNutritionImportPreview } from "../../utils/mealNutritionCsv";

export type SettingsActionData = {
  /** CSV body for meal nutrition template (Blob download client-side). */
  csv?: string;
  /** Unique per successful export so the client can re-download identical CSV. */
  downloadToken?: string;
  errors?: string[];
  filename?: string;
  message?: string;
  /** Variants successfully written on Apply. */
  nutritionImportAppliedCount?: number;
  /** Raw CSV retained after preview so Apply can revalidate server-side. */
  nutritionImportCsvText?: string;
  /** 14C preview (format + catalogue). */
  nutritionImportPreview?: MealNutritionImportPreview;
  ok: boolean;
};

export type SettingsBoxProduct = ShopifyProduct & {
  configuredMealCount: number | null;
};
