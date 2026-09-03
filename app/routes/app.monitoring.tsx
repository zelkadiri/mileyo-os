import type { LoaderFunctionArgs } from "react-router";

import { loadMonitoringPageData } from "../features/monitoring/monitoring-data.server";

export { default } from "../features/monitoring/monitoring-render";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadMonitoringPageData(request);
