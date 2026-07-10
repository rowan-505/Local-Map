#!/usr/bin/env npx tsx
/**
 * Create missing train stations for unmatched normalized names.
 *
 * Reuses one shared stop per unique station name across all routes.
 * New stops use review placeholder geometry (YBS-style) until real coords exist.
 *
 * Default: dry-run. Pass --execute to write.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/db/create-missing-train-stops.ts
 *   npx tsx tools/data-pipeline/train-app-import/db/create-missing-train-stops.ts --execute
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type pg from "pg";

import {
    loadDatabaseEnv,
    loadTrainStopPool,
    resolveDatabaseUrl,
    withWriteClient,
} from "../lib/db.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    manualOverridesPath,
    normalizedDir,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import { sharedStationKey } from "../lib/station-aliases.js";
import {
    buildTrainNormalizedData,
    buildTrainSourceRefs,
    TRAIN_IMPORT_CONFIDENCE_SCORE,
    TRAIN_MODE,
} from "../lib/train-import-constants.js";
import {
    buildTrainStopCatalog,
    matchTrainStation,
    parseManualOverrides,
} from "../lib/train-station-matcher.js";
import { trimToNull } from "../lib/text-normalize.js";
import type { NormalizedTrainRoute } from "../lib/types.js";

const REPORT_FILENAME = "create-missing-train-stops.json";

/** Myanmar review placeholder centroid (approx. country center). */
const PLACEHOLDER_LNG = 96.1;
const PLACEHOLDER_LAT = 19.75;

export type CreateMissingTrainStopsOptions = {
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
};

type MissingStationCandidate = {
    shared_key: string;
    station_name_en: string | null;
    station_name_my: string | null;
    route_count: number;
    sample_variants: string[];
};

type CreatedStopRow = {
    shared_key: string;
    stop_id: number;
    public_id: string;
    station_name_en: string | null;
    station_name_my: string | null;
    placeholder_lng: number;
    placeholder_lat: number;
};

function loadNormalizedRoutes(dir: string): NormalizedTrainRoute[] {
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => {
            const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
            return raw as NormalizedTrainRoute;
        });
}

function hashOffset(key: string): { lng: number; lat: number } {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    const lngJitter = ((hash % 2000) - 1000) / 100_000;
    const latJitter = (((hash >> 11) % 2000) - 1000) / 100_000;
    return {
        lng: PLACEHOLDER_LNG + lngJitter,
        lat: PLACEHOLDER_LAT + latJitter,
    };
}

function collectMissingStations(
    routes: NormalizedTrainRoute[],
    catalog: ReturnType<typeof buildTrainStopCatalog>,
    manualOverrides: Map<string, number>,
): MissingStationCandidate[] {
    const byKey = new Map<string, MissingStationCandidate>();

    for (const route of routes) {
        for (const station of route.stations) {
            const match = matchTrainStation({
                catalog,
                station,
                variantCode: route.variant.variant_code,
                manualOverrides,
            });
            if (match.matched_stop_id) {
                continue;
            }

            const key = sharedStationKey(station.station_name_en, station.station_name_my);
            const existing = byKey.get(key);
            if (existing) {
                existing.route_count += 1;
                if (existing.sample_variants.length < 5) {
                    existing.sample_variants.push(
                        `${route.variant.variant_code}#${station.sequence}`,
                    );
                }
                continue;
            }

            byKey.set(key, {
                shared_key: key,
                station_name_en: trimToNull(station.station_name_en),
                station_name_my: trimToNull(station.station_name_my),
                route_count: 1,
                sample_variants: [`${route.variant.variant_code}#${station.sequence}`],
            });
        }
    }

    return [...byKey.values()].sort((a, b) => b.route_count - a.route_count);
}

