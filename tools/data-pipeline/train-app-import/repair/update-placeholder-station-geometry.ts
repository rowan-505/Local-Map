#!/usr/bin/env npx tsx
/**
 * Apply manually reviewed coordinates to placeholder train stops (one row per stop).
 *
 * Input: tmp/train-import/reviewed-station-geometry.json
 *
 * Default: dry-run. Pass --execute to commit.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/repair/update-placeholder-station-geometry.ts
 *   npx tsx tools/data-pipeline/train-app-import/repair/update-placeholder-station-geometry.ts --execute
 *   npx tsx tools/data-pipeline/train-app-import/repair/update-placeholder-station-geometry.ts --execute --activate-stops
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type pg from "pg";

import { loadDatabaseEnv, resolveDatabaseUrl, withWriteClient } from "../lib/db.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import { TRAIN_IMPORT_GENERATION, TRAIN_MODE } from "../lib/train-import-constants.js";
import { trimToNull } from "../lib/text-normalize.js";

const INPUT_FILENAME = "reviewed-station-geometry.json";
const REPORT_FILENAME = "update-placeholder-station-geometry.json";

/** Approximate Myanmar bounds for extra safety on manual review input. */
const MYANMAR_LON_MIN = 92;
const MYANMAR_LON_MAX = 102;
const MYANMAR_LAT_MIN = 9;
const MYANMAR_LAT_MAX = 29;

export type ReviewedStationGeometryInput = {
    stop_id: number;
    name_en?: string | null;
    lon: number;
    lat: number;
    review_note?: string | null;
};

export type EligibleStopRow = {
    stop_id: number;
    name: string;
    name_en: string | null;
    review_status: string;
    is_active: boolean;
    lon: number | null;
    lat: number | null;
    normalized_data: Record<string, unknown> | null;
};

export type PlaceholderGeometryUpdatePlanItem = {
    stop_id: number;
    name_en: string | null;
    input_name_en: string | null;
    current_lon: number | null;
    current_lat: number | null;
    new_lon: number;
    new_lat: number;
    review_note: string | null;
    action: "update" | "activate_only" | "skip";
    skip_reason: string | null;
    normalized_data_patch: Record<string, unknown> | null;
    activate_stop: boolean;
};

export type PlaceholderGeometryUpdateResult = {
    dry_run: boolean;
    executed: boolean;
    activate_stops: boolean;
    input_file: string;
    updated_count: number;
    activated_count: number;
    skipped_count: number;
    invalid_input_count: number;
    items: PlaceholderGeometryUpdatePlanItem[];
};

export type UpdatePlaceholderStationGeometryOptions = {
    runRoot?: string;
    inputFile?: string;
    databaseUrl?: string;
    execute?: boolean;
    activateStops?: boolean;
};

function reviewedGeometryInputPath(paths: TrainRunPaths, inputFile?: string): string {
    if (inputFile) {
        return path.isAbsolute(inputFile) ? inputFile : path.join(paths.runRoot, inputFile);
    }
    return path.join(paths.runRoot, INPUT_FILENAME);
}

export function isValidWgs84Coordinate(lon: number, lat: number): boolean {
    return (
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        lon >= -180 &&
        lon <= 180 &&
        lat >= -90 &&
        lat <= 90
    );
}

export function isWithinMyanmarBounds(lon: number, lat: number): boolean {
    return (
        lon >= MYANMAR_LON_MIN &&
        lon <= MYANMAR_LON_MAX &&
        lat >= MYANMAR_LAT_MIN &&
        lat <= MYANMAR_LAT_MAX
    );
}

