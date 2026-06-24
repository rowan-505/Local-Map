import { Prisma, type PrismaClient } from "@prisma/client";

import {
    TransportInvalidReferenceError,
    TransportNotFoundError,
    TransportSchemaUnavailableError,
} from "./transport.errors.js";
import {
    appendPointDiff,
    diffScalarFields,
    insertTransportAuditLog,
    resolvePointAwareAction,
    type TransportAuditContext,
} from "./transport-audit.js";
import type {
    ListTransportRoutesQuery,
    ListTransportStopsQuery,
    ListTransportTerminalsQuery,
    ListImportBatchesQuery,
    ListImportErrorsQuery,
    ListSourceLinksQuery,
    ListTransportInfrastructureLinesQuery,
    ListVariantStopsQuery,
    StopRoutesQuery,
    UpdateInfrastructureLineInput,
    UpdateRouteInput,
    UpdateRouteStopInput,
    UpdateStopInput,
    UpdateTerminalInput,
    UpdateVariantInput,
} from "./transport.schema.js";
import type {
    GeoJsonGeometry,
    TransportCountsByKey,
    TransportDataQualityQueues,
    TransportImportBatchListItem,
    TransportImportErrorListItem,
    TransportSourceLinkListItem,
    TransportImportIssueBreakdown,
    TransportOverview,
    TransportPaginated,
    TransportRawNameStatus,
    TransportRouteDetail,
    TransportRouteListItem,
    TransportRouteStopItem,
    TransportStopDetail,
    TransportStopListItem,
    TransportStopRouteUsage,
    TransportInfrastructureLineDetail,
    TransportInfrastructureLineListItem,
    TransportTerminalDetail,
    TransportTerminalListItem,
    TransportVariantStopsResponse,
    TransportVariantSummary,
} from "./transport.types.js";

type CountsRow = {
    routes: bigint;
    route_variants: bigint;
    route_paths: bigint;
    route_stops: bigint;
    stops: bigint;
    terminals: bigint;
    infrastructure_lines: bigint;
    import_batches: bigint;
    import_errors: bigint;
};

type GroupRow = { entity: string; key: string | null; c: bigint };
type ImportIssueRow = { error_code: string | null; c: bigint };

type QualityRow = {
    total_routes: bigint;
    routes_with_stops: bigint;
    total_variants: bigint;
    variants_with_path: bigint;
    ferry_terminals_unreviewed: bigint;
    gen_terminals: bigint;
    gen_stops: bigint;
};

type RouteListRow = {
    public_id: string;
    route_code: string;
    public_name: string;
    mode: string;
    route_kind: string;
    origin_name: string | null;
    destination_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    variant_count: bigint;
    stop_count: bigint;
    path_count: bigint;
    updated_at: Date;
};

type StopListRow = {
    public_id: string;
    stop_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    route_count: bigint;
    admin_area_id: bigint | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    updated_at: Date;
};

type StopDetailRow = {
    id: bigint;
    public_id: string;
    stop_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    admin_area_id: bigint | null;
    admin_area_name: string | null;
    parent_stop_id: bigint | null;
    parent_stop_public_id: string | null;
    parent_stop_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    longitude: number | null;
    latitude: number | null;
    geometry: unknown;
    route_count: bigint;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    source_refs: unknown;
    normalized_data: unknown;
};

type TerminalDetailRow = {
    id: bigint;
    public_id: string;
    terminal_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    raw_name_status: string;
    mode: string;
    terminal_role: string;
    linked_stop_id: bigint | null;
    linked_stop_public_id: string | null;
    linked_stop_name: string | null;
    linked_stop_mode: string | null;
    linked_stop_type: string | null;
    operator_id: bigint | null;
    operator_name: string | null;
    admin_area_id: bigint | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    longitude: number | null;
    latitude: number | null;
    geometry: unknown;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    source_refs: unknown;
    normalized_data: unknown;
};

type StopRouteUsageRow = {
    route_public_id: string;
    route_code: string;
    route_name: string;
    mode: string;
    variant_public_id: string;
    variant_code: string;
    direction_name: string | null;
    headsign: string | null;
    stop_sequence: number;
};

type TerminalListRow = {
    public_id: string;
    terminal_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    raw_name_status: string;
    mode: string;
    terminal_role: string;
    linked_stop_public_id: string | null;
    linked_stop_name: string | null;
    admin_area_id: bigint | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    updated_at: Date;
};

type InfrastructureLineListRow = {
    public_id: string;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    raw_name_status: string;
    mode: string;
    line_type: string;
    admin_area_id: bigint | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    updated_at: Date;
};

type InfrastructureLineDetailRow = {
    id: bigint;
    public_id: string;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    raw_name_status: string;
    mode: string;
    line_type: string;
    admin_area_id: bigint | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    geometry: unknown;
    length_m: number | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    source_refs: unknown;
    normalized_data: unknown;
};

/** Escapes LIKE/ILIKE metacharacters; wraps as a `%term%` contains-pattern. */
function toLikeParam(search: string | undefined): string | null {
    if (!search) {
        return null;
    }
    const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
    return `%${escaped}%`;
}

function asGeometry(value: unknown): GeoJsonGeometry | null {
    if (value && typeof value === "object" && "type" in value) {
        return value as GeoJsonGeometry;
    }
    return null;
}

/**
 * Derives a terminal's vehicle-access from normalized_data. Returns "unknown"
 * unless an explicit key exists — current OSM imports carry no such data, so this
 * is "unknown" in practice, but it future-proofs the ferry RoRo/vehicle attribute.
 */
function deriveVehicleAccess(normalized: unknown): string {
    if (normalized && typeof normalized === "object") {
        const n = normalized as Record<string, unknown>;
        for (const key of ["vehicle_access", "vehicle", "car_ferry", "roro", "motor_vehicle"]) {
            const v = n[key];
            if (typeof v === "string" && v.trim() !== "") return v.trim();
            if (typeof v === "boolean") return v ? "yes" : "no";
        }
    }
    return "unknown";
}

type RouteDetailRow = {
    id: bigint;
    public_id: string;
    route_code: string;
    public_name: string;
    mode: string;
    route_kind: string;
    origin_name: string | null;
    destination_name: string | null;
    origin_admin_area_id: bigint | null;
    destination_admin_area_id: bigint | null;
    description: string | null;
    operator_id: bigint | null;
    operator_name: string | null;
    confidence_score: number | null;
    review_status: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    variant_count: bigint;
    stop_count: bigint;
    path_count: bigint;
};

type RouteNameRow = {
    name: string;
    language_code: string;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
    search_weight: number;
};

type SourceRow = {
    source_name: string;
    source_kind: string;
    external_id: string | null;
    source_url: string | null;
    is_primary: boolean;
};

type VariantSummaryRow = {
    public_id: string;
    variant_code: string;
    direction_name: string | null;
    direction_id: number | null;
    headsign: string | null;
    origin_name: string | null;
    destination_name: string | null;
    stop_count: bigint;
    path_count: bigint;
    distance_m: number | null;
    estimated_duration_min: number | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
};

type RouteStopRow = {
    id: bigint;
    stop_sequence: number;
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
    distance_from_start_m: number | null;
    stop_public_id: string;
    stop_name: string;
    stop_name_mm: string | null;
    stop_name_en: string | null;
    stop_mode: string;
    stop_type: string;
    geometry: unknown;
};

type RoutePathRow = {
    path_kind: string;
    distance_m: number | null;
    geometry: unknown;
};

/** Synthetic names created by the importer when no human name exists, e.g. "bus_station osm:N:5293807821". */
const GENERATED_NAME_PATTERN = "osm:[A-Za-z]+:[0-9]+";

/** Data-quality "low confidence" boundary: rows with confidence_score below this (0–100). */
const LOW_CONFIDENCE_THRESHOLD = 60;

type ImportBatchRow = {
    id: bigint;
    public_id: string;
    source_name: string;
    source_kind: string;
    import_scope: string;
    import_mode: string;
    status: string;
    started_at: Date;
    finished_at: Date | null;
    inserted_count: bigint;
    updated_count: bigint;
    skipped_count: bigint;
    error_count: bigint;
    notes: string | null;
    created_at: Date;
    updated_at: Date;
};

type ImportErrorRow = {
    id: bigint;
    import_batch_id: bigint | null;
    entity_type: string;
    external_id: string | null;
    error_code: string;
    error_message: string;
    created_at: Date;
};

type SourceLinkRowListItem = {
    id: bigint;
    entity_type: string;
    entity_id: bigint;
    source_name: string;
    source_kind: string;
    external_id: string | null;
    source_url: string | null;
    import_batch_id: bigint | null;
    confidence_score: number | null;
    is_primary: boolean;
    created_at: Date;
};

type DataQualityQueueRow = {
    generated_name_stops: bigint;
    generated_name_terminals: bigint;
    missing_name_stops: bigint;
    missing_name_terminals: bigint;
    routes_without_path: bigint;
    routes_with_stops_no_path: bigint;
    routes_with_path_no_stops: bigint;
    ferry_landing_candidates: bigint;
    low_conf_stops: bigint;
    low_conf_terminals: bigint;
    low_conf_routes: bigint;
    import_errors: bigint;
};

function isMissingTransportSchemaError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return (
        message.includes('schema "transport" does not exist') ||
        (message.includes("relation") && message.includes("does not exist"))
    );
}

function num(value: bigint | number | null | undefined): number {
    return value === null || value === undefined ? 0 : Number(value);
}

function mapRouteStopRow(row: RouteStopRow): TransportRouteStopItem {
    return {
        id: String(row.id),
        stop_sequence: row.stop_sequence,
        pickup_type: row.pickup_type,
        drop_off_type: row.drop_off_type,
        is_timing_point: row.is_timing_point,
        distance_from_start_m: row.distance_from_start_m,
        stop: {
            public_id: row.stop_public_id,
            name: row.stop_name,
            name_mm: row.stop_name_mm,
            name_en: row.stop_name_en,
            mode: row.stop_mode,
            stop_type: row.stop_type,
            geometry: asGeometry(row.geometry),
        },
    };
}

type RouteStopMetaRow = {
    id: bigint;
    route_variant_id: bigint;
    stop_sequence: number;
};

/** Folds `(entity, key, count)` rows into `{ entity: { key: count } }`. */
function groupRowsToRecord(rows: GroupRow[]): Record<string, TransportCountsByKey> {
    const out: Record<string, TransportCountsByKey> = {};
    for (const row of rows) {
        const entity = row.entity;
        const key = row.key ?? "unknown";
        out[entity] ??= {};
        out[entity][key] = num(row.c);
    }
    return out;
}

/**
 * Import-error codes that represent a route geometry/member problem rather than a
 * name/quality warning. Used to bucket the import-issue breakdown on the overview.
 */
const ROUTE_GEOMETRY_ISSUE_CODES = new Set([
    "ROUTE_PATH_NOT_SINGLE_LINESTRING",
    "WARN_RELATION_NO_WAY_MEMBERS",
    "WARN_ROUTE_PATH_UNMERGEABLE",
]);

