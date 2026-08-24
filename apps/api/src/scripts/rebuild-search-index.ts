/**
 * Rebuild the unified runtime search index (search.search_documents +
 * search.search_document_names) from the search.v_search_*_source views.
 *
 * Streets are indexed as GROUPED roads via search.v_search_street_groups_source
 * (one document per logical road, ~14.8k rows) -- NOT per segment. The old
 * per-segment street path (~823k rows, 35-50 min) was removed in migration 121
 * and is DEPRECATED: never rebuild `streets`/`street`.
 *
 * This script connects directly to Postgres via the API's Prisma client (a
 * persistent pooled connection), NOT the Supabase SQL Editor. Long rebuilds run
 * with statement_timeout disabled for the duration of the call.
 *
 * Usage (from repo root):
 *   npm --prefix apps/api run rebuild:search-index                # full (light + street_groups)
 *   npm --prefix apps/api run rebuild:search-index:light          # light views only
 *   npm --prefix apps/api run rebuild:search-index:street-groups  # grouped streets only
 *   npx tsx src/scripts/rebuild-search-index.ts --preset full
 *   npx tsx src/scripts/rebuild-search-index.ts --views places,admin_areas
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { prisma } from "../db/prisma.js";
import {
    guardDeprecatedSearchRebuildViews,
    rebuildSearchFamilies,
} from "../modules/search/search-family-rebuild.js";

/** Light views: everything cheap (no street_groups). Keeps `addresses`. */
const LIGHT_VIEWS = [
    "places",
    "settlements",
    "admin_areas",
    "addresses",
    "bus_stops",
    "bus_routes",
    "transport_terminals",
    "buildings",
    "water_lines",
    "water_polygons",
    "land_area",
] as const;

/** Grouped roads only (search.v_search_street_groups_source). */
const STREET_GROUP_VIEWS = ["street_groups"] as const;

/** Full normal rebuild = light views + grouped streets. Never per-segment streets. */
const FULL_VIEWS = [...LIGHT_VIEWS, ...STREET_GROUP_VIEWS] as const;

const PRESETS: Record<string, readonly string[]> = {
    full: FULL_VIEWS,
    light: LIGHT_VIEWS,
    "street-groups": STREET_GROUP_VIEWS,
};

function readArg(name: string): string | undefined {
    const idx = process.argv.indexOf(name);
    if (idx === -1) {
        return undefined;
    }
    return process.argv[idx + 1];
}

/**
 * Resolve the requested views from `--views a,b,c` or `--preset name`.
 * Falls back to the `full` preset when neither is provided.
 */
function resolveRequestedViews(): string[] {
    const rawViews = readArg("--views");
    if (rawViews) {
        return rawViews
            .split(",")
            .map((v) => v.trim().toLowerCase())
            .filter((v) => v.length > 0);
    }

    const preset = (readArg("--preset") ?? "full").trim().toLowerCase();
    const views = PRESETS[preset];
    if (!views) {
        throw new Error(
            `Unknown --preset "${preset}". Valid presets: ${Object.keys(PRESETS).join(", ")}.`,
        );
    }
    return [...views];
}

async function main(): Promise<void> {
    const requested = guardDeprecatedSearchRebuildViews(resolveRequestedViews());

    const startedAt = new Date();
    console.log("[rebuild-search-index] Connection: direct Postgres (Prisma), not Supabase SQL Editor.");
    console.log(`[rebuild-search-index] Requested views: ${requested.join(", ")}`);
    console.log(`[rebuild-search-index] Started:  ${startedAt.toISOString()}`);

    const outcome = await rebuildSearchFamilies(prisma, requested, {
        info: (obj, msg) => console.log(`[rebuild-search-index] ${msg}`, obj),
        error: (obj, msg) => console.error(`[rebuild-search-index] ${msg}`, obj),
    });
    const result = outcome
        ? {
              run_id: outcome.run_id ?? undefined,
              status: outcome.status,
              entity_counts: outcome.entity_counts,
          }
        : undefined;

    const finishedAt = new Date();
    const secs = ((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1);
    console.log(`[rebuild-search-index] Finished: ${finishedAt.toISOString()} (${secs}s)`);
    console.log(`[rebuild-search-index] Run #${result?.run_id ?? "?"} -> status: ${result?.status ?? "unknown"}`);
    console.log("[rebuild-search-index] Per-view entity counts:");
    console.log(JSON.stringify(result?.entity_counts ?? {}, null, 2));

    const counts = await prisma.$queryRawUnsafe<Array<{ entity_type: string; cnt: bigint }>>(
        "SELECT entity_type, count(*)::bigint AS cnt FROM search.search_documents GROUP BY entity_type ORDER BY entity_type",
    );
    console.log("[rebuild-search-index] Resulting search_documents counts:");
    for (const row of counts) {
        console.log(`  ${row.entity_type}: ${Number(row.cnt)}`);
    }

    const status = (result?.status ?? "").toLowerCase();
    if (status.includes("error") || status.includes("fail")) {
        console.error(`[rebuild-search-index] ⚠️  Rebuild reported status "${result?.status}".`);
        process.exitCode = 1;
    }
}

main()
    .catch((err) => {
        console.error("[rebuild-search-index] Failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