export function parseReviewedStationGeometryInput(raw: unknown): {
    entries: ReviewedStationGeometryInput[];
    errors: string[];
} {
    if (!Array.isArray(raw)) {
        return { entries: [], errors: ["Input file must be a JSON array"] };
    }

    const entries: ReviewedStationGeometryInput[] = [];
    const errors: string[] = [];
    const seenStopIds = new Set<number>();

    raw.forEach((row, index) => {
        if (!row || typeof row !== "object") {
            errors.push(`Row ${index}: expected object`);
            return;
        }

        const record = row as Record<string, unknown>;
        const stop_id = Number(record.stop_id);
        const lon = Number(record.lon);
        const lat = Number(record.lat);

        if (!Number.isInteger(stop_id) || stop_id <= 0) {
            errors.push(`Row ${index}: invalid stop_id`);
            return;
        }

        if (seenStopIds.has(stop_id)) {
            errors.push(`Row ${index}: duplicate stop_id ${stop_id}`);
            return;
        }
        seenStopIds.add(stop_id);

        if (!isValidWgs84Coordinate(lon, lat)) {
            errors.push(`Row ${index}: lon/lat out of WGS84 range (stop_id=${stop_id})`);
            return;
        }

        if (!isWithinMyanmarBounds(lon, lat)) {
            errors.push(
                `Row ${index}: lon/lat outside Myanmar bounds (stop_id=${stop_id}, lon=${lon}, lat=${lat})`,
            );
            return;
        }

        entries.push({
            stop_id,
            name_en: trimToNull(typeof record.name_en === "string" ? record.name_en : null),
            lon,
            lat,
            review_note: trimToNull(typeof record.review_note === "string" ? record.review_note : null),
        });
    });

    return { entries, errors };
}

export function buildGeometryNormalizedDataPatch(
    input: Pick<ReviewedStationGeometryInput, "lon" | "lat" | "review_note">,
    reviewedAtIso: string,
): Record<string, unknown> {
    return {
        geometry_status: "manual_reviewed",
        geometry_reviewed_at: reviewedAtIso,
        geometry_review_note: input.review_note,
        geometry: {
            lng: input.lon,
            lat: input.lat,
            public_safe: true,
            do_not_publish: false,
            validator_required: false,
            placeholder_geometry_mode: null,
        },
    };
}

function coordsMatch(
    lon: number | null,
    lat: number | null,
    targetLon: number,
    targetLat: number,
    epsilon = 1e-6,
): boolean {
    return (
        lon != null &&
        lat != null &&
        Math.abs(lon - targetLon) < epsilon &&
        Math.abs(lat - targetLat) < epsilon
    );
}

async function loadEligibleStops(
    client: pg.PoolClient,
    stopIds: number[],
): Promise<Map<number, EligibleStopRow>> {
    if (stopIds.length === 0) {
        return new Map();
    }

    const result = await client.query<{
        stop_id: string;
        name: string;
        name_en: string | null;
        review_status: string;
        is_active: boolean;
        lon: number | null;
        lat: number | null;
        normalized_data: Record<string, unknown> | null;
    }>(
        `
        SELECT
            s.id::text AS stop_id,
            s.name,
            s.name_en,
            s.review_status,
            s.is_active,
            ST_X(s.geom)::float8 AS lon,
            ST_Y(s.geom)::float8 AS lat,
            s.normalized_data
        FROM transport.stops AS s
        WHERE s.id = ANY($1::bigint[])
          AND s.mode = $2
          AND s.deleted_at IS NULL
          AND s.review_status IN ('needs_review', 'reviewed')
          AND s.normalized_data->>'generation' = $3
        `,
        [stopIds, TRAIN_MODE, TRAIN_IMPORT_GENERATION],
    );

    return new Map(
        result.rows.map((row) => [
            Number(row.stop_id),
            {
                stop_id: Number(row.stop_id),
                name: row.name,
                name_en: row.name_en,
                review_status: row.review_status,
                is_active: row.is_active,
                lon: row.lon,
                lat: row.lat,
                normalized_data: row.normalized_data,
            },
        ]),
    );
}

