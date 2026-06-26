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

/** Light views: everything cheap (no street_groups). Keeps `addresses`. */
const LIGHT_VIEWS = [
    "places",
    "admin_areas",
    "addresses",
    "bus_stops",
    "bus_routes",
    "buildings",
    "water_lines",
    "water_polygons",
    "landuse",
] as const;

/** Grouped roads only (search.v_search_street_groups_source). */
const STREET_GROUP_VIEWS = ["street_groups"] as const;

/** Full normal rebuild = light views + grouped streets. Never per-segment streets. */
const FULL_VIEWS = [...LIGHT_VIEWS, ...STREET_GROUP_VIEWS] as const;

/** Deprecated per-segment street views (removed in migration 121). */
const DEPRECATED_VIEWS = new Set(["streets", "street"]);

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

/**
 * Strip deprecated per-segment street views and warn loudly. Returns the safe
 * list. Throws if, after stripping, nothing is left to rebuild.
 */
function guardDeprecatedViews(views: string[]): string[] {
    const requestedDeprecated = views.filter((v) => DEPRECATED_VIEWS.has(v));
    if (requestedDeprecated.length > 0) {
        console.warn(
            "\n[rebuild-search-index] ⚠️  DEPRECATED: per-segment street rebuild " +
                `(${requestedDeprecated.join(", ")}) is no longer supported.\n` +
                "  Streets are indexed as grouped roads via 'street_groups'. " +
                "Ignoring the deprecated view(s).\n",
        );
    }

    const safe = views.filter((v) => !DEPRECATED_VIEWS.has(v));
    if (safe.length === 0) {
        throw new Error(
            "No valid views to rebuild after removing deprecated per-segment streets. " +
                "Use 'street_groups' instead.",
        );
    }
    return safe;
}

type RebuildResult = {
    run_id: number;
    status: string;
    requested_views: string[];
    entity_counts: Record<string, unknown>;
};

async function rebuildViews(views: string[]): Promise<RebuildResult | undefined> {
    // Disable statement_timeout on this connection BEFORE the call (it is armed
    // when the statement begins, so changing it inside the function is too late).
    const rows = await prisma.$transaction(
        async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 0");
            return tx.$queryRawUnsafe<Array<{ rebuild_search_documents: RebuildResult }>>(
                "SELECT search.rebuild_search_documents($1::text[]) AS rebuild_search_documents",
                views,
            );
        },
        { timeout: 30 * 60 * 1000, maxWait: 60 * 1000 },
    );

    return rows[0]?.rebuild_search_documents;
}

async function main(): Promise<void> {
    const requested = guardDeprecatedViews(resolveRequestedViews());

    const startedAt = new Date();
    console.log("[rebuild-search-index] Connection: direct Postgres (Prisma), not Supabase SQL Editor.");
    console.log(`[rebuild-search-index] Requested views: ${requested.join(", ")}`);
    console.log(`[rebuild-search-index] Started:  ${startedAt.toISOString()}`);

    const result = await rebuildViews(requested);

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

    // Surface a non-zero exit on a partial/failed rebuild so CI/operators notice.
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
