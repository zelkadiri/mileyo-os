/**
 * Business regression — preparation delivery date archive (chip nav).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  __resetPreparationArchiveTestDb,
  __setPreparationArchiveTestDb,
  archivePreparationDeliveryDate,
  archivePreparationDeliveryDateAndResolveRedirect,
  canArchivePreparationDeliveryDate,
  filterVisiblePreparationDates,
  getArchivedPreparationDeliveryDateSet,
  resolvePreparationArchiveRedirectPath,
} from "../../app/features/preparation/preparation-archive.server";
import type { UpcomingPreparationDate } from "../../app/features/preparation/preparation-types";
import { ARCHIVE_PREPARATION_DATE_INTENT } from "../../app/features/preparation/preparation-types";
import { parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepo = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const cutoffStub = {
  deadlineLabel: null as string | null,
  isKnown: true,
  isPassed: true,
};

const chip = (
  scheduledDeliveryDate: string,
  orderCount = 1,
): UpcomingPreparationDate => ({
  cutoff: cutoffStub,
  orderCount,
  scheduledDeliveryDate: parseDeliveryDate(scheduledDeliveryDate)!,
});

type StateRow = {
  archivedAt: Date | null;
  id: string;
  scheduledDeliveryDate: string;
  shop: string;
};

const createArchiveMemoryDb = (initial: StateRow[] = []) => {
  const rows = initial.map((row) => ({ ...row }));
  let boxOrderTouched = false;

  return {
    boxOrder: {
      delete: async () => {
        boxOrderTouched = true;
        throw new Error("BoxOrder must not be touched");
      },
      update: async () => {
        boxOrderTouched = true;
        throw new Error("BoxOrder must not be touched");
      },
      updateMany: async () => {
        boxOrderTouched = true;
        throw new Error("BoxOrder must not be touched");
      },
    },
    preparationDeliveryDateState: {
      findMany: async ({
        where,
      }: {
        select: { scheduledDeliveryDate: true };
        where: { archivedAt: { not: null }; shop: string };
      }) =>
        rows
          .filter(
            (row) =>
              row.shop === where.shop &&
              row.archivedAt != null,
          )
          .map((row) => ({
            scheduledDeliveryDate: row.scheduledDeliveryDate,
          })),
      upsert: async ({
        create,
        update,
        where,
      }: {
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
      }) => {
        const key = where.shop_scheduledDeliveryDate;
        const existing = rows.find(
          (row) =>
            row.shop === key.shop &&
            row.scheduledDeliveryDate === key.scheduledDeliveryDate,
        );

        if (existing) {
          existing.archivedAt = update.archivedAt;
          return existing;
        }

        const created = {
          archivedAt: create.archivedAt,
          id: `state-${rows.length + 1}`,
          scheduledDeliveryDate: create.scheduledDeliveryDate,
          shop: create.shop,
        };
        rows.push(created);
        return created;
      },
    },
    rows,
    wasBoxOrderTouched: () => boxOrderTouched,
  };
};

export default async function run() {
  const ctx = createBusinessTestContext("107-preparation-delivery-date-archive");

  ctx.scenario("Source — persistence + pas de mutation BoxOrder");
  const schema = readRepo("prisma/schema.prisma");
  const migration = readRepo(
    "prisma/migrations/20260929190000_add_preparation_delivery_date_state/migration.sql",
  );
  const dataServer = readRepo(
    "app/features/preparation/preparation-data.server.ts",
  );
  const dayDataFn = readRepo(
    "app/features/preparation/preparation-data.server.ts",
  );
  ctx.assertTrue(
    "PreparationDeliveryDateState model exists",
    schema.includes("model PreparationDeliveryDateState"),
  );
  ctx.assertTrue(
    "unique (shop, scheduledDeliveryDate)",
    schema.includes("@@unique([shop, scheduledDeliveryDate])") &&
      schema.includes("PreparationDeliveryDateState"),
  );
  ctx.assertTrue(
    "migration creates table",
    migration.includes('CREATE TABLE "PreparationDeliveryDateState"'),
  );
  ctx.assertTrue(
    "getPreparationDayData has no archive filter",
    !/getPreparationDayData[\s\S]*archivedAt/.test(
      dayDataFn.slice(
        dayDataFn.indexOf("export const getPreparationDayData"),
        dayDataFn.indexOf("export const getUpcomingPreparationDates"),
      ),
    ),
  );
  ctx.assertTrue(
    "loader filters chips via archived set",
    dataServer.includes("filterVisiblePreparationDates") &&
      dataServer.includes("getArchivedPreparationDeliveryDateSet"),
  );
  ctx.assertTrue(
    "intent constant stable",
    ARCHIVE_PREPARATION_DATE_INTENT === "archive_preparation_delivery_date",
  );

  ctx.scenario("Date passée non archivée reste visible dans les pastilles");
  const pastA = chip("2026-09-18");
  const pastB = chip("2026-09-25");
  const future = chip("2026-10-02");
  const visible = filterVisiblePreparationDates(
    [pastA, pastB, future],
    new Set(),
  );
  ctx.assertEqual("3 dates visibles sans archive", visible.length, 3);
  ctx.assertEqual(
    "past non archivée présente",
    visible.some((d) => d.scheduledDeliveryDate === "2026-09-18"),
    true,
  );

  ctx.scenario("Date archivée absente des pastilles");
  const afterArchive = filterVisiblePreparationDates(
    [pastA, pastB, future],
    new Set(["2026-09-18"]),
  );
  ctx.assertEqual("2 dates visibles après archive", afterArchive.length, 2);
  ctx.assertEqual(
    "date archivée absente des pastilles",
    afterArchive.some((d) => d.scheduledDeliveryDate === "2026-09-18"),
    false,
  );
  ctx.assertEqual(
    "autre date passée toujours visible",
    afterArchive.some((d) => d.scheduledDeliveryDate === "2026-09-25"),
    true,
  );

  ctx.scenario("Date future / aujourd’hui non archivable");
  const fixedNow = new Date("2026-09-29T12:00:00.000Z");
  ctx.assertEqual(
    "past archivable",
    canArchivePreparationDeliveryDate("2026-09-25", fixedNow),
    true,
  );
  ctx.assertEqual(
    "today non archivable",
    canArchivePreparationDeliveryDate("2026-09-29", fixedNow),
    false,
  );
  ctx.assertEqual(
    "future non archivable",
    canArchivePreparationDeliveryDate("2026-10-02", fixedNow),
    false,
  );

  ctx.scenario("Redirect après archivage — première non archivée, sinon /app/preparation");
  ctx.assertEqual(
    "redirect vers première restante",
    resolvePreparationArchiveRedirectPath(afterArchive),
    "/app/preparation?date=2026-09-25",
  );
  ctx.assertEqual(
    "fallback propre sans inventer today",
    resolvePreparationArchiveRedirectPath([]),
    "/app/preparation",
  );

  ctx.scenario("Archivage persistant + isolation shop/date + BoxOrder intact");
  const memoryDb = createArchiveMemoryDb([
    {
      archivedAt: new Date("2026-09-20T10:00:00.000Z"),
      id: "other-shop",
      scheduledDeliveryDate: "2026-09-18",
      shop: "other.myshopify.com",
    },
  ]);
  __setPreparationArchiveTestDb(memoryDb as never);

  try {
    const shop = "mileyo.myshopify.com";
    const before = await getArchivedPreparationDeliveryDateSet(shop);
    ctx.assertEqual("shop A sans archive au départ", before.size, 0);

    const result = await archivePreparationDeliveryDateAndResolveRedirect({
      now: fixedNow,
      scheduledDeliveryDateInput: "2026-09-18",
      shop,
      visibleDatesBeforeArchive: [pastA, pastB, future],
    });

    ctx.assertEqual("archive ok", result.ok, true);
    if (result.ok) {
      ctx.assertEqual(
        "redirect vers 2026-09-25",
        result.redirectTo,
        "/app/preparation?date=2026-09-25",
      );
    }

    const after = await getArchivedPreparationDeliveryDateSet(shop);
    ctx.assertEqual("archive persistée pour shop A", after.has("2026-09-18"), true);
    ctx.assertEqual(
      "autre date du même shop non archivée",
      after.has("2026-09-25"),
      false,
    );

    const otherShop = await getArchivedPreparationDeliveryDateSet(
      "other.myshopify.com",
    );
    ctx.assertEqual(
      "isolation shop — other garde sa propre archive",
      otherShop.has("2026-09-18"),
      true,
    );
    ctx.assertEqual(
      "isolation shop — archive A n’apparaît pas chez other via set size",
      otherShop.size,
      1,
    );

    await archivePreparationDeliveryDate({
      now: fixedNow,
      scheduledDeliveryDate: parseDeliveryDate("2026-09-25")!,
      shop,
    });
    const afterSecond = await getArchivedPreparationDeliveryDateSet(shop);
    ctx.assertEqual(
      "isolation par date — 2 archives distinctes",
      afterSecond.size,
      2,
    );

    const refuseFuture = await archivePreparationDeliveryDateAndResolveRedirect({
      now: fixedNow,
      scheduledDeliveryDateInput: "2026-10-02",
      shop,
      visibleDatesBeforeArchive: [future],
    });
    ctx.assertEqual("future refusée", refuseFuture.ok, false);
    if (!refuseFuture.ok) {
      ctx.assertEqual("reason not_past", refuseFuture.reason, "not_past");
    }

    ctx.assertEqual(
      "aucune BoxOrder touchée",
      memoryDb.wasBoxOrderTouched(),
      false,
    );
  } finally {
    __resetPreparationArchiveTestDb();
  }

  ctx.scenario("UI / route — action serveur + bouton Archiver");
  const render = readRepo("app/features/preparation/preparation-render.tsx");
  const route = readRepo("app/routes/app.preparation.tsx");
  const actions = readRepo(
    "app/features/preparation/preparation-actions.server.ts",
  );
  const dbServer = readRepo("app/db.server.ts");
  ctx.assertTrue(
    "route exporte action",
    route.includes("handlePreparationAction") && route.includes("export const action"),
  );
  ctx.assertTrue(
    "action utilise intent archive",
    actions.includes("ARCHIVE_PREPARATION_DATE_INTENT"),
  );
  ctx.assertTrue(
    "bouton Archiver conditionné par canArchiveSelectedDate",
    render.includes("canArchiveSelectedDate") && render.includes("Archiver"),
  );
  ctx.assertTrue(
    "Form method=post pour archive",
    render.includes('method="post"') &&
      render.includes("ARCHIVE_PREPARATION_DATE_INTENT"),
  );
  ctx.assertTrue(
    "db.server détecte client Prisma hors sync DMMF (évite stale HMR)",
    dbServer.includes("isPrismaClientInSyncWithGeneratedSchema") &&
      dbServer.includes("Prisma.dmmf.datamodel.models"),
  );

  ctx.scenario(
    "INTÉGRATION DB — vrai client Prisma + findMany archive + loader shop",
  );
  // Must not use the in-memory mock — that is exactly why 107 missed the DEV crash.
  __resetPreparationArchiveTestDb();

  const { default: realDb } = await import("../../app/db.server");
  const {
    getArchivedPreparationDeliveryDateSet: getArchivedReal,
  } = await import("../../app/features/preparation/preparation-archive.server");
  const { loadPreparationPageDataForShop } = await import(
    "../../app/features/preparation/preparation-data.server"
  );

  ctx.assertEqual(
    "db.preparationDeliveryDateState est défini sur le client généré",
    typeof realDb.preparationDeliveryDateState,
    "object",
  );
  ctx.assertEqual(
    "db.preparationDeliveryDateState.findMany est une fonction",
    typeof realDb.preparationDeliveryDateState.findMany,
    "function",
  );

  let findManyOk = false;
  let findManyError: string | null = null;
  try {
    await realDb.preparationDeliveryDateState.findMany({
      select: { scheduledDeliveryDate: true },
      take: 1,
      where: {
        archivedAt: { not: null },
        shop: "__mileyo_archive_integration_probe__",
      },
    });
    findManyOk = true;
  } catch (error) {
    findManyError =
      error instanceof Error ? error.message : String(error);
  }

  ctx.assertEqual(
    "findMany réel sur PreparationDeliveryDateState ne throw pas",
    findManyOk,
    true,
  );
  if (findManyError) {
    ctx.assertEqual("findMany error detail", findManyError, null);
  }

  const archivedFromReal = await getArchivedReal(
    "__mileyo_archive_integration_probe__",
  );
  ctx.assertEqual(
    "getArchivedPreparationDeliveryDateSet (DB réelle) retourne un Set",
    archivedFromReal instanceof Set,
    true,
  );

  const stubAdmin = {
    graphql: async () =>
      new Response(JSON.stringify({ data: {} }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
  };

  let loaderOk = false;
  let loaderError: string | null = null;
  let pageData: Awaited<
    ReturnType<typeof loadPreparationPageDataForShop>
  > | null = null;

  try {
    pageData = await loadPreparationPageDataForShop({
      admin: stubAdmin,
      requestUrl: "https://admin.example/app/preparation",
      shop: "__mileyo_archive_integration_probe__",
    });
    loaderOk = true;
  } catch (error) {
    loaderError = error instanceof Error ? error.message : String(error);
  }

  ctx.assertEqual(
    "loadPreparationPageDataForShop (DB réelle) ne crash pas sur archive findMany",
    loaderOk,
    true,
  );
  if (loaderError) {
    ctx.assertEqual("loader error detail", loaderError, null);
  }
  ctx.assertEqual(
    "loader expose upcomingDates",
    Array.isArray(pageData?.upcomingDates),
    true,
  );
  ctx.assertEqual(
    "loader expose canArchiveSelectedDate",
    typeof pageData?.canArchiveSelectedDate,
    "boolean",
  );

  return finishSuite("107-preparation-delivery-date-archive", ctx);
};

try {
  process.exitCode = await run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
