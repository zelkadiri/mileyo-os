import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { handlePreparationAction } from "../features/preparation/preparation-actions.server";
import { loadPreparationPageData } from "../features/preparation/preparation-data.server";

export { default } from "../features/preparation/preparation-render";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadPreparationPageData(request);

export const action = async ({ request }: ActionFunctionArgs) =>
  handlePreparationAction(request);