export function buildPlaceholderGeometryUpdatePlan(
    inputs: ReviewedStationGeometryInput[],
    eligibleById: Map<number, EligibleStopRow>,
    options: { activateStops: boolean; reviewedAtIso: string },
): PlaceholderGeometryUpdatePlanItem[] {
    return inputs.map((input) => {
        const stop = eligibleById.get(input.stop_id);
        const normalized_data_patch = buildGeometryNormalizedDataPatch(input, options.reviewedAtIso);

        if (!stop) {
            return {
                stop_id: input.stop_id,
                name_en: null,
                input_name_en: input.name_en ?? null,
                current_lon: null,
                current_lat: null,
                new_lon: input.lon,
                new_lat: input.lat,
                review_note: input.review_note ?? null,
                action: "skip",
                skip_reason:
                    "stop not found or not eligible (train + simple_train_system_v1 + needs_review/reviewed)",
                normalized_data_patch,
                activate_stop: options.activateStops,
            };
        }

        const sameCoordinates = coordsMatch(stop.lon, stop.lat, input.lon, input.lat);
        const alreadyManualReviewed = stop.normalized_data?.geometry_status === "manual_reviewed";

        if (alreadyManualReviewed && sameCoordinates) {
            if (options.activateStops && !stop.is_active) {
                return {
                    stop_id: input.stop_id,
                    name_en: stop.name_en,
                    input_name_en: input.name_en ?? null,
                    current_lon: stop.lon,
                    current_lat: stop.lat,
                    new_lon: input.lon,
                    new_lat: input.lat,
                    review_note: input.review_note ?? null,
                    action: "activate_only",
                    skip_reason: null,
                    normalized_data_patch: null,
                    activate_stop: true,
                };
            }

            return {
                stop_id: input.stop_id,
                name_en: stop.name_en,
                input_name_en: input.name_en ?? null,
                current_lon: stop.lon,
                current_lat: stop.lat,
                new_lon: input.lon,
                new_lat: input.lat,
                review_note: input.review_note ?? null,
                action: "skip",
                skip_reason: stop.is_active
                    ? "geometry already manually reviewed and stop is already active"
                    : "geometry already manually reviewed at same coordinates (pass --activate-stops to enable)",
                normalized_data_patch,
                activate_stop: options.activateStops,
            };
        }

        return {
            stop_id: input.stop_id,
            name_en: stop.name_en,
            input_name_en: input.name_en ?? null,
            current_lon: stop.lon,
            current_lat: stop.lat,
            new_lon: input.lon,
            new_lat: input.lat,
            review_note: input.review_note ?? null,
            action: "update",
            skip_reason: null,
            normalized_data_patch,
            activate_stop: options.activateStops,
        };
    });
}

async function applyPlaceholderGeometryUpdate(
    client: pg.PoolClient,
    item: PlaceholderGeometryUpdatePlanItem,
): Promise<boolean> {
    const result = await client.query<{ id: string }>(
        `
        UPDATE transport.stops AS s
        SET
            geom = ST_SetSRID(ST_MakePoint($2, $3), 4326),
            review_status = 'reviewed',
            is_active = CASE WHEN $4 THEN true ELSE s.is_active END,
            normalized_data = s.normalized_data || $5::jsonb,
            updated_at = now()
        WHERE s.id = $1
          AND s.mode = $6
          AND s.deleted_at IS NULL
          AND s.review_status IN ('needs_review', 'reviewed')
          AND s.normalized_data->>'generation' = $7
        RETURNING s.id::text
        `,
        [
            item.stop_id,
            item.new_lon,
            item.new_lat,
            item.activate_stop,
            JSON.stringify(item.normalized_data_patch ?? {}),
            TRAIN_MODE,
            TRAIN_IMPORT_GENERATION,
        ],
    );

    return result.rowCount === 1;
}

