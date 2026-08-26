/**
 * Phase 7: prepare YBS route and stop geometry before Supabase import.
 *
 * Read-only against Supabase. No inserts, updates, or deletes.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import {
    BLOCK_CODE_GEOMETRY_NOT_READY,
    EXISTING_GEOM_SOURCE,
    GENERATED_REVIEW_STATUS,
    PHASE7_SCHEMA_VERSION,
    PLACEHOLDER_GEOM_CONFIDENCE_SCORE,
    PLACEHOLDER_GEOMETRY_MODE,
    ROUTE_PATH_KIND,
    buildExistingStopNormalizedData,
    buildRouteStopReviewGeometryData,
    buildStraightLineReviewRoutePath,
    buildStraightLineReviewRoutePathNormalizedData,
    buildStraightLineReviewStopNormalizedData,
    fromGeoJsonPoint,
    isValidLngLat,
    resolveStraightLineReviewStopGeometries,
    toGeoJsonPoint,
    validateStopSequences,
    type GeoJsonLineString,
    type GeoJsonPoint,
    type LngLat,
    type ResolvedSequenceStopGeometry,
} from "./geometry-rules.js";
import {
    buildBoardingStopKey,
    buildCandidateId,
    canonicalYbsDirectionName,
    buildStopPlaceKey,
    buildVariantCode,
    normalizeStopMatchingFields,
    ybsDirectionIdFromSourceDirection,
} from "./stop-normalize.js";
import type { StopResolutionPlanEntry } from "./build-stop-resolution.js";

export type PrepareGeometryOptions = {
    runRoot: string;
    databaseUrl?: string;
    skipSupabase?: boolean;
};

type RouteStopRow = {
    sequence?: number;
    stop_name_my?: string | null;
    stop_name_en?: string | null;
    area_text_my?: string | null;
    area_text_en?: string | null;
};

type RouteVariantRow = {
    direction_key?: string;
    stops?: RouteStopRow[];
};

type NormalizedRouteFile = {
    normalization_status?: string;
    route?: Record<string, unknown>;
    variants?: RouteVariantRow[];
};

type StopResolutionPlanFile = {
    plans: StopResolutionPlanEntry[];
};

type VariantStopRow = {
    sequence: number;
    candidate_id: string;
    candidate_key: string;
    stop_place_key: string;
    boarding_stop_key: string;
    stop_name_my: string | null;
    stop_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
};

type ResolvedStopRecord = {
    candidate_id: string;
    candidate_key: string;
    stop_ref: string;
    matched_stop_id: number | null;
    matched_public_id: string | null;
    primary_name_my: string | null;
    primary_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
    geometry: GeoJsonPoint;
    geom_source: string;
    review_status: string;
    confidence_score: number | null;
    resolution_decision: string;
    normalized_data: Record<string, unknown>;
};

export type PreparedVariantRecord = {
    route_code: string;
    variant_code: string;
    direction_key: string;
    direction_name: string;
    gtfs_direction_id: number;
    origin_name: string | null;
    destination_name: string | null;
    total_stops: number;
    reused_existing_geometry_count: number;
    interpolated_geometry_count: number;
    synthetic_placeholder_geometry_count: number;
    missing_geometry_count: number;
    route_path_created: boolean;
    geometry_status: "ready" | "blocked";
    placeholder_geometry_mode: typeof PLACEHOLDER_GEOMETRY_MODE;
    placeholder_line_created: boolean;
    route_path_length_km: number | null;
    expected_visual_line_length_km: number | null;
    generated_stop_points_count: number;
    reused_existing_stop_count: number;
    existing_reused_stops_not_moved_count: number;
    reused_existing_stops_off_line_warning: boolean;
    /** @deprecated Use reused_existing_geometry_count */
    anchor_stop_count?: number;
    /** @deprecated Use interpolated_geometry_count + synthetic_placeholder_geometry_count */
    generated_stop_count?: number;
    /** @deprecated Use total_stops */
    stop_count?: number;
};

type RouteStopLink = {
    route_code: string;
    variant_code: string;
    candidate_id: string;
    sequence: number;
    review_geometry: GeoJsonPoint;
    review_geometry_data: Record<string, unknown>;
    physical_stop_geom_preserved: boolean;
};

type RoutePathRecord = {
    route_code: string;
    variant_code: string;
    path_kind: typeof ROUTE_PATH_KIND;
    geometry: GeoJsonLineString;
    distance_m: number | null;
    review_status: typeof GENERATED_REVIEW_STATUS;
    confidence_score: number;
    normalized_data: Record<string, unknown>;
};

type BlockedRouteRecord = {
    route_code: string;
    variant_code?: string;
    block_code: typeof BLOCK_CODE_GEOMETRY_NOT_READY | "ROUTE_PATH_POINTS_INSUFFICIENT" | "INVALID_VARIANT_STRUCTURE";
    message: string;
};

