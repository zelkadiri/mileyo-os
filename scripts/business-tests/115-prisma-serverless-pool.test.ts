/**
 * Business regression — Prisma serverless pool hardening (P0 auth).
 *
 * Guards connection_limit defaults for Vercel + Supabase transaction pooler.
 * No DB writes. No billing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePrismaDatasourceUrl } from "../../app/db.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepoFile = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

const ctx = createBusinessTestContext("115-prisma-serverless-pool");

ctx.scenario("resolvePrismaDatasourceUrl — production default");
{
  const raw =
    "postgresql://postgres.ref:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
  const resolved = resolvePrismaDatasourceUrl(raw, "production");
  const url = new URL(resolved!);

  ctx.assertEqual(
    "ajoute connection_limit=1 si absent",
    url.searchParams.get("connection_limit"),
    "1",
  );
  ctx.assertEqual(
    "conserve pgbouncer=true",
    url.searchParams.get("pgbouncer"),
    "true",
  );
  ctx.assertEqual(
    "ne définit pas pool_timeout",
    url.searchParams.get("pool_timeout"),
    null,
  );
  ctx.assertEqual("conserve le host", url.hostname, "aws-1-eu-west-1.pooler.supabase.com");
  ctx.assertEqual("conserve le port 6543", url.port, "6543");
}

ctx.scenario("resolvePrismaDatasourceUrl — respect explicite");
{
  const raw =
    "postgresql://u:p@host:6543/postgres?pgbouncer=true&connection_limit=3";
  const resolved = resolvePrismaDatasourceUrl(raw, "production");
  const url = new URL(resolved!);

  ctx.assertEqual(
    "ne surcharge pas connection_limit explicite",
    url.searchParams.get("connection_limit"),
    "3",
  );
}

ctx.scenario("resolvePrismaDatasourceUrl — hors production");
{
  const raw =
    "postgresql://u:p@host:6543/postgres?pgbouncer=true";
  const resolved = resolvePrismaDatasourceUrl(raw, "development");

  ctx.assertEqual(
    "ne modifie pas l'URL hors production",
    resolved,
    raw,
  );
}

ctx.scenario("db.server — singleton global aussi en production");
{
  const source = readRepoFile("app/db.server.ts");

  ctx.assertTrue(
    "réutilise global.prismaGlobal sans early-return production",
    source.includes("global.prismaGlobal = createPrismaClient()") &&
      !source.includes(
        'if (process.env.NODE_ENV === "production") {\n    return createPrismaClient();',
      ) &&
      source.includes("resolvePrismaDatasourceUrl"),
  );
  ctx.assertTrue(
    "ne désactive pas pool_timeout",
    !source.includes("pool_timeout=0") && !source.includes('"pool_timeout", "0"'),
  );
  ctx.assertTrue(
    "n'augmente pas connection_limit au-delà de 1 par défaut",
    source.includes('set("connection_limit", "1")') &&
      !source.includes('set("connection_limit", "5")'),
  );
}

process.exitCode = finishSuite("115-prisma-serverless-pool", ctx);
