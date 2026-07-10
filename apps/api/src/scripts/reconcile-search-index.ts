/**
 * Unified search index health check and optional targeted repair.
 *
 * Default: read-only health report (no mutations).
 * With --repair: rebuild only unhealthy search families, then re-check.
 *
 * Usage (from repo root):
 *   npm --prefix apps/api run search:health
 *   npm --prefix apps/api run search:reconcile
 *   npm --prefix apps/api run search:reconcile -- --repair
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
    hasSearchIndexHealthIssues,
    isSearchIndexFamilyUnhealthy,
    printSearchIndexHealthTable,
    runSearchIndexHealthCheck,
    type SearchIndexFamilyHealth,
} from "../modules/search/search-index-health.js";
import { repairUnhealthySearchIndexFamilies } from "../modules/search/search-index-maintenance.service.js";

const SQL_PATH = resolve(
    repoRoot,
    "infrastructure/database/verification/verify_search_index_health.sql",
);

function readRepairFlag(): boolean {
    return process.argv.includes("--repair");
}

function logFamilySummary(
    prefix: string,
    rows: readonly SearchIndexFamilyHealth[],
    repairedByFamily?: ReadonlyMap<string, boolean>,
): void {
    for (const row of rows) {
        const repaired = repairedByFamily?.get(row.entity_family) ?? false;
        console.log(
            `${prefix} family=${row.entity_family} missing=${row.missing} ghost=${row.ghost} stale=${row.stale} repaired=${repaired}`,
        );
    }
}

async function main(): Promise<void> {
    const repair = readRepairFlag();
    const startedAt = Date.now();

    readFileSync(SQL_PATH, "utf8");

    console.log(`[search-reconcile] mode=${repair ? "repair" : "check-only"}`);
    console.log(`[search-reconcile] sql=${SQL_PATH}`);

    if (!repair) {
        const before = await runSearchIndexHealthCheck(prisma);
        console.log("\n=== search_index_health ===\n");
        printSearchIndexHealthTable(before);
        logFamilySummary("[search-reconcile]", before);

        const unhealthy = before.filter(isSearchIndexFamilyUnhealthy);
        const duration_ms = Date.now() - startedAt;
        if (unhealthy.length === 0) {
            console.log(`\n[search-reconcile] all families healthy duration_ms=${duration_ms}`);
            return;
        }

        console.error(
            `\n[search-reconcile] unhealthy families=${unhealthy.length} duration_ms=${duration_ms} (pass --repair to rebuild)`,
        );
        process.exitCode = 1;
        return;
    }

    const repairStartedAt = Date.now();
    const outcome = await repairUnhealthySearchIndexFamilies(prisma, {
        info: (obj, msg) => console.log(`[search-reconcile] ${msg}`, obj),
        error: (obj, msg) => console.error(`[search-reconcile] ${msg}`, obj),
    });
    const repairDuration_ms = Date.now() - repairStartedAt;

    console.log("\n=== search_index_health ===\n");
    printSearchIndexHealthTable(outcome.before);
    logFamilySummary("[search-reconcile]", outcome.before);

    if (outcome.skipped) {
        const duration_ms = Date.now() - startedAt;
        console.log(`\n[search-reconcile] all families healthy duration_ms=${duration_ms}`);
        return;
    }

    console.log(`\n[search-reconcile] rebuilding views=${outcome.rebuildViews.join(",")}`);

    console.log("\n=== search_index_health_after_repair ===\n");
    printSearchIndexHealthTable(outcome.after);
    logFamilySummary("[search-reconcile]", outcome.after, outcome.repairedByFamily);

    const duration_ms = Date.now() - startedAt;
    const stillUnhealthy = outcome.after.filter(isSearchIndexFamilyUnhealthy).length;
    const repairedCount = [...outcome.repairedByFamily.values()].filter(Boolean).length;

    console.log(
        `\n[search-reconcile] repair_views=${outcome.rebuildViews.join(",")} ` +
            `repair_duration_ms=${repairDuration_ms} ` +
            `rebuild_success=${outcome.rebuild?.success ?? false} ` +
            `families_repaired=${repairedCount}/${outcome.before.filter(isSearchIndexFamilyUnhealthy).length} ` +
            `still_unhealthy=${stillUnhealthy} ` +
            `duration_ms=${duration_ms}`,
    );

    if (hasSearchIndexHealthIssues(outcome.after) || outcome.rebuild?.success === false) {
        process.exitCode = 1;
    }
}

main()
    .catch((err) => {
        console.error("[search-reconcile] Failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