type GeometryWarning = {
    code: string;
    message: string;
    route_code?: string;
    variant_code?: string;
    candidate_id?: string;
    sequence?: number;
};

export type VariantGeometryReportRow = {
    route_code: string;
    variant_code: string;
    stop_count: number;
    total_stops: number;
    reused_existing_geometry_count: number;
    interpolated_geometry_count: number;
    synthetic_placeholder_geometry_count: number;
    missing_geometry_count: number;
    route_path_created: boolean;
    geometry_status: "ready" | "blocked";
    placeholder_geometry_mode: typeof PLACEHOLDER_GEOMETRY_MODE;
    placeholder_line_created: boolean;
    route_path_length_km: number | null;
    expected_visual_line_length_km: number | null;
    generated_stop_points_count: number;
    reused_existing_stop_count: number;
    existing_reused_stops_not_moved_count: number;
    reused_existing_stops_off_line_warning: boolean;
    route_stop_review_geom_count: number;
    reused_stop_real_geom_count: number;
    placeholder_display_points_count: number;
    physical_stop_geom_not_modified_count: number;
};

export type RoutesWithGeometryOutput = {
    schema_version: number;
    generated_at: string;
    run_root: string;
    prepared_routes: Array<Record<string, unknown>>;
    prepared_variants: PreparedVariantRecord[];
    variant_geometry_reports: VariantGeometryReportRow[];
    resolved_stops: ResolvedStopRecord[];
    route_stops: RouteStopLink[];
    route_paths: RoutePathRecord[];
    blocked_routes: BlockedRouteRecord[];
    geometry_warnings: GeometryWarning[];
};

export type Phase7GeometryReport = {
    generated_at: string;
    run_root: string;
    summary: {
        route_files_processed: number;
        prepared_routes: number;
        prepared_variants: number;
        resolved_stops: number;
        route_stops: number;
        route_paths: number;
        blocked_routes: number;
        geometry_warnings: number;
        reused_existing_geometry_count: number;
        interpolated_geometry_count: number;
        synthetic_placeholder_geometry_count: number;
        missing_geometry_count: number;
        variants_ready: number;
        variants_blocked: number;
        placeholder_warnings: number;
        route_stop_review_geom_count: number;
        reused_stop_real_geom_count: number;
        placeholder_display_points_count: number;
        physical_stop_geom_not_modified_count: number;
    };
    variant_reports: VariantGeometryReportRow[];
};

function repoRoot(): string {
    return process.cwd();
}

function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.join(repoRoot(), relativePath);
}

function loadDatabaseEnv(): void {
    const candidates = [
        path.join(repoRoot(), "apps/api/.env"),
        path.join(repoRoot(), "infrastructure/.env"),
    ];

    for (const envPath of candidates) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
        }
    }
}

function resolveDatabaseUrl(explicit?: string): string | undefined {
    return (
        explicit ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.LOCAL_DATABASE_URL
    );
}

function listJsonFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(dir, name))
        .sort((left, right) => left.localeCompare(right));
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function routeCodeFromFile(file: NormalizedRouteFile, filePath: string): string {
    const route = file.route ?? {};
    const fromRoute =
        (typeof route.route_code === "string" && route.route_code.trim()) ||
        (typeof route.route_code_candidate === "string" && route.route_code_candidate.trim());
    return fromRoute || path.basename(filePath, ".json");
}

function canUsePlanAsGeometryAnchor(plan: StopResolutionPlanEntry | undefined): boolean {
    if (!plan) {
        return false;
    }

    if (typeof plan.can_use_as_geometry_anchor === "boolean") {
        return plan.can_use_as_geometry_anchor;
    }

    if (!plan.matched_stop_id) {
        return false;
    }

    return (
        plan.decision === "reuse_existing_stop" ||
        plan.decision === "merge_additional_data_to_existing"
    );
}

function getAnchorGeometryFromPlan(plan: StopResolutionPlanEntry | undefined): LngLat | null {
    if (!canUsePlanAsGeometryAnchor(plan)) {
        return null;
    }

    if (
        plan?.existing_lng !== null &&
        plan?.existing_lng !== undefined &&
        plan?.existing_lat !== null &&
        plan?.existing_lat !== undefined
    ) {
        const point = { lng: plan.existing_lng, lat: plan.existing_lat };
        if (isValidLngLat(point)) {
            return point;
        }
    }

    if (plan?.existing_geom_geojson) {
        const point = fromGeoJsonPoint(plan.existing_geom_geojson);
        if (isValidLngLat(point)) {
            return point;
        }
    }

    return null;
}

