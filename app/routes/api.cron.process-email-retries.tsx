import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { runProcessEmailRetriesCron } from "../services/email/processEmailRetriesCron.server";

export const loader = ({ request }: LoaderFunctionArgs) =>
  runProcessEmailRetriesCron(request);

export const action = ({ request }: ActionFunctionArgs) =>
  runProcessEmailRetriesCron(request);
