import { Prisma, type PrismaClient } from "@prisma/client";

import {
    TransportInvalidReferenceError,
    TransportNameRequiredError,
    TransportNotFoundError,
    TransportRouteStopDuplicateError,
    TransportRouteStopTransactionTimeoutError,
    TransportSchemaUnavailableError,
    TransportStopInUseError,
} from "./transport.errors.js";
import {
    appendPointDiff,
    diffScalarFields,
    insertTransportAuditLog,
    resolvePointAwareAction,
    type TransportAuditContext,
} from "./transport-audit.js";
import { getTransportTypeFallbackLabel } from "./transport-naming.js";
import type {
    ListTransportRoutesQuery,
    ListTransportStopsQuery,
    ListTransportTerminalsQuery,
    ListImportBatchesQuery,
    ListImportErrorsQuery,
    ListSourceLinksQuery,
    ListTransportInfrastructureLinesQuery,
    ListVariantStopsQuery,
    InsertExistingRouteStopInput,
    CreateAndInsertRouteStopInput,
    SearchTransportStopsQuery,
    StopRoutesQuery,
    UpdateInfrastructureLineInput,
    UpdateRouteInput,
    UpdateRouteStopInput,
    UpdateStopInput,
    UpdateTerminalInput,
    UpdateVariantInput,
} from "./transport.schema.js";
import { STOPS_LIST_MAX_LIMIT } from "./transport.schema.js";
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
    TransportCreatedStopLite,
    TransportOrderedStopLite,
    TransportRouteStopMutationResult,
    TransportStopArchiveResult,
    TransportStopDetail,
    TransportStopListItem,
    TransportStopRouteUsage,
    TransportStopSearchItem,
    TransportStopSearchResponse,
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
    name_mm: string | null;
    name_en: string | null;
    display_name: string;
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
    display_name: string;
    mode: string;
    stop_type: string;
    route_count: bigint;
    has_terminal: boolean;
    terminal_role: string | null;
    terminal_code: string | null;
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

type StopLinkedTerminalRow = {
    public_id: string;
    terminal_code: string | null;
    terminal_role: string;
    operator_id: bigint | null;
    operator_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
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

type StopSearchRow = {
    public_id: string;
    display_name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    review_status: string;
    confidence_score: number | null;
    lon: number | null;
    lat: number | null;
    distance_m: number | null;
    route_count: bigint;
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

/**
 * True for Prisma P2028 ("Transaction not found … refers to an old closed
 * transaction"), raised when an interactive transaction outlives Prisma's
 * timeout window. Callers map this to a clear domain error.
 */
function isPrismaTransactionTimeout(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028";
}

/**
 * Explicit interactive-transaction window for route-stop mutations. The default
 * 5s timeout is too tight for large variants; bulk SQL keeps the work small, and
 * these bounds give comfortable headroom without holding locks indefinitely.
 */
const ROUTE_STOP_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * TEMPORARY dev-only performance instrumentation for Transport list endpoints.
 *
 * Disabled by default; enable per-process with `TRANSPORT_PERF_LOG=1`. It is a
 * no-op (zero overhead, no logging) when the flag is unset, so it is safe to
 * leave shipped but it MUST NOT be relied on in production. Remove once the
 * Transport list query optimization work is complete.
 */
const TRANSPORT_PERF_LOG = process.env.TRANSPORT_PERF_LOG === "1";

async function perf<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!TRANSPORT_PERF_LOG) {
        return fn();
    }
    const start = performance.now();
    try {
        return await fn();
    } finally {
        const ms = (performance.now() - start).toFixed(1);
        // eslint-disable-next-line no-console
        console.log(`[transport.perf] ${label}: ${ms}ms`);
    }
}

function perfSync<T>(label: string, fn: () => T): T {
    if (!TRANSPORT_PERF_LOG) {
        return fn();
    }
    const start = performance.now();
    try {
        return fn();
    } finally {
        const ms = (performance.now() - start).toFixed(1);
        // eslint-disable-next-line no-console
        console.log(`[transport.perf] ${label}: ${ms}ms`);
    }
}

type PerfTimer = { mark: (checkpoint: string) => void; done: () => void };

/**
 * TEMPORARY checkpoint timer for the route-stop insert/remove hot paths. Gated by
 * the same `TRANSPORT_PERF_LOG=1` flag (no-op otherwise). Each `mark` logs the
 * delta since the previous mark plus elapsed-since-start, so a single request
 * prints a full per-phase breakdown. Remove once the insert/delete perf work lands.
 */