async function loadStopGeometriesByIds(
    databaseUrl: string,
    stopIds: number[],
): Promise<Map<number, LngLat>> {
    if (stopIds.length === 0) {
        return new Map();
    }

    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 120_000,
    });

    try {
        const client = await pool.connect();
        try {
            await client.query("BEGIN READ ONLY");
            await client.query("SET TRANSACTION READ ONLY");

            const result = await client.query<{
                id: string;
                lng: string;
                lat: string;
            }>(
                `
                SELECT
                    s.id::text,
                    ST_X(s.geom)::text AS lng,
                    ST_Y(s.geom)::text AS lat
                FROM transport.stops s
                WHERE s.deleted_at IS NULL
                  AND s.id = ANY($1::bigint[])
                `,
                [stopIds],
            );

            await client.query("COMMIT");

            const map = new Map<number, LngLat>();
            for (const row of result.rows) {
                const point = {
                    lng: Number(row.lng),
                    lat: Number(row.lat),
                };
                if (isValidLngLat(point)) {
                    map.set(Number(row.id), point);
                }
            }

            return map;
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
}

function blockedVariantMetrics(
    stopCount: number,
    missingCount: number = stopCount,
): Pick<
    PreparedVariantRecord,
    | "placeholder_geometry_mode"
    | "placeholder_line_created"
    | "route_path_length_km"
    | "expected_visual_line_length_km"
    | "generated_stop_points_count"
    | "reused_existing_stop_count"
    | "existing_reused_stops_not_moved_count"
    | "reused_existing_stops_off_line_warning"
> {
    return {
        placeholder_geometry_mode: PLACEHOLDER_GEOMETRY_MODE,
        placeholder_line_created: false,
        route_path_length_km: null,
        expected_visual_line_length_km: null,
        generated_stop_points_count: 0,
        reused_existing_stop_count: 0,
        existing_reused_stops_not_moved_count: 0,
        reused_existing_stops_off_line_warning: false,
    };
}

function buildVariantStops(
    routeCode: string,
    variant: RouteVariantRow,
): { variantCode: string; directionKey: string; stops: VariantStopRow[] } | null {
    const directionKey = variant.direction_key?.trim().toLowerCase();
    if (!directionKey) {
        return null;
    }

    const variantCode = buildVariantCode(routeCode, directionKey);
    const stops: VariantStopRow[] = [];

    for (const stop of variant.stops ?? []) {
        const normalized = normalizeStopMatchingFields({
            stop_name_my: stop.stop_name_my ?? null,
            stop_name_en: stop.stop_name_en ?? null,
            area_text_my: stop.area_text_my ?? null,
            area_text_en: stop.area_text_en ?? null,
        });
        const stopPlaceKey = buildStopPlaceKey(normalized);
        const boardingStopKey = buildBoardingStopKey(normalized, directionKey);

        stops.push({
            sequence: typeof stop.sequence === "number" ? stop.sequence : 0,
            candidate_id: buildCandidateId(boardingStopKey),
            candidate_key: boardingStopKey,
            stop_place_key: stopPlaceKey,
            boarding_stop_key: boardingStopKey,
            stop_name_my: stop.stop_name_my ?? null,
            stop_name_en: stop.stop_name_en ?? null,
            area_text_my: stop.area_text_my ?? null,
            area_text_en: stop.area_text_en ?? null,
        });
    }

    return {
        variantCode,
        directionKey,
        stops: stops.sort((left, right) => left.sequence - right.sequence),
    };
}

function firstLastStopNames(stops: VariantStopRow[]): {
    origin_name: string | null;
    destination_name: string | null;
} {
    if (stops.length === 0) {
        return { origin_name: null, destination_name: null };
    }

    const first = stops[0];
    const last = stops[stops.length - 1];
    return {
        origin_name: first.stop_name_my ?? first.stop_name_en,
        destination_name: last.stop_name_my ?? last.stop_name_en,
    };
}

function buildStopNormalizedData(
    resolved: ResolvedSequenceStopGeometry,
    variantCode: string,
    matchedStopId: number | null,
): Record<string, unknown> {
    if (resolved.geometry_quality === "existing" && matchedStopId) {
        return buildExistingStopNormalizedData(
            matchedStopId,
            variantCode,
            resolved.sequence,
            resolved.review_geometry,
        );
    }

    return buildStraightLineReviewStopNormalizedData(
        variantCode,
        resolved.sequence,
        resolved.geometry,
    );
}

function renderReportMarkdown(report: Phase7GeometryReport, output: RoutesWithGeometryOutput): string {
    const blockedLines =
        output.blocked_routes.length > 0
            ? output.blocked_routes
                  .map(
                      (item) =>
                          `- ${item.route_code}${item.variant_code ? ` / ${item.variant_code}` : ""}: ${item.block_code}`,
                  )
                  .join("\n")
            : "- None";

    const variantLines =
        report.variant_reports.length > 0
            ? report.variant_reports
                  .map(
                      (item) =>
                          `- ${item.route_code} / ${item.variant_code}: ${item.geometry_status}, mode=${item.placeholder_geometry_mode}, stops=${item.stop_count}, reused=${item.reused_existing_stop_count}, generated=${item.generated_stop_points_count}, path_km=${item.route_path_length_km ?? "n/a"}, off_line_warning=${item.reused_existing_stops_off_line_warning}`,
                  )
                  .join("\n")
            : "- None";

    const warningLines =
        output.geometry_warnings.length > 0
            ? output.geometry_warnings
                  .slice(0, 20)
                  .map((item) => `- ${item.code}: ${item.message}`)
                  .join("\n")
            : "- None";

    return [
        "# Phase 7 YBS Geometry Report",
        "",
        `Generated at: ${report.generated_at}`,
        `Run root: ${report.run_root}`,
        "",
        "## Summary",
        "",
        `- Route files processed: ${report.summary.route_files_processed}`,
        `- Prepared routes: ${report.summary.prepared_routes}`,
        `- Prepared variants: ${report.summary.prepared_variants}`,
        `- Resolved stops with geometry: ${report.summary.resolved_stops}`,
        `- Route stops: ${report.summary.route_stops}`,
        `- Route paths: ${report.summary.route_paths}`,
        `- Variants ready: ${report.summary.variants_ready}`,
        `- Variants blocked: ${report.summary.variants_blocked}`,
        `- Reused existing geometry: ${report.summary.reused_existing_geometry_count}`,
        `- Interpolated geometry: ${report.summary.interpolated_geometry_count}`,
        `- Synthetic placeholder geometry: ${report.summary.synthetic_placeholder_geometry_count}`,
        `- Missing geometry: ${report.summary.missing_geometry_count}`,
        `- Placeholder warnings: ${report.summary.placeholder_warnings}`,
        `- route_stop_review_geom_count: ${report.summary.route_stop_review_geom_count}`,
        `- reused_stop_real_geom_count: ${report.summary.reused_stop_real_geom_count}`,
        `- placeholder_display_points_count: ${report.summary.placeholder_display_points_count}`,
        `- physical_stop_geom_not_modified_count: ${report.summary.physical_stop_geom_not_modified_count}`,
        `- Blocked routes: ${report.summary.blocked_routes}`,
        `- Geometry warnings: ${report.summary.geometry_warnings}`,
        "",
        "## Variant geometry",
        "",
        variantLines,
        "",
        "## Blocked routes",
        "",
        blockedLines,
        "",
        "## Geometry warnings",
        "",
        warningLines,
        "",
    ].join("\n");
}

export async function prepareGeometry(
    options: PrepareGeometryOptions,
): Promise<{ output: RoutesWithGeometryOutput; report: Phase7GeometryReport }> {
    const runRoot = resolveFromRepo(options.runRoot);
    const normalizedDir = path.join(runRoot, "normalized", "routes");
    const dbPrepDir = path.join(runRoot, "db-prep");
    const reportsDir = path.join(runRoot, "reports");
    const planPath = path.join(dbPrepDir, "stop-resolution-plan.json");

    fs.mkdirSync(dbPrepDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });

    const planFile = readJsonFile<StopResolutionPlanFile>(planPath);
    const planByCandidateId = new Map(
        planFile.plans.map((plan) => [plan.candidate_id, plan]),
    );

    const matchedStopIds = [
        ...new Set(
            planFile.plans
                .filter(
                    (plan) =>
                        canUsePlanAsGeometryAnchor(plan) && getAnchorGeometryFromPlan(plan) === null,
                )
                .map((plan) => plan.matched_stop_id ?? plan.existing_stop_id)
                .filter((value): value is number => typeof value === "number"),
        ),
    ];

    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    const existingGeometries =
        !options.skipSupabase && databaseUrl
            ? await loadStopGeometriesByIds(databaseUrl, matchedStopIds)
            : new Map<number, LngLat>();

    const routeFiles = listJsonFiles(normalizedDir);
    const preparedRoutes: Array<Record<string, unknown>> = [];
    const preparedVariants: PreparedVariantRecord[] = [];
    const variantGeometryReports: VariantGeometryReportRow[] = [];
    const resolvedStops = new Map<string, ResolvedStopRecord>();
    const routeStops: RouteStopLink[] = [];
    const routePaths: RoutePathRecord[] = [];
    const blockedRoutes: BlockedRouteRecord[] = [];
    const geometryWarnings: GeometryWarning[] = [];

    let totalReusedExisting = 0;
    let totalInterpolated = 0;
    let totalSyntheticPlaceholder = 0;
    let totalMissingGeometry = 0;
    let totalRouteStopReviewGeom = 0;
    let totalReusedStopRealGeom = 0;
    let totalPhysicalStopGeomPreserved = 0;
    let placeholderWarnings = 0;

    for (const filePath of routeFiles) {
        const file = readJsonFile<NormalizedRouteFile>(filePath);
        if (
            file.normalization_status === "blocked_invalid_structure" ||
            file.normalization_status === "blocked_dirty_stop_data"
        ) {
            continue;
        }

        const routeCode = routeCodeFromFile(file, filePath);
        if (!routeCode.trim()) {
            blockedRoutes.push({
                route_code: "unknown",
                block_code: "INVALID_VARIANT_STRUCTURE",
                message: "Route file is missing route_code.",
            });
            continue;
        }

        const route = file.route ?? {};

        preparedRoutes.push({
            route_code: routeCode,
            route_number: route.route_number ?? null,
            route_display_code: route.route_display_code ?? null,
            route_name_my: route.route_name_my ?? null,
            route_name_en: route.route_name_en ?? null,
            public_name: route.public_name ?? route.route_name_my ?? null,
            origin_name: route.origin_name ?? null,
            destination_name: route.destination_name ?? null,
            source_title_my: route.source_title_my ?? null,
            source_title_en: route.source_title_en ?? null,
            route_name_alias_und: route.route_name_alias_und ?? null,
            operator_name: route.operator_name ?? null,
            fare_min: route.fare_min ?? null,
            fare_max: route.fare_max ?? null,
            fare_text: route.fare_text ?? null,
            mode: "bus",
            review_status: GENERATED_REVIEW_STATUS,
            confidence_score: PLACEHOLDER_GEOM_CONFIDENCE_SCORE,
            source_route_file: filePath,
        });

        for (const variant of file.variants ?? []) {
            const built = buildVariantStops(routeCode, variant);
            if (!built) {
                blockedRoutes.push({
                    route_code: routeCode,
                    block_code: "INVALID_VARIANT_STRUCTURE",
                    message: "Variant is missing direction_key.",
                });
                continue;
            }

            const { variantCode, directionKey, stops } = built;
            const { origin_name, destination_name } = firstLastStopNames(stops);

            if (stops.length === 0) {
                blockedRoutes.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    block_code: "INVALID_VARIANT_STRUCTURE",
                    message: "Variant has no stops.",
                });
                preparedVariants.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    direction_key: directionKey,
                    direction_name: canonicalYbsDirectionName(directionKey),
                    gtfs_direction_id: ybsDirectionIdFromSourceDirection(directionKey),
                    origin_name,
                    destination_name,
                    total_stops: 0,
                    reused_existing_geometry_count: 0,
                    interpolated_geometry_count: 0,
                    synthetic_placeholder_geometry_count: 0,
                    missing_geometry_count: 0,
                    route_path_created: false,
                    geometry_status: "blocked",
                    ...blockedVariantMetrics(0, 0),
                });
                continue;
            }

            const sequenceError = validateStopSequences(stops);
            if (sequenceError) {
                blockedRoutes.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    block_code: "INVALID_VARIANT_STRUCTURE",
                    message: sequenceError,
                });
                preparedVariants.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    direction_key: directionKey,
                    direction_name: canonicalYbsDirectionName(directionKey),
                    gtfs_direction_id: ybsDirectionIdFromSourceDirection(directionKey),
                    origin_name,
                    destination_name,
                    total_stops: stops.length,
                    reused_existing_geometry_count: 0,
                    interpolated_geometry_count: 0,
                    synthetic_placeholder_geometry_count: 0,
                    missing_geometry_count: stops.length,
                    route_path_created: false,
                    geometry_status: "blocked",
                    ...blockedVariantMetrics(stops.length),
                });
                continue;
            }

            const blockedConflictStop = stops.find(
                (stop) => planByCandidateId.get(stop.candidate_id)?.decision === "blocked_conflict",
            );
            if (blockedConflictStop) {
                blockedRoutes.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    block_code: BLOCK_CODE_GEOMETRY_NOT_READY,
                    message: `Stop candidate ${blockedConflictStop.candidate_id} is blocked_conflict.`,
                });
                preparedVariants.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    direction_key: directionKey,
                    direction_name: canonicalYbsDirectionName(directionKey),
                    gtfs_direction_id: ybsDirectionIdFromSourceDirection(directionKey),
                    origin_name,
                    destination_name,
                    total_stops: stops.length,
                    reused_existing_geometry_count: 0,
                    interpolated_geometry_count: 0,
                    synthetic_placeholder_geometry_count: 0,
                    missing_geometry_count: stops.length,
                    route_path_created: false,
                    geometry_status: "blocked",
                    ...blockedVariantMetrics(stops.length),
                });
                continue;
            }

            const sequenceRows = stops.map((stop) => {
                const plan = planByCandidateId.get(stop.candidate_id);
                let geometry: LngLat | null = getAnchorGeometryFromPlan(plan);
                let geomSource: string | null = geometry ? EXISTING_GEOM_SOURCE : null;

                if (!geometry && canUsePlanAsGeometryAnchor(plan)) {
                    const stopId = plan?.matched_stop_id ?? plan?.existing_stop_id ?? null;
                    if (stopId !== null) {
                        const existing = existingGeometries.get(stopId);
                        if (existing) {
                            geometry = existing;
                            geomSource = EXISTING_GEOM_SOURCE;
                        }
                    }
                }

                return {
                    sequence: stop.sequence,
                    candidate_id: stop.candidate_id,
                    geometry,
                    geom_source: geomSource,
                    stop,
                    plan,
                };
            });

            const resolution = resolveStraightLineReviewStopGeometries({
                stops: sequenceRows.map((row) => ({
                    sequence: row.sequence,
                    candidate_id: row.candidate_id,
                    geometry: row.geometry,
                    geom_source: row.geom_source,
                })),
                routeCode,
                directionKey,
            });

            const reusedExistingOffLineWarning = resolution.reused_existing_stop_count > 0;
            if (reusedExistingOffLineWarning) {
                geometryWarnings.push({
                    code: "REUSED_STOPS_OFF_PLACEHOLDER_LINE",
                    message:
                        "Reused existing stops keep real geometry and may visually deviate from the straight-line review path.",
                    route_code: routeCode,
                    variant_code: variantCode,
                });
            }

            let missingGeometryCount = 0;

            for (const row of sequenceRows) {
                const key = `${row.candidate_id}:${row.sequence}`;
                const resolved = resolution.resolved.get(key);

                if (!resolved) {
                    missingGeometryCount++;
                    geometryWarnings.push({
                        code: "STOP_GEOMETRY_UNRESOLVED",
                        message: "Stop could not be assigned geometry even with placeholder rules.",
                        route_code: routeCode,
                        variant_code: variantCode,
                        candidate_id: row.candidate_id,
                        sequence: row.sequence,
                    });
                    continue;
                }

                if (resolved.geometry_quality === "placeholder") {
                    geometryWarnings.push({
                        code: "PLACEHOLDER_GEOMETRY_USED",
                        message: "Synthetic placeholder geometry was generated for validator review.",
                        route_code: routeCode,
                        variant_code: variantCode,
                        candidate_id: row.candidate_id,
                        sequence: row.sequence,
                    });
                    geometryWarnings.push({
                        code: "VALIDATOR_REQUIRED",
                        message: "Stop geometry must be reviewed in dashboard before public release.",
                        route_code: routeCode,
                        variant_code: variantCode,
                        candidate_id: row.candidate_id,
                        sequence: row.sequence,
                    });
                    geometryWarnings.push({
                        code: "LOW_GEOMETRY_CONFIDENCE",
                        message: `Placeholder geometry confidence is ${PLACEHOLDER_GEOM_CONFIDENCE_SCORE}.`,
                        route_code: routeCode,
                        variant_code: variantCode,
                        candidate_id: row.candidate_id,
                        sequence: row.sequence,
                    });
                    placeholderWarnings += 3;
                }

                const plan = row.plan;
                const isGenerated = resolved.geometry_quality !== "existing";

                if (!resolvedStops.has(row.candidate_id)) {
                    resolvedStops.set(row.candidate_id, {
                        candidate_id: row.candidate_id,
                        candidate_key: row.stop.candidate_key,
                        stop_ref: plan?.matched_stop_id
                            ? `existing:${plan.matched_stop_id}`
                            : `new:${row.candidate_id}`,
                        matched_stop_id: plan?.matched_stop_id ?? null,
                        matched_public_id: plan?.matched_public_id ?? null,
                        primary_name_my: row.stop.stop_name_my,
                        primary_name_en: row.stop.stop_name_en,
                        area_text_my: row.stop.area_text_my,
                        area_text_en: row.stop.area_text_en,
                        geometry: toGeoJsonPoint(resolved.geometry),
                        geom_source: resolved.geom_source,
                        review_status: isGenerated
                            ? GENERATED_REVIEW_STATUS
                            : plan?.matched_review_status ?? GENERATED_REVIEW_STATUS,
                        confidence_score: isGenerated ? resolved.confidence_score : null,
                        resolution_decision: plan?.decision ?? "create_new_stop",
                        normalized_data: buildStopNormalizedData(
                            resolved,
                            variantCode,
                            plan?.matched_stop_id ?? null,
                        ),
                    });
                }

                const reviewPoint = resolved.review_geometry ?? resolved.geometry;
                const physicalStopGeomPreserved =
                    resolved.geometry_quality === "existing" && Boolean(resolved.review_geometry);

                routeStops.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    candidate_id: row.candidate_id,
                    sequence: row.sequence,
                    review_geometry: toGeoJsonPoint(reviewPoint),
                    review_geometry_data: buildRouteStopReviewGeometryData(),
                    physical_stop_geom_preserved: physicalStopGeomPreserved,
                });
            }

            const reviewPath = buildStraightLineReviewRoutePath(routeCode, directionKey);
            const lineString = reviewPath?.geometry ?? null;
            const routePathCreated = missingGeometryCount === 0 && Boolean(lineString);

            if (!routePathCreated) {
                blockedRoutes.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    block_code: lineString ? BLOCK_CODE_GEOMETRY_NOT_READY : "ROUTE_PATH_POINTS_INSUFFICIENT",
                    message: missingGeometryCount > 0
                        ? `${missingGeometryCount} stop(s) still lack geometry after placeholder generation.`
                        : "Straight-line review path could not be generated.",
                });
            } else {
                routePaths.push({
                    route_code: routeCode,
                    variant_code: variantCode,
                    path_kind: ROUTE_PATH_KIND,
                    geometry: lineString as GeoJsonLineString,
                    distance_m: reviewPath?.line.length_m ?? null,
                    review_status: GENERATED_REVIEW_STATUS,
                    confidence_score: PLACEHOLDER_GEOM_CONFIDENCE_SCORE,
                    normalized_data: buildStraightLineReviewRoutePathNormalizedData(),
                });

                geometryWarnings.push({
                    code: "PLACEHOLDER_GEOMETRY_USED",
                    message: "Route path uses straight-line review placeholder geometry.",
                    route_code: routeCode,
                    variant_code: variantCode,
                });
                geometryWarnings.push({
                    code: "VALIDATOR_REQUIRED",
                    message: "Route path must be reviewed in dashboard before public release.",
                    route_code: routeCode,
                    variant_code: variantCode,
                });
                placeholderWarnings += 2;
            }

            const variantReport: VariantGeometryReportRow = {
                route_code: routeCode,
                variant_code: variantCode,
                stop_count: stops.length,
                total_stops: stops.length,
                reused_existing_geometry_count: resolution.reused_existing_geometry_count,
                interpolated_geometry_count: resolution.interpolated_geometry_count,
                synthetic_placeholder_geometry_count: resolution.synthetic_placeholder_geometry_count,
                missing_geometry_count: missingGeometryCount,
                route_path_created: routePathCreated,
                geometry_status: routePathCreated && missingGeometryCount === 0 ? "ready" : "blocked",
                placeholder_geometry_mode: PLACEHOLDER_GEOMETRY_MODE,
                placeholder_line_created: routePathCreated,
                route_path_length_km: reviewPath
                    ? Number((reviewPath.line.length_m / 1000).toFixed(3))
                    : null,
                expected_visual_line_length_km: reviewPath?.line.expected_visual_line_length_km ?? null,
                generated_stop_points_count: resolution.generated_stop_points_count,
                reused_existing_stop_count: resolution.reused_existing_stop_count,
                existing_reused_stops_not_moved_count: resolution.existing_reused_stops_not_moved_count,
                reused_existing_stops_off_line_warning: reusedExistingOffLineWarning,
                route_stop_review_geom_count: stops.length,
                reused_stop_real_geom_count: resolution.reused_existing_geometry_count,
                placeholder_display_points_count: stops.length,
                physical_stop_geom_not_modified_count: resolution.existing_reused_stops_not_moved_count,
            };
            variantGeometryReports.push(variantReport);

            preparedVariants.push({
                route_code: routeCode,
                variant_code: variantCode,
                direction_key: directionKey,
                direction_name: canonicalYbsDirectionName(directionKey),
                gtfs_direction_id: ybsDirectionIdFromSourceDirection(directionKey),
                origin_name,
                destination_name,
                total_stops: stops.length,
                reused_existing_geometry_count: resolution.reused_existing_geometry_count,
                interpolated_geometry_count: resolution.interpolated_geometry_count,
                synthetic_placeholder_geometry_count: resolution.synthetic_placeholder_geometry_count,
                missing_geometry_count: missingGeometryCount,
                route_path_created: routePathCreated,
                geometry_status: variantReport.geometry_status,
                placeholder_geometry_mode: PLACEHOLDER_GEOMETRY_MODE,
                placeholder_line_created: routePathCreated,
                route_path_length_km: variantReport.route_path_length_km,
                expected_visual_line_length_km: variantReport.expected_visual_line_length_km,
                generated_stop_points_count: resolution.generated_stop_points_count,
                reused_existing_stop_count: resolution.reused_existing_stop_count,
                existing_reused_stops_not_moved_count: resolution.existing_reused_stops_not_moved_count,
                reused_existing_stops_off_line_warning: reusedExistingOffLineWarning,
                anchor_stop_count: resolution.reused_existing_geometry_count,
                generated_stop_count:
                    resolution.interpolated_geometry_count +
                    resolution.synthetic_placeholder_geometry_count,
                stop_count: stops.length,
            });

            totalReusedExisting += resolution.reused_existing_geometry_count;
            totalInterpolated += resolution.interpolated_geometry_count;
            totalSyntheticPlaceholder += resolution.synthetic_placeholder_geometry_count;
            totalMissingGeometry += missingGeometryCount;
            totalRouteStopReviewGeom += stops.length;
            totalReusedStopRealGeom += resolution.reused_existing_geometry_count;
            totalPhysicalStopGeomPreserved += resolution.existing_reused_stops_not_moved_count;
        }
    }

    const output: RoutesWithGeometryOutput = {
        schema_version: PHASE7_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        run_root: runRoot,
        prepared_routes: preparedRoutes,
        prepared_variants: preparedVariants,
        variant_geometry_reports: variantGeometryReports,
        resolved_stops: [...resolvedStops.values()].sort((left, right) =>
            left.candidate_id.localeCompare(right.candidate_id),
        ),
        route_stops: routeStops,
        route_paths: routePaths,
        blocked_routes: blockedRoutes,
        geometry_warnings: geometryWarnings,
    };

    const variantsReady = preparedVariants.filter((item) => item.geometry_status === "ready").length;
    const variantsBlocked = preparedVariants.filter((item) => item.geometry_status === "blocked").length;

    const report: Phase7GeometryReport = {
        generated_at: output.generated_at,
        run_root: runRoot,
        summary: {
            route_files_processed: routeFiles.length,
            prepared_routes: preparedRoutes.length,
            prepared_variants: preparedVariants.length,
            resolved_stops: output.resolved_stops.length,
            route_stops: routeStops.length,
            route_paths: routePaths.length,
            blocked_routes: blockedRoutes.length,
            geometry_warnings: geometryWarnings.length,
            reused_existing_geometry_count: totalReusedExisting,
            interpolated_geometry_count: totalInterpolated,
            synthetic_placeholder_geometry_count: totalSyntheticPlaceholder,
            missing_geometry_count: totalMissingGeometry,
            variants_ready: variantsReady,
            variants_blocked: variantsBlocked,
            placeholder_warnings: placeholderWarnings,
            route_stop_review_geom_count: totalRouteStopReviewGeom,
            reused_stop_real_geom_count: totalReusedStopRealGeom,
            placeholder_display_points_count: totalRouteStopReviewGeom,
            physical_stop_geom_not_modified_count: totalPhysicalStopGeomPreserved,
        },
        variant_reports: variantGeometryReports,
    };

    const outputPath = path.join(dbPrepDir, "routes-with-geometry.json");
    const reportJsonPath = path.join(reportsDir, "phase7-geometry-report.json");
    const reportMarkdownPath = path.join(reportsDir, "phase7-geometry-report.md");

    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(reportMarkdownPath, `${renderReportMarkdown(report, output)}\n`, "utf8");

    return { output, report };
}

