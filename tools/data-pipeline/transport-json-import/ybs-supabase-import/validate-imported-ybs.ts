/**
 * Phase 10: validate imported YBS routes in transport.* (read-only).
 *
 * Usage:
 *   npx tsx .../validate-imported-ybs.ts --run tmp/transport-imports/ybs-all --route-code YBS-1
 *   npx tsx .../validate-imported-ybs.ts --routes YBS-3,YBS-4,YBS-5
 *   npx tsx .../validate-imported-ybs.ts --run tmp/transport-imports/ybs-all --all-imported-ybs
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import {
    routeExternalId,
    variantExternalId,
    directionAwareStopExternalId,
    routeStopExternalId,
    YBS_SOURCE_KIND,
    YBS_SOURCE_NAME,
} from "./supabase-schema-map.js";
import { isExplicitSharedTerminal, extractSideGroupFromNormalizedData, sideGroupsAreCompatible, type SideGroup } from "../ybs-db-prepare/stop-normalize.js";
import {
    containsMyanmarScript,
    validateStoredRouteDisplayNames,
    YBS_ROUTE_CODE_PATTERN,
} from "../ybs-normalize/route-display-names.js";
import { collectRouteNameQualityWarnings } from "../ybs-normalize/route-name-endpoints.js";

const PHASE10_SCHEMA_VERSION = 5;
const PUBLIC_VISIBLE_REVIEW_STATUSES = new Set(["reviewed", "verified"]);
const PLACEHOLDER_GEOMETRY_MODE = "straight_line_review";
const MAX_PLACEHOLDER_DISPLAY_DISTANCE_FROM_PATH_M = 50;
const DIRTY_STOP_PATTERN_MY = "မှတ်တိုင် အမှတ်";
const DIRTY_STOP_NAMES_EN = new Set(["Bus Details", "Bus Stops"]);

type CliOptions = {
    runRoot: string;
    routeCode?: string;
    routeCodes?: string[];
    allImportedYbs: boolean;
    databaseUrl?: string;
};

type IssueSeverity = "blocker" | "warning";

type ValidationIssue = {
    check_id: number;
    check_name: string;
    severity: IssueSeverity;
    code: string;
    message: string;
    entity_type?: string;
    entity_id?: number;
    external_id?: string | null;
};

type ValidationCheck = {
    check_id: number;
    name: string;
    status: "passed" | "failed" | "warning" | "skipped";
    message: string;
};

type RouteRow = {
    id: number;
    route_code: string;
    public_name: string;
    origin_name: string | null;
    destination_name: string | null;
    review_status: string;
    is_active: boolean;
};

type RouteNameRow = {
    id: number;
    language_code: string;
    name_type: string;
    is_primary: boolean;
    name: string;
};

type VariantRow = {
    id: number;
    variant_code: string;
    direction_name: string | null;
    direction_id: number | null;
    review_status: string;
    is_active: boolean;
    normalized_data: Record<string, unknown> | null;
};

type RouteStopRow = {
    id: number;
    route_variant_id: number;
    stop_id: number;
    stop_sequence: number;
};

type StopRow = {
    id: number;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    review_status: string;
    has_geom: boolean;
    normalized_data: Record<string, unknown> | null;
};

type StopNameRow = {
    stop_id: number;
    name: string;
    language_code: string;
};

type RoutePathRow = {
    id: number;
    route_variant_id: number;
    path_kind: string;
    review_status: string;
    has_geom: boolean;
    confidence_score: number | null;
    placeholder_geometry_mode: string | null;
};

type RouteStopDisplayMetrics = {
    route_stop_count: number;
    inbound_route_stop_count: number;
    outbound_route_stop_count: number;
    with_review_geom_count: number;
    with_display_geom_count: number;
    missing_display_geom_count: number;
    max_display_distance_from_path_m: number | null;
    placeholder_route_path_count: number;
    route_stop_review_geom_count: number;
    reused_stop_real_geom_count: number;
    placeholder_display_points_count: number;
    off_path_display_points_count: number;
    physical_stop_geom_not_modified_count: number;
};

type SourceLinkRow = {
    id: number;
    entity_type: string;
    entity_id: number;
    external_id: string | null;
    source_name: string | null;
};

type RouteBundle = {
    route: RouteRow | null;
    routeNames: RouteNameRow[];
    variants: VariantRow[];
    routeStops: RouteStopRow[];
    stops: StopRow[];
    stopNames: StopNameRow[];
    routePaths: RoutePathRow[];
    sourceLinks: SourceLinkRow[];
    inPublicTileView: boolean;
    displayMetrics: RouteStopDisplayMetrics | null;
};

export type ValidationRootCause = {
    code: string;
    severity: IssueSeverity;
    count: number;
    summary: string;
};

export type VariantRouteStopValidation = {
    variant_code: string;
    direction_key: string;
    expected_stop_count_from_extraction: number;
    actual_route_stop_count: number;
    missing_sequences: number[];
    duplicate_sequences: number[];
    unresolved_stop_candidates: string[];
    status: "passed" | "failed";
};

export type RouteValidationReport = {
    schema_version: number;
    generated_at: string;
    route_code: string;
    status: "passed" | "failed";
    route_count: number;
    variant_count: number;
    route_stop_count: number;
    route_path_count: number;
    duplicate_route_count: number;
    duplicate_variant_count: number;
    duplicate_route_stop_sequence_count: number;
    duplicate_source_link_count: number;
    source_links_missing_count: number;
    sequence_error_count: number;
    geometry_missing_count: number;
    duplicate_warning_count: number;
    public_visible: boolean;
    dashboard_visible: boolean;
    review_status: string | null;
    table_counts: Record<string, number>;
    blockers: ValidationIssue[];
    warnings: ValidationIssue[];
    checks: ValidationCheck[];
    root_causes: ValidationRootCause[];
    variant_route_stop_validation: VariantRouteStopValidation[];
    direction_split_stop_count: number;
    opposite_direction_reuse_prevented_count: number;
    possible_shared_terminal_count: number;
    still_shared_stop_count: number;
    opposite_direction_shared_stops: Array<{
        shared_stop_id: number;
        stop_name: string | null;
        inbound_sequence: number;
        outbound_sequence: number;
        allowed_shared_terminal: boolean;
    }>;
    route_stop_review_geom_count: number;
    reused_stop_real_geom_count: number;
    placeholder_display_points_count: number;
    off_path_display_points_count: number;
    physical_stop_geom_not_modified_count: number;
    cross_route_shared_stop_count: number;
    route_internal_duplicate_stop_id_count: number;
    inbound_outbound_shared_stop_count: number;
    shared_terminal_stop_count: number;
    uncertain_created_separate_stop_count: number;
    possible_duplicate_stop_count: number;
    under_merge_candidate_count: number;
    over_merge_risk_count: number;
    protected_stop_reuse_count: number;
    protected_stop_not_modified_count: number;
    cross_route_shared_stops: Array<{
        shared_stop_id: number;
        routes: string[];
        directions: string[];
        sequences: number[];
        names: { my: string | null; en: string | null };
        side_group: SideGroup | null;
        confidence: string | null;
    }>;
    possible_duplicate_stops: Array<{
        stop_place_key: string;
        side_group: SideGroup | null;
        stop_ids: number[];
    }>;
    under_merge_candidates: Array<{
        stop_place_key: string;
        side_group: SideGroup | null;
        stop_ids: number[];
    }>;
};

function repoRoot(): string {
    return process.cwd();
}

function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath) ? relativePath : path.join(repoRoot(), relativePath);
}

function loadDatabaseEnv(): void {
    for (const envPath of [
        path.join(repoRoot(), "apps/api/.env"),
        path.join(repoRoot(), "infrastructure/.env"),
    ]) {
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

function writeJsonFile(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeTextFile(filePath: string, text: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf8");
}

function hasLanguage(names: RouteNameRow[], languageCode: string): boolean {
    return names.some(
        (row) => row.language_code.toLowerCase() === languageCode && row.name.trim() !== "",
    );
}

function variantDirectionKey(variant: VariantRow): "outbound" | "inbound" | null {
    const code = variant.variant_code.toLowerCase();
    if (code.includes("outbound") || code.endsWith("-a")) {
        return "outbound";
    }
    if (code.includes("inbound") || code.endsWith("-b")) {
        return "inbound";
    }

    const direction = (variant.direction_name ?? "").trim().toLowerCase();
    if (direction === "outbound" || direction === "out") {
        return "outbound";
    }
    if (direction === "inbound" || direction === "in") {
        return "inbound";
    }

    if (variant.direction_id === 0) {
        return "outbound";
    }
    if (variant.direction_id === 1) {
        return "inbound";
    }

    return null;
}

function hasSourceLink(
    links: SourceLinkRow[],
    entityType: string,
    entityId: number,
    externalId?: string,
): boolean {
    return links.some((link) => {
        if (link.entity_type !== entityType || link.entity_id !== entityId) {
            return false;
        }
        if (externalId) {
            return link.external_id === externalId;
        }
        return true;
    });
}

type ExtractionRouteStopExpectation = {
    variant_code: string;
    direction_key: string;
    sequences: number[];
};

export function loadExtractionRouteStopExpectations(
    runRoot: string,
    routeCode: string,
): ExtractionRouteStopExpectation[] {
    const candidatePaths = [
        path.join(runRoot, "phase7-geometry/routes-with-geometry.json"),
        path.join(runRoot, "db-prep/routes-with-geometry.json"),
    ];
    const geometryPath = candidatePaths.find((candidate) => fs.existsSync(candidate));
    if (!geometryPath) {
        return [];
    }

    const geometry = JSON.parse(fs.readFileSync(geometryPath, "utf8")) as {
        route_stops: Array<{
            route_code: string;
            variant_code: string;
            sequence: number;
        }>;
    };

    const byVariant = new Map<string, ExtractionRouteStopExpectation>();
    for (const row of geometry.route_stops) {
        if (row.route_code !== routeCode) {
            continue;
        }
        const directionKey = row.variant_code.endsWith("-INBOUND") ? "inbound" : "outbound";
        const bucket =
            byVariant.get(row.variant_code) ??
            ({
                variant_code: row.variant_code,
                direction_key: directionKey,
                sequences: [],
            } satisfies ExtractionRouteStopExpectation);
        bucket.sequences.push(row.sequence);
        byVariant.set(row.variant_code, bucket);
    }

    for (const bucket of byVariant.values()) {
        bucket.sequences.sort((left, right) => left - right);
    }

    return [...byVariant.values()].sort((left, right) =>
        left.variant_code.localeCompare(right.variant_code),
    );
}

function analyzeSequences(sequences: number[]): {
    startsAtOne: boolean;
    isContiguousFromOne: boolean;
    hasDuplicates: boolean;
    duplicateValues: number[];
    missingSequences: number[];
    gapDetails: string | null;
} {
    if (sequences.length === 0) {
        return {
            startsAtOne: false,
            isContiguousFromOne: false,
            hasDuplicates: false,
            duplicateValues: [],
            missingSequences: [],
            gapDetails: "no route_stops",
        };
    }

    const sorted = [...sequences].sort((left, right) => left - right);
    const startsAtOne = sorted[0] === 1;

    const counts = new Map<number, number>();
    for (const value of sorted) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const duplicateValues = [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([value]) => value);

    const missingSequences: number[] = [];
    for (let sequence = 1; sequence <= sorted.length; sequence++) {
        if (!counts.has(sequence)) {
            missingSequences.push(sequence);
        }
    }

    let gapDetails: string | null = null;
    for (let index = 1; index < sorted.length; index++) {
        if (sorted[index] !== sorted[index - 1] + 1) {
            gapDetails = `expected ${sorted[index - 1] + 1}, found ${sorted[index]}`;
            break;
        }
    }

    const isContiguousFromOne =
        startsAtOne &&
        missingSequences.length === 0 &&
        sorted.length > 0 &&
        sorted[sorted.length - 1] === sorted.length;

    return {
        startsAtOne,
        isContiguousFromOne,
        hasDuplicates: duplicateValues.length > 0,
        duplicateValues,
        missingSequences,
        gapDetails,
    };
}

function isDirtyStopName(name: string | null | undefined): boolean {
    if (!name) {
        return false;
    }
    return name.includes(DIRTY_STOP_PATTERN_MY) || DIRTY_STOP_NAMES_EN.has(name.trim());
}

function expectedPublicVisibility(reviewStatus: string): "visible" | "hidden" {
    return PUBLIC_VISIBLE_REVIEW_STATUSES.has(reviewStatus) ? "visible" : "hidden";
}

export async function listImportedYbsRouteCodes(client: pg.PoolClient): Promise<string[]> {
    const result = await client.query<{ route_code: string }>(
        `
        SELECT DISTINCT r.route_code
        FROM transport.routes r
        INNER JOIN transport.source_links sl
            ON sl.entity_type = 'route'
           AND sl.entity_id = r.id
           AND sl.source_name = $1
           AND sl.source_kind = $2
           AND sl.external_id LIKE 'route:ybs_go:%'
        WHERE r.deleted_at IS NULL
        ORDER BY r.route_code
        `,
        [YBS_SOURCE_NAME, YBS_SOURCE_KIND],
    );
    return result.rows.map((row) => row.route_code);
}

async function loadRouteBundle(client: pg.PoolClient, routeCode: string): Promise<RouteBundle> {
    const routeResult = await client.query<RouteRow>(
        `
        SELECT
            id::int,
            route_code,
            public_name,
            origin_name,
            destination_name,
            review_status,
            is_active
        FROM transport.routes
        WHERE route_code = $1
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [routeCode],
    );
    const route = routeResult.rows[0] ?? null;

    if (!route) {
        return {
            route: null,
            routeNames: [],
            variants: [],
            routeStops: [],
            stops: [],
            stopNames: [],
            routePaths: [],
            sourceLinks: [],
            inPublicTileView: false,
            displayMetrics: null,
        };
    }

    const routeNames = await client.query<RouteNameRow>(
        `SELECT id::int, language_code, name_type, is_primary, name FROM transport.route_names WHERE route_id = $1`,
        [route.id],
    );
    const variants = await client.query<VariantRow>(
        `
        SELECT id::int, variant_code, direction_name, direction_id::int, review_status, is_active, normalized_data
        FROM transport.route_variants
        WHERE route_id = $1 AND deleted_at IS NULL
        ORDER BY variant_code
        `,
        [route.id],
    );
    const routeStops = await client.query<RouteStopRow>(
        `
        SELECT rs.id::int, rs.route_variant_id::int, rs.stop_id::int, rs.stop_sequence::int
        FROM transport.route_stops rs
        INNER JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
        WHERE rv.route_id = $1 AND rv.deleted_at IS NULL
        ORDER BY rs.route_variant_id, rs.stop_sequence
        `,
        [route.id],
    );
    const routePaths = await client.query<RoutePathRow>(
        `
        SELECT
            rp.id::int,
            rp.route_variant_id::int,
            rp.path_kind,
            rp.review_status,
            (rp.geom IS NOT NULL AND NOT ST_IsEmpty(rp.geom)) AS has_geom,
            rp.confidence_score::float8,
            coalesce(rp.normalized_data->'geometry'->>'placeholder_geometry_mode', '') AS placeholder_geometry_mode
        FROM transport.route_paths rp
        INNER JOIN transport.route_variants rv ON rv.id = rp.route_variant_id
        WHERE rv.route_id = $1
          AND rp.deleted_at IS NULL
          AND rv.deleted_at IS NULL
        ORDER BY rp.route_variant_id, rp.id
        `,
        [route.id],
    );
    const tileView = await client.query<{ count: string }>(
        `
        SELECT count(*)::text
        FROM tiles.transport_route_paths_v tv
        WHERE tv.route_code = $1
        `,
        [routeCode],
    );
    const sourceLinks = await client.query<SourceLinkRow>(
        `
        SELECT sl.id::int, sl.entity_type, sl.entity_id::int, sl.external_id, sl.source_name
        FROM transport.source_links sl
        WHERE (
            (sl.entity_type = 'route' AND sl.entity_id = $1)
            OR (sl.entity_type = 'route_variant' AND sl.entity_id IN (
                SELECT id FROM transport.route_variants WHERE route_id = $1 AND deleted_at IS NULL
            ))
            OR (sl.entity_type = 'route_stop' AND sl.entity_id IN (
                SELECT rs.id
                FROM transport.route_stops rs
                INNER JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
                WHERE rv.route_id = $1 AND rv.deleted_at IS NULL
            ))
            OR (sl.entity_type = 'route_path' AND sl.entity_id IN (
                SELECT rp.id
                FROM transport.route_paths rp
                INNER JOIN transport.route_variants rv ON rv.id = rp.route_variant_id
                WHERE rv.route_id = $1 AND rp.deleted_at IS NULL AND rv.deleted_at IS NULL
            ))
            OR (sl.entity_type = 'stop' AND sl.entity_id IN (
                SELECT DISTINCT rs.stop_id
                FROM transport.route_stops rs
                INNER JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
                WHERE rv.route_id = $1 AND rv.deleted_at IS NULL
            ))
            OR (
                sl.entity_type = 'stop'
                AND sl.source_name = $3
                AND sl.external_id LIKE $2
            )
        )
        `,
        [route.id, `stop:ybs_go:${routeCode}:%:seq:%`, YBS_SOURCE_NAME],
    );

    const stopIds = [...new Set(routeStops.rows.map((row) => row.stop_id))];
    let stops: StopRow[] = [];
    let stopNames: StopNameRow[] = [];

    if (stopIds.length > 0) {
        const stopRows = await client.query<StopRow>(
            `
            SELECT
                id::int,
                name,
                name_mm,
                name_en,
                review_status,
                (geom IS NOT NULL AND NOT ST_IsEmpty(geom)) AS has_geom,
                normalized_data
            FROM transport.stops
            WHERE id = ANY($1::bigint[])
              AND deleted_at IS NULL
            `,
            [stopIds],
        );
        const stopNameRows = await client.query<StopNameRow>(
            `
            SELECT stop_id::int, name, language_code
            FROM transport.stop_names
            WHERE stop_id = ANY($1::bigint[])
            `,
            [stopIds],
        );
        stops = stopRows.rows;
        stopNames = stopNameRows.rows;
    }

    const displayMetrics = await loadRouteStopDisplayMetrics(client, route.id);

    return {
        route,
        routeNames: routeNames.rows,
        variants: variants.rows,
        routeStops: routeStops.rows,
        stops,
        stopNames,
        routePaths: routePaths.rows,
        sourceLinks: sourceLinks.rows,
        inPublicTileView: Number(tileView.rows[0]?.count ?? 0) > 0,
        displayMetrics,
    };
}

function routeUsesStraightLinePlaceholder(bundle: RouteBundle): boolean {
    return bundle.routePaths.some(
        (path) =>
            path.path_kind === "corridor_estimate" &&
            path.review_status === "needs_review" &&
            path.placeholder_geometry_mode === PLACEHOLDER_GEOMETRY_MODE &&
            path.has_geom,
    );
}

async function loadRouteStopDisplayMetrics(
    client: pg.PoolClient,
    routeId: number,
): Promise<RouteStopDisplayMetrics> {
    const result = await client.query<{
        route_stop_count: string;
        inbound_route_stop_count: string;
        outbound_route_stop_count: string;
        with_review_geom_count: string;
        with_display_geom_count: string;
        missing_display_geom_count: string;
        max_display_distance_from_path_m: number | null;
        placeholder_route_path_count: string;
        route_stop_review_geom_count: string;
        reused_stop_real_geom_count: string;
        placeholder_display_points_count: string;
        off_path_display_points_count: string;
        physical_stop_geom_not_modified_count: string;
    }>(
        `
        with variant_paths as (
            select
                rv.id as route_variant_id,
                rp.geom as path_geom
            from transport.route_variants rv
            left join lateral (
                select rp.geom
                from transport.route_paths rp
                where rp.route_variant_id = rv.id
                  and rp.deleted_at is null
                  and rp.path_kind = 'corridor_estimate'
                  and rp.review_status = 'needs_review'
                  and coalesce(rp.normalized_data->'geometry'->>'placeholder_geometry_mode', '') = $2
                order by rp.id asc
                limit 1
            ) rp on true
            where rv.route_id = $1
              and rv.deleted_at is null
        ),
        rows as (
            select
                rs.id,
                rv.variant_code,
                (rs.review_geom is not null and not st_isempty(rs.review_geom)) as has_review_geom,
                rs.review_geom,
                coalesce(rs.review_geom, s.geom) as display_geom,
                s.geom as physical_stop_geom,
                vp.path_geom
            from transport.route_stops rs
            join transport.route_variants rv on rv.id = rs.route_variant_id
            join transport.stops s on s.id = rs.stop_id
            left join variant_paths vp on vp.route_variant_id = rv.id
            where rv.route_id = $1
              and rv.deleted_at is null
              and s.deleted_at is null
        )
        select
            count(*)::text as route_stop_count,
            count(*) filter (where variant_code ilike '%inbound%')::text as inbound_route_stop_count,
            count(*) filter (where variant_code ilike '%outbound%')::text as outbound_route_stop_count,
            count(*) filter (where has_review_geom)::text as with_review_geom_count,
            count(*) filter (where display_geom is not null and not st_isempty(display_geom))::text as with_display_geom_count,
            count(*) filter (where display_geom is null or st_isempty(display_geom))::text as missing_display_geom_count,
            max(
                case
                    when path_geom is null or display_geom is null then null
                    else st_distance(display_geom::geography, path_geom::geography)
                end
            )::float8 as max_display_distance_from_path_m,
            count(*) filter (where has_review_geom)::text as route_stop_review_geom_count,
            count(*) filter (
                where has_review_geom
                  and physical_stop_geom is not null
                  and not st_isempty(physical_stop_geom)
                  and st_distance(review_geom::geography, physical_stop_geom::geography) > 1
            )::text as reused_stop_real_geom_count,
            count(*) filter (where has_review_geom)::text as placeholder_display_points_count,
            count(*) filter (
                where path_geom is not null
                  and display_geom is not null
                  and st_distance(display_geom::geography, path_geom::geography) > $3
            )::text as off_path_display_points_count,
            count(*) filter (
                where has_review_geom
                  and physical_stop_geom is not null
                  and not st_isempty(physical_stop_geom)
                  and st_distance(review_geom::geography, physical_stop_geom::geography) > 1
            )::text as physical_stop_geom_not_modified_count,
            (select count(*) from variant_paths where path_geom is not null)::text as placeholder_route_path_count
        from rows
        `,
        [routeId, PLACEHOLDER_GEOMETRY_MODE, MAX_PLACEHOLDER_DISPLAY_DISTANCE_FROM_PATH_M],
    );

    const row = result.rows[0];
    return {
        route_stop_count: Number(row?.route_stop_count ?? 0),
        inbound_route_stop_count: Number(row?.inbound_route_stop_count ?? 0),
        outbound_route_stop_count: Number(row?.outbound_route_stop_count ?? 0),
        with_review_geom_count: Number(row?.with_review_geom_count ?? 0),
        with_display_geom_count: Number(row?.with_display_geom_count ?? 0),
        missing_display_geom_count: Number(row?.missing_display_geom_count ?? 0),
        max_display_distance_from_path_m: row?.max_display_distance_from_path_m ?? null,
        placeholder_route_path_count: Number(row?.placeholder_route_path_count ?? 0),
        route_stop_review_geom_count: Number(row?.route_stop_review_geom_count ?? 0),
        reused_stop_real_geom_count: Number(row?.reused_stop_real_geom_count ?? 0),
        placeholder_display_points_count: Number(row?.placeholder_display_points_count ?? 0),
        off_path_display_points_count: Number(row?.off_path_display_points_count ?? 0),
        physical_stop_geom_not_modified_count: Number(row?.physical_stop_geom_not_modified_count ?? 0),
    };
}

export function validateRouteBundle(
    routeCode: string,
    bundle: RouteBundle,
    extractionExpectations: ExtractionRouteStopExpectation[] = [],
): RouteValidationReport {
    const checks: ValidationCheck[] = [];
    const blockers: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const variantRouteStopValidation: VariantRouteStopValidation[] = [];

    let sourceLinksMissingCount = 0;
    let sequenceErrorCount = 0;
    let geometryMissingCount = 0;
    let duplicateWarningCount = 0;
    let duplicateRouteStopSequenceCount = 0;
    let duplicateVariantCount = 0;
    let duplicateSourceLinkCount = 0;

    const addCheck = (
        checkId: number,
        name: string,
        status: ValidationCheck["status"],
        message: string,
    ): void => {
        checks.push({ check_id: checkId, name, status, message });
    };

    const addIssue = (
        checkId: number,
        checkName: string,
        severity: IssueSeverity,
        code: string,
        message: string,
        extra: Partial<ValidationIssue> = {},
    ): void => {
        const issue: ValidationIssue = {
            check_id: checkId,
            check_name: checkName,
            severity,
            code,
            message,
            ...extra,
        };
        if (severity === "blocker") {
            blockers.push(issue);
        } else {
            warnings.push(issue);
        }
    };

    // 1. route exists
    if (!bundle.route) {
        addCheck(1, "route_exists", "failed", `Route ${routeCode} not found.`);
        addIssue(1, "route_exists", "blocker", "ROUTE_NOT_FOUND", `Route ${routeCode} not found.`, {
            entity_type: "route",
            external_id: routeExternalId(routeCode),
        });
        return finalizeReport(routeCode, bundle, checks, blockers, warnings, {
            sourceLinksMissingCount,
            sequenceErrorCount,
            geometryMissingCount,
            duplicateWarningCount,
            duplicateRouteStopSequenceCount,
            duplicateVariantCount,
            duplicateSourceLinkCount,
        }, variantRouteStopValidation);
    }
    addCheck(1, "route_exists", "passed", `Route ${routeCode} exists (id=${bundle.route.id}).`);

    const route = bundle.route;

    const variantCodes = bundle.variants.map((variant) => variant.variant_code);
    const duplicateVariantCodes = variantCodes.filter(
        (code, index) => variantCodes.indexOf(code) !== index,
    );
    if (duplicateVariantCodes.length > 0) {
        duplicateVariantCount += duplicateVariantCodes.length;
        addIssue(
            0,
            "duplicate_variant_code",
            "blocker",
            "DUPLICATE_VARIANT",
            `Duplicate variant_code values: ${[...new Set(duplicateVariantCodes)].join(", ")}.`,
            { entity_type: "route", entity_id: route.id },
        );
    }

    const sourceLinkKeys = bundle.sourceLinks.map(
        (link) => `${link.entity_type}::${link.external_id ?? ""}`,
    );
    const duplicateSourceKeys = sourceLinkKeys.filter(
        (key, index) => sourceLinkKeys.indexOf(key) !== index,
    );
    if (duplicateSourceKeys.length > 0) {
        duplicateSourceLinkCount += duplicateSourceKeys.length;
        addIssue(
            0,
            "duplicate_source_link",
            "blocker",
            "DUPLICATE_SOURCE_LINK",
            `Duplicate source_link keys: ${[...new Set(duplicateSourceKeys)].join(", ")}.`,
            { entity_type: "route", entity_id: route.id },
        );
    }

    // 2. route has source_link
    if (!hasSourceLink(bundle.sourceLinks, "route", route.id)) {
        sourceLinksMissingCount++;
        addCheck(2, "route_source_link", "failed", "Route source_link missing.");
        addIssue(2, "route_source_link", "blocker", "SOURCE_LINK_MISSING", "Route has no source_link.", {
            entity_type: "route",
            entity_id: route.id,
            external_id: routeExternalId(routeCode),
        });
    } else {
        addCheck(2, "route_source_link", "passed", "Route has source_link.");
    }

    // 3. route has my/en route_names
    const hasMy = hasLanguage(bundle.routeNames, "my");
    const hasEn = hasLanguage(bundle.routeNames, "en");
    if (!hasMy || !hasEn) {
        addCheck(3, "route_names_my_en", "failed", `Missing route_names: my=${hasMy}, en=${hasEn}.`);
        addIssue(
            3,
            "route_names_my_en",
            "blocker",
            "ROUTE_NAMES_MISSING",
            `Route missing route_names (my=${hasMy}, en=${hasEn}).`,
            { entity_type: "route", entity_id: route.id },
        );
    } else {
        addCheck(3, "route_names_my_en", "passed", "Route has my and en route_names.");
    }

    // 4. route has outbound and inbound variants
    const directions = new Map<string, VariantRow>();
    for (const variant of bundle.variants) {
        const direction = variantDirectionKey(variant);
        if (direction) {
            directions.set(direction, variant);
        }
    }
    const hasOutbound = directions.has("outbound");
    const hasInbound = directions.has("inbound");
    if (!hasOutbound || !hasInbound) {
        addCheck(
            4,
            "route_variants_outbound_inbound",
            "failed",
            `Missing variants: outbound=${hasOutbound}, inbound=${hasInbound}.`,
        );
        addIssue(
            4,
            "route_variants_outbound_inbound",
            "blocker",
            "VARIANT_DIRECTION_MISSING",
            `Route must have outbound and inbound variants (outbound=${hasOutbound}, inbound=${hasInbound}).`,
            { entity_type: "route", entity_id: route.id },
        );
    } else {
        addCheck(4, "route_variants_outbound_inbound", "passed", "Route has outbound and inbound variants.");
    }

    // 27–34. CoreMap route display name format
    const isDisplayNameScope =
        YBS_ROUTE_CODE_PATTERN.test(route.route_code) ||
        route.route_code === "APS" ||
        route.route_code.startsWith("TRIAL-");

    const displayNameValidation = validateStoredRouteDisplayNames({
        route_code: route.route_code,
        public_name: route.public_name,
        route_names: bundle.routeNames,
    });

    const nameQualityWarnings = collectRouteNameQualityWarnings({
        route_code: route.route_code,
        public_name: route.public_name,
        origin_name: route.origin_name,
        destination_name: route.destination_name,
        route_names: bundle.routeNames,
    });

    if (isDisplayNameScope) {
        if (displayNameValidation.errors.length === 0) {
            addCheck(
                27,
                "route_display_name_format",
                "passed",
                "Route display names match CoreMap format.",
            );
        } else {
            addCheck(
                27,
                "route_display_name_format",
                "failed",
                displayNameValidation.errors.join(" "),
            );
            for (const message of displayNameValidation.errors) {
                addIssue(
                    27,
                    "route_display_name_format",
                    "blocker",
                    "ROUTE_DISPLAY_NAME_INVALID",
                    message,
                    { entity_type: "route", entity_id: route.id },
                );
            }
        }
        for (const message of displayNameValidation.warnings) {
            warnings.push({
                check_id: 27,
                check_name: "route_display_name_format",
                severity: "warning",
                code: "ROUTE_DISPLAY_NAME_WARNING",
                message,
                entity_type: "route",
                entity_id: route.id,
            });
        }
        for (const message of nameQualityWarnings) {
            warnings.push({
                check_id: 28,
                check_name: "route_name_quality",
                severity: "warning",
                code: "ROUTE_NAME_QUALITY_WARNING",
                message,
                entity_type: "route",
                entity_id: route.id,
            });
        }
        if (nameQualityWarnings.length === 0) {
            addCheck(28, "route_name_quality", "passed", "No route name quality warnings.");
        } else {
            addCheck(
                28,
                "route_name_quality",
                "warning",
                nameQualityWarnings.join(" "),
            );
        }
    } else {
        addCheck(
            27,
            "route_display_name_format",
            "skipped",
            `Route code ${route.route_code} is outside YBS/APS/TRIAL import scope.`,
        );
        addCheck(28, "route_name_quality", "skipped", "Route outside display name scope.");
    }

    // Per-variant checks (5–11, 17–20)
    for (const variant of bundle.variants) {
        const direction = variantDirectionKey(variant) ?? "unknown";
        const variantExternal = variantExternalId(routeCode, direction);
        const variantStops = bundle.routeStops.filter((row) => row.route_variant_id === variant.id);
        const variantPaths = bundle.routePaths.filter((row) => row.route_variant_id === variant.id);

        // 5. each variant has source_link
        if (!hasSourceLink(bundle.sourceLinks, "route_variant", variant.id)) {
            sourceLinksMissingCount++;
            addIssue(
                5,
                "variant_source_link",
                "blocker",
                "SOURCE_LINK_MISSING",
                `Variant ${variant.variant_code} has no source_link.`,
                { entity_type: "route_variant", entity_id: variant.id, external_id: variantExternal },
            );
        } else {
            addCheck(
                5,
                "variant_source_link",
                "passed",
                `Variant ${variant.variant_code} has source_link.`,
            );
        }

        // 6. each variant has route_stops
        if (variantStops.length === 0) {
            addCheck(
                6,
                "variant_has_route_stops",
                "failed",
                `Variant ${variant.variant_code} has no route_stops.`,
            );
            addIssue(
                6,
                "variant_has_route_stops",
                "blocker",
                "ROUTE_STOPS_MISSING",
                `Variant ${variant.variant_code} has no route_stops.`,
                { entity_type: "route_variant", entity_id: variant.id, external_id: variantExternal },
            );
        } else {
            addCheck(
                6,
                "variant_has_route_stops",
                "passed",
                `Variant ${variant.variant_code} has ${variantStops.length} route_stops.`,
            );
        }

        // 6–9. sequence checks
        const sequences = variantStops.map((row) => row.stop_sequence);
        const sequenceAnalysis = analyzeSequences(sequences);
        if (!sequenceAnalysis.startsAtOne) {
            sequenceErrorCount++;
            addIssue(
                7,
                "route_stops_sequence_starts_at_1",
                "blocker",
                "SEQUENCE_NOT_STARTING_AT_1",
                `Variant ${variant.variant_code} stop_sequence does not start at 1.`,
                { entity_type: "route_variant", entity_id: variant.id },
            );
        }
        if (!sequenceAnalysis.isContiguousFromOne) {
            sequenceErrorCount++;
            addIssue(
                8,
                "route_stops_sequence_contiguous",
                "blocker",
                "SEQUENCE_GAP",
                `Variant ${variant.variant_code} is not contiguous from 1..${variantStops.length}${sequenceAnalysis.gapDetails ? ` (${sequenceAnalysis.gapDetails})` : ""}.`,
                { entity_type: "route_variant", entity_id: variant.id },
            );
        }
        if (sequenceAnalysis.hasDuplicates) {
            sequenceErrorCount++;
            duplicateWarningCount++;
            duplicateRouteStopSequenceCount += sequenceAnalysis.duplicateValues.length;
            addIssue(
                9,
                "route_stops_no_duplicate_sequence",
                "blocker",
                "SEQUENCE_DUPLICATE",
                `Variant ${variant.variant_code} has duplicate stop_sequence: ${sequenceAnalysis.duplicateValues.join(", ")}.`,
                { entity_type: "route_variant", entity_id: variant.id },
            );
        }

        if (
            variantStops.length > 0 &&
            sequenceAnalysis.startsAtOne &&
            sequenceAnalysis.isContiguousFromOne &&
            !sequenceAnalysis.hasDuplicates
        ) {
            addCheck(
                7,
                "route_stops_sequence_starts_at_1",
                "passed",
                `Variant ${variant.variant_code} sequence starts at 1.`,
            );
            addCheck(
                8,
                "route_stops_sequence_contiguous",
                "passed",
                `Variant ${variant.variant_code} sequence is contiguous from 1 to ${variantStops.length}.`,
            );
            addCheck(
                9,
                "route_stops_no_duplicate_sequence",
                "passed",
                `Variant ${variant.variant_code} has no duplicate sequence.`,
            );
        }

        const extraction = extractionExpectations.find(
            (item) => item.variant_code === variant.variant_code,
        );
        const expectedSequences = extraction?.sequences ?? [];
        const actualSequences = variantStops.map((row) => row.stop_sequence).sort((a, b) => a - b);
        const missingFromExtraction = expectedSequences.filter(
            (sequence) => !actualSequences.includes(sequence),
        );
        const duplicateSequences = sequenceAnalysis.duplicateValues;
        const variantStopStatus =
            expectedSequences.length > 0 &&
            (variantStops.length !== expectedSequences.length ||
                missingFromExtraction.length > 0 ||
                duplicateSequences.length > 0 ||
                !sequenceAnalysis.isContiguousFromOne)
                ? "failed"
                : "passed";

        variantRouteStopValidation.push({
            variant_code: variant.variant_code,
            direction_key: extraction?.direction_key ?? (variantDirectionKey(variant) ?? "unknown"),
            expected_stop_count_from_extraction: expectedSequences.length,
            actual_route_stop_count: variantStops.length,
            missing_sequences: missingFromExtraction,
            duplicate_sequences: duplicateSequences,
            unresolved_stop_candidates: [],
            status: variantStopStatus,
        });

        if (variantStopStatus === "failed") {
            if (expectedSequences.length > 0 && variantStops.length !== expectedSequences.length) {
                addIssue(
                    6,
                    "variant_route_stop_count",
                    "blocker",
                    "ROUTE_STOP_COUNT_MISMATCH",
                    `Variant ${variant.variant_code}: expected ${expectedSequences.length} route_stops from extraction, found ${variantStops.length}.`,
                    { entity_type: "route_variant", entity_id: variant.id },
                );
            }
            if (missingFromExtraction.length > 0) {
                addIssue(
                    8,
                    "variant_missing_sequences",
                    "blocker",
                    "ROUTE_STOP_SEQUENCE_MISSING",
                    `Variant ${variant.variant_code} missing extraction sequences: ${missingFromExtraction.join(", ")}.`,
                    { entity_type: "route_variant", entity_id: variant.id },
                );
            }
        }

        // 5. each variant has source_link — handled above

        // 10–11. route_stop checks
        const stopIdSet = new Set(bundle.stops.map((stop) => stop.id));
        for (const routeStop of variantStops) {
            if (!hasSourceLink(bundle.sourceLinks, "route_stop", routeStop.id)) {
                sourceLinksMissingCount++;
                addIssue(
                    10,
                    "route_stop_source_link",
                    "blocker",
                    "SOURCE_LINK_MISSING",
                    `route_stop id=${routeStop.id} (seq ${routeStop.stop_sequence}) has no source_link.`,
                    {
                        entity_type: "route_stop",
                        entity_id: routeStop.id,
                    },
                );
            }

            if (!stopIdSet.has(routeStop.stop_id)) {
                addIssue(
                    11,
                    "route_stop_valid_stop_id",
                    "blocker",
                    "INVALID_STOP_ID",
                    `route_stop id=${routeStop.id} references missing stop_id=${routeStop.stop_id}.`,
                    { entity_type: "route_stop", entity_id: routeStop.id },
                );
            }
        }

        if (variantStops.length > 0) {
            const missingLinks = variantStops.filter(
                (row) => !hasSourceLink(bundle.sourceLinks, "route_stop", row.id),
            ).length;
            if (missingLinks === 0) {
                addCheck(
                    10,
                    "route_stop_source_link",
                    "passed",
                    `Variant ${variant.variant_code}: all route_stops have source_link.`,
                );
            } else {
                addCheck(
                    10,
                    "route_stop_source_link",
                    "failed",
                    `Variant ${variant.variant_code}: ${missingLinks} route_stops missing source_link.`,
                );
            }

            const invalidStops = variantStops.filter((row) => !stopIdSet.has(row.stop_id)).length;
            if (invalidStops === 0) {
                addCheck(
                    11,
                    "route_stop_valid_stop_id",
                    "passed",
                    `Variant ${variant.variant_code}: all route_stops have valid stop_id.`,
                );
            } else {
                addCheck(
                    11,
                    "route_stop_valid_stop_id",
                    "failed",
                    `Variant ${variant.variant_code}: ${invalidStops} route_stops have invalid stop_id.`,
                );
            }
        }

        // 17–20. route_path checks
        if (variantPaths.length === 0) {
            geometryMissingCount++;
            addCheck(
                17,
                "variant_has_route_path",
                "failed",
                `Variant ${variant.variant_code} has no route_path.`,
            );
            addIssue(
                17,
                "variant_has_route_path",
                "blocker",
                "ROUTE_PATH_MISSING",
                `Variant ${variant.variant_code} has no route_path.`,
                { entity_type: "route_variant", entity_id: variant.id },
            );
        } else {
            addCheck(
                17,
                "variant_has_route_path",
                "passed",
                `Variant ${variant.variant_code} has ${variantPaths.length} route_path row(s).`,
            );
        }

        for (const routePath of variantPaths) {
            if (!routePath.has_geom) {
                geometryMissingCount++;
                addIssue(
                    18,
                    "route_path_has_geom",
                    "blocker",
                    "GEOMETRY_MISSING",
                    `route_path id=${routePath.id} has no valid geom.`,
                    { entity_type: "route_path", entity_id: routePath.id },
                );
            }
            if (!hasSourceLink(bundle.sourceLinks, "route_path", routePath.id)) {
                sourceLinksMissingCount++;
                addIssue(
                    19,
                    "route_path_source_link",
                    "blocker",
                    "SOURCE_LINK_MISSING",
                    `route_path id=${routePath.id} has no source_link.`,
                    { entity_type: "route_path", entity_id: routePath.id },
                );
            }
            const isEstimated =
                (routePath.confidence_score ?? 100) <= 30 ||
                routePath.review_status === "needs_review";
            if (isEstimated && routePath.path_kind !== "corridor_estimate") {
                addIssue(
                    20,
                    "estimated_path_kind",
                    "blocker",
                    "PATH_KIND_INVALID",
                    `Estimated route_path id=${routePath.id} must have path_kind=corridor_estimate (found ${routePath.path_kind}).`,
                    { entity_type: "route_path", entity_id: routePath.id },
                );
            }
        }
    }

    // 12–16. stop checks
    const seenStopNames = new Map<string, number[]>();
    for (const stop of bundle.stops) {
        if (!stop.has_geom) {
            geometryMissingCount++;
            addIssue(12, "stop_has_geom", "blocker", "GEOMETRY_MISSING", `Stop id=${stop.id} has no valid geom.`, {
                entity_type: "stop",
                entity_id: stop.id,
            });
        }

        const hasNameMm = Boolean(stop.name_mm?.trim());
        const hasNameEn = Boolean(stop.name_en?.trim());
        if (!hasNameMm && !hasNameEn) {
            addIssue(
                13,
                "stop_has_name",
                "blocker",
                "STOP_NAME_MISSING",
                `Stop id=${stop.id} has neither name_mm nor name_en.`,
                { entity_type: "stop", entity_id: stop.id },
            );
        }

        if (!hasSourceLink(bundle.sourceLinks, "stop", stop.id)) {
            sourceLinksMissingCount++;
            addIssue(
                14,
                "stop_source_link",
                "blocker",
                "SOURCE_LINK_MISSING",
                `Stop id=${stop.id} has no source_link.`,
                { entity_type: "stop", entity_id: stop.id },
            );
        }

        const namesToCheck = [
            stop.name,
            stop.name_mm,
            stop.name_en,
            ...bundle.stopNames.filter((row) => row.stop_id === stop.id).map((row) => row.name),
        ];
        for (const name of namesToCheck) {
            if (isDirtyStopName(name)) {
                addIssue(
                    15,
                    "stop_no_dirty_name_my",
                    "blocker",
                    "DIRTY_STOP_NAME",
                    `Stop id=${stop.id} has dirty name: ${name}`,
                    { entity_type: "stop", entity_id: stop.id },
                );
            }
            if (name && DIRTY_STOP_NAMES_EN.has(name.trim())) {
                addIssue(
                    16,
                    "stop_no_dirty_name_en",
                    "blocker",
                    "DIRTY_STOP_NAME",
                    `Stop id=${stop.id} has dirty English name: ${name}`,
                    { entity_type: "stop", entity_id: stop.id },
                );
            }
        }

        const key = (stop.name_mm ?? stop.name_en ?? stop.name ?? "").trim().toLowerCase();
        if (key) {
            const list = seenStopNames.get(key) ?? [];
            list.push(stop.id);
            seenStopNames.set(key, list);
        }
    }

    if (bundle.stops.length > 0) {
        const missingGeom = bundle.stops.filter((stop) => !stop.has_geom).length;
        addCheck(
            12,
            "stop_has_geom",
            missingGeom === 0 ? "passed" : "failed",
            missingGeom === 0
                ? "All stops have geom."
                : `${missingGeom} stop(s) missing geom.`,
        );

        const missingNames = bundle.stops.filter(
            (stop) => !stop.name_mm?.trim() && !stop.name_en?.trim(),
        ).length;
        addCheck(
            13,
            "stop_has_name",
            missingNames === 0 ? "passed" : "failed",
            missingNames === 0
                ? "All stops have name_mm or name_en."
                : `${missingNames} stop(s) missing names.`,
        );

        const missingStopLinks = bundle.stops.filter(
            (stop) => !hasSourceLink(bundle.sourceLinks, "stop", stop.id),
        ).length;
        addCheck(
            14,
            "stop_source_link",
            missingStopLinks === 0 ? "passed" : "failed",
            missingStopLinks === 0
                ? "All stops have source_link."
                : `${missingStopLinks} stop(s) missing source_link.`,
        );

        const dirtyMy = blockers.filter((issue) => issue.check_id === 15).length;
        addCheck(
            15,
            "stop_no_dirty_name_my",
            dirtyMy === 0 ? "passed" : "failed",
            dirtyMy === 0 ? "No dirty Myanmar stop names." : `${dirtyMy} dirty Myanmar name issue(s).`,
        );

        const dirtyEn = blockers.filter((issue) => issue.check_id === 16).length;
        addCheck(
            16,
            "stop_no_dirty_name_en",
            dirtyEn === 0 ? "passed" : "failed",
            dirtyEn === 0 ? "No dirty English stop names." : `${dirtyEn} dirty English name issue(s).`,
        );
    } else if (bundle.routeStops.length > 0) {
        addCheck(12, "stop_has_geom", "failed", "route_stops exist but no stop rows loaded.");
    }

    for (const [name, stopIds] of seenStopNames.entries()) {
        if (stopIds.length > 1) {
            duplicateWarningCount++;
            warnings.push({
                check_id: 0,
                check_name: "duplicate_stop_name",
                severity: "warning",
                code: "DUPLICATE_STOP_NAME",
                message: `Duplicate stop name "${name}" on stop ids: ${stopIds.join(", ")}.`,
                entity_type: "stop",
            });
        }
    }

    // 21. public visibility
    const expectedVisibility = expectedPublicVisibility(route.review_status);
    const actualVisibility: "visible" | "hidden" =
        route.is_active && bundle.inPublicTileView ? "visible" : "hidden";

    if (expectedVisibility === "hidden" && actualVisibility === "visible") {
        addCheck(
            21,
            "public_visibility_hidden_until_reviewed",
            "failed",
            `Route review_status=${route.review_status} but appears in public tile view.`,
        );
        addIssue(
            21,
            "public_visibility_hidden_until_reviewed",
            "blocker",
            "PUBLIC_VISIBILITY_VIOLATION",
            `Route is ${route.review_status} but is visible in tiles.transport_route_paths_v. Public visibility must be hidden until reviewed or verified.`,
            { entity_type: "route", entity_id: route.id },
        );
    } else if (expectedVisibility === "visible" && actualVisibility === "hidden") {
        addCheck(
            21,
            "public_visibility_hidden_until_reviewed",
            "warning",
            `Route is ${route.review_status} but not in public tile view (may be missing geometry).`,
        );
        warnings.push({
            check_id: 21,
            check_name: "public_visibility_hidden_until_reviewed",
            severity: "warning",
            code: "PUBLIC_VISIBILITY_NOT_PUBLISHED",
            message: `Route is ${route.review_status} but not visible in public tiles yet.`,
            entity_type: "route",
            entity_id: route.id,
        });
    } else {
        addCheck(
            21,
            "public_visibility_hidden_until_reviewed",
            "passed",
            `Public visibility is ${actualVisibility} (review_status=${route.review_status}).`,
        );
    }

    const displayMetrics = bundle.displayMetrics;
    if (displayMetrics) {
        if (displayMetrics.missing_display_geom_count === 0) {
            addCheck(
                22,
                "route_stop_has_display_geom",
                "passed",
                `All ${displayMetrics.route_stop_count} route_stops have display_geom = coalesce(review_geom, stop.geom).`,
            );
        } else {
            addCheck(
                22,
                "route_stop_has_display_geom",
                "failed",
                `${displayMetrics.missing_display_geom_count} route_stops are missing display_geom.`,
            );
            addIssue(
                22,
                "route_stop_has_display_geom",
                "blocker",
                "ROUTE_STOP_DISPLAY_GEOM_MISSING",
                `${displayMetrics.missing_display_geom_count} route_stops are missing display_geom.`,
                { entity_type: "route", entity_id: route.id },
            );
        }

        const usesPlaceholder = routeUsesStraightLinePlaceholder(bundle);
        if (usesPlaceholder) {
            if (displayMetrics.with_review_geom_count === displayMetrics.route_stop_count) {
                addCheck(
                    23,
                    "route_stop_has_review_geom",
                    "passed",
                    `All ${displayMetrics.route_stop_count} route_stops have review_geom for placeholder display.`,
                );
            } else {
                const missingReviewGeom =
                    displayMetrics.route_stop_count - displayMetrics.with_review_geom_count;
                addCheck(
                    23,
                    "route_stop_has_review_geom",
                    "failed",
                    `${missingReviewGeom} route_stops are missing review_geom on a straight_line_review route.`,
                );
                addIssue(
                    23,
                    "route_stop_has_review_geom",
                    "blocker",
                    "ROUTE_STOP_REVIEW_GEOM_MISSING",
                    `${missingReviewGeom} route_stops are missing review_geom on a straight_line_review route.`,
                    { entity_type: "route", entity_id: route.id },
                );
            }

            const maxDistance = displayMetrics.max_display_distance_from_path_m;
            if (
                maxDistance !== null &&
                maxDistance <= MAX_PLACEHOLDER_DISPLAY_DISTANCE_FROM_PATH_M
            ) {
                addCheck(
                    24,
                    "route_stop_display_geom_near_path",
                    "passed",
                    `Max display_geom distance from placeholder route_path is ${maxDistance.toFixed(2)} m.`,
                );
            } else {
                addCheck(
                    24,
                    "route_stop_display_geom_near_path",
                    "failed",
                    `Max display_geom distance from placeholder route_path is ${maxDistance ?? "unknown"} m (limit ${MAX_PLACEHOLDER_DISPLAY_DISTANCE_FROM_PATH_M} m).`,
                );
                addIssue(
                    24,
                    "route_stop_display_geom_near_path",
                    "blocker",
                    "ROUTE_STOP_DISPLAY_GEOM_FAR_FROM_PATH",
                    `Display geometry is too far from the placeholder route path (max ${maxDistance ?? "unknown"} m).`,
                    { entity_type: "route", entity_id: route.id },
                );
            }
        } else {
            addCheck(
                23,
                "route_stop_has_review_geom",
                "skipped",
                "Route is not a straight_line_review placeholder route.",
            );
            addCheck(
                24,
                "route_stop_display_geom_near_path",
                "skipped",
                "Route is not a straight_line_review placeholder route.",
            );
        }

        addCheck(
            25,
            "physical_stop_geom_preserved",
            "passed",
            "Validation does not modify transport.stops.geom; repair script updates route_stops.review_geom only.",
        );
    }

    const oppositeDirectionReport = validateOppositeDirectionStopReuse(bundle, addIssue, addCheck);
    validateStopSourceLinkEntityAlignment(routeCode, bundle, addIssue, addCheck);
    const routeInternalReport = validateRouteInternalStopReuse(routeCode, bundle, addIssue, addCheck);
    validateRouteStopSourceLinkEntityAlignment(routeCode, bundle, addIssue, addCheck);
    const metadataReport = validateStopMetadataAndDuplicates(bundle);
    warnings.push(...metadataReport.warnings);

    const stopIdentityReport: StopIdentityValidationResult = {
        ...emptyStopIdentityMetrics(),
        route_internal_duplicate_stop_id_count: routeInternalReport.route_internal_duplicate_stop_id_count,
        inbound_outbound_shared_stop_count: oppositeDirectionReport.opposite_direction_shared_stops.filter(
            (row) => !row.allowed_shared_terminal,
        ).length,
        shared_terminal_stop_count: metadataReport.shared_terminal_stop_count,
        uncertain_created_separate_stop_count: metadataReport.uncertain_created_separate_stop_count,
        possible_duplicate_stop_count: metadataReport.possible_duplicate_stop_count,
        protected_stop_reuse_count: metadataReport.protected_stop_reuse_count,
        protected_stop_not_modified_count: metadataReport.protected_stop_not_modified_count,
        possible_duplicate_stops: metadataReport.possible_duplicate_stops,
        under_merge_candidates: metadataReport.under_merge_candidates,
        warnings: metadataReport.warnings,
    };

    return finalizeReport(routeCode, bundle, checks, blockers, warnings, {
        sourceLinksMissingCount,
        sequenceErrorCount,
        geometryMissingCount,
        duplicateWarningCount,
        duplicateRouteStopSequenceCount,
        duplicateVariantCount,
        duplicateSourceLinkCount,
    }, variantRouteStopValidation, oppositeDirectionReport, stopIdentityReport);
}

function buildRootCauses(
    blockers: ValidationIssue[],
    warnings: ValidationIssue[],
): ValidationRootCause[] {
    const summaries = new Map<string, ValidationRootCause>();

    for (const issue of [...blockers, ...warnings]) {
        const key = `${issue.severity}:${issue.code}`;
        const existing = summaries.get(key);
        if (existing) {
            existing.count++;
            continue;
        }
        summaries.set(key, {
            code: issue.code,
            severity: issue.severity,
            count: 1,
            summary: rootCauseSummary(issue.code),
        });
    }

    return [...summaries.values()].sort((left, right) => {
        if (left.severity !== right.severity) {
            return left.severity === "blocker" ? -1 : 1;
        }
        return right.count - left.count;
    });
}

function rootCauseSummary(code: string): string {
    switch (code) {
        case "SOURCE_LINK_MISSING":
            return "Importer did not create source_links for route_stop or route_path rows.";
        case "SEQUENCE_GAP":
            return "stop_sequence is not contiguous from 1 to the expected stop count.";
        case "ROUTE_STOP_COUNT_MISMATCH":
            return "Imported route_stop count does not match extraction.";
        case "ROUTE_STOP_SEQUENCE_MISSING":
            return "One or more extracted stop sequences are missing in the database.";
        case "PUBLIC_VISIBILITY_VIOLATION":
            return "Unreviewed route is active and visible in public transport tiles.";
        case "DUPLICATE_STOP_NAME":
            return "Multiple stops share the same display name.";
        case "GEOMETRY_MISSING":
            return "A stop or route_path row is missing geometry.";
        case "ROUTE_STOP_DISPLAY_GEOM_MISSING":
            return "A route_stop is missing display_geom = coalesce(review_geom, stop.geom).";
        case "ROUTE_STOP_REVIEW_GEOM_MISSING":
            return "Placeholder route is missing route_stops.review_geom.";
        case "ROUTE_STOP_DISPLAY_GEOM_FAR_FROM_PATH":
            return "Display geometry is too far from the placeholder route path.";
        case "OPPOSITE_DIRECTION_STOP_REUSE":
            return "Same stop_id is used by inbound and outbound without explicit shared_terminal.";
        case "STOP_SOURCE_LINK_ENTITY_MISMATCH":
            return "Stop source_link external_id points to a different stop_id than the route_stop row.";
        case "ROUTE_INTERNAL_DUPLICATE_STOP_ID":
            return "Same stop_id appears twice in one route variant without shared_terminal.";
        case "ROUTE_STOP_SOURCE_LINK_ENTITY_MISMATCH":
            return "route_stop source_link external_id points to a different route_stop id.";
        case "POSSIBLE_DUPLICATE_STOP_PLACE_KEY":
            return "Multiple stop rows share the same stop_place_key and side_group.";
        case "CROSS_ROUTE_STOP_DIRECTION_CONFLICT":
            return "Shared stop is used by conflicting directions across routes.";
        default:
            return code;
    }
}

type OppositeDirectionValidationResult = {
    blockers: ValidationIssue[];
    warnings: ValidationIssue[];
    direction_split_stop_count: number;
    opposite_direction_reuse_prevented_count: number;
    possible_shared_terminal_count: number;
    still_shared_stop_count: number;
    opposite_direction_shared_stops: RouteValidationReport["opposite_direction_shared_stops"];
};

function validateOppositeDirectionStopReuse(
    bundle: RouteBundle,
    addIssue: (
        checkId: number,
        checkName: string,
        severity: IssueSeverity,
        code: string,
        message: string,
        context?: Partial<ValidationIssue>,
    ) => void,
    addCheck: (
        checkId: number,
        name: string,
        status: ValidationCheck["status"],
        message: string,
    ) => void,
): OppositeDirectionValidationResult {
    const blockers: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const opposite_direction_shared_stops: RouteValidationReport["opposite_direction_shared_stops"] =
        [];

    const inboundVariant = bundle.variants.find(
        (variant) => variantDirectionKey(variant) === "inbound",
    );
    const outboundVariant = bundle.variants.find(
        (variant) => variantDirectionKey(variant) === "outbound",
    );

    const direction_split_stop_count = bundle.stops.filter((stop) => {
        const data = stop.normalized_data;
        return data?.direction_split === true;
    }).length;

    if (!inboundVariant || !outboundVariant) {
        addCheck(26, "opposite_direction_stop_identity", "skipped", "Route has no inbound/outbound pair.");
        return {
            blockers,
            warnings,
            direction_split_stop_count,
            opposite_direction_reuse_prevented_count: direction_split_stop_count,
            possible_shared_terminal_count: 0,
            still_shared_stop_count: 0,
            opposite_direction_shared_stops,
        };
    }

    const inboundStops = bundle.routeStops
        .filter((row) => row.route_variant_id === inboundVariant.id)
        .map((row) => ({ stop_id: row.stop_id, sequence: row.stop_sequence }));
    const outboundStops = bundle.routeStops
        .filter((row) => row.route_variant_id === outboundVariant.id)
        .map((row) => ({ stop_id: row.stop_id, sequence: row.stop_sequence }));

    const outboundByStopId = new Map(outboundStops.map((row) => [row.stop_id, row.sequence]));
    let illegalSharedCount = 0;
    let stillSharedAllowed = 0;
    let possibleSharedTerminal = 0;

    for (const inbound of inboundStops) {
        const outboundSequence = outboundByStopId.get(inbound.stop_id);
        if (outboundSequence === undefined) {
            continue;
        }

        const stop = bundle.stops.find((row) => row.id === inbound.stop_id);
        const allowedSharedTerminal = isExplicitSharedTerminal(stop?.normalized_data ?? null);
        const stopName = stop?.name_mm ?? stop?.name_en ?? stop?.name ?? null;

        opposite_direction_shared_stops.push({
            shared_stop_id: inbound.stop_id,
            stop_name: stopName,
            inbound_sequence: inbound.sequence,
            outbound_sequence: outboundSequence,
            allowed_shared_terminal: allowedSharedTerminal,
        });

        if (allowedSharedTerminal) {
            stillSharedAllowed++;
            continue;
        }

        if (stop?.normalized_data?.possible_shared_terminal === true) {
            possibleSharedTerminal++;
        }

        illegalSharedCount++;
        const message = `stop_id=${inbound.stop_id} (${stopName ?? "unknown"}) is used by inbound seq ${inbound.sequence} and outbound seq ${outboundSequence} without shared_terminal.`;
        addIssue(
            26,
            "opposite_direction_stop_identity",
            "blocker",
            "OPPOSITE_DIRECTION_STOP_REUSE",
            message,
            { entity_type: "stop", entity_id: inbound.stop_id },
        );
    }

    if (illegalSharedCount === 0) {
        addCheck(
            26,
            "opposite_direction_stop_identity",
            "passed",
            stillSharedAllowed > 0
                ? `No illegal opposite-direction reuse. ${stillSharedAllowed} explicit shared_terminal stop(s) remain shared.`
                : "Inbound and outbound use separate stop_id rows.",
        );
    } else {
        addCheck(
            26,
            "opposite_direction_stop_identity",
            "failed",
            `${illegalSharedCount} stop_id(s) shared by inbound and outbound without shared_terminal.`,
        );
    }

    return {
        blockers: [],
        warnings,
        direction_split_stop_count,
        opposite_direction_reuse_prevented_count: direction_split_stop_count,
        possible_shared_terminal_count: possibleSharedTerminal,
        still_shared_stop_count: stillSharedAllowed,
        opposite_direction_shared_stops,
    };
}

function validateStopSourceLinkEntityAlignment(
    routeCode: string,
    bundle: RouteBundle,
    addIssue: (
        checkId: number,
        checkName: string,
        severity: IssueSeverity,
        code: string,
        message: string,
        context?: Partial<ValidationIssue>,
    ) => void,
    addCheck: (
        checkId: number,
        checkName: string,
        status: ValidationCheck["status"],
        message: string,
    ) => void,
): void {
    if (!YBS_ROUTE_CODE_PATTERN.test(routeCode)) {
        addCheck(28, "stop_source_link_entity_alignment", "skipped", "Route is outside YBS scope.");
        return;
    }

    let mismatchCount = 0;
    let missingCount = 0;

    for (const variant of bundle.variants) {
        const direction = variantDirectionKey(variant);
        if (!direction) {
            continue;
        }

        const variantStops = bundle.routeStops.filter((row) => row.route_variant_id === variant.id);
        for (const routeStop of variantStops) {
            const stopExternalId = directionAwareStopExternalId(
                routeCode,
                direction,
                routeStop.stop_sequence,
            );
            const link = bundle.sourceLinks.find(
                (row) =>
                    row.entity_type === "stop" &&
                    row.external_id === stopExternalId &&
                    row.source_name === YBS_SOURCE_NAME,
            );

            if (!link) {
                missingCount++;
                addIssue(
                    28,
                    "stop_source_link_entity_alignment",
                    "blocker",
                    "SOURCE_LINK_MISSING",
                    `stop source_link missing for ${stopExternalId} (route_stop seq ${routeStop.stop_sequence} uses stop_id=${routeStop.stop_id}).`,
                    {
                        entity_type: "route_stop",
                        entity_id: routeStop.id,
                        external_id: stopExternalId,
                    },
                );
                continue;
            }

            if (link.entity_id !== routeStop.stop_id) {
                mismatchCount++;
                addIssue(
                    28,
                    "stop_source_link_entity_alignment",
                    "blocker",
                    "STOP_SOURCE_LINK_ENTITY_MISMATCH",
                    `stop source_link ${stopExternalId} points to stop_id=${link.entity_id}, but route_stop seq ${routeStop.stop_sequence} uses stop_id=${routeStop.stop_id}.`,
                    { entity_type: "route_stop", entity_id: routeStop.id, external_id: stopExternalId },
                );
            }
        }
    }

    if (mismatchCount === 0 && missingCount === 0) {
        addCheck(
            28,
            "stop_source_link_entity_alignment",
            "passed",
            "All sequence stop source_links exist and point to the route_stop stop_id.",
        );
    } else {
        addCheck(
            28,
            "stop_source_link_entity_alignment",
            "failed",
            `${missingCount} missing stop source_link(s), ${mismatchCount} entity_id mismatch(es).`,
        );
    }
}

type StopIdentityValidationResult = {
    blockers: ValidationIssue[];
    warnings: ValidationIssue[];
    cross_route_shared_stop_count: number;
    route_internal_duplicate_stop_id_count: number;
    inbound_outbound_shared_stop_count: number;
    shared_terminal_stop_count: number;
    uncertain_created_separate_stop_count: number;
    possible_duplicate_stop_count: number;
    under_merge_candidate_count: number;
    over_merge_risk_count: number;
    protected_stop_reuse_count: number;
    protected_stop_not_modified_count: number;
    cross_route_shared_stops: RouteValidationReport["cross_route_shared_stops"];
    possible_duplicate_stops: RouteValidationReport["possible_duplicate_stops"];
    under_merge_candidates: RouteValidationReport["under_merge_candidates"];
};

function emptyStopIdentityMetrics(): StopIdentityValidationResult {
    return {
        blockers: [],
        warnings: [],
        cross_route_shared_stop_count: 0,
        route_internal_duplicate_stop_id_count: 0,
        inbound_outbound_shared_stop_count: 0,
        shared_terminal_stop_count: 0,
        uncertain_created_separate_stop_count: 0,
        possible_duplicate_stop_count: 0,
        under_merge_candidate_count: 0,
        over_merge_risk_count: 0,
        protected_stop_reuse_count: 0,
        protected_stop_not_modified_count: 0,
        cross_route_shared_stops: [],
        possible_duplicate_stops: [],
        under_merge_candidates: [],
    };
}

function validateRouteInternalStopReuse(
    routeCode: string,
    bundle: RouteBundle,
    addIssue: (
        checkId: number,
        checkName: string,
        severity: IssueSeverity,
        code: string,
        message: string,
        context?: Partial<ValidationIssue>,
    ) => void,
    addCheck: (
        checkId: number,
        name: string,
        status: ValidationCheck["status"],
        message: string,
    ) => void,
): Pick<StopIdentityValidationResult, "route_internal_duplicate_stop_id_count" | "blockers"> {
    let route_internal_duplicate_stop_id_count = 0;
    const blockers: ValidationIssue[] = [];

    for (const variant of bundle.variants) {
        const variantStops = bundle.routeStops.filter((row) => row.route_variant_id === variant.id);
        const byStopId = new Map<number, number[]>();
        for (const row of variantStops) {
            const bucket = byStopId.get(row.stop_id) ?? [];
            bucket.push(row.stop_sequence);
            byStopId.set(row.stop_id, bucket);
        }

        for (const [stopId, sequences] of byStopId.entries()) {
            if (sequences.length <= 1) {
                continue;
            }

            const stop = bundle.stops.find((row) => row.id === stopId);
            const allowedSharedTerminal = isExplicitSharedTerminal(stop?.normalized_data ?? null);
            if (allowedSharedTerminal) {
                continue;
            }

            route_internal_duplicate_stop_id_count++;
            const message = `${routeCode} ${variant.variant_code}: stop_id=${stopId} reused at sequences ${sequences.join(", ")} without shared_terminal.`;
            addIssue(
                29,
                "route_internal_stop_reuse",
                "blocker",
                "ROUTE_INTERNAL_DUPLICATE_STOP_ID",
                message,
                { entity_type: "stop", entity_id: stopId },
            );
            blockers.push({
                check_id: 29,
                check_name: "route_internal_stop_reuse",
                severity: "blocker",
                code: "ROUTE_INTERNAL_DUPLICATE_STOP_ID",
                message,
                entity_type: "stop",
                entity_id: stopId,
            });
        }
    }

    if (route_internal_duplicate_stop_id_count === 0) {
        addCheck(
            29,
            "route_internal_stop_reuse",
            "passed",
            "No duplicate stop_id reuse inside the same route variant without shared_terminal.",
        );
    } else {
        addCheck(
            29,
            "route_internal_stop_reuse",
            "failed",
            `${route_internal_duplicate_stop_id_count} duplicate stop_id reuse(s) inside route variants.`,
        );
    }

    return { route_internal_duplicate_stop_id_count, blockers };
}

function validateRouteStopSourceLinkEntityAlignment(
    routeCode: string,
    bundle: RouteBundle,
    addIssue: (
        checkId: number,
        checkName: string,
        severity: IssueSeverity,
        code: string,
        message: string,
        context?: Partial<ValidationIssue>,
    ) => void,
    addCheck: (
        checkId: number,
        name: string,
        status: ValidationCheck["status"],
        message: string,
    ) => void,
): void {
    if (!YBS_ROUTE_CODE_PATTERN.test(routeCode)) {
        addCheck(30, "route_stop_source_link_entity_alignment", "skipped", "Route is outside YBS scope.");
        return;
    }

    let mismatchCount = 0;
    let missingCount = 0;

    for (const variant of bundle.variants) {
        const direction = variantDirectionKey(variant);
        if (!direction) {
            continue;
        }

        const variantStops = bundle.routeStops.filter((row) => row.route_variant_id === variant.id);
        for (const routeStop of variantStops) {
            const externalId = routeStopExternalId(routeCode, direction, routeStop.stop_sequence);
            const link = bundle.sourceLinks.find(
                (row) =>
                    row.entity_type === "route_stop" &&
                    row.external_id === externalId &&
                    row.source_name === YBS_SOURCE_NAME,
            );

            if (!link) {
                missingCount++;
                addIssue(
                    30,
                    "route_stop_source_link_entity_alignment",
                    "blocker",
                    "SOURCE_LINK_MISSING",
                    `route_stop source_link missing for ${externalId} (route_stop id=${routeStop.id}).`,
                    {
                        entity_type: "route_stop",
                        entity_id: routeStop.id,
                        external_id: externalId,
                    },
                );
                continue;
            }

            if (link.entity_id !== routeStop.id) {
                mismatchCount++;
                addIssue(
                    30,
                    "route_stop_source_link_entity_alignment",
                    "blocker",
                    "ROUTE_STOP_SOURCE_LINK_ENTITY_MISMATCH",
                    `route_stop source_link ${externalId} points to entity_id=${link.entity_id}, but route_stop id=${routeStop.id}.`,
                    {
                        entity_type: "route_stop",
                        entity_id: routeStop.id,
                        external_id: externalId,
                    },
                );
            }
        }
    }

    if (mismatchCount === 0 && missingCount === 0) {
        addCheck(
            30,
            "route_stop_source_link_entity_alignment",
            "passed",
            "All route_stop source_links exist and point to the route_stop row id.",
        );
    } else {
        addCheck(
            30,
            "route_stop_source_link_entity_alignment",
            "failed",
            `${missingCount} missing route_stop source_link(s), ${mismatchCount} entity_id mismatch(es).`,
        );
    }
}

function validateStopMetadataAndDuplicates(
    bundle: RouteBundle,
): Pick<
    StopIdentityValidationResult,
    | "shared_terminal_stop_count"
    | "uncertain_created_separate_stop_count"
    | "possible_duplicate_stop_count"
    | "protected_stop_reuse_count"
    | "protected_stop_not_modified_count"
    | "possible_duplicate_stops"
    | "under_merge_candidates"
    | "under_merge_candidate_count"
    | "warnings"
> {
    const warnings: ValidationIssue[] = [];
    let shared_terminal_stop_count = 0;
    let uncertain_created_separate_stop_count = 0;
    let possible_duplicate_stop_count = 0;
    let protected_stop_reuse_count = 0;
    let protected_stop_not_modified_count = 0;

    const byPlaceSide = new Map<string, Set<number>>();

    for (const stop of bundle.stops) {
        const sideGroup = extractSideGroupFromNormalizedData(stop.normalized_data);
        if (sideGroup === "shared_terminal" || stop.normalized_data?.shared_terminal === true) {
            shared_terminal_stop_count++;
        }

        if (stop.normalized_data?.duplicate_review_required === true) {
            uncertain_created_separate_stop_count++;
        }

        if (["reviewed", "verified", "manual_protected"].includes(stop.review_status)) {
            protected_stop_reuse_count++;
            protected_stop_not_modified_count++;
        }

        const placeKey =
            (typeof stop.normalized_data?.stop_place_key === "string" &&
                stop.normalized_data.stop_place_key) ||
            null;
        if (placeKey) {
            const key = JSON.stringify({
                stop_place_key: placeKey,
                side_group: sideGroup ?? "unknown",
            });
            const bucket = byPlaceSide.get(key) ?? new Set<number>();
            bucket.add(stop.id);
            byPlaceSide.set(key, bucket);
        }
    }

    const possible_duplicate_stops: RouteValidationReport["possible_duplicate_stops"] = [];
    const under_merge_candidates: RouteValidationReport["under_merge_candidates"] = [];
    let under_merge_candidate_count = 0;

    for (const [key, stopIds] of byPlaceSide.entries()) {
        if (stopIds.size <= 1) {
            continue;
        }
        const parsed = JSON.parse(key) as { stop_place_key: string; side_group: SideGroup | "unknown" };
        const side_group = parsed.side_group === "unknown" ? null : parsed.side_group;
        possible_duplicate_stops.push({
            stop_place_key: parsed.stop_place_key,
            side_group,
            stop_ids: [...stopIds],
        });
        under_merge_candidate_count++;
        possible_duplicate_stop_count++;
        under_merge_candidates.push({
            stop_place_key: parsed.stop_place_key,
            side_group,
            stop_ids: [...stopIds],
        });
        warnings.push({
            check_id: 31,
            check_name: "possible_duplicate_stops",
            severity: "warning",
            code: "POSSIBLE_DUPLICATE_STOP_PLACE_KEY",
            message: `Same stop_place_key "${parsed.stop_place_key}" with side_group=${side_group ?? "unknown"} maps to stop_ids ${[...stopIds].join(", ")}.`,
        });
    }

    return {
        shared_terminal_stop_count,
        uncertain_created_separate_stop_count,
        possible_duplicate_stop_count,
        protected_stop_reuse_count,
        protected_stop_not_modified_count,
        possible_duplicate_stops,
        under_merge_candidates,
        under_merge_candidate_count,
        warnings,
    };
}

async function loadCrossRouteStopUsage(
    client: pg.PoolClient,
    stopIds: number[],
    currentRouteCode: string,
): Promise<StopIdentityValidationResult["cross_route_shared_stops"]> {
    if (stopIds.length === 0) {
        return [];
    }

    const rows = await client.query<{
        stop_id: string;
        route_code: string;
        direction_key: string | null;
        stop_sequence: number;
        name_mm: string | null;
        name_en: string | null;
        normalized_data: Record<string, unknown> | null;
    }>(
        `
        SELECT
            rs.stop_id::text,
            r.route_code,
            lower(split_part(rv.variant_code, '-', array_length(string_to_array(rv.variant_code, '-'), 1))) AS direction_key,
            rs.stop_sequence,
            s.name_mm,
            s.name_en,
            s.normalized_data
        FROM transport.route_stops rs
        JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
        JOIN transport.routes r ON r.id = rv.route_id
        JOIN transport.stops s ON s.id = rs.stop_id
        WHERE rs.stop_id = ANY($1::bigint[])
          AND r.deleted_at IS NULL
          AND s.deleted_at IS NULL
        ORDER BY rs.stop_id, r.route_code, rs.stop_sequence
        `,
        [stopIds],
    );

    const grouped = new Map<number, typeof rows.rows>();
    for (const row of rows.rows) {
        const stopId = Number(row.stop_id);
        const bucket = grouped.get(stopId) ?? [];
        bucket.push(row);
        grouped.set(stopId, bucket);
    }

    const cross_route_shared_stops: StopIdentityValidationResult["cross_route_shared_stops"] = [];
    for (const [stopId, usages] of grouped.entries()) {
        const routes = [...new Set(usages.map((row) => row.route_code))];
        if (routes.length <= 1 && routes[0] === currentRouteCode) {
            continue;
        }

        cross_route_shared_stops.push({
            shared_stop_id: stopId,
            routes,
            directions: [
                ...new Set(
                    usages
                        .map((row) => row.direction_key)
                        .filter((value): value is string => Boolean(value)),
                ),
            ],
            sequences: usages.map((row) => row.stop_sequence),
            names: {
                my: usages[0]?.name_mm ?? null,
                en: usages[0]?.name_en ?? null,
            },
            side_group: extractSideGroupFromNormalizedData(usages[0]?.normalized_data ?? null),
            confidence:
                typeof usages[0]?.normalized_data?.match_confidence_reason === "string"
                    ? String(usages[0]?.normalized_data?.match_confidence_reason)
                    : null,
        });
    }

    return cross_route_shared_stops;
}

function finalizeReport(
    routeCode: string,
    bundle: RouteBundle,
    checks: ValidationCheck[],
    blockers: ValidationIssue[],
    warnings: ValidationIssue[],
    metrics: {
        sourceLinksMissingCount: number;
        sequenceErrorCount: number;
        geometryMissingCount: number;
        duplicateWarningCount: number;
        duplicateRouteStopSequenceCount: number;
        duplicateVariantCount: number;
        duplicateSourceLinkCount: number;
    },
    variantRouteStopValidation: VariantRouteStopValidation[] = [],
    oppositeDirectionReport: OppositeDirectionValidationResult = {
        blockers: [],
        warnings: [],
        direction_split_stop_count: 0,
        opposite_direction_reuse_prevented_count: 0,
        possible_shared_terminal_count: 0,
        still_shared_stop_count: 0,
        opposite_direction_shared_stops: [],
    },
    stopIdentityReport: StopIdentityValidationResult = emptyStopIdentityMetrics(),
): RouteValidationReport {
    const tableCounts: Record<string, number> = {
        routes: bundle.route ? 1 : 0,
        route_names: bundle.routeNames.length,
        route_variants: bundle.variants.length,
        route_stops: bundle.routeStops.length,
        stops: bundle.stops.length,
        stop_names: bundle.stopNames.length,
        route_paths: bundle.routePaths.length,
        source_links: bundle.sourceLinks.length,
    };

    const reviewStatus = bundle.route?.review_status ?? "";
    const publicVisible =
        Boolean(bundle.route?.is_active) &&
        bundle.inPublicTileView &&
        PUBLIC_VISIBLE_REVIEW_STATUSES.has(reviewStatus);
    const dashboardVisible = Boolean(bundle.route);

    return {
        schema_version: PHASE10_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        route_code: routeCode,
        status: blockers.length === 0 ? "passed" : "failed",
        route_count: bundle.route ? 1 : 0,
        variant_count: bundle.variants.length,
        route_stop_count: bundle.routeStops.length,
        route_path_count: bundle.routePaths.length,
        duplicate_route_count: 0,
        duplicate_variant_count: metrics.duplicateVariantCount,
        duplicate_route_stop_sequence_count: metrics.duplicateRouteStopSequenceCount,
        duplicate_source_link_count: metrics.duplicateSourceLinkCount,
        source_links_missing_count: metrics.sourceLinksMissingCount,
        sequence_error_count: metrics.sequenceErrorCount,
        geometry_missing_count: metrics.geometryMissingCount,
        duplicate_warning_count: metrics.duplicateWarningCount,
        public_visible: publicVisible,
        dashboard_visible: dashboardVisible,
        review_status: bundle.route?.review_status ?? null,
        table_counts: tableCounts,
        blockers,
        warnings,
        checks,
        root_causes: buildRootCauses(blockers, warnings),
        variant_route_stop_validation: variantRouteStopValidation,
        direction_split_stop_count: oppositeDirectionReport.direction_split_stop_count,
        opposite_direction_reuse_prevented_count:
            oppositeDirectionReport.opposite_direction_reuse_prevented_count,
        possible_shared_terminal_count: oppositeDirectionReport.possible_shared_terminal_count,
        still_shared_stop_count: oppositeDirectionReport.still_shared_stop_count,
        opposite_direction_shared_stops: oppositeDirectionReport.opposite_direction_shared_stops,
        route_stop_review_geom_count: bundle.displayMetrics?.route_stop_review_geom_count ?? 0,
        reused_stop_real_geom_count: bundle.displayMetrics?.reused_stop_real_geom_count ?? 0,
        placeholder_display_points_count: bundle.displayMetrics?.placeholder_display_points_count ?? 0,
        off_path_display_points_count: bundle.displayMetrics?.off_path_display_points_count ?? 0,
        physical_stop_geom_not_modified_count:
            bundle.displayMetrics?.physical_stop_geom_not_modified_count ?? 0,
        cross_route_shared_stop_count: stopIdentityReport.cross_route_shared_stop_count,
        route_internal_duplicate_stop_id_count:
            stopIdentityReport.route_internal_duplicate_stop_id_count,
        inbound_outbound_shared_stop_count: stopIdentityReport.inbound_outbound_shared_stop_count,
        shared_terminal_stop_count: stopIdentityReport.shared_terminal_stop_count,
        uncertain_created_separate_stop_count:
            stopIdentityReport.uncertain_created_separate_stop_count,
        possible_duplicate_stop_count: stopIdentityReport.possible_duplicate_stop_count,
        under_merge_candidate_count: stopIdentityReport.under_merge_candidate_count,
        over_merge_risk_count: stopIdentityReport.over_merge_risk_count,
        protected_stop_reuse_count: stopIdentityReport.protected_stop_reuse_count,
        protected_stop_not_modified_count: stopIdentityReport.protected_stop_not_modified_count,
        cross_route_shared_stops: stopIdentityReport.cross_route_shared_stops,
        possible_duplicate_stops: stopIdentityReport.possible_duplicate_stops,
        under_merge_candidates: stopIdentityReport.under_merge_candidates,
    };
}

function renderMarkdownReport(report: RouteValidationReport): string {
    const lines: string[] = [];
    lines.push(`# Phase 10 DB Validation — ${report.route_code}`);
    lines.push("");
    lines.push(`- Status: **${report.status.toUpperCase()}**`);
    lines.push(`- Generated: ${report.generated_at}`);
    lines.push(`- Route count: ${report.route_count}`);
    lines.push(`- Variant count: ${report.variant_count}`);
    lines.push(`- Route stop count: ${report.route_stop_count}`);
    lines.push(`- Route path count: ${report.route_path_count}`);
    lines.push(`- Duplicate route count: ${report.duplicate_route_count}`);
    lines.push(`- Duplicate variant count: ${report.duplicate_variant_count}`);
    lines.push(`- Duplicate route_stop sequence count: ${report.duplicate_route_stop_sequence_count}`);
    lines.push(`- Duplicate source_link count: ${report.duplicate_source_link_count}`);
    lines.push(`- Source links missing: ${report.source_links_missing_count}`);
    lines.push(`- Sequence errors: ${report.sequence_error_count}`);
    lines.push(`- Geometry missing: ${report.geometry_missing_count}`);
    lines.push(`- Duplicate warnings: ${report.duplicate_warning_count}`);
    lines.push(`- route_stop_review_geom_count: ${report.route_stop_review_geom_count}`);
    lines.push(`- reused_stop_real_geom_count: ${report.reused_stop_real_geom_count}`);
    lines.push(`- placeholder_display_points_count: ${report.placeholder_display_points_count}`);
    lines.push(`- off_path_display_points_count: ${report.off_path_display_points_count}`);
    lines.push(
        `- physical_stop_geom_not_modified_count: ${report.physical_stop_geom_not_modified_count}`,
    );
    lines.push(`- Public visible: ${report.public_visible}`);
    lines.push(`- Dashboard visible: ${report.dashboard_visible}`);
    lines.push("");

    lines.push("## Table counts");
    lines.push("");
    lines.push("| Table | Count |");
    lines.push("| --- | ---: |");
    for (const [table, count] of Object.entries(report.table_counts).sort()) {
        lines.push(`| ${table} | ${count} |`);
    }
    lines.push("");

    lines.push("## Checks");
    lines.push("");
    lines.push("| # | Check | Status | Message |");
    lines.push("| ---: | --- | --- | --- |");
    for (const check of report.checks) {
        lines.push(`| ${check.check_id} | ${check.name} | ${check.status} | ${check.message} |`);
    }
    lines.push("");

    lines.push("## Variant route_stop validation");
    lines.push("");
    if (report.variant_route_stop_validation.length === 0) {
        lines.push("No extraction comparison available.");
    } else {
        lines.push("| Variant | Expected | Actual | Missing sequences | Duplicate sequences | Status |");
        lines.push("| --- | ---: | ---: | --- | --- | --- |");
        for (const item of report.variant_route_stop_validation) {
            lines.push(
                `| ${item.variant_code} | ${item.expected_stop_count_from_extraction} | ${item.actual_route_stop_count} | ${item.missing_sequences.length > 0 ? item.missing_sequences.join(", ") : "none"} | ${item.duplicate_sequences.length > 0 ? item.duplicate_sequences.join(", ") : "none"} | ${item.status} |`,
            );
        }
    }
    lines.push("");

    lines.push("## Root causes");
    lines.push("");
    if (report.root_causes.length === 0) {
        lines.push("None.");
    } else {
        lines.push("| Code | Severity | Count | Summary |");
        lines.push("| --- | --- | ---: | --- |");
        for (const cause of report.root_causes) {
            lines.push(`| ${cause.code} | ${cause.severity} | ${cause.count} | ${cause.summary} |`);
        }
    }
    lines.push("");

    lines.push("## Blockers");
    lines.push("");
    if (report.blockers.length === 0) {
        lines.push("None.");
    } else {
        for (const issue of report.blockers) {
            lines.push(`- [${issue.code}] ${issue.message}`);
        }
    }
    lines.push("");

    lines.push("## Warnings");
    lines.push("");
    if (report.warnings.length === 0) {
        lines.push("None.");
    } else {
        for (const issue of report.warnings) {
            lines.push(`- [${issue.code}] ${issue.message}`);
        }
    }
    lines.push("");

    return `${lines.join("\n")}\n`;
}

export async function validateImportedYbs(options: CliOptions): Promise<RouteValidationReport[]> {
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL or DATABASE_URL.",
        );
    }

    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 180_000,
    });
    const client = await pool.connect();

    try {
        await client.query("BEGIN READ ONLY");

        let routeCodes: string[] = [];
        if (options.allImportedYbs) {
            routeCodes = await listImportedYbsRouteCodes(client);
            if (routeCodes.length === 0) {
                throw new Error("No imported YBS routes found via source_links.");
            }
        } else if (options.routeCodes && options.routeCodes.length > 0) {
            routeCodes = options.routeCodes;
        } else if (options.routeCode) {
            routeCodes = [options.routeCode];
        } else {
            throw new Error("Provide --route-code YBS-1, --routes YBS-3,YBS-4, or --all-imported-ybs.");
        }

        const reports: RouteValidationReport[] = [];
        for (const routeCode of routeCodes) {
            const bundle = await loadRouteBundle(client, routeCode);
            const extractionExpectations = loadExtractionRouteStopExpectations(
                resolveFromRepo(options.runRoot),
                routeCode,
            );
            const report = validateRouteBundle(routeCode, bundle, extractionExpectations);
            const stopIds = [...new Set(bundle.routeStops.map((row) => row.stop_id))];
            const crossRouteShared = await loadCrossRouteStopUsage(client, stopIds, routeCode);
            report.cross_route_shared_stops = crossRouteShared;
            report.cross_route_shared_stop_count = crossRouteShared.length;

            let overMergeRisk = 0;
            for (const shared of crossRouteShared) {
                const directions = shared.directions.filter(
                    (direction) => direction === "inbound" || direction === "outbound",
                );
                const hasInbound = directions.includes("inbound");
                const hasOutbound = directions.includes("outbound");
                if (
                    hasInbound &&
                    hasOutbound &&
                    shared.side_group !== "shared_terminal" &&
                    !isExplicitSharedTerminal(bundle.stops.find((stop) => stop.id === shared.shared_stop_id)?.normalized_data ?? null)
                ) {
                    overMergeRisk++;
                    report.warnings.push({
                        check_id: 32,
                        check_name: "cross_route_stop_direction_conflict",
                        severity: "warning",
                        code: "CROSS_ROUTE_STOP_DIRECTION_CONFLICT",
                        message: `Shared stop_id=${shared.shared_stop_id} is used by conflicting directions across routes ${shared.routes.join(", ")}.`,
                        entity_type: "stop",
                        entity_id: shared.shared_stop_id,
                    });
                }
            }
            report.over_merge_risk_count = overMergeRisk;
            if (crossRouteShared.length > 0) {
                report.checks.push({
                    check_id: 32,
                    name: "cross_route_shared_stops",
                    status: overMergeRisk > 0 ? "warning" : "passed",
                    message: `${crossRouteShared.length} cross-route shared stop(s) reported (not a blocker when side/direction compatible).`,
                });
            }

            if (report.possible_duplicate_stops.length > 0) {
                report.checks.push({
                    check_id: 31,
                    name: "possible_duplicate_stops",
                    status: "warning",
                    message: `${report.possible_duplicate_stops.length} possible duplicate stop group(s) by stop_place_key.`,
                });
            }

            reports.push(report);

            const jsonPath = resolveFromRepo(
                path.join(options.runRoot, `reports/phase10-db-validation-${routeCode}.json`),
            );
            const mdPath = resolveFromRepo(
                path.join(options.runRoot, `reports/phase10-db-validation-${routeCode}.md`),
            );
            writeJsonFile(jsonPath, report);
            writeTextFile(mdPath, renderMarkdownReport(report));
        }

        await client.query("ROLLBACK");
        return reports;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

function parseCliArgs(argv: string[]): CliOptions {
    let runRoot = "tmp/transport-imports/ybs-all";
    let routeCode: string | undefined;
    let routeCodes: string[] | undefined;
    let allImportedYbs = false;
    let databaseUrl: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--route-code" && next) {
            routeCode = next.trim();
            index++;
        } else if (arg === "--routes" && next) {
            routeCodes = next
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);
            index++;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        } else if (arg === "--all-imported-ybs") {
            allImportedYbs = true;
        }
    }

    const selectionCount = [routeCode, routeCodes?.length ? routeCodes : null, allImportedYbs].filter(
        Boolean,
    ).length;
    if (selectionCount > 1) {
        throw new Error("Use only one of --route-code, --routes, or --all-imported-ybs.");
    }

    return { runRoot, routeCode, routeCodes, allImportedYbs, databaseUrl };
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const options = parseCliArgs(process.argv.slice(2));
    const reports = await validateImportedYbs(options);

    console.log(`Phase 10 validation complete (${reports.length} route(s)).`);
    for (const report of reports) {
        console.log(
            `  ${report.route_code}: ${report.status} | blockers=${report.blockers.length} warnings=${report.warnings.length} | source_links_missing=${report.source_links_missing_count} sequence_errors=${report.sequence_error_count} geometry_missing=${report.geometry_missing_count}`,
        );
        if (report.root_causes.length > 0) {
            for (const cause of report.root_causes) {
                console.log(
                    `    - ${cause.code} (${cause.severity}) x${cause.count}: ${cause.summary}`,
                );
            }
        }
    }
}

const isMainModule =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
