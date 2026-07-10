export type ShopifyProduct = {
  id: string;
  title: string;
  featuredImage?: { altText?: string | null; url: string } | null;
  mealCountMetafield?: {
    value: string;
  } | null;
  subscriptionPriceMetafield?: {
    value: string;
  } | null;
  caloriesMetafield?: { value: string } | null;
  badge1Metafield?: { value: string } | null;
  badge2Metafield?: { value: string } | null;
  badge3Metafield?: { value: string } | null;
  allergenesMetafield?: { value: string } | null;
  ingredientsMetafield?: { value: string } | null;
  sellingPlanGroups?: {
    nodes: {
      name: string;
      sellingPlans: {
        nodes: {
          id: string;
          name: string;
        }[];
      };
    }[];
  };
  variants: {
    nodes: {
      id: string;
      price?: string | null;
      title: string;
    }[];
  };
};

export type BuilderProduct = {
  id: string;
  imageAlt: string;
  imageUrl: string | null;
  mealCount: number | null;
  sellingPlanId: string | null;
  subscriptionPrice: string | null;
  title: string;
  variantId: string;
  variantPrice: string | null;
  variantTitle: string;
};

export type BuilderMeal = {
  allergenes: string[];
  badges: string[];
  calories: number | null;
  id: string;
  imageAlt: string;
  imageUrl: string | null;
  ingredients: string[];
  title: string;
  variantId: string;
  variantPrice: string | null;
  variantTitle: string;
};

export type CollectionProductsResponse = {
  data?: {
    collection?: {
      products: { nodes: ShopifyProduct[] };
    } | null;
  };
};
