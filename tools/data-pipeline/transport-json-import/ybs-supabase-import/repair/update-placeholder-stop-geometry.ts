#!/usr/bin/env npx tsx
/**
 * Apply manually reviewed coordinates to YBS placeholder bus stops (one row per stop).
 *
 * Input: tmp/transport-imports/reviewed-stop-geometry.json
 *
 * Updates:
 * - transport.stops.geom + normalized_data
 * - transport.route_stops.review_geom for YBS usages (map display uses review_geom when set)
 *
 * Default: dry-run. Pass --execute to commit.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/repair/update-placeholder-stop-geometry.ts
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/repair/update-placeholder-stop-geometry.ts --execute
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/repair/update-placeholder-stop-geometry.ts --execute --activate-stops
 */

import fs from "node:fs";
import process from "node:process";

import type pg from "pg";

import {
    BUS_MODE,
    UPDATE_PLACEHOLDER_STOP_GEOMETRY_REPORT,
    YBS_SOURCE_KIND,
    YBS_SOURCE_NAME,
    buildManualReviewedRouteStopGeometryData,
    buildManualReviewedStopNormalizedDataPatch,
    defaultBusGeometryRunPaths,
    ensureBusGeometryRunLayout,
    isEligibleBusStopReviewStatus,
    isValidWgs84Coordinate,
    isWithinMyanmarBounds,
    loadDatabaseEnv,
    placeholderBusStopGeometrySql,
    reportPath,
    resolveDatabaseUrl,
    reviewedStopGeometryInputPath,
    withWriteClient,
    ybsStopSourceLinkExistsSql,
} from "../lib/placeholder-bus-stop-geometry.js";
import { rebuildSearchFamiliesPg } from "../../../../search-index/rebuild-search-families-pg.js";

const REPORT_FILENAME = UPDATE_PLACEHOLDER_STOP_GEOMETRY_REPORT;

export type ReviewedStopGeometryInput = {
    stop_id: number;
    name_en?: string | null;
    lon: number;
    lat: number;
    review_note?: string | null;
};

export type EligibleBusStopRow = {
    stop_id: number;
    name: string;
    name_en: string | null;
    review_status: string;
    is_active: boolean;
    lon: number | null;
    lat: number | null;
    normalized_data: Record<string, unknown> | null;
    ybs_route_stop_count: number;
};

export type PlaceholderStopGeometryUpdatePlanItem = {
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
    ybs_route_stops_to_update: number;
};

export type PlaceholderStopGeometryUpdateResult = {
    dry_run: boolean;
    executed: boolean;
    activate_stops: boolean;
    input_file: string;
    updated_count: number;
    activated_count: number;
    route_stops_updated_count: number;
    skipped_count: number;
    invalid_input_count: number;
    items: PlaceholderStopGeometryUpdatePlanItem[];
};

export type UpdatePlaceholderStopGeometryOptions = {
    runRoot?: string;
    inputFile?: string;
    databaseUrl?: string;
    execute?: boolean;
    activateStops?: boolean;
};

