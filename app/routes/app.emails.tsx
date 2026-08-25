import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { handleEmailsAction } from "../features/emails/emails-actions.server";
import { loadEmailsPageData } from "../features/emails/emails-data.server";
import { authenticate } from "../shopify.server";

export { default } from "../features/emails/emails-render";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadEmailsPageData(request);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return handleEmailsAction({ request, shop: session.shop });
};