/** Buckets `(error_code, count)` rows into the overview's named import-issue categories. */
function mapImportIssueBreakdown(rows: ImportIssueRow[]): TransportImportIssueBreakdown {
    const out: TransportImportIssueBreakdown = {
        missingNameMm: 0,
        missingNameEn: 0,
        fallbackName: 0,
        routeGeometry: 0,
        routeStopMember: 0,
        lowConfidence: 0,
        other: 0,
    };
    for (const row of rows) {
        const code = row.error_code ?? "";
        const c = num(row.c);
        switch (code) {
            case "WARN_MISSING_NAME_MM":
                out.missingNameMm += c;
                break;
            case "WARN_MISSING_NAME_EN":
                out.missingNameEn += c;
                break;
            case "WARN_FALLBACK_NAME":
                out.fallbackName += c;
                break;
            case "WARN_LOW_CONFIDENCE":
                out.lowConfidence += c;
                break;
            case "ROUTE_STOP_MEMBER_NOT_IMPORTED":
                out.routeStopMember += c;
                break;
            default:
                if (ROUTE_GEOMETRY_ISSUE_CODES.has(code)) {
                    out.routeGeometry += c;
                } else {
                    out.other += c;
                }
        }
    }
    return out;
}

/** Editable fields audited per entity (kept in sync with the UPDATE set-clauses below). */
const ROUTE_AUDIT_FIELDS = [
    "route_code",
    "public_name",
    "mode",
    "route_kind",
    "origin_name",
    "destination_name",
    "description",
    "review_status",
    "confidence_score",
    "is_active",
] as const;

const VARIANT_AUDIT_FIELDS = [
    "variant_code",
    "direction_name",
    "direction_id",
    "headsign",
    "origin_name",
    "destination_name",
    "estimated_duration_min",
    "review_status",
    "confidence_score",
    "is_active",
] as const;

const STOP_AUDIT_FIELDS = [
    "stop_code",
    "name",
    "name_mm",
    "name_en",
    "mode",
    "stop_type",
    "admin_area_id",
    "parent_stop_id",
    "review_status",
    "confidence_score",
    "is_active",
] as const;

const TERMINAL_AUDIT_FIELDS = [
    "terminal_code",
    "name",
    "name_mm",
    "name_en",
    "mode",
    "terminal_role",
    "linked_stop_id",
    "operator_id",
    "admin_area_id",
    "review_status",
    "confidence_score",
    "is_active",
] as const;

const INFRASTRUCTURE_LINE_AUDIT_FIELDS = [
    "name",
    "name_mm",
    "name_en",
    "mode",
    "line_type",
    "admin_area_id",
    "review_status",
    "confidence_score",
    "is_active",
] as const;

const ROUTE_STOP_FLAGS_AUDIT_FIELDS = ["pickup_type", "drop_off_type", "is_timing_point"] as const;

/** Pre-mutation snapshot rows used for audit diffs (FK ids cast to int, geom to lat/lng). */
type RouteAuditRow = {
    id: bigint;
    route_code: string | null;
    public_name: string | null;
    mode: string | null;
    route_kind: string | null;
    origin_name: string | null;
    destination_name: string | null;
    description: string | null;
    review_status: string | null;
    confidence_score: number | null;
    is_active: boolean | null;
};

type VariantAuditRow = {
    id: bigint;
    variant_code: string | null;
    direction_name: string | null;
    direction_id: number | null;
    headsign: string | null;
    origin_name: string | null;
    destination_name: string | null;
    estimated_duration_min: number | null;
    review_status: string | null;
    confidence_score: number | null;
    is_active: boolean | null;
};

type StopAuditRow = {
    id: bigint;
    stop_code: string | null;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    mode: string | null;
    stop_type: string | null;
    admin_area_id: number | null;
    parent_stop_id: number | null;
    review_status: string | null;
    confidence_score: number | null;
    is_active: boolean | null;
    point_lng: number | null;
    point_lat: number | null;
};

type TerminalAuditRow = {
    id: bigint;
    terminal_code: string | null;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    mode: string | null;
    terminal_role: string | null;
    linked_stop_id: number | null;
    operator_id: number | null;
    admin_area_id: number | null;
    review_status: string | null;
    confidence_score: number | null;
    is_active: boolean | null;
    point_lng: number | null;
    point_lat: number | null;
};

type InfrastructureLineAuditRow = {
    id: bigint;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    mode: string | null;
    line_type: string | null;
    admin_area_id: number | null;
    review_status: string | null;
    confidence_score: number | null;
    is_active: boolean | null;
};

type RouteStopFlagsAuditRow = {
    id: bigint;
    pickup_type: number | null;
    drop_off_type: number | null;
    is_timing_point: boolean | null;
};

type RouteStopRemoveAuditRow = {
    id: bigint;
    route_variant_id: bigint;
    stop_id: bigint;
    stop_sequence: number;
    pickup_type: number | null;
    drop_off_type: number | null;
    is_timing_point: boolean | null;
    distance_from_start_m: number | null;
};

