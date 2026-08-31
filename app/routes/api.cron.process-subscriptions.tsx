import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { runProcessSubscriptionsCron } from "../services/processSubscriptionsCron.server";

export const loader = ({ request }: LoaderFunctionArgs) =>
  runProcessSubscriptionsCron(request);

export const action = ({ request }: ActionFunctionArgs) =>
  runProcessSubscriptionsCron(request);
