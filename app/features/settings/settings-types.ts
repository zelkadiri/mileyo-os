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
        field?: string[] | null;
        message: string;
      }[];
    };
  };
};

export type SettingsActionData = {
  errors?: string[];
  message?: string;
  ok: boolean;
};

export type SettingsBoxProduct = ShopifyProduct & {
  configuredMealCount: number | null;
};
