import type {
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import { handleSubscriptionsAction } from "../features/subscriptions/subscriptions-actions.server";
import { loadSubscriptionsPageData } from "../features/subscriptions/subscriptions-data.server";

export { default } from "../features/subscriptions/subscriptions-render";

export const shouldRevalidate = () => true;

export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store, max-age=0, must-revalidate",
});

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return serverLoader();
}

clientLoader.hydrate = true as const;

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadSubscriptionsPageData(request);

export const action = async ({ request }: ActionFunctionArgs) =>
  handleSubscriptionsAction(request);
