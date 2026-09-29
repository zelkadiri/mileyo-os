import { redirect } from "react-router";

import { authenticate } from "../../shopify.server";
import {
  archivePreparationDeliveryDateAndResolveRedirect,
  filterVisiblePreparationDates,
  getArchivedPreparationDeliveryDateSet,
} from "./preparation-archive.server";
import { getUpcomingPreparationDates } from "./preparation-data.server";
import { ARCHIVE_PREPARATION_DATE_INTENT } from "./preparation-types";

export { ARCHIVE_PREPARATION_DATE_INTENT };

export const handlePreparationAction = async (request: Request) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();

  if (intent !== ARCHIVE_PREPARATION_DATE_INTENT) {
    return redirect("/app/preparation");
  }

  const dateInput = String(formData.get("date") ?? "").trim();
  const allDates = await getUpcomingPreparationDates(shop);
  const archivedDates = await getArchivedPreparationDeliveryDateSet(shop);
  const visibleDatesBeforeArchive = filterVisiblePreparationDates(
    allDates,
    archivedDates,
  );

  const result = await archivePreparationDeliveryDateAndResolveRedirect({
    scheduledDeliveryDateInput: dateInput,
    shop,
    visibleDatesBeforeArchive,
  });

  if (!result.ok) {
    if (dateInput) {
      return redirect(
        `/app/preparation?date=${encodeURIComponent(dateInput)}`,
      );
    }

    return redirect("/app/preparation");
  }

  return redirect(result.redirectTo);
};