function startPerf(label: string): PerfTimer {
    if (!TRANSPORT_PERF_LOG) {
        return { mark: () => {}, done: () => {} };
    }
    const t0 = performance.now();
    let last = t0;
    return {
        mark(checkpoint: string) {
            const now = performance.now();
            // eslint-disable-next-line no-console
            console.log(
                `[transport.perf] ${label} | ${checkpoint}: +${(now - last).toFixed(1)}ms ` +
                    `(t=${(now - t0).toFixed(1)}ms)`
            );
            last = now;
        },
        done() {
            const now = performance.now();
            // eslint-disable-next-line no-console
            console.log(`[transport.perf] ${label} | TOTAL ${(now - t0).toFixed(1)}ms`);
        },
    };
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

        const rows = await perf("importBatches.list.rowsQuery", () =>
            this.prisma.$queryRaw<ImportBatchRow[]>(Prisma.sql`
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
        `)
        );

        const countRows = await perf("importBatches.list.countQuery", () =>
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count FROM transport.import_batches b ${where}
        `)
        );

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

        const rows = await perf("importErrors.list.rowsQuery", () =>
            this.prisma.$queryRaw<ImportErrorRow[]>(Prisma.sql`
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
        `)
        );

        const countRows = await perf("importErrors.list.countQuery", () =>
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count FROM transport.import_errors e ${where}
        `)
        );

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

        const rows = await perf("sourceLinks.list.rowsQuery", () =>
            this.prisma.$queryRaw<SourceLinkRowListItem[]>(Prisma.sql`
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
        `)
        );

        const countRows = await perf("sourceLinks.list.countQuery", () =>
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count FROM transport.source_links s ${where}
        `)
        );

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

        const rows = await perf("routes.list.rowsQuery", () =>
            this.prisma.$queryRaw<RouteListRow[]>`
            SELECT
                r.public_id::text AS public_id,
                r.route_code,
                r.public_name,
                rn_mm.name AS name_mm,
                rn_en.name AS name_en,
                COALESCE(
                    rn_mm.name,
                    rn_en.name,
                    NULLIF(btrim(r.public_name), ''),
                    r.route_code
                ) AS display_name,
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
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                ORDER BY n.is_primary DESC, n.search_weight DESC, n.id ASC
                LIMIT 1
            ) AS rn_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY n.is_primary DESC, n.search_weight DESC, n.id ASC
                LIMIT 1
            ) AS rn_en ON true
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
        `
        );

        const countRows = await perf("routes.list.countQuery", () =>
            this.prisma.$queryRaw<{ count: bigint }[]>`
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
        `
        );

        return {
            items: rows.map((row) => ({
                public_id: row.public_id,
                route_code: row.route_code,
                public_name: row.public_name,
                name_mm: row.name_mm,
                name_en: row.name_en,
                display_name: row.display_name,
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
        const hasTerminal = query.hasTerminal === undefined ? null : query.hasTerminal;
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
              AND (
                ${hasTerminal}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.terminals t
                        WHERE t.linked_stop_id = s.id AND t.deleted_at IS NULL
                    )
                ) = ${hasTerminal}
              )
        `;

        // Page-first strategy: filter + sort + paginate the base `stops` table
        // (selected columns only, no geometry) inside the `page` CTE, then attach
        // admin-area name, route_count, and terminal info for ONLY the <=limit
        // page rows. This avoids the previous per-row LATERAL/correlated subqueries
        // that ran across the whole table before LIMIT was applied.
        const rows = await perf("stops.list.rowsQuery", () =>
            this.prisma.$queryRaw<StopListRow[]>(Prisma.sql`
            WITH page AS (
                SELECT
                    s.id,
                    s.public_id,
                    s.stop_code,
                    s.name,
                    s.name_mm,
                    s.name_en,
                    s.mode,
                    s.stop_type,
                    s.admin_area_id,
                    s.review_status,
                    s.confidence_score,
                    s.is_active,
                    s.updated_at
                FROM transport.stops s
                ${where}
                ORDER BY s.updated_at DESC, s.id DESC
                LIMIT ${limit}
                OFFSET ${offset}
            ),
            route_counts AS (
                SELECT rs.stop_id, count(DISTINCT v.route_id)::bigint AS route_count
                FROM transport.route_stops rs
                JOIN transport.route_variants v
                    ON v.id = rs.route_variant_id AND v.deleted_at IS NULL
                WHERE rs.stop_id IN (SELECT id FROM page)
                GROUP BY rs.stop_id
            ),
            terminal_info AS (
                SELECT DISTINCT ON (t.linked_stop_id)
                    t.linked_stop_id,
                    t.terminal_role,
                    t.terminal_code
                FROM transport.terminals t
                WHERE t.deleted_at IS NULL
                  AND t.linked_stop_id IN (SELECT id FROM page)
                ORDER BY t.linked_stop_id, t.id ASC
            )
            SELECT
                p.public_id::text AS public_id,
                p.stop_code,
                p.name,
                p.name_mm,
                p.name_en,
                COALESCE(
                    NULLIF(btrim(p.name_mm), ''),
                    NULLIF(btrim(p.name_en), ''),
                    'Unnamed ' || replace(p.stop_type, '_', ' ')
                ) AS display_name,
                p.mode,
                p.stop_type,
                COALESCE(rc.route_count, 0)::bigint AS route_count,
                (ti.linked_stop_id IS NOT NULL) AS has_terminal,
                ti.terminal_role,
                ti.terminal_code,
                p.admin_area_id,
                aa.canonical_name AS admin_area_name,
                p.review_status,
                p.confidence_score::float8 AS confidence_score,
                p.is_active,
                p.updated_at
            FROM page p
            LEFT JOIN core.core_admin_areas aa ON aa.id = p.admin_area_id
            LEFT JOIN route_counts rc ON rc.stop_id = p.id
            LEFT JOIN terminal_info ti ON ti.linked_stop_id = p.id
            ORDER BY p.updated_at DESC, p.id DESC
        `)
        );

        const countRows = await perf("stops.list.countQuery", () =>
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM transport.stops s
            ${where}
        `)
        );

        return {
            items: perfSync("stops.list.serialize", () =>
                rows.map((row) => ({
                public_id: row.public_id,
                stop_code: row.stop_code,
                name: row.name,
                name_mm: row.name_mm,
                name_en: row.name_en,
                display_name: row.display_name,
                mode: row.mode,
                stop_type: row.stop_type,
                route_count: num(row.route_count),
                has_terminal: row.has_terminal === true,
                terminal_role: row.terminal_role,
                terminal_code: row.terminal_code,
                admin_area_id: row.admin_area_id === null ? null : Number(row.admin_area_id),
                admin_area_name: row.admin_area_name,
                review_status: row.review_status,
                confidence_score: row.confidence_score,
                is_active: row.is_active,
                updated_at: row.updated_at.toISOString(),
                }))
            ),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    /**
     * Lightweight stop search for the route-insertion picker. Returns existing,
     * active, non-deleted stops only — never source_refs / normalized_data and
     * never the full list of routes that use a stop.
     *
     * Nearby search uses the GIST(geom) index via a `&&` bbox prefilter (degrees)
     * and then an exact metric `ST_DWithin(...::geography, ...)`; results are ranked
     * by true geodesic distance. Without a near point, results are ranked by name.
     * `excludeRouteVariantPublicId` drops stops already in that variant. Hard-capped.
     */
    async searchStops(query: SearchTransportStopsQuery): Promise<TransportStopSearchResponse> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const mode = query.mode ?? null;
        const searchLike = toLikeParam(query.search);
        const near = query.nearLng !== undefined && query.nearLat !== undefined;
        const nearLng = query.nearLng ?? null;
        const nearLat = query.nearLat ?? null;
        const radiusMeters = query.radiusMeters;
        // Generous degree bbox (superset of the metric radius) so the GIST(geom)
        // index can prefilter; the exact geography ST_DWithin trims the remainder.
        const radiusDeg = radiusMeters / 90000;
        const excludeVariant = query.excludeRouteVariantPublicId ?? null;

        const rows = await this.prisma.$queryRaw<StopSearchRow[]>(Prisma.sql`
            WITH page AS (
                SELECT
                    s.id,
                    s.public_id,
                    COALESCE(
                        NULLIF(btrim(s.name_mm), ''),
                        NULLIF(btrim(s.name_en), ''),
                        'Unnamed ' || replace(s.stop_type, '_', ' ')
                    ) AS display_name,
                    s.name_mm,
                    s.name_en,
                    s.mode,
                    s.stop_type,
                    s.review_status,
                    s.confidence_score::float8 AS confidence_score,
                    ST_X(s.geom)::float8 AS lon,
                    ST_Y(s.geom)::float8 AS lat,
                    CASE
                        WHEN ${near}::boolean THEN ST_Distance(
                            s.geom::geography,
                            ST_SetSRID(ST_MakePoint(${nearLng}, ${nearLat}), 4326)::geography
                        )
                        ELSE NULL
                    END::float8 AS distance_m
                FROM transport.stops s
                WHERE s.deleted_at IS NULL
                  AND s.is_active = true
                  AND (${mode}::text IS NULL OR s.mode = ${mode})
                  AND (
                    ${searchLike}::text IS NULL OR (
                        s.name ILIKE ${searchLike}
                        OR s.name_mm ILIKE ${searchLike}
                        OR s.name_en ILIKE ${searchLike}
                        OR s.stop_code ILIKE ${searchLike}
                    )
                  )
                  AND (
                    NOT ${near}::boolean OR (
                        s.geom && ST_Expand(
                            ST_SetSRID(ST_MakePoint(${nearLng}, ${nearLat}), 4326),
                            ${radiusDeg}::float8
                        )
                        AND ST_DWithin(
                            s.geom::geography,
                            ST_SetSRID(ST_MakePoint(${nearLng}, ${nearLat}), 4326)::geography,
                            ${radiusMeters}::float8
                        )
                    )
                  )
                  AND (
                    ${excludeVariant}::uuid IS NULL OR NOT EXISTS (
                        SELECT 1
                        FROM transport.route_stops rs2
                        JOIN transport.route_variants v2 ON v2.id = rs2.route_variant_id
                        WHERE rs2.stop_id = s.id AND v2.public_id = ${excludeVariant}::uuid
                    )
                  )
                ORDER BY
                    CASE WHEN ${near}::boolean THEN ST_Distance(
                        s.geom::geography,
                        ST_SetSRID(ST_MakePoint(${nearLng}, ${nearLat}), 4326)::geography
                    ) END ASC NULLS LAST,
                    COALESCE(
                        NULLIF(btrim(s.name_mm), ''),
                        NULLIF(btrim(s.name_en), ''),
                        ''
                    ) ASC,
                    s.id ASC
                LIMIT ${limit}
            ),
            route_counts AS (
                SELECT rs.stop_id, count(DISTINCT v.route_id)::bigint AS route_count
                FROM transport.route_stops rs
                JOIN transport.route_variants v
                    ON v.id = rs.route_variant_id AND v.deleted_at IS NULL
                WHERE rs.stop_id IN (SELECT id FROM page)
                GROUP BY rs.stop_id
            )
            SELECT
                p.public_id::text AS public_id,
                p.display_name,
                p.name_mm,
                p.name_en,
                p.mode,
                p.stop_type,
                p.review_status,
                p.confidence_score,
                p.lon,
                p.lat,
                p.distance_m,
                COALESCE(rc.route_count, 0)::bigint AS route_count
            FROM page p
            LEFT JOIN route_counts rc ON rc.stop_id = p.id
            ORDER BY p.distance_m ASC NULLS LAST, p.display_name ASC, p.id ASC
        `);

        const items: TransportStopSearchItem[] = rows.map((row) => ({
            public_id: row.public_id,
            display_name: row.display_name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            mode: row.mode,
            stop_type: row.stop_type,
            review_status: row.review_status,
            confidence_score: row.confidence_score,
            lon: row.lon,
            lat: row.lat,
            distance_m: row.distance_m,
            route_count: num(row.route_count),
        }));

        return { items, limit };
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

        const rows = await perf("infrastructureLines.list.rowsQuery", () =>
            this.prisma.$queryRaw<InfrastructureLineListRow[]>(Prisma.sql`
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
        `)
        );

        const countRows = await perf("infrastructureLines.list.countQuery", () =>
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM transport.infrastructure_lines l
            ${where}
        `)
        );

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
                COALESCE(sn_mm.name, s.name_mm) AS name_mm,
                COALESCE(sn_en.name, s.name_en) AS name_en,
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
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.stop_names AS n
                WHERE n.stop_id = s.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                ORDER BY n.is_primary DESC, n.search_weight DESC, n.id ASC
                LIMIT 1
            ) AS sn_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.stop_names AS n
                WHERE n.stop_id = s.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY n.is_primary DESC, n.search_weight DESC, n.id ASC
                LIMIT 1
            ) AS sn_en ON true
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

        // Linked terminal summary (1:1 via terminals.linked_stop_id). No name/geometry —
        // the stop owns display name + location.
        const terminalRows = await this.prisma.$queryRaw<StopLinkedTerminalRow[]>`
            SELECT
                t.public_id::text AS public_id,
                t.terminal_code,
                t.terminal_role,
                t.operator_id,
                o.name AS operator_name,
                t.review_status,
                t.confidence_score::float8 AS confidence_score,
                t.is_active
            FROM transport.terminals t
            LEFT JOIN transport.operators o ON o.id = t.operator_id
            WHERE t.linked_stop_id = ${row.id} AND t.deleted_at IS NULL
            ORDER BY t.id ASC
            LIMIT 1
        `;
        const terminalRow = terminalRows[0];

        const trimToNull = (value: string | null): string | null => {
            if (value === null) return null;
            const trimmed = value.trim();
            return trimmed === "" ? null : trimmed;
        };
        const stopNameMm = trimToNull(row.name_mm);
        const stopNameEn = trimToNull(row.name_en);

        return {
            public_id: row.public_id,
            stop_code: row.stop_code,
            name: row.name,
            name_mm: stopNameMm,
            name_en: stopNameEn,
            display_name:
                stopNameMm ?? stopNameEn ?? getTransportTypeFallbackLabel(row.stop_type),
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
            linked_terminal: terminalRow
                ? {
                      public_id: terminalRow.public_id,
                      terminal_code: terminalRow.terminal_code,
                      terminal_role: terminalRow.terminal_role,
                      operator_id:
                          terminalRow.operator_id === null
                              ? null
                              : Number(terminalRow.operator_id),
                      operator:
                          terminalRow.operator_id === null
                              ? null
                              : {
                                    id: Number(terminalRow.operator_id),
                                    name: terminalRow.operator_name ?? "",
                                },
                      review_status: terminalRow.review_status,
                      confidence_score: terminalRow.confidence_score,
                      is_active: terminalRow.is_active,
                  }
                : null,
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

        const editingNames = input.name_mm !== undefined || input.name_en !== undefined;

        if (sets.length === 0 && !editingNames) {
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

            // Localized-name edits (transport.stop_names = source of truth) +
            // derived stops.name_mm / stops.name_en / stops.name cache columns.
            let derivedName: string | null = null;
            let effectiveMm: string | null = null;
            let effectiveEn: string | null = null;

            if (editingNames) {
                const existingNames = await tx.$queryRaw<
                    { language_code: string; name: string }[]
                >`
                    SELECT lower(btrim(coalesce(language_code, ''))) AS language_code, name
                    FROM transport.stop_names
                    WHERE stop_id = ${before.id}
                      AND lower(btrim(coalesce(language_code, ''))) IN ('my', 'en')
                    ORDER BY is_primary DESC, search_weight DESC, id ASC
                `;
                const existingMm =
                    existingNames.find((n) => n.language_code === "my")?.name ??
                    before.name_mm ??
                    null;
                const existingEn =
                    existingNames.find((n) => n.language_code === "en")?.name ??
                    before.name_en ??
                    null;

                effectiveMm = input.name_mm !== undefined ? input.name_mm : existingMm;
                effectiveEn = input.name_en !== undefined ? input.name_en : existingEn;
                if (effectiveMm === null && effectiveEn === null) {
                    throw new TransportNameRequiredError();
                }

                if (input.name_mm !== undefined && input.name_mm !== existingMm) {
                    await this.upsertLocalizedStopName(tx, before.id, "my", input.name_mm);
                }
                if (input.name_en !== undefined && input.name_en !== existingEn) {
                    await this.upsertLocalizedStopName(tx, before.id, "en", input.name_en);
                }

                derivedName = effectiveMm ?? effectiveEn;
                sets.push(Prisma.sql`name_mm = ${effectiveMm}`);
                sets.push(Prisma.sql`name_en = ${effectiveEn}`);
                sets.push(Prisma.sql`name = ${derivedName}`);
            }

            if (sets.length > 0) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.stops
                    SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                    WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
                `);
            }

            // Audit: scalar fields (incl. name_mm/name_en from input) + point +
            // the derived `name` cache (input never carries `name`).
            const diff = diffScalarFields(before, input, STOP_AUDIT_FIELDS);
            appendPointDiff(diff, { lat: before.point_lat, lng: before.point_lng }, input.point);
            if (editingNames) {
                const prevName = before.name ?? null;
                if (prevName !== derivedName) {
                    diff.changedFields.push("name");
                    diff.oldValues.name = prevName;
                    diff.newValues.name = derivedName;
                }
            }
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

            // Keep terminal-linked display fields (name/name_mm/name_en/mode/geom) in
            // sync with the owning stop. Terminal-specific metadata (code, role,
            // operator, review, confidence, active) and source_refs/normalized_data
            // are never touched here. Direct SQL only (no terminal→stop write-back),
            // so there is no update loop.
            const syncName = editingNames;
            const syncMode = input.mode !== undefined;
            const syncPoint = input.point !== undefined;
            if (syncName || syncMode || syncPoint) {
                await this.syncLinkedTerminalsFromStop(tx, {
                    stopId: before.id,
                    stopPublicId: publicId,
                    name: syncName ? derivedName : undefined,
                    nameMm: syncName ? effectiveMm : undefined,
                    nameEn: syncName ? effectiveEn : undefined,
                    mode: syncMode ? (input.mode as string) : undefined,
                    point: syncPoint ? input.point : undefined,
                    audit,
                });
            }
        });

        return this.getStopByPublicId(publicId);
    }

    /**
     * Mirrors a stop's display fields onto every terminal linked to it
     * (`terminals.linked_stop_id = stopId`, soft-deletes excluded). Only the
     * provided display fields are written; terminal-specific metadata,
     * `source_refs`, and `normalized_data` are left untouched. Runs inside the
     * caller's transaction. Each terminal whose values actually change is updated
     * once (no loop back to the stop) and gets a `transport.terminal.sync_from_stop`
     * audit row referencing the source stop.
     */
    private async syncLinkedTerminalsFromStop(
        tx: Prisma.TransactionClient,
        params: {
            stopId: bigint;
            stopPublicId: string;
            name?: string | null;
            nameMm?: string | null;
            nameEn?: string | null;
            mode?: string;
            point?: { longitude: number; latitude: number };
            audit?: TransportAuditContext;
        }
    ): Promise<void> {
        const { stopId, stopPublicId, name, nameMm, nameEn, mode, point, audit } = params;

        const terminals = await tx.$queryRaw<
            {
                id: bigint;
                public_id: string;
                name: string;
                name_mm: string | null;
                name_en: string | null;
                mode: string;
                point_lng: number | null;
                point_lat: number | null;
            }[]
        >`
            SELECT id, public_id::text AS public_id, name, name_mm, name_en, mode,
                   ST_X(geom)::float8 AS point_lng, ST_Y(geom)::float8 AS point_lat
            FROM transport.terminals
            WHERE linked_stop_id = ${stopId} AND deleted_at IS NULL
            FOR UPDATE
        `;
        if (terminals.length === 0) {
            return;
        }

        for (const term of terminals) {
            const sets: Prisma.Sql[] = [];
            const changedFields: string[] = [];
            const oldValues: Record<string, unknown> = {};
            const newValues: Record<string, unknown> = {};

            if (name !== undefined && (term.name ?? null) !== name) {
                sets.push(Prisma.sql`name = ${name}`);
                changedFields.push("name");
                oldValues.name = term.name ?? null;
                newValues.name = name;
            }
            if (nameMm !== undefined && (term.name_mm ?? null) !== nameMm) {
                sets.push(Prisma.sql`name_mm = ${nameMm}`);
                changedFields.push("name_mm");
                oldValues.name_mm = term.name_mm ?? null;
                newValues.name_mm = nameMm;
            }
            if (nameEn !== undefined && (term.name_en ?? null) !== nameEn) {
                sets.push(Prisma.sql`name_en = ${nameEn}`);
                changedFields.push("name_en");
                oldValues.name_en = term.name_en ?? null;
                newValues.name_en = nameEn;
            }
            if (mode !== undefined && term.mode !== mode) {
                sets.push(Prisma.sql`mode = ${mode}`);
                changedFields.push("mode");
                oldValues.mode = term.mode;
                newValues.mode = mode;
            }
            if (point !== undefined) {
                const moved =
                    term.point_lng === null ||
                    term.point_lat === null ||
                    Math.abs(point.longitude - term.point_lng) > 1e-9 ||
                    Math.abs(point.latitude - term.point_lat) > 1e-9;
                if (moved) {
                    sets.push(
                        Prisma.sql`geom = ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)`
                    );
                    changedFields.push("point");
                    oldValues.point = { lng: term.point_lng, lat: term.point_lat };
                    newValues.point = { lng: point.longitude, lat: point.latitude };
                }
            }

            if (sets.length === 0) {
                continue;
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.terminals
                SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                WHERE id = ${term.id} AND deleted_at IS NULL
            `);

            await insertTransportAuditLog(tx, {
                action: "transport.terminal.sync_from_stop",
                entityType: "transport_terminal",
                entityId: term.id,
                entityPublicId: term.public_id,
                changedFields,
                oldValues,
                newValues,
                metadata: { synced_from_stop_public_id: stopPublicId },
                context: audit,
            });
        }
    }

    /**
     * Upsert one localized stop name (language my/en) in `transport.stop_names`,
     * the source of truth. With no unique `(stop_id, language_code)` constraint,
     * this updates the first existing row for the language and deletes any
     * duplicates; a `null` value deletes all rows for that language. `und` /
     * other languages are never touched.
     */
    private async upsertLocalizedStopName(
        tx: Prisma.TransactionClient,
        stopId: bigint,
        languageCode: "my" | "en",
        value: string | null
    ): Promise<void> {
        const existing = await tx.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM transport.stop_names
            WHERE stop_id = ${stopId}
              AND lower(btrim(coalesce(language_code, ''))) = ${languageCode}
            ORDER BY is_primary DESC, search_weight DESC, id ASC
        `;

        if (value === null) {
            if (existing.length > 0) {
                await tx.$executeRaw`
                    DELETE FROM transport.stop_names
                    WHERE stop_id = ${stopId}
                      AND lower(btrim(coalesce(language_code, ''))) = ${languageCode}
                `;
            }
            return;
        }

        const [first, ...rest] = existing;
        if (first) {
            await tx.$executeRaw`
                UPDATE transport.stop_names
                SET name = ${value}, language_code = ${languageCode}, is_primary = true,
                    updated_at = now()
                WHERE id = ${first.id}
            `;
            if (rest.length > 0) {
                await tx.$executeRaw(Prisma.sql`
                    DELETE FROM transport.stop_names
                    WHERE id IN (${Prisma.join(rest.map((r) => r.id))})
                `);
            }
        } else {
            await tx.$executeRaw`
                INSERT INTO transport.stop_names
                    (stop_id, name, language_code, name_type, is_primary, search_weight)
                VALUES (${stopId}, ${value}, ${languageCode}, 'primary', true, 100)
            `;
        }
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

        const pickLocalizedName = (lang: "my" | "en"): string | null =>
            nameRows.find((n) => (n.language_code ?? "").trim().toLowerCase() === lang)?.name ??
            null;
        const nameMm = pickLocalizedName("my");
        const nameEn = pickLocalizedName("en");
        const publicNameFallback =
            row.public_name && row.public_name.trim() !== "" ? row.public_name : row.route_code;
        const displayName = nameMm ?? nameEn ?? publicNameFallback;

        return {
            public_id: row.public_id,
            route_code: row.route_code,
            public_name: row.public_name,
            name_mm: nameMm,
            name_en: nameEn,
            display_name: displayName,
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
     * Lightweight ordered-stops read for the route_stop mutation responses. Returns
     * the full 1..N ordered membership in the flat {@link TransportOrderedStopLite}
     * shape (lng/lat as plain numbers via ST_X/ST_Y — no GeoJSON parse), the row
     * count, and a cheap `has_verified_path` flag. No path geometry and no heavy
     * stop fields, so the dashboard can update its panel/map/count from one cheap
     * response instead of refetching the heavy includePath list. One variant lookup
     * + one stops query (count derived from the rows, no separate COUNT(*)).
     */
    private async listOrderedStopsLite(variantPublicId: string): Promise<{
        ordered_stops: TransportOrderedStopLite[];
        route_stop_count: number;
        has_verified_path: boolean;
    }> {
        const variantRows = await this.prisma.$queryRaw<{ id: bigint; has_path: boolean }[]>`
            SELECT rv.id,
                   EXISTS (
                       SELECT 1 FROM transport.route_paths rp
                       WHERE rp.route_variant_id = rv.id AND rp.deleted_at IS NULL
                   ) AS has_path
            FROM transport.route_variants rv
            WHERE rv.public_id = ${variantPublicId}::uuid
            LIMIT 1
        `;
        const variant = variantRows[0];
        if (!variant) {
            throw new TransportNotFoundError("route variant", variantPublicId);
        }

        // Timed (TRANSPORT_PERF_LOG=1) ordered-stops query. Joins only route_stops
        // + stops, filters route_variant_id and non-deleted stops, orders by
        // stop_sequence (uses the route_stops(route_variant_id, stop_sequence)
        // index). ST_X/ST_Y return plain numbers — no GeoJSON serialization.
        const rows = await perf("listOrderedStopsLite ordered-stops query", () =>
            this.prisma.$queryRaw<
                {
                    route_stop_id: string;
                    stop_public_id: string;
                    stop_sequence: number;
                    display_name: string;
                    name_mm: string | null;
                    name_en: string | null;
                    mode: string;
                    stop_type: string;
                    longitude: number | null;
                    latitude: number | null;
                    pickup_type: number;
                    drop_off_type: number;
                    is_timing_point: boolean;
                }[]
            >`
                SELECT
                    rs.id::text AS route_stop_id,
                    s.public_id::text AS stop_public_id,
                    rs.stop_sequence,
                    s.name AS display_name,
                    s.name_mm,
                    s.name_en,
                    s.mode,
                    s.stop_type,
                    ST_X(s.geom)::float8 AS longitude,
                    ST_Y(s.geom)::float8 AS latitude,
                    rs.pickup_type,
                    rs.drop_off_type,
                    rs.is_timing_point
                FROM transport.route_stops rs
                JOIN transport.stops s ON s.id = rs.stop_id
                WHERE rs.route_variant_id = ${variant.id}
                  AND s.deleted_at IS NULL
                ORDER BY rs.stop_sequence ASC
            `
        );

        return {
            ordered_stops: rows.map((r) => ({
                route_stop_id: r.route_stop_id,
                stop_public_id: r.stop_public_id,
                stop_sequence: r.stop_sequence,
                display_name: r.display_name,
                name_mm: r.name_mm,
                name_en: r.name_en,
                mode: r.mode,
                stop_type: r.stop_type,
                longitude: r.longitude,
                latitude: r.latitude,
                pickup_type: r.pickup_type,
                drop_off_type: r.drop_off_type,
                is_timing_point: r.is_timing_point,
            })),
            route_stop_count: rows.length,
            has_verified_path: variant.has_path,
        };
    }

    /**
     * Public lightweight ordered-stops read for the Route Detail ordered-stop panel
     * + map markers. Same flat shape the mutation endpoints return (no path
     * geometry, no source_refs/normalized_data, no route detail/list) so the panel
     * loads fast and never waits on path serialization. The verified path overlay
     * is fetched separately by the client only when `has_verified_path` is true.
     */
    async getOrderedStops(variantPublicId: string): Promise<TransportRouteStopMutationResult> {
        await this.assertSchemaAvailable();
        const lite = await this.listOrderedStopsLite(variantPublicId);
        return {
            variant_public_id: variantPublicId,
            ordered_stops: lite.ordered_stops,
            route_stop_count: lite.route_stop_count,
            has_verified_path: lite.has_verified_path,
        };
    }

    /**
     * Upserts a single localized route name row (`language_code` my/en) as the
     * editable source of truth. There is no unique constraint on
     * `(route_id, language_code)` yet, so this updates the FIRST existing row for
     * that language and removes any duplicates (never creates a second row); a
     * `null` value clears the localized name. `und` rows are never touched.
     */
    private async upsertLocalizedRouteName(
        tx: Prisma.TransactionClient,
        routeId: bigint,
        languageCode: "my" | "en",
        value: string | null
    ): Promise<void> {
        const existing = await tx.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM transport.route_names
            WHERE route_id = ${routeId}
              AND lower(btrim(coalesce(language_code, ''))) = ${languageCode}
            ORDER BY is_primary DESC, search_weight DESC, id ASC
        `;

        if (value === null) {
            if (existing.length > 0) {
                await tx.$executeRaw`
                    DELETE FROM transport.route_names
                    WHERE route_id = ${routeId}
                      AND lower(btrim(coalesce(language_code, ''))) = ${languageCode}
                `;
            }
            return;
        }

        const [first, ...rest] = existing;
        if (first) {
            await tx.$executeRaw`
                UPDATE transport.route_names
                SET name = ${value}, language_code = ${languageCode}, is_primary = true,
                    updated_at = now()
                WHERE id = ${first.id}
            `;
            if (rest.length > 0) {
                await tx.$executeRaw(Prisma.sql`
                    DELETE FROM transport.route_names
                    WHERE id IN (${Prisma.join(rest.map((r) => r.id))})
                `);
            }
        } else {
            await tx.$executeRaw`
                INSERT INTO transport.route_names
                    (route_id, name, language_code, name_type, is_primary, search_weight)
                VALUES (${routeId}, ${value}, ${languageCode}, 'primary', true, 100)
            `;
        }
    }

    /**
     * Partial update of an active route's editable metadata.
     *
     * Naming is edited via `name_mm` / `name_en` only; the repo writes the
     * `transport.route_names` rows (language my/en) as the source of truth and
     * derives the `routes.public_name` cache (Myanmar first, English fallback).
     * `public_name` is never accepted as direct input. A merge-aware rule
     * enforces that at least one of name_mm/name_en remains after the edit.
     * `und` names, `source_refs`, and `normalized_data` are never touched.
     * Returns the refreshed route detail. Throws {@link TransportNotFoundError}
     * when the route is missing/soft-deleted, or {@link TransportNameRequiredError}
     * when an edit would clear both localized names.
     */
    async updateRouteByPublicId(
        publicId: string,
        input: UpdateRouteInput,
        audit?: TransportAuditContext
    ): Promise<TransportRouteDetail> {
        await this.assertSchemaAvailable();

        const sets: Prisma.Sql[] = [];
        if (input.route_code !== undefined) sets.push(Prisma.sql`route_code = ${input.route_code}`);
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

        const editingNames = input.name_mm !== undefined || input.name_en !== undefined;

        if (sets.length === 0 && !editingNames) {
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

            // Localized-name edits (source of truth) + derived public_name cache.
            const nameChangedFields: string[] = [];
            const nameOldValues: Record<string, unknown> = {};
            const nameNewValues: Record<string, unknown> = {};
            let derivedPublicName: string | null = null;

            if (editingNames) {
                const existingNames = await tx.$queryRaw<
                    { language_code: string; name: string }[]
                >`
                    SELECT lower(btrim(coalesce(language_code, ''))) AS language_code, name
                    FROM transport.route_names
                    WHERE route_id = ${before.id}
                      AND lower(btrim(coalesce(language_code, ''))) IN ('my', 'en')
                    ORDER BY is_primary DESC, search_weight DESC, id ASC
                `;
                const existingMm =
                    existingNames.find((n) => n.language_code === "my")?.name ?? null;
                const existingEn =
                    existingNames.find((n) => n.language_code === "en")?.name ?? null;

                const effectiveMm = input.name_mm !== undefined ? input.name_mm : existingMm;
                const effectiveEn = input.name_en !== undefined ? input.name_en : existingEn;
                if (effectiveMm === null && effectiveEn === null) {
                    throw new TransportNameRequiredError();
                }

                if (input.name_mm !== undefined && input.name_mm !== existingMm) {
                    await this.upsertLocalizedRouteName(tx, before.id, "my", input.name_mm);
                    nameChangedFields.push("name_mm");
                    nameOldValues.name_mm = existingMm;
                    nameNewValues.name_mm = input.name_mm;
                }
                if (input.name_en !== undefined && input.name_en !== existingEn) {
                    await this.upsertLocalizedRouteName(tx, before.id, "en", input.name_en);
                    nameChangedFields.push("name_en");
                    nameOldValues.name_en = existingEn;
                    nameNewValues.name_en = input.name_en;
                }

                derivedPublicName = effectiveMm ?? effectiveEn;
                sets.push(Prisma.sql`public_name = ${derivedPublicName}`);
            }

            if (sets.length > 0) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.routes
                    SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                    WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
                `);
            }

            // Audit: scalar fields (input has no public_name) + derived public_name + names.
            const diff = diffScalarFields(before, input, ROUTE_AUDIT_FIELDS);
            if (editingNames) {
                const prevPublicName = before.public_name ?? null;
                if (prevPublicName !== derivedPublicName) {
                    diff.changedFields.push("public_name");
                    diff.oldValues.public_name = prevPublicName;
                    diff.newValues.public_name = derivedPublicName;
                }
                for (const field of nameChangedFields) {
                    diff.changedFields.push(field);
                    diff.oldValues[field] = nameOldValues[field];
                    diff.newValues[field] = nameNewValues[field];
                }
            }

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
    ): Promise<TransportRouteStopMutationResult> {
        await this.assertSchemaAvailable();

        const trimmedReason = typeof reason === "string" ? reason.trim() : "";

        const perf = startPerf("remove-route-stop");

        let variantPublicId: string | null;
        try {
            variantPublicId = await this.prisma.$transaction(async (tx) => {
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
            perf.mark("route_stop loaded");

            await tx.$executeRaw`
                DELETE FROM transport.route_stops WHERE id = ${id}
            `;
            perf.mark("delete done");

            // Resequence the remaining membership rows to a gap-free 1..N. This uses
            // TWO bulk statements (temp slots strictly above the current max, then
            // the final positions) instead of a per-row UPDATE loop, so the query
            // count stays constant regardless of variant size (avoids the Prisma
            // transaction timeout / P2028 on large variants). The disjoint temp
            // range guarantees the non-deferrable UNIQUE(variant, sequence) and the
            // stop_sequence > 0 CHECK never transiently conflict. Only rows whose
            // sequence actually changes are written.
            const remaining = await tx.$queryRaw<
                { id: bigint; stop_id: bigint; stop_sequence: number }[]
            >`
                SELECT id, stop_id, stop_sequence
                FROM transport.route_stops
                WHERE route_variant_id = ${before.route_variant_id}
                ORDER BY stop_sequence ASC
                FOR UPDATE
            `;
            const changed = remaining
                .map((r, idx) => ({ id: r.id, target: idx + 1, current: r.stop_sequence }))
                .filter((r) => r.current !== r.target);
            if (changed.length > 0) {
                // remaining is ordered ascending, so the last row holds the max.
                const tempBase = remaining[remaining.length - 1].stop_sequence + 1;
                const tempRows = changed.map(
                    (r, i) => Prisma.sql`(${r.id}::bigint, ${tempBase + i}::int)`
                );
                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.route_stops rs
                    SET stop_sequence = v.temp_sequence, updated_at = now()
                    FROM (VALUES ${Prisma.join(tempRows)}) AS v(id, temp_sequence)
                    WHERE rs.id = v.id
                `);
                const finalRows = changed.map(
                    (r) => Prisma.sql`(${r.id}::bigint, ${r.target}::int)`
                );
                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.route_stops rs
                    SET stop_sequence = v.final_sequence, updated_at = now()
                    FROM (VALUES ${Prisma.join(finalRows)}) AS v(id, final_sequence)
                    WHERE rs.id = v.id
                `);
            }
            perf.mark(`resequence done (${changed.length} rows changed)`);

            const variantRows = await tx.$queryRaw<{ public_id: string }[]>`
                SELECT public_id::text AS public_id
                FROM transport.route_variants
                WHERE id = ${before.route_variant_id}
                LIMIT 1
            `;
            const variantPublicId = variantRows[0]?.public_id ?? null;

            // Compact new-sequence summary (post-resequence) for the audit trail.
            const newSequence = remaining.map((r, idx) => ({
                route_stop_id: String(r.id),
                stop_id: String(r.stop_id),
                stop_sequence: idx + 1,
            }));

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
                    resequenced_count: remaining.length,
                    new_sequence: newSequence,
                },
                context: audit,
            });
            perf.mark("audit written");

            return variantPublicId;
            }, ROUTE_STOP_TX_OPTIONS);
        } catch (error) {
            if (isPrismaTransactionTimeout(error)) {
                throw new TransportRouteStopTransactionTimeoutError();
            }
            throw error;
        }
        perf.mark("transaction committed");

        // Lightweight ordered re-read so the dashboard can update locally without a
        // heavy includePath refetch. No path geometry (it does not change on a
        // membership edit).
        if (variantPublicId === null) {
            perf.done();
            return {
                variant_public_id: null,
                ordered_stops: [],
                route_stop_count: 0,
                has_verified_path: false,
                deleted: true,
            };
        }
        const lite = await this.listOrderedStopsLite(variantPublicId);
        perf.mark("response built (re-read stops, lite)");
        perf.done();
        return {
            variant_public_id: variantPublicId,
            ordered_stops: lite.ordered_stops,
            route_stop_count: lite.route_stop_count,
            has_verified_path: lite.has_verified_path,
            deleted: true,
        };
    }

    /**
     * Archive (soft-delete) an actual stop record. This is the only stop-deletion
     * path and is intentionally conservative:
     *
     *   - Never hard-deletes: sets `deleted_at = now()` and `is_active = false`.
     *   - Never touches route_stops. A stop still used by any route (counted as
     *     distinct routes via non-deleted variants — the same figure shown in the
     *     list/detail route_count) is rejected with {@link TransportStopInUseError}
     *     (HTTP 409); the admin must remove it from all routes first.
     *   - stop_names and source_links are preserved (no cascade delete here).
     *   - Any terminal linked to this stop (terminals.linked_stop_id, not already
     *     archived) is archived in the SAME transaction, since the stop owns the
     *     terminal's display name + location and an orphaned active terminal would
     *     be invalid.
     *   - Writes a `transport.stop.archive` audit row (and a
     *     `transport.terminal.archive` row per archived terminal) inside the
     *     transaction, so a rolled-back archive never leaves an audit trail.
     *
     * Returns the archived stop's public_id plus the archived terminals' public_ids.
     * Throws {@link TransportNotFoundError} when the stop does not exist or is
     * already archived.
     */
    async archiveStopByPublicId(
        publicId: string,
        audit?: TransportAuditContext,
        reason?: string
    ): Promise<TransportStopArchiveResult> {
        await this.assertSchemaAvailable();

        const trimmedReason = typeof reason === "string" ? reason.trim() : "";

        return this.prisma.$transaction(async (tx) => {
            // Lock the live stop row. Already-archived / missing both surface as 404.
            const stopRows = await tx.$queryRaw<
                {
                    id: bigint;
                    public_id: string;
                    name: string | null;
                    mode: string | null;
                    stop_type: string | null;
                    is_active: boolean;
                }[]
            >`
                SELECT id, public_id::text AS public_id, name, mode, stop_type, is_active
                FROM transport.stops
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const stop = stopRows[0];
            if (!stop) {
                throw new TransportNotFoundError("stop", publicId);
            }

            // Usage guard: distinct routes reached via non-deleted variants. This
            // matches the route_count shown in the list/detail, so "remove it from
            // all routes" is consistent with what the admin sees. route_stops rows
            // are never deleted by this endpoint.
            const countRows = await tx.$queryRaw<{ route_count: bigint }[]>`
                SELECT count(DISTINCT v.route_id)::bigint AS route_count
                FROM transport.route_stops rs
                JOIN transport.route_variants v
                    ON v.id = rs.route_variant_id AND v.deleted_at IS NULL
                WHERE rs.stop_id = ${stop.id}
            `;
            const routeCount = num(countRows[0]?.route_count);
            if (routeCount > 0) {
                throw new TransportStopInUseError(routeCount);
            }

            // Archive every live terminal linked to this stop (usually 0 or 1).
            const terminalRows = await tx.$queryRaw<
                {
                    id: bigint;
                    public_id: string;
                    terminal_code: string | null;
                    terminal_role: string | null;
                    name: string | null;
                    is_active: boolean;
                }[]
            >`
                SELECT id, public_id::text AS public_id, terminal_code, terminal_role, name, is_active
                FROM transport.terminals
                WHERE linked_stop_id = ${stop.id} AND deleted_at IS NULL
                FOR UPDATE
            `;

            const archivedTerminals: string[] = [];
            for (const terminal of terminalRows) {
                await tx.$executeRaw`
                    UPDATE transport.terminals
                    SET deleted_at = now(), is_active = false, updated_at = now()
                    WHERE id = ${terminal.id}
                `;
                archivedTerminals.push(terminal.public_id);
                await insertTransportAuditLog(tx, {
                    action: "transport.terminal.archive",
                    entityType: "transport_terminal",
                    entityId: terminal.id,
                    entityPublicId: terminal.public_id,
                    changedFields: ["deleted_at", "is_active"],
                    oldValues: {
                        name: terminal.name,
                        terminal_code: terminal.terminal_code,
                        terminal_role: terminal.terminal_role,
                        is_active: terminal.is_active,
                    },
                    newValues: { deleted_at: "now()", is_active: false },
                    metadata: {
                        archived_via: "stop_archive",
                        stop_public_id: stop.public_id,
                        ...(trimmedReason ? { reason: trimmedReason } : {}),
                    },
                    context: audit,
                });
            }

            // Soft-delete the stop itself.
            await tx.$executeRaw`
                UPDATE transport.stops
                SET deleted_at = now(), is_active = false, updated_at = now()
                WHERE id = ${stop.id}
            `;

            await insertTransportAuditLog(tx, {
                action: "transport.stop.archive",
                entityType: "transport_stop",
                entityId: stop.id,
                entityPublicId: stop.public_id,
                changedFields: ["deleted_at", "is_active"],
                oldValues: {
                    name: stop.name,
                    mode: stop.mode,
                    stop_type: stop.stop_type,
                    is_active: stop.is_active,
                    route_count: routeCount,
                    linked_terminals: archivedTerminals,
                },
                newValues: { deleted_at: "now()", is_active: false },
                metadata: {
                    ...(trimmedReason ? { reason: trimmedReason } : {}),
                    archived_terminal_public_ids: archivedTerminals,
                },
                context: audit,
            });

            return {
                archived: true,
                public_id: stop.public_id,
                route_count: routeCount,
                archived_terminals: archivedTerminals,
            };
        });
    }

    /**
     * Insert an EXISTING stop into a route variant's ordered pattern and resequence
     * the whole variant to a gap-free 1..N. The backend owns stop_sequence; callers
     * pass only a relative `position` (start/end/before/after + anchor route_stop).
     *
     * Safety:
     *   - Runs in a single transaction that first takes `FOR UPDATE` on the parent
     *     route_variants row, then on the variant's stops, so concurrent
     *     inserts/moves/removes serialize even when the variant is currently empty.
     *   - Rejects a stop already present in the variant. There is no
     *     UNIQUE(route_variant_id, stop_id) constraint, so this duplicate guard is
     *     app-enforced; the variant-row lock is what makes it race-safe.
     *   - The variant's route_stops carry a UNIQUE (route_variant_id, stop_sequence) and a
     *     `stop_sequence > 0` CHECK, so we never write 0/negative temporaries. Instead we
     *     first bump every existing row to a positive out-of-range slot (max+1 …), then
     *     write the final 1..N order (updates for existing rows, INSERT for the new one).
     *   - The referenced transport.stops row is never created or modified here.
     *
     * Returns the updated ordered stops list (same shape as listStopsForVariant).
     */
    async insertExistingRouteStop(
        variantPublicId: string,
        input: InsertExistingRouteStopInput,
        audit?: TransportAuditContext
    ): Promise<TransportRouteStopMutationResult> {
        await this.assertSchemaAvailable();

        try {
            await this.prisma.$transaction(async (tx) => {
            const variant = await this.resolveVariantForInsert(tx, variantPublicId);

            // Resolve the stop to insert (by internal id or public id). Never created here.
            let stopId: bigint;
            let stopRef: string;
            if (input.stopId !== undefined) {
                stopRef = String(input.stopId);
                const rows = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id FROM transport.stops WHERE id = ${BigInt(input.stopId)} LIMIT 1
                `;
                if (!rows[0]) {
                    throw new TransportNotFoundError("stop", stopRef);
                }
                stopId = rows[0].id;
            } else {
                stopRef = input.stopPublicId as string;
                const rows = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id FROM transport.stops WHERE public_id = ${stopRef}::uuid LIMIT 1
                `;
                if (!rows[0]) {
                    throw new TransportNotFoundError("stop", stopRef);
                }
                stopId = rows[0].id;
            }

            await this.insertStopIntoVariantTx(tx, {
                variantId: variant.id,
                variantPublicId,
                stopId,
                stopRef,
                position: input.position,
                anchorRouteStopId: input.anchorRouteStopId,
                pickup_type: input.pickup_type,
                drop_off_type: input.drop_off_type,
                is_timing_point: input.is_timing_point,
                audit,
            });
            }, ROUTE_STOP_TX_OPTIONS);
        } catch (error) {
            if (isPrismaTransactionTimeout(error)) {
                throw new TransportRouteStopTransactionTimeoutError();
            }
            throw error;
        }

        // Lightweight ordered re-read OUTSIDE the transaction (no path geometry), so
        // the dashboard can update locally without a heavy includePath refetch.
        const lite = await this.listOrderedStopsLite(variantPublicId);
        return {
            variant_public_id: variantPublicId,
            ordered_stops: lite.ordered_stops,
            route_stop_count: lite.route_stop_count,
            has_verified_path: lite.has_verified_path,
        };
    }

    /**
     * Secondary "quick create" path for the Insert Stop modal. Creates a new stop
     * (minimal fields: localized names, mode, stop_type, location) and inserts it
     * into the variant in a single transaction. Confidence/review_status fall back
     * to the transport.stops column defaults; full stop metadata stays on the Stop
     * Detail page. The backend owns stop_sequence (resequenced to 1..N).
     */
    async createAndInsertRouteStop(
        variantPublicId: string,
        input: CreateAndInsertRouteStopInput,
        audit?: TransportAuditContext
    ): Promise<TransportRouteStopMutationResult> {
        await this.assertSchemaAvailable();

        const perf = startPerf("create-and-insert");

        const nameMm = input.name_mm ?? null;
        const nameEn = input.name_en ?? null;
        // Display-name cache mirrors updateStop: prefer Myanmar, fall back to English.
        // At least one is guaranteed present by the schema refine. Pure from input,
        // so computed outside the transaction.
        const derivedName = (nameMm ?? nameEn) as string;

        let txResult: {
            new_stop_id: bigint;
            stop_public_id: string;
            route_stop_id: bigint;
            variant_id: bigint;
        };
        try {
            txResult = await this.prisma.$transaction(async (tx) => {
            const variant = await this.resolveVariantForInsert(tx, variantPublicId);

            const insertedStopRows = await tx.$queryRaw<{ id: bigint; public_id: string }[]>`
                INSERT INTO transport.stops (name, name_mm, name_en, mode, stop_type, geom)
                VALUES (
                    ${derivedName}, ${nameMm}, ${nameEn}, ${input.mode}, ${input.stop_type},
                    ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)
                )
                RETURNING id, public_id::text AS public_id
            `;
            const stopId = insertedStopRows[0].id;
            const stopPublicId = insertedStopRows[0].public_id;
            perf.mark("stop created");

            // transport.stop_names is the source of truth for localized names.
            if (nameMm !== null) {
                await this.upsertLocalizedStopName(tx, stopId, "my", nameMm);
            }
            if (nameEn !== null) {
                await this.upsertLocalizedStopName(tx, stopId, "en", nameEn);
            }
            perf.mark("stop_names written");

            await insertTransportAuditLog(tx, {
                action: "transport.stop.create",
                entityType: "transport_stop",
                entityId: stopId,
                entityPublicId: stopPublicId,
                changedFields: ["name", "name_mm", "name_en", "mode", "stop_type", "geom"],
                oldValues: {},
                newValues: {
                    name: derivedName,
                    name_mm: nameMm,
                    name_en: nameEn,
                    mode: input.mode,
                    stop_type: input.stop_type,
                    longitude: input.longitude,
                    latitude: input.latitude,
                },
                metadata: {
                    variant_public_id: variantPublicId,
                    created_via: "route_stop_insert",
                },
                context: audit,
            });
            perf.mark("stop.create audit written");

            const insertedRouteStopId = await this.insertStopIntoVariantTx(tx, {
                variantId: variant.id,
                variantPublicId,
                stopId,
                stopRef: stopPublicId,
                position: input.position,
                anchorRouteStopId: input.anchorRouteStopId,
                pickup_type: input.pickup_type,
                drop_off_type: input.drop_off_type,
                is_timing_point: input.is_timing_point,
                audit,
                extraMetadata: { created_stop: true, created_stop_public_id: stopPublicId },
                perf,
            });

            // Return only the minimal identifiers from inside the transaction; the
            // response (created_stop summary + ordered list) is built after commit.
            return {
                new_stop_id: stopId,
                stop_public_id: stopPublicId,
                route_stop_id: insertedRouteStopId,
                variant_id: variant.id,
            };
            }, ROUTE_STOP_TX_OPTIONS);
        } catch (error) {
            if (isPrismaTransactionTimeout(error)) {
                throw new TransportRouteStopTransactionTimeoutError();
            }
            throw error;
        }
        perf.mark("transaction committed");

        const createdStop: TransportCreatedStopLite = {
            route_stop_id: String(txResult.route_stop_id),
            public_id: txResult.stop_public_id,
            display_name: derivedName,
            name_mm: nameMm,
            name_en: nameEn,
            mode: input.mode,
            stop_type: input.stop_type,
            longitude: input.longitude,
            latitude: input.latitude,
        };

        // Lightweight ordered re-read OUTSIDE the transaction (no path geometry).
        const lite = await this.listOrderedStopsLite(variantPublicId);
        perf.mark("response built (re-read stops, lite)");
        perf.done();
        return {
            variant_public_id: variantPublicId,
            ordered_stops: lite.ordered_stops,
            route_stop_count: lite.route_stop_count,
            has_verified_path: lite.has_verified_path,
            created_stop: createdStop,
        };
    }

    /** Resolve a route variant by public id (locked rows are taken later by the insert). */
    private async resolveVariantForInsert(
        tx: Prisma.TransactionClient,
        variantPublicId: string
    ): Promise<{ id: bigint }> {
        const variantRows = await tx.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM transport.route_variants WHERE public_id = ${variantPublicId}::uuid LIMIT 1
        `;
        const variant = variantRows[0];
        if (!variant) {
            throw new TransportNotFoundError("route variant", variantPublicId);
        }
        return variant;
    }

    /**
     * Shared insert + 1..N resequence used by both insert-existing and
     * create-and-insert. Assumes the variant exists and the stop row already
     * exists. Rejects a stop already present in the variant (409). Runs entirely
     * within the caller's transaction. Returns the new route_stop id.
     */
    private async insertStopIntoVariantTx(
        tx: Prisma.TransactionClient,
        args: {
            variantId: bigint;
            variantPublicId: string;
            stopId: bigint;
            stopRef: string;
            position: "start" | "end" | "before" | "after";
            anchorRouteStopId?: string;
            pickup_type: number;
            drop_off_type: number;
            is_timing_point: boolean;
            audit?: TransportAuditContext;
            extraMetadata?: Record<string, unknown>;
            perf?: PerfTimer;
        }
    ): Promise<bigint> {
        const {
            variantId,
            variantPublicId,
            stopId,
            stopRef,
            position,
            anchorRouteStopId,
            pickup_type,
            drop_off_type,
            is_timing_point,
            audit,
            extraMetadata,
            perf,
        } = args;

        // Serialize all inserts for this variant on the parent row. The membership
        // FOR UPDATE below locks zero rows when the variant is empty, so two
        // concurrent inserts into an empty variant could otherwise both pass the
        // duplicate check (there is no UNIQUE(route_variant_id, stop_id)). Locking
        // the route_variants row first forces the second transaction to wait until
        // the first commits, after which it re-reads the now-populated membership
        // list and the duplicate check sees the freshly inserted stop.
        await tx.$queryRaw`
            SELECT id FROM transport.route_variants WHERE id = ${variantId} FOR UPDATE
        `;
        perf?.mark("route_variant lock acquired");

        // Lock the current ordered membership rows for this variant.
        const current = await tx.$queryRaw<
            { id: bigint; stop_id: bigint; stop_sequence: number }[]
        >`
            SELECT id, stop_id, stop_sequence
            FROM transport.route_stops
            WHERE route_variant_id = ${variantId}
            ORDER BY stop_sequence ASC
            FOR UPDATE
        `;
        perf?.mark(`route_stops loaded (${current.length} rows)`);

        // Reject duplicates (a stop may appear at most once per variant).
        if (current.some((r) => String(r.stop_id) === String(stopId))) {
            throw new TransportRouteStopDuplicateError(stopRef);
        }

        // Resolve the 0-based insertion index within the ordered list.
        let insertIndex: number;
        if (position === "start") {
            insertIndex = 0;
        } else if (position === "end") {
            insertIndex = current.length;
        } else {
            const anchorId = anchorRouteStopId as string;
            const idx = current.findIndex((r) => String(r.id) === anchorId);
            if (idx === -1) {
                throw new TransportNotFoundError("anchor route stop", anchorId);
            }
            insertIndex = position === "before" ? idx : idx + 1;
        }

        // Final ordered list with the new stop slotted in exactly once.
        const finalOrder: Array<{ kind: "existing"; id: bigint } | { kind: "new" }> = [];
        for (let i = 0; i <= current.length; i += 1) {
            if (i === insertIndex) {
                finalOrder.push({ kind: "new" });
            }
            if (i < current.length) {
                finalOrder.push({ kind: "existing", id: current[i].id });
            }
        }

        // Resequencing uses TWO bulk statements instead of per-row UPDATEs so the
        // interactive transaction stays small (constant query count) and never
        // trips the Prisma transaction timeout, even for variants with many stops.
        const maxRows = await tx.$queryRaw<{ m: number | null }[]>`
            SELECT max(stop_sequence) AS m
            FROM transport.route_stops
            WHERE route_variant_id = ${variantId}
        `;

        // Temp slots must sit strictly above BOTH the current max sequence (so the
        // Phase 1 bulk UPDATE never lands on an as-yet-unmoved row's sequence) and
        // the final max sequence N+1 (so the Phase 2 bulk UPDATE never lands on a
        // temp slot). With fully disjoint source/target ranges, a single multi-row
        // UPDATE is safe despite the non-deferrable UNIQUE(variant, sequence)
        // constraint, and we never write a zero/negative sequence.
        const tempBase = Math.max(num(maxRows[0]?.m) + 1, current.length + 2);

        // Phase 1: bump all existing rows to disjoint temp slots in one statement.
        if (current.length > 0) {
            const tempRows = current.map(
                (row, i) => Prisma.sql`(${row.id}::bigint, ${tempBase + i}::int)`
            );
            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.route_stops rs
                SET stop_sequence = v.temp_sequence, updated_at = now()
                FROM (VALUES ${Prisma.join(tempRows)}) AS v(id, temp_sequence)
                WHERE rs.id = v.id
            `);
        }
        perf?.mark("phase A temp resequence done");

        // Resolve the final 1..N order: existing rows get their slot, the new row
        // takes the gap left for it.
        let newSeq = -1;
        const existingFinal: Array<{ id: bigint; seq: number }> = [];
        finalOrder.forEach((entry, idx) => {
            const seq = idx + 1;
            if (entry.kind === "existing") {
                existingFinal.push({ id: entry.id, seq });
            } else {
                newSeq = seq;
            }
        });

        // Phase 2: write every existing row's final sequence in one statement.
        if (existingFinal.length > 0) {
            const finalRows = existingFinal.map(
                (row) => Prisma.sql`(${row.id}::bigint, ${row.seq}::int)`
            );
            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.route_stops rs
                SET stop_sequence = v.final_sequence, updated_at = now()
                FROM (VALUES ${Prisma.join(finalRows)}) AS v(id, final_sequence)
                WHERE rs.id = v.id
            `);
        }
        perf?.mark("phase B final resequence done");

        // Insert the new membership row into its now-free final slot.
        const inserted = await tx.$queryRaw<{ id: bigint }[]>`
            INSERT INTO transport.route_stops (
                route_variant_id, stop_id, stop_sequence,
                pickup_type, drop_off_type, is_timing_point
            )
            VALUES (
                ${variantId}, ${stopId}, ${newSeq},
                ${pickup_type}, ${drop_off_type}, ${is_timing_point}
            )
            RETURNING id
        `;
        const insertedId: bigint = inserted[0].id;
        perf?.mark("new route_stop inserted");

        // Compact old/new sequence summaries for the audit log.
        const oldSequence = current.map((r) => ({
            route_stop_id: String(r.id),
            stop_id: String(r.stop_id),
            stop_sequence: r.stop_sequence,
        }));
        const stopIdByRouteStop = new Map(current.map((r) => [String(r.id), String(r.stop_id)]));
        const newSequence = finalOrder.map((entry, idx) => {
            const stop_sequence = idx + 1;
            if (entry.kind === "existing") {
                return {
                    route_stop_id: String(entry.id),
                    stop_id: stopIdByRouteStop.get(String(entry.id)) ?? null,
                    stop_sequence,
                };
            }
            return {
                route_stop_id: String(insertedId),
                stop_id: String(stopId),
                stop_sequence,
                inserted: true,
            };
        });

        await insertTransportAuditLog(tx, {
            action: "transport.route_stop.insert",
            entityType: "transport_route_stop",
            entityId: insertedId,
            entityPublicId: null,
            changedFields: ["stop_sequence"],
            oldValues: { sequence: oldSequence },
            newValues: { sequence: newSequence },
            metadata: {
                variant_public_id: variantPublicId,
                route_variant_id: String(variantId),
                inserted_stop_id: String(stopId),
                inserted_route_stop_id: String(insertedId),
                position,
                anchor_route_stop_id: anchorRouteStopId ?? null,
                ...(extraMetadata ?? {}),
            },
            context: audit,
        });
        perf?.mark("route_stop.insert audit written");

        return insertedId;
    }
}
