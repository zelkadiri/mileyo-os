import db from "../../db.server";
import {
  isDeliveryDatePast,
  parseDeliveryDate,
  type DeliveryDateString,
} from "../../utils/deliveryDate";
import {
  ARCHIVE_PREPARATION_DATE_INTENT,
  type UpcomingPreparationDate,
} from "./preparation-types";

export { ARCHIVE_PREPARATION_DATE_INTENT };

type PreparationArchiveDb = {
  preparationDeliveryDateState: {
    findMany: (args: {
      select: { scheduledDeliveryDate: true };
      where: {
        archivedAt: { not: null };
        shop: string;
      };
    }) => Promise<Array<{ scheduledDeliveryDate: string }>>;
    upsert: (args: {
      create: {
        archivedAt: Date;
        scheduledDeliveryDate: string;
        shop: string;
      };
      update: { archivedAt: Date };
      where: {
        shop_scheduledDeliveryDate: {
          scheduledDeliveryDate: string;
          shop: string;
        };
      };
    }) => Promise<unknown>;
  };
};

let testDb: PreparationArchiveDb | null = null;

const resolveDb = (): PreparationArchiveDb => testDb ?? db;

/** @internal Mileyo business regression tests only. */
export const __setPreparationArchiveTestDb = (
  client: PreparationArchiveDb | null,
): void => {
  testDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetPreparationArchiveTestDb = (): void => {
  testDb = null;
};

export const canArchivePreparationDeliveryDate = (
  scheduledDeliveryDate: string | null | undefined,
  now: Date = new Date(),
): boolean => isDeliveryDatePast(scheduledDeliveryDate, now);

export const filterVisiblePreparationDates = <
  T extends { scheduledDeliveryDate: DeliveryDateString },
>(
  dates: T[],
  archivedDates: ReadonlySet<string>,
): T[] =>
  dates.filter((entry) => !archivedDates.has(entry.scheduledDeliveryDate));

export const resolvePreparationArchiveRedirectPath = (
  visibleDates: ReadonlyArray<{ scheduledDeliveryDate: string }>,
): string => {
  const next = visibleDates[0]?.scheduledDeliveryDate;

  if (next) {
    return `/app/preparation?date=${encodeURIComponent(next)}`;
  }

  return "/app/preparation";
};

export const getArchivedPreparationDeliveryDateSet = async (
  shop: string,
): Promise<Set<string>> => {
  const rows = await resolveDb().preparationDeliveryDateState.findMany({
    select: { scheduledDeliveryDate: true },
    where: {
      archivedAt: { not: null },
      shop,
    },
  });

  return new Set(
    rows
      .map((row) => parseDeliveryDate(row.scheduledDeliveryDate))
      .filter((date): date is DeliveryDateString => Boolean(date)),
  );
};

export const archivePreparationDeliveryDate = async ({
  now = new Date(),
  scheduledDeliveryDate,
  shop,
}: {
  now?: Date;
  scheduledDeliveryDate: DeliveryDateString;
  shop: string;
}): Promise<void> => {
  await resolveDb().preparationDeliveryDateState.upsert({
    create: {
      archivedAt: now,
      scheduledDeliveryDate,
      shop,
    },
    update: { archivedAt: now },
    where: {
      shop_scheduledDeliveryDate: {
        scheduledDeliveryDate,
        shop,
      },
    },
  });
};

export type ArchivePreparationDateResult =
  | {
      ok: true;
      redirectTo: string;
      scheduledDeliveryDate: DeliveryDateString;
    }
  | {
      ok: false;
      reason: "invalid_date" | "not_past";
    };

/**
 * Persist archive for one past delivery date and resolve post-archive navigation.
 * Does not touch BoxOrder. Visible chip list must be provided by the caller
 * (already filtered for other archives) so redirect never invents "today".
 */
export const archivePreparationDeliveryDateAndResolveRedirect = async ({
  now = new Date(),
  scheduledDeliveryDateInput,
  shop,
  visibleDatesBeforeArchive,
}: {
  now?: Date;
  scheduledDeliveryDateInput: string;
  shop: string;
  visibleDatesBeforeArchive: UpcomingPreparationDate[];
}): Promise<ArchivePreparationDateResult> => {
  const scheduledDeliveryDate = parseDeliveryDate(scheduledDeliveryDateInput);

  if (!scheduledDeliveryDate) {
    return { ok: false, reason: "invalid_date" };
  }

  if (!canArchivePreparationDeliveryDate(scheduledDeliveryDate, now)) {
    return { ok: false, reason: "not_past" };
  }

  await archivePreparationDeliveryDate({
    now,
    scheduledDeliveryDate,
    shop,
  });

  const visibleAfter = filterVisiblePreparationDates(
    visibleDatesBeforeArchive,
    new Set([scheduledDeliveryDate]),
  );

  return {
    ok: true,
    redirectTo: resolvePreparationArchiveRedirectPath(visibleAfter),
    scheduledDeliveryDate,
  };
};