async function applyPlaceholderStopActivation(
    client: pg.PoolClient,
    stopId: number,
): Promise<boolean> {
    const result = await client.query<{ id: string }>(
        `
        UPDATE transport.stops AS s
        SET
            is_active = true,
            updated_at = now()
        WHERE s.id = $1
          AND s.mode = $2
          AND s.deleted_at IS NULL
          AND s.review_status = 'reviewed'
          AND s.normalized_data->>'generation' = $3
          AND s.is_active = false
        RETURNING s.id::text
        `,
        [stopId, TRAIN_MODE, TRAIN_IMPORT_GENERATION],
    );

    return result.rowCount === 1;
}

/** Apply reviewed placeholder train stop geometry updates from local JSON. */
export async function updatePlaceholderStationGeometry(
    options: UpdatePlaceholderStationGeometryOptions = {},
): Promise<{ reportPath: string; result: PlaceholderGeometryUpdateResult }> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    const inputPath = reviewedGeometryInputPath(paths, options.inputFile);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
    }

    const parsed = parseReviewedStationGeometryInput(
        JSON.parse(fs.readFileSync(inputPath, "utf8")) as unknown,
    );
    if (parsed.errors.length > 0) {
        throw new Error(`Invalid input file:\n${parsed.errors.join("\n")}`);
    }

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const execute = options.execute === true;
    const activateStops = options.activateStops === true;
    const reviewedAtIso = new Date().toISOString();

    const result = await withWriteClient(databaseUrl, async (client) => {
        const eligibleById = await loadEligibleStops(
            client,
            parsed.entries.map((entry) => entry.stop_id),
        );
        const items = buildPlaceholderGeometryUpdatePlan(parsed.entries, eligibleById, {
            activateStops,
            reviewedAtIso,
        });

        if (execute) {
            for (const item of items) {
                if (item.action === "update") {
                    const updated = await applyPlaceholderGeometryUpdate(client, item);
                    if (!updated) {
                        item.action = "skip";
                        item.skip_reason = "geometry update affected 0 rows (stop no longer eligible)";
                    }
                    continue;
                }

                if (item.action === "activate_only") {
                    const activated = await applyPlaceholderStopActivation(client, item.stop_id);
                    if (!activated) {
                        item.action = "skip";
                        item.skip_reason = "stop activation affected 0 rows (already active or not eligible)";
                    }
                }
            }
        }

        const updated_count = items.filter((item) => item.action === "update").length;
        const activated_count = items.filter(
            (item) => item.action === "update" || item.action === "activate_only",
        ).length;

        return {
            dry_run: !execute,
            executed: execute,
            activate_stops: activateStops,
            input_file: inputPath,
            updated_count,
            activated_count,
            skipped_count: items.filter((item) => item.action === "skip").length,
            invalid_input_count: 0,
            items,
        } satisfies PlaceholderGeometryUpdateResult;
    });

    const report = {
        generated_at: new Date().toISOString(),
        generation: TRAIN_IMPORT_GENERATION,
        mode: TRAIN_MODE,
        ...result,
    };

    const reportOutputPath = reportPath(paths, REPORT_FILENAME);
    fs.writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return { reportPath: reportOutputPath, result };
}

function parseCliArgs(argv: string[]): UpdatePlaceholderStationGeometryOptions {
    const options: UpdatePlaceholderStationGeometryOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--input" && next) {
            options.inputFile = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        } else if (arg === "--execute") {
            options.execute = true;
        } else if (arg === "--activate-stops") {
            options.activateStops = true;
        }
    }

    return options;
}