function trimToNull(value: string | null | undefined): string | null {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function parseReviewedStopGeometryInput(raw: unknown): {
    entries: ReviewedStopGeometryInput[];
    errors: string[];
} {
    if (!Array.isArray(raw)) {
        return { entries: [], errors: ["Input file must be a JSON array"] };
    }

    const entries: ReviewedStopGeometryInput[] = [];
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
): Promise<Map<number, EligibleBusStopRow>> {
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
        ybs_route_stop_count: string;
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
            s.normalized_data,
            (
                SELECT count(*)::text
                FROM transport.route_stops AS rs
                INNER JOIN transport.route_variants AS rv
                    ON rv.id = rs.route_variant_id
                   AND rv.deleted_at IS NULL
                INNER JOIN transport.routes AS r
                    ON r.id = rv.route_id
                   AND r.deleted_at IS NULL
                INNER JOIN transport.source_links AS sl_route
                    ON sl_route.entity_type = 'route'
                   AND sl_route.entity_id = r.id
                   AND sl_route.source_name = $3
                   AND sl_route.source_kind = $4
                   AND sl_route.external_id LIKE 'route:ybs_go:%'
                WHERE rs.stop_id = s.id
            ) AS ybs_route_stop_count
        FROM transport.stops AS s
        WHERE s.id = ANY($1::bigint[])
          AND s.mode = $2
          AND s.deleted_at IS NULL
          AND s.review_status IN ('imported_unreviewed', 'needs_review', 'reviewed')
          AND ${ybsStopSourceLinkExistsSql("s")}
          AND ${placeholderBusStopGeometrySql("s")}
        `,
        [stopIds, BUS_MODE, YBS_SOURCE_NAME, YBS_SOURCE_KIND],
    );

    return new Map(
        result.rows
            .filter((row) => isEligibleBusStopReviewStatus(row.review_status))
            .map((row) => [
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
                    ybs_route_stop_count: Number(row.ybs_route_stop_count),
                },
            ]),
    );
}

export function buildPlaceholderStopGeometryUpdatePlan(
    inputs: ReviewedStopGeometryInput[],
    eligibleById: Map<number, EligibleBusStopRow>,
    options: { activateStops: boolean; reviewedAtIso: string },
): PlaceholderStopGeometryUpdatePlanItem[] {
    return inputs.map((input) => {
        const stop = eligibleById.get(input.stop_id);
        const normalized_data_patch = buildManualReviewedStopNormalizedDataPatch({
            lon: input.lon,
            lat: input.lat,
            review_note: input.review_note,
            reviewedAtIso: options.reviewedAtIso,
        });

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
                    "stop not found or not eligible (bus + ybs_go source + placeholder/manual_reviewed geometry)",
                normalized_data_patch,
                activate_stop: options.activateStops,
                ybs_route_stops_to_update: 0,
            };
        }

        const sameCoordinates = coordsMatch(stop.lon, stop.lat, input.lon, input.lat);
        const alreadyManualReviewed = stop.normalized_data?.geometry_status === "manual_reviewed";

        if (!alreadyManualReviewed && sameCoordinates) {
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
                skip_reason:
                    "coordinates unchanged from current placeholder; edit lon/lat in reviewed-stop-geometry.json before execute",
                normalized_data_patch,
                activate_stop: options.activateStops,
                ybs_route_stops_to_update: stop.ybs_route_stop_count,
            };
        }

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
                    ybs_route_stops_to_update: 0,
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
                ybs_route_stops_to_update: stop.ybs_route_stop_count,
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
            ybs_route_stops_to_update: stop.ybs_route_stop_count,
        };
    });
}

async function applyPlaceholderStopGeometryUpdate(
    client: pg.PoolClient,
    item: PlaceholderStopGeometryUpdatePlanItem,
): Promise<{ stopUpdated: boolean; routeStopsUpdated: number }> {
    const stopResult = await client.query<{ id: string }>(
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
          AND s.review_status IN ('imported_unreviewed', 'needs_review', 'reviewed')
          AND ${ybsStopSourceLinkExistsSql("s")}
          AND ${placeholderBusStopGeometrySql("s")}
        RETURNING s.id::text
        `,
        [
            item.stop_id,
            item.new_lon,
            item.new_lat,
            item.activate_stop,
            JSON.stringify(item.normalized_data_patch ?? {}),
            BUS_MODE,
        ],
    );

    const routeStopReviewData = buildManualReviewedRouteStopGeometryData({
        lon: item.new_lon,
        lat: item.new_lat,
        stop_id: item.stop_id,
    });

    const routeStopResult = await client.query<{ id: string }>(
        `
        UPDATE transport.route_stops AS rs
        SET
            review_geom = ST_SetSRID(ST_MakePoint($2, $3), 4326),
            review_geometry_data = $4::jsonb,
            updated_at = now()
        FROM transport.route_variants AS rv
        INNER JOIN transport.routes AS r
            ON r.id = rv.route_id
           AND r.deleted_at IS NULL
        INNER JOIN transport.source_links AS sl_route
            ON sl_route.entity_type = 'route'
           AND sl_route.entity_id = r.id
           AND sl_route.source_name = $5
           AND sl_route.source_kind = $6
           AND sl_route.external_id LIKE 'route:ybs_go:%'
        WHERE rs.stop_id = $1
          AND rs.route_variant_id = rv.id
          AND rv.deleted_at IS NULL
        RETURNING rs.id::text
        `,
        [
            item.stop_id,
            item.new_lon,
            item.new_lat,
            JSON.stringify(routeStopReviewData),
            YBS_SOURCE_NAME,
            YBS_SOURCE_KIND,
        ],
    );

    return {
        stopUpdated: stopResult.rowCount === 1,
        routeStopsUpdated: routeStopResult.rowCount ?? 0,
    };
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
          AND ${ybsStopSourceLinkExistsSql("s")}
          AND s.is_active = false
        RETURNING s.id::text
        `,
        [stopId, BUS_MODE],
    );

    return result.rowCount === 1;
}

/** Apply reviewed placeholder bus stop geometry updates from local JSON. */
export async function updatePlaceholderStopGeometry(
    options: UpdatePlaceholderStopGeometryOptions = {},
): Promise<{ reportPath: string; result: PlaceholderStopGeometryUpdateResult }> {
    const paths = defaultBusGeometryRunPaths(options.runRoot);
    ensureBusGeometryRunLayout(paths);

    const inputPath = reviewedStopGeometryInputPath(paths, options.inputFile);
    if (!fs.existsSync(inputPath)) {
        throw new Error(
            `Input file not found: ${inputPath}. Run report-placeholder-bus-stops.ts --write-input-template first.`,
        );
    }

    const parsed = parseReviewedStopGeometryInput(
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

    let routeStopsUpdatedTotal = 0;

    const result = await withWriteClient(databaseUrl, async (client) => {
        const eligibleById = await loadEligibleStops(
            client,
            parsed.entries.map((entry) => entry.stop_id),
        );
        const items = buildPlaceholderStopGeometryUpdatePlan(parsed.entries, eligibleById, {
            activateStops,
            reviewedAtIso,
        });

        if (execute) {
            for (const item of items) {
                if (item.action === "update") {
                    const applied = await applyPlaceholderStopGeometryUpdate(client, item);
                    routeStopsUpdatedTotal += applied.routeStopsUpdated;
                    if (!applied.stopUpdated) {
                        item.action = "skip";
                        item.skip_reason = "geometry update affected 0 rows (stop no longer eligible)";
                    } else {
                        item.ybs_route_stops_to_update = applied.routeStopsUpdated;
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
            route_stops_updated_count: execute
                ? routeStopsUpdatedTotal
                : items
                      .filter((item) => item.action === "update")
                      .reduce((sum, item) => sum + item.ybs_route_stops_to_update, 0),
            skipped_count: items.filter((item) => item.action === "skip").length,
            invalid_input_count: 0,
            items,
        } satisfies PlaceholderStopGeometryUpdateResult;
    });

    const report = {
        generated_at: new Date().toISOString(),
        source_name: YBS_SOURCE_NAME,
        source_kind: YBS_SOURCE_KIND,
        mode: BUS_MODE,
        ...result,
    };

    const reportOutputPath = reportPath(paths, REPORT_FILENAME);
    fs.writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    if (execute && (result.updated_count > 0 || result.activated_count > 0)) {
        await rebuildSearchFamiliesPg(databaseUrl, ["bus_stops"]);
    }

    return { reportPath: reportOutputPath, result };
}

function parseCliArgs(argv: string[]): UpdatePlaceholderStopGeometryOptions {
    const options: UpdatePlaceholderStopGeometryOptions = {};

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

async function main(): Promise<void> {
    const { reportPath: reportOutputPath, result } = await updatePlaceholderStopGeometry(
        parseCliArgs(process.argv.slice(2)),
    );

    console.log(`Report: ${reportOutputPath}`);
    console.log(
        `Mode: ${result.executed ? "EXECUTE" : "DRY-RUN"} | updated=${result.updated_count} activated=${result.activated_count} route_stops=${result.route_stops_updated_count} skipped=${result.skipped_count}`,
    );

    for (const item of result.items.slice(0, 15)) {
        console.log(
            `  stop_id=${item.stop_id} action=${item.action}` +
                (item.skip_reason ? ` reason=${item.skip_reason}` : "") +
                (item.action === "update"
                    ? ` route_stops=${item.ybs_route_stops_to_update} lon=${item.new_lon} lat=${item.new_lat}`
                    : ""),
        );
    }

    if (result.items.length > 15) {
        console.log(`  ... ${result.items.length - 15} more in report`);
    }

    if (!result.executed && result.updated_count > 0) {
        console.log("");
        console.log("Pass --execute to apply geometry updates.");
    }
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("update-placeholder-stop-geometry.ts") ||
        process.argv[1].endsWith("update-placeholder-stop-geometry.js"));

if (isMain) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
