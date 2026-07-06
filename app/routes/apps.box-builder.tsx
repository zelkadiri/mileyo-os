import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getCollectionProducts,
  toBuilderMeals,
  toBuilderProducts,
} from "../features/builder/builder-catalog.server";
import { renderBuilder, renderMessage } from "../features/builder/builder-render";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim();

  if (!shop) {
    return renderMessage(
      "Boutique introuvable. Ouvrez ce builder via le proxy d’application Shopify.",
    );
  }

  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings) {
    return renderMessage(
      "Configuration manquante. Sélectionnez les collections de box et de plats dans l’administration Mileyo.",
      shop,
    );
  }

  if (!settings.boxCollectionId || !settings.mealCollectionId) {
    return renderMessage(
      "Configuration incomplète. Sélectionnez une collection de box et une collection de plats dans les réglages.",
      shop,
    );
  }

  const { admin } = await unauthenticated.admin(shop);
  const [boxProducts, mealProducts] = await Promise.all([
    getCollectionProducts(admin, settings.boxCollectionId),
    getCollectionProducts(admin, settings.mealCollectionId),
  ]);

  return renderBuilder({
    boxes: toBuilderProducts(boxProducts),
    meals: toBuilderMeals(mealProducts),
  });
};
