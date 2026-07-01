import type { LoaderFunctionArgs } from "react-router";

import { loadOrdersPageData } from "../features/orders/orders-data.server";

export { default } from "../features/orders/orders-render";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadOrdersPageData(request);
