import type { LoaderFunctionArgs } from "react-router";

import { loadPreparationPageData } from "../features/preparation/preparation-data.server";

export { default } from "../features/preparation/preparation-render";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadPreparationPageData(request);
