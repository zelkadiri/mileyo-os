export type ShopifyProduct = {
  id: string;
  title: string;
  featuredImage?: { altText?: string | null; url: string } | null;
  metafield?: {
    value: string;
  } | null;
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
  sellingPlanId: string | null;
  subscriptionPrice: string | null;
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