function printSummary(reportOutputPath: string, result: PlaceholderGeometryUpdateResult): void {
    console.log(`Report: ${reportOutputPath}`);
    console.log(`Input: ${result.input_file}`);
    console.log(result.executed ? "Executed updates." : "Dry run only.");
    console.log(
        `Geometry updates: ${result.updated_count}, activated: ${result.activated_count}, skipped: ${result.skipped_count}, activate_stops=${result.activate_stops}`,
    );

    for (const item of result.items) {
        if (item.action === "update") {
            console.log(
                `  [update] stop_id=${item.stop_id} ` +
                    `(${item.current_lon?.toFixed(5) ?? "?"}, ${item.current_lat?.toFixed(5) ?? "?"}) ` +
                    `-> (${item.new_lon.toFixed(5)}, ${item.new_lat.toFixed(5)})`,
            );
        } else if (item.action === "activate_only") {
            console.log(`  [activate] stop_id=${item.stop_id}`);
        } else {
            console.log(`  [skip] stop_id=${item.stop_id}: ${item.skip_reason}`);
        }
    }
}

export function runUpdatePlaceholderStationGeometrySelfTest(): void {
    if (!isValidWgs84Coordinate(96.12, 16.98)) {
        throw new Error("expected valid WGS84 coordinate");
    }
    if (isValidWgs84Coordinate(200, 16.98)) {
        throw new Error("expected invalid lon to fail");
    }
    if (!isWithinMyanmarBounds(96.12, 16.98)) {
        throw new Error("expected Myanmar bounds pass");
    }
    if (isWithinMyanmarBounds(10, 16.98)) {
        throw new Error("expected outside Myanmar to fail");
    }

    const parsed = parseReviewedStationGeometryInput([
        {
            stop_id: 19370,
            name_en: "Aung San Railway Station",
            lon: 96.123456,
            lat: 16.987654,
            review_note: "Checked manually from map",
        },
    ]);
    if (parsed.errors.length > 0 || parsed.entries.length !== 1) {
        throw new Error(`unexpected parse result: ${JSON.stringify(parsed)}`);
    }

    const patch = buildGeometryNormalizedDataPatch(parsed.entries[0]!, "2026-07-09T00:00:00.000Z");
    if (patch.geometry_status !== "manual_reviewed") {
        throw new Error("expected manual_reviewed geometry_status");
    }

    const plan = buildPlaceholderGeometryUpdatePlan(
        parsed.entries,
        new Map([
            [
                19370,
                {
                    stop_id: 19370,
                    name: "test",
                    name_en: "Aung San Railway Station",
                    review_status: "needs_review",
                    is_active: false,
                    lon: 96.1,
                    lat: 19.7,
                    normalized_data: { generation: TRAIN_IMPORT_GENERATION },
                },
            ],
        ]),
        { activateStops: false, reviewedAtIso: "2026-07-09T00:00:00.000Z" },
    );
    if (plan.length !== 1 || plan[0]?.action !== "update") {
        throw new Error("expected one update plan item");
    }

    const reviewedPlan = buildPlaceholderGeometryUpdatePlan(
        parsed.entries,
        new Map([
            [
                19370,
                {
                    stop_id: 19370,
                    name: "test",
                    name_en: "Aung San Railway Station",
                    review_status: "reviewed",
                    is_active: false,
                    lon: 96.123456,
                    lat: 16.987654,
                    normalized_data: {
                        generation: TRAIN_IMPORT_GENERATION,
                        geometry_status: "manual_reviewed",
                    },
                },
            ],
        ]),
        { activateStops: true, reviewedAtIso: "2026-07-09T00:00:00.000Z" },
    );
    if (reviewedPlan[0]?.action !== "activate_only") {
        throw new Error("expected activate_only for reviewed stop with --activate-stops");
    }

    console.log("ok - update-placeholder-station-geometry self-test");
}

async function main(): Promise<void> {
    const { reportPath: reportOutputPath, result } = await updatePlaceholderStationGeometry(
        parseCliArgs(process.argv.slice(2)),
    );
    printSummary(reportOutputPath, result);
}

const isCliEntry = process.argv[1]?.includes("update-placeholder-station-geometry.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("update-placeholder-station-geometry.ts") &&
    process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runUpdatePlaceholderStationGeometrySelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
