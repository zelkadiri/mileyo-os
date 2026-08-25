import type { LoaderFunctionArgs } from "react-router";

import { loadEmailsPageData } from "../features/emails/emails-data.server";

export { default } from "../features/emails/emails-render";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadEmailsPageData(request);
