import type { SubscriptionObjective } from "../../constants/subscriptionObjective";
import type { BuilderDeliveryWindowOption } from "../../utils/deliveryDate";

export type { BuilderObjectiveOption } from "./builder-objective-options";
export type { BuilderDeliveryWindowOption } from "../../utils/deliveryDate";

/** Checkout-ready Box V2 option for the subscription-only builder. */
export type BuilderBoxOption = {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  objective: SubscriptionObjective;
  mealCount: number;
  price: string;
  sellingPlanId: string;
};

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

export type BuilderDeliveryConfig = {
  deliveryWindowOptions: BuilderDeliveryWindowOption[];
  timezone: string;
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

/** Objective-filtered meal portion for the subscription builder (V2). */
export type BuilderMealOption = {
  productId: string;
  variantId: string;
  title: string;
  objective: SubscriptionObjective;
  imageAlt: string;
  imageUrl: string | null;
  calories: number | null;
  proteins: number | null;
  carbs: number | null;
  fat: number | null;
  portionGrams: number | null;
  allergenes: string[];
  badges: string[];
  ingredients: string[];
};

export type CollectionProductsResponse = {
  data?: {
    collection?: {
      products: { nodes: ShopifyProduct[] };
    } | null;
  };
};