async function insertPlaceholderStop(
    client: pg.PoolClient,
    candidate: MissingStationCandidate,
): Promise<CreatedStopRow> {
    const name =
        candidate.station_name_my ??
        candidate.station_name_en ??
        candidate.shared_key;
    const point = hashOffset(candidate.shared_key);
    const sourceRefs = buildTrainSourceRefs({
        shared_station_key: candidate.shared_key,
        created_by: "create-missing-train-stops",
    });
    const normalizedData = buildTrainNormalizedData({
        shared_station_key: candidate.shared_key,
        geometry: {
            placeholder_geometry_mode: "review_centroid_jitter",
            public_safe: false,
            do_not_publish: true,
            validator_required: true,
            lng: point.lng,
            lat: point.lat,
        },
    });

    const inserted = await client.query<{ id: string; public_id: string }>(
        `
        INSERT INTO transport.stops (
            name,
            name_mm,
            name_en,
            mode,
            stop_type,
            geom,
            review_status,
            source_refs,
            normalized_data,
            confidence_score,
            is_active
        )
        VALUES (
            $1, $2, $3, $4, 'station',
            ST_SetSRID(ST_MakePoint($5, $6), 4326),
            'needs_review',
            $7::jsonb,
            $8::jsonb,
            $9,
            false
        )
        RETURNING id::text, public_id::text
        `,
        [
            name,
            candidate.station_name_my,
            candidate.station_name_en,
            TRAIN_MODE,
            point.lng,
            point.lat,
            JSON.stringify(sourceRefs),
            JSON.stringify(normalizedData),
            Math.min(TRAIN_IMPORT_CONFIDENCE_SCORE, 20),
        ],
    );

    return {
        shared_key: candidate.shared_key,
        stop_id: Number(inserted.rows[0]!.id),
        public_id: inserted.rows[0]!.public_id,
        station_name_en: candidate.station_name_en,
        station_name_my: candidate.station_name_my,
        placeholder_lng: point.lng,
        placeholder_lat: point.lat,
    };
}

export async function createMissingTrainStops(
    options: CreateMissingTrainStopsOptions = {},
): Promise<{
    missing_count: number;
    created_count: number;
    dry_run: boolean;
    report_path: string;
    created: CreatedStopRow[];
    missing: MissingStationCandidate[];
}> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const routes = loadNormalizedRoutes(normalizedDir(paths));
    if (routes.length === 0) {
        throw new Error(`No normalized routes in ${normalizedDir(paths)}`);
    }

    const overridesPath = manualOverridesPath(paths);
    const manualOverrides = fs.existsSync(overridesPath)
        ? parseManualOverrides(JSON.parse(fs.readFileSync(overridesPath, "utf8")))
        : new Map<string, number>();

    const stops = await loadTrainStopPool(databaseUrl);
    const catalog = buildTrainStopCatalog(stops);
    const missing = collectMissingStations(routes, catalog, manualOverrides);

    const created: CreatedStopRow[] = [];

    if (options.execute && missing.length > 0) {
        await withWriteClient(databaseUrl, async (client) => {
            for (const candidate of missing) {
                created.push(await insertPlaceholderStop(client, candidate));
            }
        });
    }

    const report = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        dry_run: !options.execute,
        stop_pool_before: stops.length,
        missing_unique_stations: missing.length,
        created_count: created.length,
        missing,
        created,
        notes: [
            "New stops use review placeholder geometry near Myanmar centroid.",
            "Same shared_key is created once and reused by all routes after re-match.",
            "Stops are inactive (is_active=false) and review_status=needs_review.",
        ],
    };

    const reportFile = reportPath(paths, REPORT_FILENAME);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return {
        missing_count: missing.length,
        created_count: created.length,
        dry_run: !options.execute,
        report_path: reportFile,
        created,
        missing,
    };
}

function parseCliArgs(argv: string[]): CreateMissingTrainStopsOptions {
    const options: CreateMissingTrainStopsOptions = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        } else if (arg === "--execute") {
            options.execute = true;
        }
    }
    return options;
}

async function main(): Promise<void> {
    const result = await createMissingTrainStops(parseCliArgs(process.argv.slice(2)));
    console.log(result.dry_run ? "Dry run: create-missing-train-stops" : "Executed: create-missing-train-stops");
    console.log(`Unique missing stations: ${result.missing_count}`);
    console.log(`Created stops: ${result.created_count}`);
    console.log(`Report: ${result.report_path}`);
    for (const row of result.missing.slice(0, 15)) {
        console.log(`  ${row.route_count}x ${row.station_name_en ?? row.station_name_my}`);
    }
    if (result.missing.length > 15) {
        console.log(`  ... +${result.missing.length - 15} more`);
    }
}

const isCliEntry = process.argv[1]?.includes("create-missing-train-stops.ts");
if (isCliEntry) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
