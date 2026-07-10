#!/usr/bin/env npx tsx
/**
 * Stage 8: match normalized train stations to existing transport.stops (mode = train).
 *
 * Input:  tmp/train-import/normalized/*.json
 * Output: tmp/train-import/station-matches/auto-matches.json
 *         tmp/train-import/station-matches/unmatched-stations.json
 *         tmp/train-import/import-ready/{variant_code}.json
 *
 * Read-only SELECT against PostgreSQL. Does not create stops.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    loadDatabaseEnv,
    loadTrainStopPool,
    resolveDatabaseUrl,
} from "../lib/db.js";
import {
    autoMatchesPath,
    defaultRunPaths,
    ensureRunLayout,
    importReadyDir,
    importReadyRoutePathByVariantCode,
    manualOverridesPath,
    normalizedDir,
    unmatchedStationsPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import {
    buildTrainStopCatalog,
    matchTrainRoute,
    parseManualOverrides,
    runTrainStationMatcherSelfTest,
    type TrainRouteAutoMatch,
} from "../lib/train-station-matcher.js";
import type {
    ImportReadyTrainRoute,
    NormalizedTrainRoute,
    TrainAutoMatchesFile,
    TrainUnmatchedStationsFile,
} from "../lib/types.js";
import {
    TRAIN_IMPORT_READY_SCHEMA_VERSION,
    TRAIN_MATCH_SCHEMA_VERSION,
    TRAIN_SOURCE_KIND,
    TRAIN_SOURCE_NAME,
} from "../lib/types.js";

export type MatchTrainStationsOptions = {
    runRoot?: string;
    databaseUrl?: string;
    skipDb?: boolean;
};

export type MatchTrainStationsResult = {
    autoMatchesPath: string;
    unmatchedStationsPath: string;
    importReadyWritten: string[];
    summary: TrainAutoMatchesFile["summary"];
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
            const filePath = path.join(dir, name);
            return JSON.parse(fs.readFileSync(filePath, "utf8")) as NormalizedTrainRoute;
        });
}

function loadManualOverrides(filePath: string): Map<string, number> {
    if (!fs.existsSync(filePath)) {
        return new Map();
    }
    return parseManualOverrides(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function buildImportReadyRoute(
    normalized: NormalizedTrainRoute,
    matched: TrainRouteAutoMatch,
): ImportReadyTrainRoute | null {
    if (matched.route_quality_status !== "ready_for_import") {
        return null;
    }

    const stations = normalized.stations.map((station) => {
        const match = matched.stations.find((row) => row.sequence === station.sequence);
        if (!match?.matched_stop_id || !match.matched_stop_public_id) {
            throw new Error(
                `Internal error: route ${matched.variant_code} marked ready but station ${station.sequence} is not matched`,
            );
        }

        return {
            ...station,
            stop_id: match.matched_stop_id,
            stop_public_id: match.matched_stop_public_id,
            match_method: match.match_method,
            match_score: match.match_score,
        };
    });

    return {
        schema_version: TRAIN_IMPORT_READY_SCHEMA_VERSION,
        prepared_at: new Date().toISOString(),
        train_number: normalized.route.train_number,
        direction: normalized.variant.direction_code,
        route_code: normalized.route.route_code,
        variant_code: normalized.variant.variant_code,
        route_quality_status: "ready_for_import",
        train_type: normalized.route.train_type,
        train_model: normalized.route.train_model,
        operation_day: normalized.route.operation_days[0] ?? null,
        origin_name_en: normalized.route.origin_name_en ?? null,
        origin_name_my: normalized.route.origin_name_my ?? null,
        destination_name_en: normalized.route.destination_name_en ?? null,
        destination_name_my: normalized.route.destination_name_my ?? null,
        public_name: normalized.route.public_name,
        public_name_my: normalized.route.public_name_my,
        total_stations: normalized.variant.total_stations,
        travel_duration_seconds: normalized.variant.travel_duration_seconds ?? null,
        stations,
        import_status: "ready",
        source_name: TRAIN_SOURCE_NAME,
        source_kind: TRAIN_SOURCE_KIND,
        warnings: matched.warnings,
    };
}

function buildUnmatchedEntries(matches: TrainRouteAutoMatch[]): TrainUnmatchedStationsFile["entries"] {
    const entries: TrainUnmatchedStationsFile["entries"] = [];

    for (const route of matches) {
        for (const station of route.stations) {
            if (station.match_method !== "unmatched" && station.match_method !== "ambiguous") {
                continue;
            }

            entries.push({
                variant_code: route.variant_code,
                route_code: route.route_code,
                sequence: station.sequence,
                station_name_en: station.station_name_en,
                station_name_my: station.station_name_my,
                reason: station.match_method,
                candidate_stop_ids: station.candidate_stop_ids,
            });
        }
    }

    return entries;
}

function summarizeMatches(matches: TrainRouteAutoMatch[]): TrainAutoMatchesFile["summary"] {
    let total_stations = 0;
    let matched_stations = 0;
    let unmatched_stations = 0;
    let ambiguous_stations = 0;
    let ready_for_import = 0;
    let needs_station_match_review = 0;

    for (const route of matches) {
        total_stations += route.stations.length;
        matched_stations += route.matched_count;
        unmatched_stations += route.unmatched_count;
        ambiguous_stations += route.ambiguous_count;

        if (route.route_quality_status === "ready_for_import") {
            ready_for_import++;
        } else {
            needs_station_match_review++;
        }
    }

    return {
        route_count: matches.length,
        ready_for_import,
        needs_station_match_review,
        total_stations,
        matched_stations,
        unmatched_stations,
        ambiguous_stations,
    };
}

/** Match all normalized routes against the train stop pool. */
export async function matchTrainStations(
    options: MatchTrainStationsOptions = {},
): Promise<MatchTrainStationsResult> {
    const paths: TrainRunPaths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    const normalizedRoutes = loadNormalizedRoutes(normalizedDir(paths));
    if (normalizedRoutes.length === 0) {
        throw new Error(`No normalized routes found in ${normalizedDir(paths)}`);
    }

    const manualOverrides = loadManualOverrides(manualOverridesPath(paths));

    let stopPoolCount = 0;
    let catalog = buildTrainStopCatalog([]);

    if (!options.skipDb) {
        loadDatabaseEnv();
        const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
        if (!databaseUrl) {
            throw new Error(
                "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
            );
        }

        const stops = await loadTrainStopPool(databaseUrl);
        stopPoolCount = stops.length;
        catalog = buildTrainStopCatalog(stops);
    }

    const matches = normalizedRoutes.map((route) =>
        matchTrainRoute({
            route,
            catalog,
            manualOverrides,
        }),
    );

    const autoMatches: TrainAutoMatchesFile = {
        schema_version: TRAIN_MATCH_SCHEMA_VERSION,
        matched_at: new Date().toISOString(),
        stop_pool_count: stopPoolCount,
        routes: matches,
        summary: summarizeMatches(matches),
    };

    const unmatched: TrainUnmatchedStationsFile = {
        schema_version: TRAIN_MATCH_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        entries: buildUnmatchedEntries(matches),
    };

    fs.mkdirSync(path.dirname(autoMatchesPath(paths)), { recursive: true });
    fs.mkdirSync(importReadyDir(paths), { recursive: true });

    const autoMatchesOutput = autoMatchesPath(paths);
    const unmatchedOutput = unmatchedStationsPath(paths);

    fs.writeFileSync(autoMatchesOutput, `${JSON.stringify(autoMatches, null, 2)}\n`, "utf8");
    fs.writeFileSync(unmatchedOutput, `${JSON.stringify(unmatched, null, 2)}\n`, "utf8");

    const importReadyWritten: string[] = [];
    for (const normalized of normalizedRoutes) {
        const matched = matches.find(
            (route) => route.variant_code === normalized.variant.variant_code,
        );
        if (!matched) {
            continue;
        }

        const importReady = buildImportReadyRoute(normalized, matched);
        if (!importReady) {
            continue;
        }

        const outputPath = importReadyRoutePathByVariantCode(
            paths,
            importReady.variant_code,
        );
        fs.writeFileSync(outputPath, `${JSON.stringify(importReady, null, 2)}\n`, "utf8");
        importReadyWritten.push(outputPath);
    }

    return {
        autoMatchesPath: autoMatchesOutput,
        unmatchedStationsPath: unmatchedOutput,
        importReadyWritten,
        summary: autoMatches.summary,
    };
}

function parseCliArgs(argv: string[]): MatchTrainStationsOptions {
    const options: MatchTrainStationsOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        } else if (arg === "--skip-db") {
            options.skipDb = true;
        }
    }

    return options;
}

async function main(): Promise<void> {
    const result = await matchTrainStations(parseCliArgs(process.argv.slice(2)));
    console.log(`Saved auto matches: ${result.autoMatchesPath}`);
    console.log(`Saved unmatched stations: ${result.unmatchedStationsPath}`);
    console.log(`Import-ready routes: ${result.importReadyWritten.length}`);
    console.log(
        `Summary: ${result.summary.ready_for_import} ready, ${result.summary.needs_station_match_review} need review`,
    );
    console.log(
        `Stations: ${result.summary.matched_stations}/${result.summary.total_stations} matched, ` +
            `${result.summary.unmatched_stations} unmatched, ${result.summary.ambiguous_stations} ambiguous`,
    );
}

const isCliEntry = process.argv[1]?.includes("match-train-stations.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("match-train-stations.ts") && process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runTrainStationMatcherSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
