/**
 * Read-only unified search index health check.
 *
 * Compares search.v_search_*_source (indexer eligibility) against
 * search.search_documents. Does not modify data or rebuild the index.
 *
 * Usage (from repo root):
 *   npm --prefix apps/api run verify:search-index
 *   npm --prefix apps/api run search:health
 *   npx tsx apps/api/src/scripts/verify-search-index.ts
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "../..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { prisma } from "../db/prisma.js";
import {
    formatSearchHealthTimestamp,
    hasSearchIndexHealthIssues,
    printSearchIndexHealthTable,
    runSearchIndexHealthCheck,
    toHealthCount,
} from "../modules/search/search-index-health.js";

type DetailRow = {
    label: string;
    row_count: bigint | number;
};

type IndexRunRow = {
    id: bigint | number;
    status: string;
    started_at: Date;
    finished_at: Date | null;
    entity_counts: unknown;
};

const SQL_PATH = resolve(
    repoRoot,
    "infrastructure/database/verification/verify_search_index_health.sql",
);

const TRANSPORT_DETAIL_QUERY = `
SELECT
    'transport.stops (indexer eligibility)' AS label,
    count(*)::bigint AS row_count
FROM search.v_search_bus_stops_source
UNION ALL
SELECT
    'transport.stops (active, not deleted, has geom)' AS label,
    count(*)::bigint AS row_count
FROM transport.stops s
WHERE s.deleted_at IS NULL
  AND s.is_active = true
  AND s.geom IS NOT NULL
  AND NOT st_isempty(s.geom)
UNION ALL
SELECT
    'search.search_documents (entity_type = transport_stop)' AS label,
    count(*)::bigint AS row_count
FROM search.search_documents d
WHERE d.entity_type IN ('transport_stop', 'bus_stop')
  AND d.is_public = true
  AND d.is_active = true
`;

const LATEST_RUN_QUERY = `
SELECT id, status, started_at, finished_at, entity_counts
FROM search.search_index_runs
ORDER BY id DESC
LIMIT 1
`;

async function main(): Promise<void> {
    console.log("[verify-search-index] SQL file:", SQL_PATH);
    readFileSync(SQL_PATH, "utf8");

    const rows = await runSearchIndexHealthCheck(prisma);
    const transportDetail = await prisma.$queryRawUnsafe<DetailRow[]>(TRANSPORT_DETAIL_QUERY);
    const latestRun = await prisma.$queryRawUnsafe<IndexRunRow[]>(LATEST_RUN_QUERY);

    console.log("\n=== search_index_health ===\n");
    printSearchIndexHealthTable(rows);

    for (const row of rows) {
        console.log(
            `[verify-search-index] family=${row.entity_family} missing=${row.missing} ghost=${row.ghost} stale=${row.stale}`,
        );
    }

    console.log("\n=== transport_stops_detail ===\n");
    for (const row of transportDetail) {
        console.log(`${row.label}: ${toHealthCount(row.row_count)}`);
    }

    console.log("\n=== latest_search_index_run ===\n");
    const run = latestRun[0];
    if (!run) {
        console.log("(no runs recorded)");
    } else {
        console.log(
            JSON.stringify(
                {
                    id: toHealthCount(run.id),
                    status: run.status,
                    started_at: formatSearchHealthTimestamp(run.started_at),
                    finished_at: formatSearchHealthTimestamp(run.finished_at),
                    entity_counts: run.entity_counts,
                },
                null,
                2,
            ),
        );
    }

    if (hasSearchIndexHealthIssues(rows)) {
        console.error(
            "\n[verify-search-index] Health check reported missing, ghost, and/or stale rows.",
        );
        process.exitCode = 1;
    } else {
        console.log("\n[verify-search-index] All families are in sync on row counts and freshness.");
    }
}

main()
    .catch((err) => {
        console.error("[verify-search-index] Failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