export class TransportRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async assertSchemaAvailable(): Promise<void> {
        try {
            await this.prisma.$queryRaw`SELECT 1 FROM transport.routes LIMIT 1`;
        } catch (error) {
            if (isMissingTransportSchemaError(error)) {
                throw new TransportSchemaUnavailableError();
            }
            throw error;
        }
    }

    async getOverview(): Promise<TransportOverview> {
        await this.assertSchemaAvailable();

        const [countsRows, modeRows, reviewRows, qualityRows, importIssueRows] = await Promise.all([
            this.prisma.$queryRaw<CountsRow[]>`
                SELECT
                    (SELECT count(*) FROM transport.routes WHERE deleted_at IS NULL) AS routes,
                    (SELECT count(*) FROM transport.route_variants WHERE deleted_at IS NULL) AS route_variants,
                    (SELECT count(*) FROM transport.route_paths WHERE deleted_at IS NULL) AS route_paths,
                    (SELECT count(*) FROM transport.route_stops) AS route_stops,
                    (SELECT count(*) FROM transport.stops WHERE deleted_at IS NULL) AS stops,
                    (SELECT count(*) FROM transport.terminals WHERE deleted_at IS NULL) AS terminals,
                    (SELECT count(*) FROM transport.infrastructure_lines WHERE deleted_at IS NULL) AS infrastructure_lines,
                    (SELECT count(*) FROM transport.import_batches) AS import_batches,
                    (SELECT count(*) FROM transport.import_errors) AS import_errors
            `,
            this.prisma.$queryRaw<GroupRow[]>`
                SELECT 'routes' AS entity, mode AS key, count(*)::bigint AS c
                    FROM transport.routes WHERE deleted_at IS NULL GROUP BY mode
                UNION ALL
                SELECT 'stops', mode, count(*)::bigint
                    FROM transport.stops WHERE deleted_at IS NULL GROUP BY mode
                UNION ALL
                SELECT 'terminals', mode, count(*)::bigint
                    FROM transport.terminals WHERE deleted_at IS NULL GROUP BY mode
                UNION ALL
                SELECT 'infrastructureLines', mode, count(*)::bigint
                    FROM transport.infrastructure_lines WHERE deleted_at IS NULL GROUP BY mode
            `,
            this.prisma.$queryRaw<GroupRow[]>`
                SELECT 'routes' AS entity, review_status AS key, count(*)::bigint AS c
                    FROM transport.routes WHERE deleted_at IS NULL GROUP BY review_status
                UNION ALL
                SELECT 'stops', review_status, count(*)::bigint
                    FROM transport.stops WHERE deleted_at IS NULL GROUP BY review_status
                UNION ALL
                SELECT 'terminals', review_status, count(*)::bigint
                    FROM transport.terminals WHERE deleted_at IS NULL GROUP BY review_status
                UNION ALL
                SELECT 'infrastructureLines', review_status, count(*)::bigint
                    FROM transport.infrastructure_lines WHERE deleted_at IS NULL GROUP BY review_status
            `,
            this.prisma.$queryRaw<QualityRow[]>`
                SELECT
                    (SELECT count(*) FROM transport.routes WHERE deleted_at IS NULL) AS total_routes,
                    (SELECT count(DISTINCT r.id)
                        FROM transport.routes r
                        WHERE r.deleted_at IS NULL
                          AND EXISTS (
                              SELECT 1
                              FROM transport.route_variants v
                              JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                              WHERE v.route_id = r.id AND v.deleted_at IS NULL
                          )) AS routes_with_stops,
                    (SELECT count(*) FROM transport.route_variants WHERE deleted_at IS NULL) AS total_variants,
                    (SELECT count(*)
                        FROM transport.route_variants v
                        WHERE v.deleted_at IS NULL
                          AND EXISTS (
                              SELECT 1 FROM transport.route_paths p
                              WHERE p.route_variant_id = v.id AND p.deleted_at IS NULL
                          )) AS variants_with_path,
                    (SELECT count(*)
                        FROM transport.terminals
                        WHERE deleted_at IS NULL AND mode = 'ferry'
                          AND review_status = 'imported_unreviewed') AS ferry_terminals_unreviewed,
                    (SELECT count(*)
                        FROM transport.terminals
                        WHERE deleted_at IS NULL AND name ~ ${GENERATED_NAME_PATTERN}) AS gen_terminals,
                    (SELECT count(*)
                        FROM transport.stops
                        WHERE deleted_at IS NULL AND name ~ ${GENERATED_NAME_PATTERN}) AS gen_stops
            `,
            this.prisma.$queryRaw<ImportIssueRow[]>`
                SELECT error_code, count(*)::bigint AS c
                FROM transport.import_errors
                GROUP BY error_code
            `,
        ]);

        const counts = countsRows[0];
        const byMode = groupRowsToRecord(modeRows);
        const review = groupRowsToRecord(reviewRows);
        const q = qualityRows[0];

        const totalRoutes = num(q?.total_routes);
        const routesWithStops = num(q?.routes_with_stops);
        const totalVariants = num(q?.total_variants);
        const variantsWithPath = num(q?.variants_with_path);

        return {
            counts: {
                routes: num(counts?.routes),
                routeVariants: num(counts?.route_variants),
                routePaths: num(counts?.route_paths),
                routeStops: num(counts?.route_stops),
                stops: num(counts?.stops),
                terminals: num(counts?.terminals),
                infrastructureLines: num(counts?.infrastructure_lines),
                importBatches: num(counts?.import_batches),
                importErrors: num(counts?.import_errors),
            },
            byMode: {
                routes: byMode.routes ?? {},
                stops: byMode.stops ?? {},
                terminals: byMode.terminals ?? {},
                infrastructureLines: byMode.infrastructureLines ?? {},
            },
            reviewStatus: {
                routes: review.routes ?? {},
                stops: review.stops ?? {},
                terminals: review.terminals ?? {},
                infrastructureLines: review.infrastructureLines ?? {},
            },
            quality: {
                routesWithStops,
                routesWithoutStops: Math.max(0, totalRoutes - routesWithStops),
                routeVariantsWithPath: variantsWithPath,
                routeVariantsWithoutPath: Math.max(0, totalVariants - variantsWithPath),
                ferryTerminalsImportedUnreviewed: num(q?.ferry_terminals_unreviewed),
                generatedNameTerminals: num(q?.gen_terminals),
                generatedNameStops: num(q?.gen_stops),
            },
            importIssues: mapImportIssueBreakdown(importIssueRows),
            schemaAvailable: true,
        };
    }

    async getDataQualityQueues(): Promise<TransportDataQualityQueues> {
        await this.assertSchemaAvailable();

        const rows = await this.prisma.$queryRaw<DataQualityQueueRow[]>`
            SELECT
                (SELECT count(*) FROM transport.stops
                    WHERE deleted_at IS NULL AND name ~ ${GENERATED_NAME_PATTERN}) AS generated_name_stops,
                (SELECT count(*) FROM transport.terminals
                    WHERE deleted_at IS NULL AND name ~ ${GENERATED_NAME_PATTERN}) AS generated_name_terminals,
                (SELECT count(*) FROM transport.stops
                    WHERE deleted_at IS NULL AND (name IS NULL OR btrim(name) = '')) AS missing_name_stops,
                (SELECT count(*) FROM transport.terminals
                    WHERE deleted_at IS NULL AND (name IS NULL OR btrim(name) = '')) AS missing_name_terminals,
                (SELECT count(*) FROM transport.routes r
                    WHERE r.deleted_at IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM transport.route_variants v
                          JOIN transport.route_paths p ON p.route_variant_id = v.id
                          WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                      )) AS routes_without_path,
                (SELECT count(*) FROM transport.routes r
                    WHERE r.deleted_at IS NULL
                      AND EXISTS (
                          SELECT 1 FROM transport.route_variants v
                          JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                          WHERE v.route_id = r.id AND v.deleted_at IS NULL
                      )
                      AND NOT EXISTS (
                          SELECT 1 FROM transport.route_variants v
                          JOIN transport.route_paths p ON p.route_variant_id = v.id
                          WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                      )) AS routes_with_stops_no_path,
                (SELECT count(*) FROM transport.routes r
                    WHERE r.deleted_at IS NULL
                      AND EXISTS (
                          SELECT 1 FROM transport.route_variants v
                          JOIN transport.route_paths p ON p.route_variant_id = v.id
                          WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                      )
                      AND NOT EXISTS (
                          SELECT 1 FROM transport.route_variants v
                          JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                          WHERE v.route_id = r.id AND v.deleted_at IS NULL
                      )) AS routes_with_path_no_stops,
                (SELECT count(*) FROM transport.terminals
                    WHERE deleted_at IS NULL AND mode = 'ferry'
                      AND review_status = 'imported_unreviewed') AS ferry_landing_candidates,
                (SELECT count(*) FROM transport.stops
                    WHERE deleted_at IS NULL AND confidence_score < ${LOW_CONFIDENCE_THRESHOLD}) AS low_conf_stops,
                (SELECT count(*) FROM transport.terminals
                    WHERE deleted_at IS NULL AND confidence_score < ${LOW_CONFIDENCE_THRESHOLD}) AS low_conf_terminals,
                (SELECT count(*) FROM transport.routes
                    WHERE deleted_at IS NULL AND confidence_score < ${LOW_CONFIDENCE_THRESHOLD}) AS low_conf_routes,
                (SELECT count(*) FROM transport.import_errors) AS import_errors
        `;

        const r = rows[0];
        return {
            generatedNameStops: num(r?.generated_name_stops),
            generatedNameTerminals: num(r?.generated_name_terminals),
            missingNameStops: num(r?.missing_name_stops),
            missingNameTerminals: num(r?.missing_name_terminals),
            routesWithoutPath: num(r?.routes_without_path),
            routesWithStopsButNoPath: num(r?.routes_with_stops_no_path),
            routesWithPathButNoStops: num(r?.routes_with_path_no_stops),
            ferryLandingCandidates: num(r?.ferry_landing_candidates),
            lowConfidenceStops: num(r?.low_conf_stops),
            lowConfidenceTerminals: num(r?.low_conf_terminals),
            lowConfidenceRoutes: num(r?.low_conf_routes),
            importErrors: num(r?.import_errors),
            lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
            schemaAvailable: true,
        };
    }

    async listImportBatches(
        query: ListImportBatchesQuery
    ): Promise<TransportPaginated<TransportImportBatchListItem>> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;

        const sourceName = query.sourceName ?? null;
        const sourceKind = query.sourceKind ?? null;
        const status = query.status ?? null;

        const where = Prisma.sql`
            WHERE (${sourceName}::text IS NULL OR b.source_name = ${sourceName})
              AND (${sourceKind}::text IS NULL OR b.source_kind = ${sourceKind})
              AND (${status}::text IS NULL OR b.status = ${status})
        `;

        const rows = await this.prisma.$queryRaw<ImportBatchRow[]>(Prisma.sql`
            SELECT
                b.id,
                b.public_id::text AS public_id,
                b.source_name,
                b.source_kind,
                b.import_scope,
                b.import_mode,
                b.status,
                b.started_at,
                b.finished_at,
                b.inserted_count,
                b.updated_count,
                b.skipped_count,
                b.error_count,
                b.notes,
                b.created_at,
                b.updated_at
            FROM transport.import_batches b
            ${where}
            ORDER BY b.started_at DESC, b.id DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `);

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count FROM transport.import_batches b ${where}
        `);

        return {
            items: rows.map((row) => ({
                id: Number(row.id),
                public_id: row.public_id,
                source_name: row.source_name,
                source_kind: row.source_kind,
                import_scope: row.import_scope,
                import_mode: row.import_mode,
                status: row.status,
                started_at: row.started_at.toISOString(),
                finished_at: row.finished_at ? row.finished_at.toISOString() : null,
                inserted_count: Number(row.inserted_count),
                updated_count: Number(row.updated_count),
                skipped_count: Number(row.skipped_count),
                error_count: Number(row.error_count),
                notes: row.notes,
                created_at: row.created_at.toISOString(),
                updated_at: row.updated_at.toISOString(),
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    async listImportErrors(
        query: ListImportErrorsQuery
    ): Promise<TransportPaginated<TransportImportErrorListItem>> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;

        const importBatchId = query.importBatchId ?? null;
        const entityType = query.entityType ?? null;
        const errorCode = query.errorCode ?? null;
        const searchLike = toLikeParam(query.search);

        const where = Prisma.sql`
            WHERE (${importBatchId}::bigint IS NULL OR e.import_batch_id = ${importBatchId})
              AND (${entityType}::text IS NULL OR e.entity_type = ${entityType})
              AND (${errorCode}::text IS NULL OR e.error_code = ${errorCode})
              AND (
                ${searchLike}::text IS NULL OR (
                    e.external_id ILIKE ${searchLike}
                    OR e.error_message ILIKE ${searchLike}
                )
              )
        `;

        const rows = await this.prisma.$queryRaw<ImportErrorRow[]>(Prisma.sql`
            SELECT
                e.id,
                e.import_batch_id,
                e.entity_type,
                e.external_id,
                e.error_code,
                e.error_message,
                e.created_at
            FROM transport.import_errors e
            ${where}
            ORDER BY e.id DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `);

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count FROM transport.import_errors e ${where}
        `);

        return {
            items: rows.map((row) => ({
                id: Number(row.id),
                import_batch_id: row.import_batch_id === null ? null : Number(row.import_batch_id),
                entity_type: row.entity_type,
                external_id: row.external_id,
                error_code: row.error_code,
                error_message: row.error_message,
                created_at: row.created_at.toISOString(),
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    async listSourceLinks(
        query: ListSourceLinksQuery
    ): Promise<TransportPaginated<TransportSourceLinkListItem>> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;

        const entityType = query.entityType ?? null;
        const entityId = query.entityId ?? null;
        const sourceName = query.sourceName ?? null;
        const sourceKind = query.sourceKind ?? null;
        const externalId = query.externalId ?? null;

        const where = Prisma.sql`
            WHERE (${entityType}::text IS NULL OR s.entity_type = ${entityType})
              AND (${entityId}::bigint IS NULL OR s.entity_id = ${entityId})
              AND (${sourceName}::text IS NULL OR s.source_name = ${sourceName})
              AND (${sourceKind}::text IS NULL OR s.source_kind = ${sourceKind})
              AND (${externalId}::text IS NULL OR s.external_id = ${externalId})
        `;

        const rows = await this.prisma.$queryRaw<SourceLinkRowListItem[]>(Prisma.sql`
            SELECT
                s.id,
                s.entity_type,
                s.entity_id,
                s.source_name,
                s.source_kind,
                s.external_id,
                s.source_url,
                s.import_batch_id,
                s.confidence_score::float8 AS confidence_score,
                s.is_primary,
                s.created_at
            FROM transport.source_links s
            ${where}
            ORDER BY s.id DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `);

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count FROM transport.source_links s ${where}
        `);

        return {
            items: rows.map((row) => ({
                id: Number(row.id),
                entity_type: row.entity_type,
                entity_id: Number(row.entity_id),
                source_name: row.source_name,
                source_kind: row.source_kind,
                external_id: row.external_id,
                source_url: row.source_url,
                import_batch_id: row.import_batch_id === null ? null : Number(row.import_batch_id),
                confidence_score: row.confidence_score,
                is_primary: row.is_primary,
                created_at: row.created_at.toISOString(),
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    async listRoutes(
        query: ListTransportRoutesQuery
    ): Promise<TransportPaginated<TransportRouteListItem>> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;

        const mode = query.mode ?? null;
        const reviewStatus = query.reviewStatus ?? null;
        const isActive = query.isActive === undefined ? null : query.isActive;
        const hasStops = query.hasStops === undefined ? null : query.hasStops;
        const hasPath = query.hasPath === undefined ? null : query.hasPath;
        const includeDeleted = query.includeDeleted === true;
        const searchLike = toLikeParam(query.search);

        const rows = await this.prisma.$queryRaw<RouteListRow[]>`
            SELECT
                r.public_id::text AS public_id,
                r.route_code,
                r.public_name,
                r.mode,
                r.route_kind,
                r.origin_name,
                r.destination_name,
                r.review_status,
                r.confidence_score::float8 AS confidence_score,
                r.is_active,
                (SELECT count(*) FROM transport.route_variants v
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL)::bigint AS variant_count,
                (SELECT count(*) FROM transport.route_variants v
                    JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL)::bigint AS stop_count,
                (SELECT count(*) FROM transport.route_variants v
                    JOIN transport.route_paths p ON p.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL)::bigint AS path_count,
                r.updated_at
            FROM transport.routes r
            WHERE (${includeDeleted}::boolean OR r.deleted_at IS NULL)
              AND (${mode}::text IS NULL OR r.mode = ${mode})
              AND (${reviewStatus}::text IS NULL OR r.review_status = ${reviewStatus})
              AND (${isActive}::boolean IS NULL OR r.is_active = ${isActive})
              AND (
                ${searchLike}::text IS NULL OR (
                    r.route_code ILIKE ${searchLike}
                    OR r.public_name ILIKE ${searchLike}
                    OR r.origin_name ILIKE ${searchLike}
                    OR r.destination_name ILIKE ${searchLike}
                    OR EXISTS (
                        SELECT 1 FROM transport.route_names rn
                        WHERE rn.route_id = r.id AND rn.name ILIKE ${searchLike}
                    )
                )
              )
              AND (
                ${hasStops}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.route_variants v
                        JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                        WHERE v.route_id = r.id AND v.deleted_at IS NULL
                    )
                ) = ${hasStops}
              )
              AND (
                ${hasPath}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.route_variants v
                        JOIN transport.route_paths p ON p.route_variant_id = v.id
                        WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                    )
                ) = ${hasPath}
              )
            ORDER BY r.updated_at DESC, r.id DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM transport.routes r
            WHERE (${includeDeleted}::boolean OR r.deleted_at IS NULL)
              AND (${mode}::text IS NULL OR r.mode = ${mode})
              AND (${reviewStatus}::text IS NULL OR r.review_status = ${reviewStatus})
              AND (${isActive}::boolean IS NULL OR r.is_active = ${isActive})
              AND (
                ${searchLike}::text IS NULL OR (
                    r.route_code ILIKE ${searchLike}
                    OR r.public_name ILIKE ${searchLike}
                    OR r.origin_name ILIKE ${searchLike}
                    OR r.destination_name ILIKE ${searchLike}
                    OR EXISTS (
                        SELECT 1 FROM transport.route_names rn
                        WHERE rn.route_id = r.id AND rn.name ILIKE ${searchLike}
                    )
                )
              )
              AND (
                ${hasStops}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.route_variants v
                        JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                        WHERE v.route_id = r.id AND v.deleted_at IS NULL
                    )
                ) = ${hasStops}
              )
              AND (
                ${hasPath}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.route_variants v
                        JOIN transport.route_paths p ON p.route_variant_id = v.id
                        WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                    )
                ) = ${hasPath}
              )
        `;

        return {
            items: rows.map((row) => ({
                public_id: row.public_id,
                route_code: row.route_code,
                public_name: row.public_name,
                mode: row.mode,
                route_kind: row.route_kind,
                origin_name: row.origin_name,
                destination_name: row.destination_name,
                review_status: row.review_status,
                confidence_score: row.confidence_score,
                is_active: row.is_active,
                variant_count: num(row.variant_count),
                stop_count: num(row.stop_count),
                path_count: num(row.path_count),
                updated_at: row.updated_at.toISOString(),
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    async listStops(
        query: ListTransportStopsQuery
    ): Promise<TransportPaginated<TransportStopListItem>> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;

        const mode = query.mode ?? null;
        const stopType = query.stopType ?? null;
        const reviewStatus = query.reviewStatus ?? null;
        const isActive = query.isActive === undefined ? null : query.isActive;
        const generatedName = query.generatedName === undefined ? null : query.generatedName;
        const hasRoutes = query.hasRoutes === undefined ? null : query.hasRoutes;
        const adminAreaId = query.adminAreaId ?? null;
        const includeDeleted = query.includeDeleted === true;
        const searchLike = toLikeParam(query.search);

        // Shared WHERE predicate (kept in one place for list + count parity).
        const where = Prisma.sql`
            WHERE (${includeDeleted}::boolean OR s.deleted_at IS NULL)
              AND (${mode}::text IS NULL OR s.mode = ${mode})
              AND (${stopType}::text IS NULL OR s.stop_type = ${stopType})
              AND (${reviewStatus}::text IS NULL OR s.review_status = ${reviewStatus})
              AND (${isActive}::boolean IS NULL OR s.is_active = ${isActive})
              AND (${adminAreaId}::bigint IS NULL OR s.admin_area_id = ${adminAreaId})
              AND (
                ${generatedName}::boolean IS NULL
                OR (s.name ~ ${GENERATED_NAME_PATTERN}) = ${generatedName}
              )
              AND (
                ${searchLike}::text IS NULL OR (
                    s.name ILIKE ${searchLike}
                    OR s.name_mm ILIKE ${searchLike}
                    OR s.name_en ILIKE ${searchLike}
                    OR s.stop_code ILIKE ${searchLike}
                )
              )
              AND (
                ${hasRoutes}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.route_stops rs
                        WHERE rs.stop_id = s.id
                    )
                ) = ${hasRoutes}
              )
        `;

        const rows = await this.prisma.$queryRaw<StopListRow[]>(Prisma.sql`
            SELECT
                s.public_id::text AS public_id,
                s.stop_code,
                s.name,
                s.name_mm,
                s.name_en,
                s.mode,
                s.stop_type,
                (SELECT count(DISTINCT v.route_id)
                    FROM transport.route_stops rs
                    JOIN transport.route_variants v ON v.id = rs.route_variant_id
                    WHERE rs.stop_id = s.id AND v.deleted_at IS NULL)::bigint AS route_count,
                s.admin_area_id,
                aa.canonical_name AS admin_area_name,
                s.review_status,
                s.confidence_score::float8 AS confidence_score,
                s.is_active,
                s.updated_at
            FROM transport.stops s
            LEFT JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id
            ${where}
            ORDER BY s.updated_at DESC, s.id DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `);

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM transport.stops s
            ${where}
        `);

        return {
            items: rows.map((row) => ({
                public_id: row.public_id,
                stop_code: row.stop_code,
                name: row.name,
                name_mm: row.name_mm,
                name_en: row.name_en,
                mode: row.mode,
                stop_type: row.stop_type,
                route_count: num(row.route_count),
                admin_area_id: row.admin_area_id === null ? null : Number(row.admin_area_id),
                admin_area_name: row.admin_area_name,
                review_status: row.review_status,
                confidence_score: row.confidence_score,
                is_active: row.is_active,
                updated_at: row.updated_at.toISOString(),
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    async listTerminals(
        query: ListTransportTerminalsQuery
    ): Promise<TransportPaginated<TransportTerminalListItem>> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;

        const mode = query.mode ?? null;
        const terminalRole = query.terminalRole ?? null;
        const reviewStatus = query.reviewStatus ?? null;
        const isActive = query.isActive === undefined ? null : query.isActive;
        const generatedName = query.generatedName === undefined ? null : query.generatedName;
        const linkedStop = query.linkedStop === undefined ? null : query.linkedStop;
        const adminAreaId = query.adminAreaId ?? null;
        const confidenceMin = query.confidenceMin ?? null;
        const confidenceMax = query.confidenceMax ?? null;
        const includeDeleted = query.includeDeleted === true;
        const searchLike = toLikeParam(query.search);

        const where = Prisma.sql`
            WHERE (${includeDeleted}::boolean OR t.deleted_at IS NULL)
              AND (${mode}::text IS NULL OR t.mode = ${mode})
              AND (${terminalRole}::text IS NULL OR t.terminal_role = ${terminalRole})
              AND (${reviewStatus}::text IS NULL OR t.review_status = ${reviewStatus})
              AND (${isActive}::boolean IS NULL OR t.is_active = ${isActive})
              AND (${adminAreaId}::bigint IS NULL OR t.admin_area_id = ${adminAreaId})
              AND (${confidenceMin}::float8 IS NULL OR t.confidence_score >= ${confidenceMin})
              AND (${confidenceMax}::float8 IS NULL OR t.confidence_score <= ${confidenceMax})
              AND (
                ${generatedName}::boolean IS NULL
                OR (t.name ~ ${GENERATED_NAME_PATTERN}) = ${generatedName}
              )
              AND (
                ${linkedStop}::boolean IS NULL
                OR (t.linked_stop_id IS NOT NULL) = ${linkedStop}
              )
              AND (
                ${searchLike}::text IS NULL OR (
                    t.name ILIKE ${searchLike}
                    OR t.name_mm ILIKE ${searchLike}
                    OR t.name_en ILIKE ${searchLike}
                    OR t.terminal_code ILIKE ${searchLike}
                )
              )
        `;

        const rows = await this.prisma.$queryRaw<TerminalListRow[]>(Prisma.sql`
            SELECT
                t.public_id::text AS public_id,
                t.terminal_code,
                t.name,
                t.name_mm,
                t.name_en,
                CASE
                    WHEN btrim(t.name) = '' THEN 'missing'
                    WHEN t.name ~ ${GENERATED_NAME_PATTERN} THEN 'generated'
                    ELSE 'real'
                END AS raw_name_status,
                t.mode,
                t.terminal_role,
                ls.public_id::text AS linked_stop_public_id,
                ls.name AS linked_stop_name,
                t.admin_area_id,
                aa.canonical_name AS admin_area_name,
                t.review_status,
                t.confidence_score::float8 AS confidence_score,
                t.is_active,
                t.updated_at
            FROM transport.terminals t
            LEFT JOIN transport.stops ls ON ls.id = t.linked_stop_id
            LEFT JOIN core.core_admin_areas aa ON aa.id = t.admin_area_id
            ${where}
            ORDER BY t.updated_at DESC, t.id DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `);

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM transport.terminals t
            ${where}
        `);

        return {
            items: rows.map((row) => ({
                public_id: row.public_id,
                terminal_code: row.terminal_code,
                name: row.name,
                name_mm: row.name_mm,
                name_en: row.name_en,
                raw_name_status: row.raw_name_status as TransportRawNameStatus,
                mode: row.mode,
                terminal_role: row.terminal_role,
                linked_stop:
                    row.linked_stop_public_id === null
                        ? null
                        : {
                              public_id: row.linked_stop_public_id,
                              name: row.linked_stop_name ?? "",
                          },
                admin_area_id: row.admin_area_id === null ? null : Number(row.admin_area_id),
                admin_area_name: row.admin_area_name,
                review_status: row.review_status,
                confidence_score: row.confidence_score,
                is_active: row.is_active,
                updated_at: row.updated_at.toISOString(),
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    async listInfrastructureLines(
        query: ListTransportInfrastructureLinesQuery
    ): Promise<TransportPaginated<TransportInfrastructureLineListItem>> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;

        const mode = query.mode ?? null;
        const lineType = query.lineType ?? null;
        const reviewStatus = query.reviewStatus ?? null;
        const isActive = query.isActive === undefined ? null : query.isActive;
        const generatedName = query.generatedName === undefined ? null : query.generatedName;
        const adminAreaId = query.adminAreaId ?? null;
        const includeDeleted = query.includeDeleted === true;
        const searchLike = toLikeParam(query.search);

        const where = Prisma.sql`
            WHERE (${includeDeleted}::boolean OR l.deleted_at IS NULL)
              AND (${mode}::text IS NULL OR l.mode = ${mode})
              AND (${lineType}::text IS NULL OR l.line_type = ${lineType})
              AND (${reviewStatus}::text IS NULL OR l.review_status = ${reviewStatus})
              AND (${isActive}::boolean IS NULL OR l.is_active = ${isActive})
              AND (${adminAreaId}::bigint IS NULL OR l.admin_area_id = ${adminAreaId})
              AND (
                ${generatedName}::boolean IS NULL
                OR (l.name IS NOT NULL AND l.name ~ ${GENERATED_NAME_PATTERN}) = ${generatedName}
              )
              AND (
                ${searchLike}::text IS NULL OR (
                    l.name ILIKE ${searchLike}
                    OR l.name_mm ILIKE ${searchLike}
                    OR l.name_en ILIKE ${searchLike}
                )
              )
        `;

        const rows = await this.prisma.$queryRaw<InfrastructureLineListRow[]>(Prisma.sql`
            SELECT
                l.public_id::text AS public_id,
                l.name,
                l.name_mm,
                l.name_en,
                CASE
                    WHEN l.name IS NULL OR btrim(l.name) = '' THEN 'missing'
                    WHEN l.name ~ ${GENERATED_NAME_PATTERN} THEN 'generated'
                    ELSE 'real'
                END AS raw_name_status,
                l.mode,
                l.line_type,
                l.admin_area_id,
                aa.canonical_name AS admin_area_name,
                l.review_status,
                l.confidence_score::float8 AS confidence_score,
                l.is_active,
                l.updated_at
            FROM transport.infrastructure_lines l
            LEFT JOIN core.core_admin_areas aa ON aa.id = l.admin_area_id
            ${where}
            ORDER BY l.updated_at DESC, l.id DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `);

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM transport.infrastructure_lines l
            ${where}
        `);

        return {
            items: rows.map((row) => ({
                public_id: row.public_id,
                name: row.name ?? "",
                name_mm: row.name_mm,
                name_en: row.name_en,
                raw_name_status: row.raw_name_status as TransportRawNameStatus,
                mode: row.mode,
                line_type: row.line_type,
                admin_area_id: row.admin_area_id === null ? null : Number(row.admin_area_id),
                admin_area_name: row.admin_area_name,
                review_status: row.review_status,
                confidence_score: row.confidence_score,
                is_active: row.is_active,
                updated_at: row.updated_at.toISOString(),
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    async getInfrastructureLineByPublicId(
        publicId: string
    ): Promise<TransportInfrastructureLineDetail> {
        await this.assertSchemaAvailable();

        const rows = await this.prisma.$queryRaw<InfrastructureLineDetailRow[]>`
            SELECT
                l.id,
                l.public_id::text AS public_id,
                l.name,
                l.name_mm,
                l.name_en,
                CASE
                    WHEN l.name IS NULL OR btrim(l.name) = '' THEN 'missing'
                    WHEN l.name ~ ${GENERATED_NAME_PATTERN} THEN 'generated'
                    ELSE 'real'
                END AS raw_name_status,
                l.mode,
                l.line_type,
                l.admin_area_id,
                aa.canonical_name AS admin_area_name,
                l.review_status,
                l.confidence_score::float8 AS confidence_score,
                l.is_active,
                ST_AsGeoJSON(l.geom)::jsonb AS geometry,
                ST_Length(l.geom::geography)::float8 AS length_m,
                l.created_at,
                l.updated_at,
                l.deleted_at,
                l.source_refs,
                l.normalized_data
            FROM transport.infrastructure_lines l
            LEFT JOIN core.core_admin_areas aa ON aa.id = l.admin_area_id
            WHERE l.public_id = ${publicId}::uuid
            LIMIT 1
        `;

        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("infrastructure_line", publicId);
        }

        const sourceRows = await this.prisma.$queryRaw<SourceRow[]>`
            SELECT source_name, source_kind, external_id, source_url, is_primary
            FROM transport.source_links
            WHERE entity_type = 'infrastructure_line' AND entity_id = ${row.id}
            ORDER BY is_primary DESC, source_name ASC
            LIMIT 50
        `;

        return {
            public_id: row.public_id,
            name: row.name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            raw_name_status: row.raw_name_status as TransportRawNameStatus,
            mode: row.mode,
            line_type: row.line_type,
            admin_area_id: row.admin_area_id === null ? null : Number(row.admin_area_id),
            admin_area_name: row.admin_area_name,
            review_status: row.review_status,
            confidence_score: row.confidence_score,
            is_active: row.is_active,
            geometry: asGeometry(row.geometry),
            length_m: row.length_m,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
            sources: sourceRows.map((src) => ({
                source_name: src.source_name,
                source_kind: src.source_kind,
                external_id: src.external_id,
                source_url: src.source_url,
                is_primary: src.is_primary,
            })),
            source_refs: row.source_refs ?? null,
            normalized_data: row.normalized_data ?? null,
        };
    }

    /**
     * Partial update of an active infrastructure line's editable metadata. Only
     * provided keys are written; `source_refs` / `normalized_data` and geometry are
     * never touched here. admin_area_id FK is validated up-front. Never hard-deletes.
     */
    async updateInfrastructureLineByPublicId(
        publicId: string,
        input: UpdateInfrastructureLineInput,
        audit?: TransportAuditContext
    ): Promise<TransportInfrastructureLineDetail> {
        await this.assertSchemaAvailable();

        const existing = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM transport.infrastructure_lines WHERE public_id = ${publicId}::uuid LIMIT 1
        `;
        if (!existing[0]) {
            throw new TransportNotFoundError("infrastructure_line", publicId);
        }

        if (input.admin_area_id !== undefined && input.admin_area_id !== null) {
            const refRows = await this.prisma.$queryRaw<{ ok: number }[]>`
                SELECT 1 AS ok FROM core.core_admin_areas WHERE id = ${input.admin_area_id} LIMIT 1
            `;
            if (!refRows[0]) {
                throw new TransportInvalidReferenceError("admin_area_id");
            }
        }

        const sets: Prisma.Sql[] = [];
        if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
        if (input.name_mm !== undefined) sets.push(Prisma.sql`name_mm = ${input.name_mm}`);
        if (input.name_en !== undefined) sets.push(Prisma.sql`name_en = ${input.name_en}`);
        if (input.mode !== undefined) sets.push(Prisma.sql`mode = ${input.mode}`);
        if (input.line_type !== undefined) sets.push(Prisma.sql`line_type = ${input.line_type}`);
        if (input.admin_area_id !== undefined)
            sets.push(Prisma.sql`admin_area_id = ${input.admin_area_id}`);
        if (input.review_status !== undefined)
            sets.push(Prisma.sql`review_status = ${input.review_status}`);
        if (input.confidence_score !== undefined)
            sets.push(Prisma.sql`confidence_score = ${input.confidence_score}`);
        if (input.is_active !== undefined) sets.push(Prisma.sql`is_active = ${input.is_active}`);

        if (sets.length === 0) {
            return this.getInfrastructureLineByPublicId(publicId);
        }

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<InfrastructureLineAuditRow[]>`
                SELECT id, name, name_mm, name_en, mode, line_type,
                       admin_area_id::int AS admin_area_id, review_status,
                       confidence_score::float8 AS confidence_score, is_active
                FROM transport.infrastructure_lines
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("infrastructure_line", publicId);
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.infrastructure_lines
                SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
            `);

            const diff = diffScalarFields(before, input, INFRASTRUCTURE_LINE_AUDIT_FIELDS);
            if (diff.changedFields.length > 0) {
                await insertTransportAuditLog(tx, {
                    action: "transport.infrastructure_line.update",
                    entityType: "transport_infrastructure_line",
                    entityId: before.id,
                    entityPublicId: publicId,
                    changedFields: diff.changedFields,
                    oldValues: diff.oldValues,
                    newValues: diff.newValues,
                    metadata: null,
                    context: audit,
                });
            }
        });

        return this.getInfrastructureLineByPublicId(publicId);
    }

    /** Internal stop id by public_id (used by routes-usage + update paths). */
    private async getStopIdByPublicId(publicId: string): Promise<bigint> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM transport.stops WHERE public_id = ${publicId}::uuid LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("stop", publicId);
        }
        return row.id;
    }

    async getStopByPublicId(publicId: string): Promise<TransportStopDetail> {
        await this.assertSchemaAvailable();

        const rows = await this.prisma.$queryRaw<StopDetailRow[]>`
            SELECT
                s.id,
                s.public_id::text AS public_id,
                s.stop_code,
                s.name,
                s.name_mm,
                s.name_en,
                s.mode,
                s.stop_type,
                s.admin_area_id,
                aa.canonical_name AS admin_area_name,
                s.parent_stop_id,
                ps.public_id::text AS parent_stop_public_id,
                ps.name AS parent_stop_name,
                s.review_status,
                s.confidence_score::float8 AS confidence_score,
                s.is_active,
                ST_X(s.geom)::float8 AS longitude,
                ST_Y(s.geom)::float8 AS latitude,
                ST_AsGeoJSON(s.geom)::jsonb AS geometry,
                (SELECT count(DISTINCT v.route_id)
                    FROM transport.route_stops rs
                    JOIN transport.route_variants v ON v.id = rs.route_variant_id
                    WHERE rs.stop_id = s.id AND v.deleted_at IS NULL)::bigint AS route_count,
                s.created_at,
                s.updated_at,
                s.deleted_at,
                s.source_refs,
                s.normalized_data
            FROM transport.stops s
            LEFT JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id
            LEFT JOIN transport.stops ps ON ps.id = s.parent_stop_id
            WHERE s.public_id = ${publicId}::uuid
            LIMIT 1
        `;

        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("stop", publicId);
        }

        const sourceRows = await this.prisma.$queryRaw<SourceRow[]>`
            SELECT source_name, source_kind, external_id, source_url, is_primary
            FROM transport.source_links
            WHERE entity_type = 'stop' AND entity_id = ${row.id}
            ORDER BY is_primary DESC, source_name ASC
            LIMIT 50
        `;

        return {
            public_id: row.public_id,
            stop_code: row.stop_code,
            name: row.name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            mode: row.mode,
            stop_type: row.stop_type,
            admin_area_id: row.admin_area_id === null ? null : Number(row.admin_area_id),
            admin_area_name: row.admin_area_name,
            parent_stop_id: row.parent_stop_id === null ? null : Number(row.parent_stop_id),
            parent_stop:
                row.parent_stop_id === null
                    ? null
                    : {
                          public_id: row.parent_stop_public_id ?? "",
                          name: row.parent_stop_name ?? "",
                      },
            review_status: row.review_status,
            confidence_score: row.confidence_score,
            is_active: row.is_active,
            longitude: row.longitude,
            latitude: row.latitude,
            geometry: asGeometry(row.geometry),
            route_count: num(row.route_count),
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
            sources: sourceRows.map((src) => ({
                source_name: src.source_name,
                source_kind: src.source_kind,
                external_id: src.external_id,
                source_url: src.source_url,
                is_primary: src.is_primary,
            })),
            source_refs: row.source_refs ?? null,
            normalized_data: row.normalized_data ?? null,
        };
    }

    /** Paginated list of route variants that include this stop (summary only). */
    async listRoutesForStop(
        publicId: string,
        query: StopRoutesQuery
    ): Promise<TransportPaginated<TransportStopRouteUsage>> {
        await this.assertSchemaAvailable();

        const stopId = await this.getStopIdByPublicId(publicId);
        const limit = query.limit;
        const offset = query.offset;

        const rows = await this.prisma.$queryRaw<StopRouteUsageRow[]>`
            SELECT
                r.public_id::text AS route_public_id,
                r.route_code,
                r.public_name AS route_name,
                r.mode,
                v.public_id::text AS variant_public_id,
                v.variant_code,
                v.direction_name,
                v.headsign,
                rs.stop_sequence
            FROM transport.route_stops rs
            JOIN transport.route_variants v ON v.id = rs.route_variant_id AND v.deleted_at IS NULL
            JOIN transport.routes r ON r.id = v.route_id AND r.deleted_at IS NULL
            WHERE rs.stop_id = ${stopId}
            ORDER BY r.route_code ASC, v.variant_code ASC, rs.stop_sequence ASC
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM transport.route_stops rs
            JOIN transport.route_variants v ON v.id = rs.route_variant_id AND v.deleted_at IS NULL
            JOIN transport.routes r ON r.id = v.route_id AND r.deleted_at IS NULL
            WHERE rs.stop_id = ${stopId}
        `;

        return {
            items: rows.map((row) => ({
                route_public_id: row.route_public_id,
                route_code: row.route_code,
                route_name: row.route_name,
                mode: row.mode,
                variant_public_id: row.variant_public_id,
                variant_code: row.variant_code,
                direction_name: row.direction_name,
                headsign: row.headsign,
                stop_sequence: row.stop_sequence,
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    /** Confirms an FK target row exists; throws {@link TransportInvalidReferenceError} otherwise. */
    private async assertReferenceExists(
        field: "admin_area_id" | "parent_stop_id",
        id: number,
        currentStopId: bigint
    ): Promise<void> {
        if (field === "admin_area_id") {
            const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
                SELECT 1 AS ok FROM core.core_admin_areas WHERE id = ${id} LIMIT 1
            `;
            if (!rows[0]) {
                throw new TransportInvalidReferenceError(field);
            }
            return;
        }
        // parent_stop_id: must exist, be active, and not be the stop itself (no self-parent).
        if (BigInt(id) === currentStopId) {
            throw new TransportInvalidReferenceError(field);
        }
        const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
            SELECT 1 AS ok FROM transport.stops WHERE id = ${id} AND deleted_at IS NULL LIMIT 1
        `;
        if (!rows[0]) {
            throw new TransportInvalidReferenceError(field);
        }
    }

    /**
     * Partial update of an active stop's editable metadata + point geometry. Only
     * provided keys are written; `source_refs` / `normalized_data` are never touched.
     * FK references are validated up-front. Never hard-deletes. Returns refreshed detail.
     */
    async updateStopByPublicId(
        publicId: string,
        input: UpdateStopInput,
        audit?: TransportAuditContext
    ): Promise<TransportStopDetail> {
        await this.assertSchemaAvailable();

        const stopId = await this.getStopIdByPublicId(publicId);

        if (input.admin_area_id !== undefined && input.admin_area_id !== null) {
            await this.assertReferenceExists("admin_area_id", input.admin_area_id, stopId);
        }
        if (input.parent_stop_id !== undefined && input.parent_stop_id !== null) {
            await this.assertReferenceExists("parent_stop_id", input.parent_stop_id, stopId);
        }

        const sets: Prisma.Sql[] = [];
        if (input.stop_code !== undefined) sets.push(Prisma.sql`stop_code = ${input.stop_code}`);
        if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
        if (input.name_mm !== undefined) sets.push(Prisma.sql`name_mm = ${input.name_mm}`);
        if (input.name_en !== undefined) sets.push(Prisma.sql`name_en = ${input.name_en}`);
        if (input.mode !== undefined) sets.push(Prisma.sql`mode = ${input.mode}`);
        if (input.stop_type !== undefined) sets.push(Prisma.sql`stop_type = ${input.stop_type}`);
        if (input.admin_area_id !== undefined)
            sets.push(Prisma.sql`admin_area_id = ${input.admin_area_id}`);
        if (input.parent_stop_id !== undefined)
            sets.push(Prisma.sql`parent_stop_id = ${input.parent_stop_id}`);
        if (input.review_status !== undefined)
            sets.push(Prisma.sql`review_status = ${input.review_status}`);
        if (input.confidence_score !== undefined)
            sets.push(Prisma.sql`confidence_score = ${input.confidence_score}`);
        if (input.is_active !== undefined) sets.push(Prisma.sql`is_active = ${input.is_active}`);
        if (input.point !== undefined)
            sets.push(
                Prisma.sql`geom = ST_SetSRID(ST_MakePoint(${input.point.longitude}, ${input.point.latitude}), 4326)`
            );

        if (sets.length === 0) {
            return this.getStopByPublicId(publicId);
        }

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<StopAuditRow[]>`
                SELECT id, stop_code, name, name_mm, name_en, mode, stop_type,
                       admin_area_id::int AS admin_area_id, parent_stop_id::int AS parent_stop_id,
                       review_status, confidence_score::float8 AS confidence_score, is_active,
                       ST_X(geom)::float8 AS point_lng, ST_Y(geom)::float8 AS point_lat
                FROM transport.stops
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("stop", publicId);
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.stops
                SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
            `);

            const diff = diffScalarFields(before, input, STOP_AUDIT_FIELDS);
            appendPointDiff(diff, { lat: before.point_lat, lng: before.point_lng }, input.point);
            if (diff.changedFields.length > 0) {
                await insertTransportAuditLog(tx, {
                    action: resolvePointAwareAction(
                        "transport.stop.update",
                        "transport.stop.point_move",
                        diff.changedFields
                    ),
                    entityType: "transport_stop",
                    entityId: before.id,
                    entityPublicId: publicId,
                    changedFields: diff.changedFields,
                    oldValues: diff.oldValues,
                    newValues: diff.newValues,
                    metadata: null,
                    context: audit,
                });
            }
        });

        return this.getStopByPublicId(publicId);
    }

    async getTerminalByPublicId(publicId: string): Promise<TransportTerminalDetail> {
        await this.assertSchemaAvailable();

        const rows = await this.prisma.$queryRaw<TerminalDetailRow[]>`
            SELECT
                t.id,
                t.public_id::text AS public_id,
                t.terminal_code,
                t.name,
                t.name_mm,
                t.name_en,
                CASE
                    WHEN btrim(t.name) = '' THEN 'missing'
                    WHEN t.name ~ ${GENERATED_NAME_PATTERN} THEN 'generated'
                    ELSE 'real'
                END AS raw_name_status,
                t.mode,
                t.terminal_role,
                t.linked_stop_id,
                ls.public_id::text AS linked_stop_public_id,
                ls.name AS linked_stop_name,
                ls.mode AS linked_stop_mode,
                ls.stop_type AS linked_stop_type,
                t.operator_id,
                o.name AS operator_name,
                t.admin_area_id,
                aa.canonical_name AS admin_area_name,
                t.review_status,
                t.confidence_score::float8 AS confidence_score,
                t.is_active,
                ST_X(t.geom)::float8 AS longitude,
                ST_Y(t.geom)::float8 AS latitude,
                ST_AsGeoJSON(t.geom)::jsonb AS geometry,
                t.created_at,
                t.updated_at,
                t.deleted_at,
                t.source_refs,
                t.normalized_data
            FROM transport.terminals t
            LEFT JOIN transport.stops ls ON ls.id = t.linked_stop_id
            LEFT JOIN transport.operators o ON o.id = t.operator_id
            LEFT JOIN core.core_admin_areas aa ON aa.id = t.admin_area_id
            WHERE t.public_id = ${publicId}::uuid
            LIMIT 1
        `;

        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("terminal", publicId);
        }

        const sourceRows = await this.prisma.$queryRaw<SourceRow[]>`
            SELECT source_name, source_kind, external_id, source_url, is_primary
            FROM transport.source_links
            WHERE entity_type = 'terminal' AND entity_id = ${row.id}
            ORDER BY is_primary DESC, source_name ASC
            LIMIT 50
        `;

        return {
            public_id: row.public_id,
            terminal_code: row.terminal_code,
            name: row.name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            raw_name_status: row.raw_name_status as TransportTerminalDetail["raw_name_status"],
            mode: row.mode,
            terminal_role: row.terminal_role,
            linked_stop_id: row.linked_stop_id === null ? null : Number(row.linked_stop_id),
            linked_stop:
                row.linked_stop_id === null
                    ? null
                    : {
                          public_id: row.linked_stop_public_id ?? "",
                          name: row.linked_stop_name ?? "",
                          mode: row.linked_stop_mode ?? "",
                          stop_type: row.linked_stop_type ?? "",
                      },
            operator_id: row.operator_id === null ? null : Number(row.operator_id),
            operator:
                row.operator_id === null
                    ? null
                    : { id: Number(row.operator_id), name: row.operator_name ?? "" },
            admin_area_id: row.admin_area_id === null ? null : Number(row.admin_area_id),
            admin_area_name: row.admin_area_name,
            review_status: row.review_status,
            confidence_score: row.confidence_score,
            is_active: row.is_active,
            longitude: row.longitude,
            latitude: row.latitude,
            geometry: asGeometry(row.geometry),
            vehicle_access: deriveVehicleAccess(row.normalized_data),
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
            sources: sourceRows.map((src) => ({
                source_name: src.source_name,
                source_kind: src.source_kind,
                external_id: src.external_id,
                source_url: src.source_url,
                is_primary: src.is_primary,
            })),
            source_refs: row.source_refs ?? null,
            normalized_data: row.normalized_data ?? null,
        };
    }

    /** Confirms a terminal FK target exists; throws {@link TransportInvalidReferenceError} otherwise. */
    private async assertTerminalRef(
        field: "linked_stop_id" | "operator_id" | "admin_area_id",
        id: number
    ): Promise<void> {
        let rows: { ok: number }[];
        if (field === "linked_stop_id") {
            rows = await this.prisma.$queryRaw<{ ok: number }[]>`
                SELECT 1 AS ok FROM transport.stops WHERE id = ${id} AND deleted_at IS NULL LIMIT 1
            `;
        } else if (field === "operator_id") {
            rows = await this.prisma.$queryRaw<{ ok: number }[]>`
                SELECT 1 AS ok FROM transport.operators WHERE id = ${id} AND deleted_at IS NULL LIMIT 1
            `;
        } else {
            rows = await this.prisma.$queryRaw<{ ok: number }[]>`
                SELECT 1 AS ok FROM core.core_admin_areas WHERE id = ${id} LIMIT 1
            `;
        }
        if (!rows[0]) {
            throw new TransportInvalidReferenceError(field);
        }
    }

    /**
     * Partial update of an active terminal's editable metadata + point geometry.
     * Only provided keys are written; `source_refs` / `normalized_data` are never
     * touched. FK references are validated up-front. Never hard-deletes.
     */
    async updateTerminalByPublicId(
        publicId: string,
        input: UpdateTerminalInput,
        audit?: TransportAuditContext
    ): Promise<TransportTerminalDetail> {
        await this.assertSchemaAvailable();

        const existing = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM transport.terminals WHERE public_id = ${publicId}::uuid LIMIT 1
        `;
        if (!existing[0]) {
            throw new TransportNotFoundError("terminal", publicId);
        }

        if (input.linked_stop_id !== undefined && input.linked_stop_id !== null) {
            await this.assertTerminalRef("linked_stop_id", input.linked_stop_id);
        }
        if (input.operator_id !== undefined && input.operator_id !== null) {
            await this.assertTerminalRef("operator_id", input.operator_id);
        }
        if (input.admin_area_id !== undefined && input.admin_area_id !== null) {
            await this.assertTerminalRef("admin_area_id", input.admin_area_id);
        }

        const sets: Prisma.Sql[] = [];
        if (input.terminal_code !== undefined)
            sets.push(Prisma.sql`terminal_code = ${input.terminal_code}`);
        if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
        if (input.name_mm !== undefined) sets.push(Prisma.sql`name_mm = ${input.name_mm}`);
        if (input.name_en !== undefined) sets.push(Prisma.sql`name_en = ${input.name_en}`);
        if (input.mode !== undefined) sets.push(Prisma.sql`mode = ${input.mode}`);
        if (input.terminal_role !== undefined)
            sets.push(Prisma.sql`terminal_role = ${input.terminal_role}`);
        if (input.linked_stop_id !== undefined)
            sets.push(Prisma.sql`linked_stop_id = ${input.linked_stop_id}`);
        if (input.operator_id !== undefined)
            sets.push(Prisma.sql`operator_id = ${input.operator_id}`);
        if (input.admin_area_id !== undefined)
            sets.push(Prisma.sql`admin_area_id = ${input.admin_area_id}`);
        if (input.review_status !== undefined)
            sets.push(Prisma.sql`review_status = ${input.review_status}`);
        if (input.confidence_score !== undefined)
            sets.push(Prisma.sql`confidence_score = ${input.confidence_score}`);
        if (input.is_active !== undefined) sets.push(Prisma.sql`is_active = ${input.is_active}`);
        if (input.point !== undefined)
            sets.push(
                Prisma.sql`geom = ST_SetSRID(ST_MakePoint(${input.point.longitude}, ${input.point.latitude}), 4326)`
            );

        if (sets.length === 0) {
            return this.getTerminalByPublicId(publicId);
        }

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<TerminalAuditRow[]>`
                SELECT id, terminal_code, name, name_mm, name_en, mode, terminal_role,
                       linked_stop_id::int AS linked_stop_id, operator_id::int AS operator_id,
                       admin_area_id::int AS admin_area_id, review_status,
                       confidence_score::float8 AS confidence_score, is_active,
                       ST_X(geom)::float8 AS point_lng, ST_Y(geom)::float8 AS point_lat
                FROM transport.terminals
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("terminal", publicId);
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.terminals
                SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
            `);

            const diff = diffScalarFields(before, input, TERMINAL_AUDIT_FIELDS);
            appendPointDiff(diff, { lat: before.point_lat, lng: before.point_lng }, input.point);
            if (diff.changedFields.length > 0) {
                await insertTransportAuditLog(tx, {
                    action: resolvePointAwareAction(
                        "transport.terminal.update",
                        "transport.terminal.point_move",
                        diff.changedFields
                    ),
                    entityType: "transport_terminal",
                    entityId: before.id,
                    entityPublicId: publicId,
                    changedFields: diff.changedFields,
                    oldValues: diff.oldValues,
                    newValues: diff.newValues,
                    metadata: null,
                    context: audit,
                });
            }
        });

        return this.getTerminalByPublicId(publicId);
    }

    async getRouteByPublicId(publicId: string): Promise<TransportRouteDetail> {
        await this.assertSchemaAvailable();

        const rows = await this.prisma.$queryRaw<RouteDetailRow[]>`
            SELECT
                r.id,
                r.public_id::text AS public_id,
                r.route_code,
                r.public_name,
                r.mode,
                r.route_kind,
                r.origin_name,
                r.destination_name,
                r.origin_admin_area_id,
                r.destination_admin_area_id,
                r.description,
                r.operator_id,
                o.name AS operator_name,
                r.confidence_score::float8 AS confidence_score,
                r.review_status,
                r.is_active,
                r.created_at,
                r.updated_at,
                r.deleted_at,
                (SELECT count(*) FROM transport.route_variants v
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL)::bigint AS variant_count,
                (SELECT count(*) FROM transport.route_variants v
                    JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL)::bigint AS stop_count,
                (SELECT count(*) FROM transport.route_variants v
                    JOIN transport.route_paths p ON p.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL)::bigint AS path_count
            FROM transport.routes r
            LEFT JOIN transport.operators o ON o.id = r.operator_id
            WHERE r.public_id = ${publicId}::uuid
            LIMIT 1
        `;

        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("route", publicId);
        }

        const [nameRows, sourceRows] = await Promise.all([
            this.prisma.$queryRaw<RouteNameRow[]>`
                SELECT name, language_code, script_code, name_type, is_primary, search_weight
                FROM transport.route_names
                WHERE route_id = ${row.id}
                ORDER BY is_primary DESC, search_weight DESC, name ASC
            `,
            this.prisma.$queryRaw<SourceRow[]>`
                SELECT source_name, source_kind, external_id, source_url, is_primary
                FROM transport.source_links
                WHERE entity_type = 'route' AND entity_id = ${row.id}
                ORDER BY is_primary DESC, source_name ASC
                LIMIT 50
            `,
        ]);

        return {
            public_id: row.public_id,
            route_code: row.route_code,
            public_name: row.public_name,
            mode: row.mode,
            route_kind: row.route_kind,
            origin_name: row.origin_name,
            destination_name: row.destination_name,
            origin_admin_area_id: row.origin_admin_area_id === null ? null : Number(row.origin_admin_area_id),
            destination_admin_area_id:
                row.destination_admin_area_id === null ? null : Number(row.destination_admin_area_id),
            description: row.description,
            operator:
                row.operator_id === null
                    ? null
                    : { id: Number(row.operator_id), name: row.operator_name ?? "" },
            confidence_score: row.confidence_score,
            review_status: row.review_status,
            is_active: row.is_active,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
            counts: {
                variants: num(row.variant_count),
                stops: num(row.stop_count),
                paths: num(row.path_count),
            },
            names: nameRows.map((n) => ({
                name: n.name,
                language_code: n.language_code,
                script_code: n.script_code,
                name_type: n.name_type,
                is_primary: n.is_primary,
                search_weight: n.search_weight,
            })),
            sources: sourceRows.map((s) => ({
                source_name: s.source_name,
                source_kind: s.source_kind,
                external_id: s.external_id,
                source_url: s.source_url,
                is_primary: s.is_primary,
            })),
        };
    }

    async listVariantsForRoute(routePublicId: string): Promise<TransportVariantSummary[]> {
        await this.assertSchemaAvailable();

        const routeRows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM transport.routes WHERE public_id = ${routePublicId}::uuid LIMIT 1
        `;
        const route = routeRows[0];
        if (!route) {
            throw new TransportNotFoundError("route", routePublicId);
        }

        const rows = await this.prisma.$queryRaw<VariantSummaryRow[]>`
            SELECT
                v.public_id::text AS public_id,
                v.variant_code,
                v.direction_name,
                v.direction_id,
                v.headsign,
                v.origin_name,
                v.destination_name,
                (SELECT count(*) FROM transport.route_stops rs
                    WHERE rs.route_variant_id = v.id)::bigint AS stop_count,
                (SELECT count(*) FROM transport.route_paths p
                    WHERE p.route_variant_id = v.id AND p.deleted_at IS NULL)::bigint AS path_count,
                v.distance_m::float8 AS distance_m,
                v.estimated_duration_min,
                v.review_status,
                v.confidence_score::float8 AS confidence_score,
                v.is_active
            FROM transport.route_variants v
            WHERE v.route_id = ${route.id} AND v.deleted_at IS NULL
            ORDER BY v.variant_code ASC
        `;

        return rows.map((row) => {
            const pathCount = num(row.path_count);
            return {
                public_id: row.public_id,
                variant_code: row.variant_code,
                direction_name: row.direction_name,
                direction_id: row.direction_id,
                headsign: row.headsign,
                origin_name: row.origin_name,
                destination_name: row.destination_name,
                stop_count: num(row.stop_count),
                path_count: pathCount,
                path_status: pathCount > 0 ? "has_path" : "none",
                distance_m: row.distance_m,
                estimated_duration_min: row.estimated_duration_min,
                review_status: row.review_status,
                confidence_score: row.confidence_score,
                is_active: row.is_active,
            };
        });
    }

    async listStopsForVariant(
        variantPublicId: string,
        query: ListVariantStopsQuery
    ): Promise<TransportVariantStopsResponse> {
        await this.assertSchemaAvailable();

        const variantRows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM transport.route_variants WHERE public_id = ${variantPublicId}::uuid LIMIT 1
        `;
        const variant = variantRows[0];
        if (!variant) {
            throw new TransportNotFoundError("route variant", variantPublicId);
        }

        const limit = query.limit;
        const offset = query.offset;

        const rows = await this.prisma.$queryRaw<RouteStopRow[]>`
            SELECT
                rs.id,
                rs.stop_sequence,
                rs.pickup_type,
                rs.drop_off_type,
                rs.is_timing_point,
                rs.distance_from_start_m::float8 AS distance_from_start_m,
                s.public_id::text AS stop_public_id,
                s.name AS stop_name,
                s.name_mm AS stop_name_mm,
                s.name_en AS stop_name_en,
                s.mode AS stop_mode,
                s.stop_type,
                ST_AsGeoJSON(s.geom)::jsonb AS geometry
            FROM transport.route_stops rs
            JOIN transport.stops s ON s.id = rs.stop_id
            WHERE rs.route_variant_id = ${variant.id}
            ORDER BY rs.stop_sequence ASC
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM transport.route_stops rs
            WHERE rs.route_variant_id = ${variant.id}
        `;

        let path: TransportVariantStopsResponse["path"] = null;
        if (query.includePath === true) {
            const pathRows = await this.prisma.$queryRaw<RoutePathRow[]>`
                SELECT
                    path_kind,
                    distance_m::float8 AS distance_m,
                    ST_AsGeoJSON(geom)::jsonb AS geometry
                FROM transport.route_paths
                WHERE route_variant_id = ${variant.id} AND deleted_at IS NULL
                ORDER BY id ASC
                LIMIT 1
            `;
            const p = pathRows[0];
            path = p
                ? { path_kind: p.path_kind, distance_m: p.distance_m, geometry: asGeometry(p.geometry) }
                : null;
        }

        return {
            items: rows.map((row) => ({
                id: String(row.id),
                stop_sequence: row.stop_sequence,
                pickup_type: row.pickup_type,
                drop_off_type: row.drop_off_type,
                is_timing_point: row.is_timing_point,
                distance_from_start_m: row.distance_from_start_m,
                stop: {
                    public_id: row.stop_public_id,
                    name: row.stop_name,
                    name_mm: row.stop_name_mm,
                    name_en: row.stop_name_en,
                    mode: row.stop_mode,
                    stop_type: row.stop_type,
                    geometry: asGeometry(row.geometry),
                },
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
            path,
        };
    }

    /**
     * Partial update of an active route's editable metadata. Only provided keys are
     * written; `source_refs` / `normalized_data` are never touched here. Returns the
     * refreshed route detail. Throws {@link TransportNotFoundError} when the route is
     * missing or soft-deleted.
     */
    async updateRouteByPublicId(
        publicId: string,
        input: UpdateRouteInput,
        audit?: TransportAuditContext
    ): Promise<TransportRouteDetail> {
        await this.assertSchemaAvailable();

        const sets: Prisma.Sql[] = [];
        if (input.route_code !== undefined) sets.push(Prisma.sql`route_code = ${input.route_code}`);
        if (input.public_name !== undefined)
            sets.push(Prisma.sql`public_name = ${input.public_name}`);
        if (input.mode !== undefined) sets.push(Prisma.sql`mode = ${input.mode}`);
        if (input.route_kind !== undefined) sets.push(Prisma.sql`route_kind = ${input.route_kind}`);
        if (input.origin_name !== undefined)
            sets.push(Prisma.sql`origin_name = ${input.origin_name}`);
        if (input.destination_name !== undefined)
            sets.push(Prisma.sql`destination_name = ${input.destination_name}`);
        if (input.description !== undefined)
            sets.push(Prisma.sql`description = ${input.description}`);
        if (input.review_status !== undefined)
            sets.push(Prisma.sql`review_status = ${input.review_status}`);
        if (input.confidence_score !== undefined)
            sets.push(Prisma.sql`confidence_score = ${input.confidence_score}`);
        if (input.is_active !== undefined) sets.push(Prisma.sql`is_active = ${input.is_active}`);

        if (sets.length === 0) {
            return this.getRouteByPublicId(publicId);
        }

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<RouteAuditRow[]>`
                SELECT id, route_code, public_name, mode, route_kind, origin_name,
                       destination_name, description, review_status,
                       confidence_score::float8 AS confidence_score, is_active
                FROM transport.routes
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("route", publicId);
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.routes
                SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
            `);

            const diff = diffScalarFields(before, input, ROUTE_AUDIT_FIELDS);
            if (diff.changedFields.length > 0) {
                await insertTransportAuditLog(tx, {
                    action: "transport.route.update",
                    entityType: "transport_route",
                    entityId: before.id,
                    entityPublicId: publicId,
                    changedFields: diff.changedFields,
                    oldValues: diff.oldValues,
                    newValues: diff.newValues,
                    metadata: null,
                    context: audit,
                });
            }
        });

        return this.getRouteByPublicId(publicId);
    }

    /** Single variant summary (same shape as the variants list) by variant public_id. */
    async getVariantSummaryByPublicId(variantPublicId: string): Promise<TransportVariantSummary> {
        const rows = await this.prisma.$queryRaw<VariantSummaryRow[]>`
            SELECT
                v.public_id::text AS public_id,
                v.variant_code,
                v.direction_name,
                v.direction_id,
                v.headsign,
                v.origin_name,
                v.destination_name,
                (SELECT count(*) FROM transport.route_stops rs
                    WHERE rs.route_variant_id = v.id)::bigint AS stop_count,
                (SELECT count(*) FROM transport.route_paths p
                    WHERE p.route_variant_id = v.id AND p.deleted_at IS NULL)::bigint AS path_count,
                v.distance_m::float8 AS distance_m,
                v.estimated_duration_min,
                v.review_status,
                v.confidence_score::float8 AS confidence_score,
                v.is_active
            FROM transport.route_variants v
            WHERE v.public_id = ${variantPublicId}::uuid AND v.deleted_at IS NULL
            LIMIT 1
        `;

        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("route variant", variantPublicId);
        }

        const pathCount = num(row.path_count);
        return {
            public_id: row.public_id,
            variant_code: row.variant_code,
            direction_name: row.direction_name,
            direction_id: row.direction_id,
            headsign: row.headsign,
            origin_name: row.origin_name,
            destination_name: row.destination_name,
            stop_count: num(row.stop_count),
            path_count: pathCount,
            path_status: pathCount > 0 ? "has_path" : "none",
            distance_m: row.distance_m,
            estimated_duration_min: row.estimated_duration_min,
            review_status: row.review_status,
            confidence_score: row.confidence_score,
            is_active: row.is_active,
        };
    }

    /**
     * Partial update of an active route variant's editable metadata. Only provided
     * keys are written; `source_refs` / `normalized_data` are never touched here.
     * Returns the refreshed variant summary.
     */
    async updateVariantByPublicId(
        variantPublicId: string,
        input: UpdateVariantInput,
        audit?: TransportAuditContext
    ): Promise<TransportVariantSummary> {
        await this.assertSchemaAvailable();

        const sets: Prisma.Sql[] = [];
        if (input.variant_code !== undefined)
            sets.push(Prisma.sql`variant_code = ${input.variant_code}`);
        if (input.direction_name !== undefined)
            sets.push(Prisma.sql`direction_name = ${input.direction_name}`);
        if (input.direction_id !== undefined)
            sets.push(Prisma.sql`direction_id = ${input.direction_id}`);
        if (input.headsign !== undefined) sets.push(Prisma.sql`headsign = ${input.headsign}`);
        if (input.origin_name !== undefined)
            sets.push(Prisma.sql`origin_name = ${input.origin_name}`);
        if (input.destination_name !== undefined)
            sets.push(Prisma.sql`destination_name = ${input.destination_name}`);
        if (input.estimated_duration_min !== undefined)
            sets.push(Prisma.sql`estimated_duration_min = ${input.estimated_duration_min}`);
        if (input.review_status !== undefined)
            sets.push(Prisma.sql`review_status = ${input.review_status}`);
        if (input.confidence_score !== undefined)
            sets.push(Prisma.sql`confidence_score = ${input.confidence_score}`);
        if (input.is_active !== undefined) sets.push(Prisma.sql`is_active = ${input.is_active}`);

        if (sets.length === 0) {
            return this.getVariantSummaryByPublicId(variantPublicId);
        }

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<VariantAuditRow[]>`
                SELECT id, variant_code, direction_name, direction_id, headsign, origin_name,
                       destination_name, estimated_duration_min, review_status,
                       confidence_score::float8 AS confidence_score, is_active
                FROM transport.route_variants
                WHERE public_id = ${variantPublicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("route variant", variantPublicId);
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.route_variants
                SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                WHERE public_id = ${variantPublicId}::uuid AND deleted_at IS NULL
            `);

            const diff = diffScalarFields(before, input, VARIANT_AUDIT_FIELDS);
            if (diff.changedFields.length > 0) {
                await insertTransportAuditLog(tx, {
                    action: "transport.route_variant.update",
                    entityType: "transport_route_variant",
                    entityId: before.id,
                    entityPublicId: variantPublicId,
                    changedFields: diff.changedFields,
                    oldValues: diff.oldValues,
                    newValues: diff.newValues,
                    metadata: null,
                    context: audit,
                });
            }
        });

        return this.getVariantSummaryByPublicId(variantPublicId);
    }

    /** Single ordered-stop row (with its stop + GeoJSON geometry) by route_stops.id. */
    async getRouteStopItemById(id: bigint): Promise<TransportRouteStopItem> {
        const rows = await this.prisma.$queryRaw<RouteStopRow[]>`
            SELECT
                rs.id,
                rs.stop_sequence,
                rs.pickup_type,
                rs.drop_off_type,
                rs.is_timing_point,
                rs.distance_from_start_m::float8 AS distance_from_start_m,
                s.public_id::text AS stop_public_id,
                s.name AS stop_name,
                s.name_mm AS stop_name_mm,
                s.name_en AS stop_name_en,
                s.mode AS stop_mode,
                s.stop_type,
                ST_AsGeoJSON(s.geom)::jsonb AS geometry
            FROM transport.route_stops rs
            JOIN transport.stops s ON s.id = rs.stop_id
            WHERE rs.id = ${id}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("route stop", String(id));
        }
        return mapRouteStopRow(row);
    }

    /** Partial update of a route stop's membership flags. Never touches stop_sequence. */
    async updateRouteStopFlags(
        id: bigint,
        input: UpdateRouteStopInput,
        audit?: TransportAuditContext
    ): Promise<TransportRouteStopItem> {
        await this.assertSchemaAvailable();

        const sets: Prisma.Sql[] = [];
        if (input.pickup_type !== undefined)
            sets.push(Prisma.sql`pickup_type = ${input.pickup_type}`);
        if (input.drop_off_type !== undefined)
            sets.push(Prisma.sql`drop_off_type = ${input.drop_off_type}`);
        if (input.is_timing_point !== undefined)
            sets.push(Prisma.sql`is_timing_point = ${input.is_timing_point}`);

        if (sets.length === 0) {
            return this.getRouteStopItemById(id);
        }

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<RouteStopFlagsAuditRow[]>`
                SELECT id, pickup_type, drop_off_type, is_timing_point
                FROM transport.route_stops
                WHERE id = ${id}
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("route stop", String(id));
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.route_stops
                SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                WHERE id = ${id}
            `);

            const diff = diffScalarFields(before, input, ROUTE_STOP_FLAGS_AUDIT_FIELDS);
            if (diff.changedFields.length > 0) {
                await insertTransportAuditLog(tx, {
                    action: "transport.route_stop.update",
                    entityType: "transport_route_stop",
                    entityId: before.id,
                    entityPublicId: null,
                    changedFields: diff.changedFields,
                    oldValues: diff.oldValues,
                    newValues: diff.newValues,
                    metadata: null,
                    context: audit,
                });
            }
        });

        return this.getRouteStopItemById(id);
    }

    /**
     * Swap a route stop's sequence with its adjacent neighbor in the same variant.
     * Only the two affected rows are written. The swap runs in a transaction using a
     * temporary out-of-range sequence so the UNIQUE (route_variant_id, stop_sequence)
     * constraint (and the stop_sequence > 0 CHECK) is never violated mid-swap.
     *
     * Returns `{ moved: false }` when the stop is already at the boundary.
     */
    async moveRouteStop(
        id: bigint,
        direction: "up" | "down",
        audit?: TransportAuditContext
    ): Promise<{ moved: boolean; variantPublicId: string | null }> {
        await this.assertSchemaAvailable();

        return this.prisma.$transaction(async (tx) => {
            const curRows = await tx.$queryRaw<RouteStopMetaRow[]>`
                SELECT id, route_variant_id, stop_sequence
                FROM transport.route_stops
                WHERE id = ${id}
                FOR UPDATE
            `;
            const cur = curRows[0];
            if (!cur) {
                throw new TransportNotFoundError("route stop", String(id));
            }

            const neighborRows =
                direction === "up"
                    ? await tx.$queryRaw<RouteStopMetaRow[]>`
                        SELECT id, route_variant_id, stop_sequence
                        FROM transport.route_stops
                        WHERE route_variant_id = ${cur.route_variant_id}
                          AND stop_sequence < ${cur.stop_sequence}
                        ORDER BY stop_sequence DESC
                        LIMIT 1
                        FOR UPDATE
                    `
                    : await tx.$queryRaw<RouteStopMetaRow[]>`
                        SELECT id, route_variant_id, stop_sequence
                        FROM transport.route_stops
                        WHERE route_variant_id = ${cur.route_variant_id}
                          AND stop_sequence > ${cur.stop_sequence}
                        ORDER BY stop_sequence ASC
                        LIMIT 1
                        FOR UPDATE
                    `;
            const neighbor = neighborRows[0];

            const variantRows = await tx.$queryRaw<{ public_id: string }[]>`
                SELECT public_id::text AS public_id
                FROM transport.route_variants
                WHERE id = ${cur.route_variant_id}
                LIMIT 1
            `;
            const variantPublicId = variantRows[0]?.public_id ?? null;

            if (!neighbor) {
                return { moved: false, variantPublicId };
            }

            const maxRows = await tx.$queryRaw<{ m: number | null }[]>`
                SELECT max(stop_sequence) AS m
                FROM transport.route_stops
                WHERE route_variant_id = ${cur.route_variant_id}
            `;
            const tempSeq = num(maxRows[0]?.m) + 1;

            await tx.$executeRaw`
                UPDATE transport.route_stops SET stop_sequence = ${tempSeq}, updated_at = now()
                WHERE id = ${cur.id}
            `;
            await tx.$executeRaw`
                UPDATE transport.route_stops SET stop_sequence = ${cur.stop_sequence}, updated_at = now()
                WHERE id = ${neighbor.id}
            `;
            await tx.$executeRaw`
                UPDATE transport.route_stops SET stop_sequence = ${neighbor.stop_sequence}, updated_at = now()
                WHERE id = ${cur.id}
            `;

            await insertTransportAuditLog(tx, {
                action: "transport.route_stop.reorder",
                entityType: "transport_route_stop",
                entityId: cur.id,
                entityPublicId: null,
                changedFields: ["stop_sequence"],
                oldValues: { stop_sequence: cur.stop_sequence },
                newValues: { stop_sequence: neighbor.stop_sequence },
                metadata: {
                    direction,
                    neighbor_id: String(neighbor.id),
                    variant_public_id: variantPublicId,
                },
                context: audit,
            });

            return { moved: true, variantPublicId };
        });
    }

    /**
     * Remove a stop from a route variant by deleting its route_stops membership row.
     * The referenced `transport.stops` record is never deleted. Remaining stops keep
     * their (still-unique) sequences; gaps are allowed and harmless for ordering.
     */
    async removeRouteStop(
        id: bigint,
        audit?: TransportAuditContext,
        reason?: string
    ): Promise<{ deleted: boolean; variantPublicId: string | null }> {
        await this.assertSchemaAvailable();

        const trimmedReason = typeof reason === "string" ? reason.trim() : "";

        return this.prisma.$transaction(async (tx) => {
            // Snapshot the full (small) row before deletion: the row is gone afterward.
            const beforeRows = await tx.$queryRaw<RouteStopRemoveAuditRow[]>`
                SELECT id, route_variant_id, stop_id, stop_sequence,
                       pickup_type, drop_off_type, is_timing_point,
                       distance_from_start_m::float8 AS distance_from_start_m
                FROM transport.route_stops
                WHERE id = ${id}
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("route stop", String(id));
            }

            await tx.$executeRaw`
                DELETE FROM transport.route_stops WHERE id = ${id}
            `;

            const variantRows = await tx.$queryRaw<{ public_id: string }[]>`
                SELECT public_id::text AS public_id
                FROM transport.route_variants
                WHERE id = ${before.route_variant_id}
                LIMIT 1
            `;
            const variantPublicId = variantRows[0]?.public_id ?? null;

            await insertTransportAuditLog(tx, {
                action: "transport.route_stop.remove",
                entityType: "transport_route_stop",
                entityId: before.id,
                entityPublicId: null,
                changedFields: [],
                oldValues: {
                    id: String(before.id),
                    route_variant_id: String(before.route_variant_id),
                    stop_id: String(before.stop_id),
                    stop_sequence: before.stop_sequence,
                    pickup_type: before.pickup_type,
                    drop_off_type: before.drop_off_type,
                    is_timing_point: before.is_timing_point,
                    distance_from_start_m: before.distance_from_start_m,
                },
                newValues: null,
                metadata: {
                    variant_public_id: variantPublicId,
                    ...(trimmedReason ? { reason: trimmedReason } : {}),
                },
                context: audit,
            });

            return { deleted: true, variantPublicId };
        });
    }
}