function parseCliArgs(argv: string[]): PrepareGeometryOptions {
    let runRoot = "tmp/transport-imports/ybs-all";
    let databaseUrl: string | undefined;
    let skipSupabase = false;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        } else if (arg === "--skip-supabase") {
            skipSupabase = true;
        }
    }

    return { runRoot, databaseUrl, skipSupabase };
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const { report } = await prepareGeometry(parseCliArgs(process.argv.slice(2)));

    console.log("Phase 7 geometry preparation complete.");
    console.log(`Route files processed: ${report.summary.route_files_processed}`);
    console.log(`Prepared routes: ${report.summary.prepared_routes}`);
    console.log(`Prepared variants: ${report.summary.prepared_variants}`);
    console.log(`Variants ready: ${report.summary.variants_ready}`);
    console.log(`Variants blocked: ${report.summary.variants_blocked}`);
    console.log(`Resolved stops with geometry: ${report.summary.resolved_stops}`);
    console.log(`Route paths: ${report.summary.route_paths}`);
    console.log(`Reused existing geometry: ${report.summary.reused_existing_geometry_count}`);
    console.log(`Interpolated geometry: ${report.summary.interpolated_geometry_count}`);
    console.log(
        `Synthetic placeholder geometry: ${report.summary.synthetic_placeholder_geometry_count}`,
    );
    console.log(`Missing geometry: ${report.summary.missing_geometry_count}`);
    console.log(`Placeholder warnings: ${report.summary.placeholder_warnings}`);
    console.log(`Blocked routes: ${report.summary.blocked_routes}`);
    console.log(`Geometry warnings: ${report.summary.geometry_warnings}`);
}

const isMainModule =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
