import { Prisma, type PrismaClient } from "@prisma/client";

import {
    TransportInvalidReferenceError,
    TransportNameRequiredError,
    TransportNotFoundError,
    TransportRouteMetadataError,
    TransportRouteConflictError,
    TransportRouteStopTransactionTimeoutError,
    TransportSchemaUnavailableError,
    TransportStopDeleteBlockedError,
    TransportStopInUseError,
    TransportReviewGuardError,
    TransportGeneratePathFromStopsError,
    TransportMergePreviewFailedError,
    TransportMergeExecutionFailedError,
    TransportMergeTerminalConflictError,
    TransportMergeParentConflictError,
    TransportMergeStalePreviewError,
    type TransportStopDeleteBlocker,
} from "./transport.errors.js";
import {
    buildCreatedFromRouteSequenceNormalizedData,
    resolvePlaceholderStopGeometry,
    type RouteStopGeometryPoint,
} from "./transport-stop-placeholder-geometry.js";
import { getDefaultRouteKind } from "./transport-mode-config.js";
import {
    appendPointDiff,
    diffScalarFields,
    insertTransportAuditLog,
    resolvePointAwareAction,
    type TransportAuditContext,
} from "./transport-audit.js";
import { getTransportTypeFallbackLabel } from "./transport-naming.js";
import {
    derivePublicVisibility,
    deriveRouteGeometryStatus,
    deriveStopGeometryStatus,
} from "./transport-review.js";
import { calculateVariantTimetableSchedule, variantTimetableScheduleToOffsets } from "./transport-timetable.js";
import { assembleStopRouteUsageDetail, buildStopRouteUsageSummary } from "./stopRouteUsageDetail.js";
import {
    MERGE_TERMINAL_CONFLICT_BLOCKER,
    buildStopMergeConflictAnalysis,
    buildStopMergeFieldComparison,
    buildStopMergeTerminalConflict,
    extractConstraintMeta,
    extractPrismaErrorCode,
    extractSqlErrorCode,
    jsonSafeNumber,
    type MergePreviewTerminalRow,
    type MergePreviewUsageMembership,
} from "./stopMergePreview.js";
import {
    emptyStopMergeReferenceChanges,
    emptyStopMergeReferenceCounts,
    sumStopMergeReferenceCounts,
} from "./stopMergeGlobal.js";
import {
    resolveMergeFieldValue,
    type StopMergeFieldKey,
    type StopMergeFieldSources,
    type StopMergeFieldStopSnapshot,
} from "./stopMergeFieldApply.js";
import {
    buildTransportRouteMetadata,
    hasPlaceholderStopNames,
    type RouteMetadataVariantRow,
} from "./transport-route-metadata.js";
import type {
    ListTransportRoutesQuery,
    ListTransportStopsQuery,
    ListTransportTerminalsQuery,
    ListImportBatchesQuery,
    ListImportErrorsQuery,
    ListSourceLinksQuery,
    ListTransportInfrastructureLinesQuery,
    ListVariantStopsQuery,
    CreateRouteInput,
    CreateVariantInput,
    InsertExistingRouteStopInput,
    CreateAndInsertRouteStopInput,
    NearbyTransportStopCandidatesQuery,
    NearbyStopsQuery,
    SearchTransportStopsQuery,
    StopRoutesQuery,
    UpdateInfrastructureLineInput,
    PutVariantPathInput,
    UpdateRouteInput,
    UpdateRouteStopInput,
    UpdateRouteStopTimingInput,
    UpdateStopInput,
    UpdateStopLocationInput,
    UpdateTerminalInput,
    UpdateVariantInput,
} from "./transport.schema.js";
import { STOPS_LIST_MAX_LIMIT } from "./transport.schema.js";
import {
    DUPLICATE_NEARBY_RADIUS_M,
    approxExpandDegreesFromMeters,
} from "./transport-spatial.js";
import type {
    GeoJsonGeometry,
    TransportCountsByKey,
    TransportDataQualityQueues,
    TransportQualitySummary,
    TransportImportBatchListItem,
    TransportImportErrorListItem,
    TransportSourceLinkListItem,
    TransportImportIssueBreakdown,
    TransportOverview,
    TransportPaginated,
    TransportRawNameStatus,
    TransportRouteCreateResult,
    TransportRouteDetail,
    TransportRouteDiagnostics,
    TransportRouteListItem,
    TransportRouteStopItem,
    TransportCreatedStopLite,
    TransportOrderedStopLite,
    TransportRouteStopMutationResult,
    TransportNearbyStop,
    TransportNearbyStopCandidatesResponse,
    TransportStopArchiveResult,
    TransportStopDeleteEligibility,
    TransportStopDeleteReferenceCounts,
    TransportStopPermanentDeleteResult,
    TransportStopDetail,
    TransportStopListItem,
    TransportStopLocationUpdateResult,
    TransportStopRouteUsage,
    TransportStopRouteUsageDetailResponse,
    TransportStopMergePreviewResponse,
    TransportStopMergeReferenceCounts,
    TransportStopMergeGlobalResult,
    TransportStopSearchItem,
    TransportStopSearchResponse,
    TransportInfrastructureLineDetail,
    TransportInfrastructureLineListItem,
    TransportRoutePath,
    TransportTerminalDetail,
    TransportTerminalListItem,
    TransportVariantPathResult,
    TransportVariantStopQualityResponse,
    TransportVariantStopsResponse,
    TransportVariantSummary,
    GeneratePathFromStopsResult,
} from "./transport.types.js";
import { isCircularClosingRouteStop } from "./transport-route-stop-occurrence.js";
import {
    assertSameVariantMergeAcknowledged,
    buildSameVariantMergeWarning,
} from "./stopMergeSameVariant.js";

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
    has_source_link: boolean;
    has_estimate_path: boolean;
    has_verified_path: boolean;
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
    has_source_link: boolean;
    has_geom: boolean;
    has_nearby_duplicate: boolean;
    normalized_data: Record<string, unknown> | null;
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
    route_stop_id: string;
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

type StopRouteUsageDetailRow = {
    route_stop_id: string;
    route_id: string;
    route_code: string;
    route_name: string | null;
    variant_id: string;
    variant_code: string;
    direction_name: string | null;
    direction_id: number | bigint | null;
    stop_sequence: number | bigint;
};

type StopRouteUsageDetailByStopRow = StopRouteUsageDetailRow & {
    stop_internal_id: bigint;
};

type MergePreviewStopRow = {
    id: bigint;
    public_id: string;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    /** SQL casts to float8; still coerce in case a driver returns bigint. */
    admin_area_id: number | bigint | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    longitude: number | null;
    latitude: number | null;
    /** Present when selected; ISO string for merge stale checks. */
    updated_at?: Date | string | null;
};

type MergePreviewReferenceCountsRow = {
    current_route_stops: bigint;
    candidate_route_stops: bigint;
    current_variant_origins: bigint;
    candidate_variant_origins: bigint;
    current_variant_destinations: bigint;
    candidate_variant_destinations: bigint;
    current_terminals: bigint;
    candidate_terminals: bigint;
    current_fares_origin: bigint;
    candidate_fares_origin: bigint;
    current_fares_destination: bigint;
    candidate_fares_destination: bigint;
    current_child_stops: bigint;
    candidate_child_stops: bigint;
    current_stop_names: bigint;
    candidate_stop_names: bigint;
    current_source_links: bigint;
    candidate_source_links: bigint;
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
    normalized_data: Record<string, unknown> | null;
    variant_count: bigint;
    stop_count: bigint;
    path_count: bigint;
    source_links_count: bigint;
    stops_missing_geom: boolean;
    has_stop_geometry_review_flag: boolean;
    sequence_incomplete: boolean;
};

type RouteMetadataVariantQueryRow = {
    headsign: string | null;
    destination_name: string | null;
    estimated_duration_min: number | null;
    stop_count: bigint;
    normalized_data: Record<string, unknown> | null;
};

type RouteMetadataStopNameRow = {
    name_mm: string | null;
    name_en: string | null;
    name: string;
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
    departure_time_text: string | null;
};

type RouteStopRow = {
    id: bigint;
    stop_sequence: number;
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
    distance_from_start_m: number | null;
    source_time_text: string | null;
    source_time_type: string | null;
    travel_time_from_previous_seconds: number | null;
    waiting_time_seconds: number | null;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
    stop_public_id: string;
    stop_name: string;
    stop_name_mm: string | null;
    stop_name_en: string | null;
    stop_mode: string;
    stop_type: string;
    geometry: unknown;
    has_review_geom?: boolean;
};

type RoutePathRow = {
    id?: bigint;
    path_kind: string;
    review_status: string | null;
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

type NearbyStopCandidateRow = {
    id: bigint;
    public_id: string;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    review_status: string;
    confidence_score: number | null;
    lat: number;
    lng: number;
    distance_m: number;
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

type QualitySummaryRow = {
    mode: string | null;
    routes: bigint;
    variants: bigint;
    variants_without_stops: bigint;
    variants_without_path: bigint;
    variants_unknown_direction: bigint;
    routes_without_variants: bigint;
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
 * True for a Postgres unique-constraint violation (SQLSTATE 23505), whether it
 * surfaces as a typed Prisma error (P2002) or as a raw-query failure (P2010 with
 * the underlying 23505 in meta/message). Used to map duplicate route_code /
 * variant_code inserts to a clear 409 conflict.
 */
function isUniqueViolation(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
            return true;
        }
        const metaCode = (error.meta as { code?: unknown } | undefined)?.code;
        if (metaCode === "23505") {
            return true;
        }
    }
    return error instanceof Error && /\b23505\b|duplicate key value|unique constraint/i.test(error.message);
}

/** A row to INSERT into transport.route_variants when auto-creating a route's variants. */
type CreateRouteVariantSeed = {
    variant_code: string;
    direction_name: string;
    direction_id: number;
    origin_name: string | null;
    destination_name: string | null;
};

/**
 * Builds the auto-variant seeds for a new route from its create payload, applying
 * the endpoint rules: loop → one LOOP variant; bus/train → outbound + inbound;
 * ferry → outbound, plus inbound only when create_return_variant is set. Inbound
 * variants swap the route origin/destination.
 */
function buildCreateRouteVariantSeeds(
    input: CreateRouteInput,
    originName: string | null,
    destinationName: string | null
): CreateRouteVariantSeed[] {
    const code = input.route_code;

    if (input.is_loop) {
        return [
            {
                variant_code: `${code}-LOOP`,
                direction_name: "loop",
                direction_id: 2,
                origin_name: originName,
                destination_name: destinationName ?? originName,
            },
        ];
    }

    const outbound: CreateRouteVariantSeed = {
        variant_code: `${code}-A`,
        direction_name: "outbound",
        direction_id: 0,
        origin_name: originName,
        destination_name: destinationName,
    };
    const inbound: CreateRouteVariantSeed = {
        variant_code: `${code}-B`,
        direction_name: "inbound",
        direction_id: 1,
        origin_name: destinationName,
        destination_name: originName,
    };

    // Ferries are one-way by default; opt in to the return variant.
    if (input.mode === "ferry") {
        return input.create_return_variant ? [outbound, inbound] : [outbound];
    }
    return [outbound, inbound];
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
        source_time_text: row.source_time_text,
        source_time_type: row.source_time_type,
        travel_time_from_previous_seconds: row.travel_time_from_previous_seconds,
        waiting_time_seconds: row.waiting_time_seconds,
        arrival_offset_seconds: row.arrival_offset_seconds,
        departure_offset_seconds: row.departure_offset_seconds,
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

const ROUTE_STOP_FLAGS_AUDIT_FIELDS = [
    "pickup_type",
    "drop_off_type",
    "is_timing_point",
] as const;

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

type RouteStopTimingAuditRow = {
    id: bigint;
    route_variant_id: bigint;
    travel_time_from_previous_seconds: number | null;
    waiting_time_seconds: number | null;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
};

type VariantTimetableStopRow = {
    id: bigint;
    travel_time_from_previous_seconds: number | null;
    waiting_time_seconds: number | null;
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

type StopDeleteReferenceRow = {
    id: bigint;
    public_id: string;
    review_status: string;
    name: string | null;
    mode: string | null;
    stop_type: string | null;
    route_stops_count: bigint;
    variant_endpoints_count: bigint;
    child_stops_count: bigint;
    linked_terminals_count: bigint;
    route_count: bigint;
};

function stopDeleteReferenceCounts(row: StopDeleteReferenceRow, fares: number): TransportStopDeleteReferenceCounts {
    return {
        route_stops: num(row.route_stops_count),
        variant_endpoints: num(row.variant_endpoints_count),
        child_stops: num(row.child_stops_count),
        linked_terminals: num(row.linked_terminals_count),
        fares,
    };
}

function buildStopDeleteBlockers(
    reviewStatus: string,
    references: TransportStopDeleteReferenceCounts
): TransportStopDeleteBlocker[] {
    const blockers: TransportStopDeleteBlocker[] = [];
    if (reviewStatus === "verified") {
        blockers.push("verified");
    }
    if (reviewStatus === "manual_protected") {
        blockers.push("manual_protected");
    }
    if (references.route_stops > 0) {
        blockers.push("route_stops");
    }
    if (references.variant_endpoints > 0) {
        blockers.push("variant_endpoints");
    }
    if (references.child_stops > 0) {
        blockers.push("child_stops");
    }
    if (references.linked_terminals > 0) {
        blockers.push("linked_terminals");
    }
    if (references.fares > 0) {
        blockers.push("fares");
    }
    return blockers;
}

function buildStopDeleteBlockMessage(
    blockers: TransportStopDeleteBlocker[],
    references: TransportStopDeleteReferenceCounts
): string {
    if (blockers.includes("verified")) {
        return "Verified stops cannot be deleted.";
    }
    if (blockers.includes("manual_protected")) {
        return "Manual-protected stops cannot be deleted.";
    }

    const parts: string[] = [];
    if (blockers.includes("route_stops") || blockers.includes("variant_endpoints")) {
        parts.push("still used by routes");
    }
    if (blockers.includes("child_stops")) {
        parts.push(
            references.child_stops === 1
                ? "has a child stop"
                : `has ${references.child_stops} child stops`
        );
    }
    if (blockers.includes("linked_terminals")) {
        parts.push(
            references.linked_terminals === 1
                ? "linked to a terminal"
                : `linked to ${references.linked_terminals} terminals`
        );
    }
    if (blockers.includes("fares")) {
        parts.push("referenced by fares");
    }

    if (parts.length === 0) {
        return "This stop cannot be deleted.";
    }
    return `Cannot delete: ${parts.join("; ")}.`;
}

function buildStopDeleteEligibility(
    row: StopDeleteReferenceRow,
    fares: number
): TransportStopDeleteEligibility {
    const references = stopDeleteReferenceCounts(row, fares);
    const blockers = buildStopDeleteBlockers(row.review_status, references);
    const routeCount = num(row.route_count);
    const hasRouteUsage =
        references.route_stops > 0 ||
        references.variant_endpoints > 0 ||
        routeCount > 0;

    return {
        can_delete: blockers.length === 0,
        message: blockers.length === 0 ? "This stop can be permanently deleted." : buildStopDeleteBlockMessage(blockers, references),
        has_route_usage: hasRouteUsage,
        route_count: routeCount,
        review_status: row.review_status,
        references,
        blockers,
    };
}

function assertStopDeleteAllowed(eligibility: TransportStopDeleteEligibility): void {
    if (eligibility.can_delete) {
        return;
    }
    throw new TransportStopDeleteBlockedError(
        eligibility.message,
        eligibility.blockers as TransportStopDeleteBlocker[],
        eligibility.has_route_usage,
        eligibility.route_count
    );
}

export class TransportRepository {
    private faresStopColumns: boolean | null = null;
    /** Last merge interactive TX wall time (ms); set when TRANSPORT_PERF_LOG or always for route logs. */
    lastMergeTransactionDurationMs: number | null = null;

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

    /**
     * Per-mode quality counts for the admin triage table. Variants inherit their
     * route's mode. "Unknown direction" = direction_id IS NULL. All counts respect
     * soft deletes (route_stops has no soft delete, matching the overview query).
     */
    async getQualitySummary(): Promise<TransportQualitySummary> {
        await this.assertSchemaAvailable();

        const rows = await this.prisma.$queryRaw<QualitySummaryRow[]>`
            WITH route_modes AS (
                SELECT r.id, r.mode
                FROM transport.routes r
                WHERE r.deleted_at IS NULL
            ),
            variant_data AS (
                SELECT
                    rm.mode,
                    v.direction_id,
                    EXISTS (
                        SELECT 1 FROM transport.route_stops rs
                        WHERE rs.route_variant_id = v.id
                    ) AS has_stops,
                    EXISTS (
                        SELECT 1 FROM transport.route_paths p
                        WHERE p.route_variant_id = v.id AND p.deleted_at IS NULL
                    ) AS has_path
                FROM transport.route_variants v
                JOIN route_modes rm ON rm.id = v.route_id
                WHERE v.deleted_at IS NULL
            ),
            route_counts AS (
                SELECT
                    rm.mode,
                    count(*)::bigint AS routes,
                    count(*) FILTER (
                        WHERE NOT EXISTS (
                            SELECT 1 FROM transport.route_variants v
                            WHERE v.route_id = rm.id AND v.deleted_at IS NULL
                        )
                    )::bigint AS routes_without_variants
                FROM route_modes rm
                GROUP BY rm.mode
            ),
            variant_counts AS (
                SELECT
                    mode,
                    count(*)::bigint AS variants,
                    count(*) FILTER (WHERE NOT has_stops)::bigint AS variants_without_stops,
                    count(*) FILTER (WHERE NOT has_path)::bigint AS variants_without_path,
                    count(*) FILTER (WHERE direction_id IS NULL)::bigint AS variants_unknown_direction
                FROM variant_data
                GROUP BY mode
            )
            SELECT
                rc.mode AS mode,
                rc.routes AS routes,
                COALESCE(vc.variants, 0)::bigint AS variants,
                COALESCE(vc.variants_without_stops, 0)::bigint AS variants_without_stops,
                COALESCE(vc.variants_without_path, 0)::bigint AS variants_without_path,
                COALESCE(vc.variants_unknown_direction, 0)::bigint AS variants_unknown_direction,
                rc.routes_without_variants AS routes_without_variants
            FROM route_counts rc
            LEFT JOIN variant_counts vc ON vc.mode = rc.mode
            ORDER BY rc.mode
        `;

        return {
            items: rows.map((r) => ({
                mode: r.mode ?? "unknown",
                routes: num(r.routes),
                variants: num(r.variants),
                variants_without_stops: num(r.variants_without_stops),
                variants_without_path: num(r.variants_without_path),
                variants_unknown_direction: num(r.variants_unknown_direction),
                routes_without_variants: num(r.routes_without_variants),
            })),
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
        const hasSourceLink = query.hasSourceLink === undefined ? null : query.hasSourceLink;
        const geometryStatus = query.geometryStatus ?? null;
        const publicVisibility = query.publicVisibility ?? null;
        const sourceName = query.sourceName ?? null;
        const sourceKind = query.sourceKind ?? null;
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
                EXISTS (
                    SELECT 1 FROM transport.source_links sl
                    WHERE sl.entity_type = 'route' AND sl.entity_id = r.id
                      AND (${sourceName}::text IS NULL OR sl.source_name = ${sourceName})
                      AND (${sourceKind}::text IS NULL OR sl.source_kind = ${sourceKind})
                ) AS has_source_link,
                EXISTS (
                    SELECT 1 FROM transport.route_variants v
                    JOIN transport.route_paths p ON p.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                      AND (p.path_kind = 'corridor_estimate' OR p.review_status = 'needs_review')
                ) AS has_estimate_path,
                EXISTS (
                    SELECT 1 FROM transport.route_variants v
                    JOIN transport.route_paths p ON p.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                      AND p.review_status = 'verified'
                ) AS has_verified_path,
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
              AND (
                ${hasSourceLink}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.source_links sl
                        WHERE sl.entity_type = 'route' AND sl.entity_id = r.id
                    )
                ) = ${hasSourceLink}
              )
              AND (
                ${publicVisibility}::text IS NULL OR (
                    CASE
                        WHEN r.review_status IN ('reviewed', 'verified') AND r.is_active AND r.deleted_at IS NULL
                        THEN 'visible'
                        ELSE 'hidden'
                    END
                ) = ${publicVisibility}
              )
              AND (
                ${geometryStatus}::text IS NULL OR (
                    CASE
                        WHEN NOT EXISTS (
                            SELECT 1 FROM transport.route_variants v
                            JOIN transport.route_paths p ON p.route_variant_id = v.id
                            WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                        ) THEN 'no_path'
                        WHEN EXISTS (
                            SELECT 1 FROM transport.route_variants v
                            JOIN transport.route_paths p ON p.route_variant_id = v.id
                            WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                              AND p.review_status = 'verified'
                        ) THEN 'verified'
                        WHEN EXISTS (
                            SELECT 1 FROM transport.route_variants v
                            JOIN transport.route_paths p ON p.route_variant_id = v.id
                            WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                              AND (p.path_kind = 'corridor_estimate' OR p.review_status = 'needs_review')
                        ) THEN 'estimate'
                        ELSE 'manual'
                    END
                ) = ${geometryStatus}
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
              AND (
                ${hasSourceLink}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.source_links sl
                        WHERE sl.entity_type = 'route' AND sl.entity_id = r.id
                    )
                ) = ${hasSourceLink}
              )
              AND (
                ${publicVisibility}::text IS NULL OR (
                    CASE
                        WHEN r.review_status IN ('reviewed', 'verified') AND r.is_active AND r.deleted_at IS NULL
                        THEN 'visible'
                        ELSE 'hidden'
                    END
                ) = ${publicVisibility}
              )
              AND (
                ${geometryStatus}::text IS NULL OR (
                    CASE
                        WHEN NOT EXISTS (
                            SELECT 1 FROM transport.route_variants v
                            JOIN transport.route_paths p ON p.route_variant_id = v.id
                            WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                        ) THEN 'no_path'
                        WHEN EXISTS (
                            SELECT 1 FROM transport.route_variants v
                            JOIN transport.route_paths p ON p.route_variant_id = v.id
                            WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                              AND p.review_status = 'verified'
                        ) THEN 'verified'
                        WHEN EXISTS (
                            SELECT 1 FROM transport.route_variants v
                            JOIN transport.route_paths p ON p.route_variant_id = v.id
                            WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL
                              AND (p.path_kind = 'corridor_estimate' OR p.review_status = 'needs_review')
                        ) THEN 'estimate'
                        ELSE 'manual'
                    END
                ) = ${geometryStatus}
              )
        `
        );

        return {
            items: rows.map((row) => {
                const pathCount = num(row.path_count);
                const stopCount = num(row.stop_count);
                const geometry_status = deriveRouteGeometryStatus({
                    path_count: pathCount,
                    has_estimate_path: row.has_estimate_path,
                    has_verified_path: row.has_verified_path,
                });
                const public_visibility = derivePublicVisibility({
                    review_status: row.review_status,
                    is_active: row.is_active,
                });
                let issue_count = 0;
                if (pathCount === 0 && stopCount > 0) issue_count++;
                if (!row.has_source_link) issue_count++;
                if (row.review_status === "imported_unreviewed" || row.review_status === "needs_review") {
                    issue_count++;
                }
                return {
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
                    stop_count: stopCount,
                    path_count: pathCount,
                    has_source_link: row.has_source_link,
                    geometry_status,
                    public_visibility,
                    issue_count,
                    updated_at: row.updated_at.toISOString(),
                };
            }),
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
        const hasSourceLink = query.hasSourceLink === undefined ? null : query.hasSourceLink;
        const geometryStatus = query.geometryStatus ?? null;
        const duplicateStatus = query.duplicateStatus ?? null;
        const adminAreaId = query.adminAreaId ?? null;
        const includeDeleted = query.includeDeleted === true;
        const searchLike = toLikeParam(query.search);
        const duplicateNearbyRadiusM = DUPLICATE_NEARBY_RADIUS_M;
        const duplicateNearbyRadiusDeg = approxExpandDegreesFromMeters(duplicateNearbyRadiusM);

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
              AND (
                ${hasSourceLink}::boolean IS NULL OR (
                    EXISTS (
                        SELECT 1 FROM transport.source_links sl
                        WHERE sl.entity_type = 'stop' AND sl.entity_id = s.id
                    )
                ) = ${hasSourceLink}
              )
              AND (
                ${geometryStatus}::text IS NULL OR (
                    CASE
                        WHEN s.geom IS NULL OR ST_IsEmpty(s.geom) THEN 'missing'
                        WHEN s.review_status = 'verified' THEN 'verified'
                        WHEN s.review_status = 'needs_review'
                          OR coalesce(s.normalized_data->>'needs_geometry_review', 'false') = 'true'
                          OR s.normalized_data->>'geom_source' = 'generated_route_sequence_estimate'
                        THEN 'estimate'
                        ELSE 'manual'
                    END
                ) = ${geometryStatus}
              )
              AND (
                ${duplicateStatus}::text IS NULL OR (
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM transport.stops s2
                            WHERE s2.id <> s.id
                              AND s2.deleted_at IS NULL
                              AND s2.is_active = true
                              AND s.geom IS NOT NULL
                              AND NOT ST_IsEmpty(s.geom)
                              AND s2.geom && ST_Expand(s.geom, ${duplicateNearbyRadiusDeg}::float8)
                              AND ST_DWithin(
                                  s.geom::geography,
                                  s2.geom::geography,
                                  ${duplicateNearbyRadiusM}::float8
                              )
                        ) THEN 'nearby'
                        ELSE 'none'
                    END
                ) = ${duplicateStatus}
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
                    s.normalized_data,
                    (s.geom IS NOT NULL AND NOT ST_IsEmpty(s.geom)) AS has_geom,
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
                p.normalized_data,
                p.has_geom,
                EXISTS (
                    SELECT 1 FROM transport.source_links sl
                    WHERE sl.entity_type = 'stop' AND sl.entity_id = p.id
                ) AS has_source_link,
                EXISTS (
                    SELECT 1
                    FROM transport.stops base
                    JOIN transport.stops s2 ON s2.id <> base.id
                    WHERE base.id = p.id
                      AND base.geom IS NOT NULL
                      AND NOT ST_IsEmpty(base.geom)
                      AND s2.deleted_at IS NULL
                      AND s2.is_active = true
                      AND s2.geom IS NOT NULL
                      AND NOT ST_IsEmpty(s2.geom)
                      AND s2.geom && ST_Expand(base.geom, ${duplicateNearbyRadiusDeg}::float8)
                      AND ST_DWithin(
                          base.geom::geography,
                          s2.geom::geography,
                          ${duplicateNearbyRadiusM}::float8
                      )
                ) AS has_nearby_duplicate,
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
                rows.map((row) => {
                    const geometry_status = deriveStopGeometryStatus({
                        has_geom: row.has_geom,
                        review_status: row.review_status,
                        normalized_data: row.normalized_data,
                    });
                    const duplicate_status = row.has_nearby_duplicate ? "nearby" : "none";
                    return {
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
                        has_source_link: row.has_source_link,
                        geometry_status,
                        duplicate_status,
                        updated_at: row.updated_at.toISOString(),
                    };
                })
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

    /**
     * Reusable Review Map nearby-stop candidate search. One SQL statement returns
     * candidate rows plus route usage counts; it never fetches route usage details
     * per result.
     */
    async listNearbyStopCandidates(
        query: NearbyTransportStopCandidatesQuery
    ): Promise<TransportNearbyStopCandidatesResponse> {
        await this.assertSchemaAvailable();

        const radiusDeg = query.radiusMeters / 90000;
        const selectedName = query.selectedName?.trim().toLowerCase() || null;

        const rows = await this.prisma.$queryRaw<NearbyStopCandidateRow[]>(Prisma.sql`
            WITH candidates AS (
                SELECT
                    s.id,
                    s.public_id,
                    COALESCE(
                        NULLIF(btrim(s.name), ''),
                        NULLIF(btrim(s.name_mm), ''),
                        NULLIF(btrim(s.name_en), ''),
                        'Unnamed ' || replace(s.stop_type, '_', ' ')
                    ) AS name,
                    s.name_mm,
                    s.name_en,
                    s.mode,
                    s.stop_type,
                    s.review_status,
                    s.confidence_score::float8 AS confidence_score,
                    ST_Y(s.geom)::float8 AS lat,
                    ST_X(s.geom)::float8 AS lng,
                    ST_Distance(
                        s.geom::geography,
                        ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography
                    )::float8 AS distance_m
                FROM transport.stops s
                WHERE s.deleted_at IS NULL
                  AND s.public_id <> ${query.selectedStopId}::uuid
                  AND s.mode = ${query.mode}
                  AND s.geom && ST_Expand(
                      ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326),
                      ${radiusDeg}::float8
                  )
                  AND ST_DWithin(
                      s.geom::geography,
                      ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography,
                      ${query.radiusMeters}::float8
                  )
                ORDER BY
                    ST_Distance(
                        s.geom::geography,
                        ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography
                    ) ASC,
                    CASE
                        WHEN ${selectedName}::text IS NULL THEN 1
                        WHEN lower(COALESCE(NULLIF(btrim(s.name), ''), NULLIF(btrim(s.name_mm), ''), NULLIF(btrim(s.name_en), ''))) = ${selectedName}::text THEN 0
                        ELSE 1
                    END ASC,
                    s.id ASC
                LIMIT ${query.limit}
            )
            SELECT
                c.id,
                c.public_id::text AS public_id,
                c.name,
                c.name_mm,
                c.name_en,
                c.mode,
                c.stop_type,
                c.review_status,
                c.confidence_score,
                c.lat,
                c.lng,
                c.distance_m
            FROM candidates c
            ORDER BY c.distance_m ASC, c.id ASC
        `);

        return {
            items: rows.map((row) => ({
                id: String(row.id),
                publicId: row.public_id,
                name: row.name,
                nameMy: row.name_mm,
                nameEn: row.name_en,
                mode: row.mode,
                stopType: row.stop_type,
                reviewStatus: row.review_status,
                confidenceScore: row.confidence_score,
                lat: row.lat,
                lng: row.lng,
                distanceMeters: row.distance_m,
            })),
            radiusMeters: query.radiusMeters,
            limit: query.limit,
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
                rs.id::text AS route_stop_id,
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
                route_stop_id: row.route_stop_id,
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

    /**
     * Canonical route membership rows for one or more stops. Matches
     * {@link listRoutesForStop}: non-deleted routes and variants only (no is_active filter).
     */
    private async fetchRouteUsageDetailRowsForStopIds(
        stopIds: readonly bigint[],
    ): Promise<StopRouteUsageDetailByStopRow[]> {
        if (stopIds.length === 0) {
            return [];
        }

        return this.prisma.$queryRaw<StopRouteUsageDetailByStopRow[]>`
            SELECT
                rs.stop_id AS stop_internal_id,
                rs.id::text AS route_stop_id,
                r.public_id::text AS route_id,
                r.route_code,
                COALESCE(r.public_name, r.route_code) AS route_name,
                v.public_id::text AS variant_id,
                v.variant_code,
                v.direction_name,
                v.direction_id::int AS direction_id,
                rs.stop_sequence::int AS stop_sequence
            FROM transport.route_stops rs
            JOIN transport.route_variants v
                ON v.id = rs.route_variant_id
                AND v.deleted_at IS NULL
            JOIN transport.routes r
                ON r.id = v.route_id
                AND r.deleted_at IS NULL
            WHERE rs.stop_id IN (${Prisma.join(stopIds)})
            ORDER BY rs.stop_id, r.route_code ASC, v.variant_code ASC, rs.stop_sequence ASC
        `;
    }

    /**
     * All non-deleted route memberships for one stop plus a direction summary. Uses the
     * indexed route_stops.stop_id lookup; one SQL round-trip (no N+1).
     */
    async getStopRouteUsageDetail(publicId: string): Promise<TransportStopRouteUsageDetailResponse> {
        await this.assertSchemaAvailable();
        const stopId = await this.getStopIdByPublicId(publicId);
        const rows = await this.fetchRouteUsageDetailRowsForStopIds([stopId]);
        return this.buildRouteUsageDetailFromRows(
            publicId,
            rows.map((row) => ({
                route_stop_id: row.route_stop_id,
                route_id: row.route_id,
                route_code: row.route_code,
                route_name: row.route_name,
                variant_id: row.variant_id,
                variant_code: row.variant_code,
                direction_name: row.direction_name,
                direction_id: row.direction_id,
                stop_sequence: row.stop_sequence,
            })),
        );
    }

    private buildRouteUsageDetailFromRows(
        stopPublicId: string,
        rows: readonly StopRouteUsageDetailRow[],
    ): TransportStopRouteUsageDetailResponse {
        const items = rows.map((row) => ({
            routeStopId: row.route_stop_id,
            routeId: row.route_id,
            routeCode: row.route_code,
            routeName: row.route_name ?? row.route_code,
            variantId: row.variant_id,
            variantCode: row.variant_code,
            directionName: row.direction_name,
            directionId: row.direction_id === null ? null : num(row.direction_id),
            stopSequence: num(row.stop_sequence),
        }));

        const summary = buildStopRouteUsageSummary(
            rows.map((row) => ({
                variantCode: row.variant_code,
                directionName: row.direction_name,
                directionId: row.direction_id === null ? null : num(row.direction_id),
            })),
            rows.map((row) => row.route_id),
            rows.map((row) => row.variant_id),
        );

        return assembleStopRouteUsageDetail(stopPublicId, items, summary);
    }

    private async getStopRouteUsageDetailByStopId(
        stopId: bigint,
    ): Promise<TransportStopRouteUsageDetailResponse> {
        const stopRows = await this.prisma.$queryRaw<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
            FROM transport.stops
            WHERE id = ${stopId}
              AND deleted_at IS NULL
            LIMIT 1
        `;
        const stopPublicId = stopRows[0]?.public_id;
        if (!stopPublicId) {
            throw new TransportNotFoundError("stop", String(stopId));
        }
        return this.getStopRouteUsageDetail(stopPublicId);
    }

    private mapMergePreviewStop(row: MergePreviewStopRow) {
        const updatedAtRaw = row.updated_at;
        const updatedAt =
            updatedAtRaw instanceof Date
                ? updatedAtRaw.toISOString()
                : typeof updatedAtRaw === "string" && updatedAtRaw.trim()
                  ? new Date(updatedAtRaw).toISOString()
                  : null;
        return {
            publicId: row.public_id,
            name: row.name,
            nameMy: row.name_mm,
            nameEn: row.name_en,
            mode: row.mode,
            stopType: row.stop_type,
            adminAreaId: jsonSafeNumber(row.admin_area_id),
            adminAreaName: row.admin_area_name,
            reviewStatus: row.review_status,
            confidenceScore: jsonSafeNumber(row.confidence_score),
            isActive: row.is_active,
            lat: jsonSafeNumber(row.latitude),
            lng: jsonSafeNumber(row.longitude),
            updatedAt,
        };
    }

    private toMergePreviewStopFields(row: MergePreviewStopRow) {
        return {
            name: row.name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            stop_type: row.stop_type,
            admin_area_id: jsonSafeNumber(row.admin_area_id),
            confidence_score: jsonSafeNumber(row.confidence_score),
            review_status: row.review_status,
            is_active: row.is_active,
            longitude: jsonSafeNumber(row.longitude),
            latitude: jsonSafeNumber(row.latitude),
        };
    }

    private mapMergePreviewReferenceCounts(
        row: MergePreviewReferenceCountsRow,
        side: "current" | "candidate",
    ): TransportStopMergeReferenceCounts {
        if (side === "current") {
            return {
                routeStops: num(row.current_route_stops),
                variantOrigins: num(row.current_variant_origins),
                variantDestinations: num(row.current_variant_destinations),
                terminals: num(row.current_terminals),
                faresOrigin: num(row.current_fares_origin),
                faresDestination: num(row.current_fares_destination),
                childStops: num(row.current_child_stops),
                stopNames: num(row.current_stop_names),
                sourceLinks: num(row.current_source_links),
            };
        }

        return {
            routeStops: num(row.candidate_route_stops),
            variantOrigins: num(row.candidate_variant_origins),
            variantDestinations: num(row.candidate_variant_destinations),
            terminals: num(row.candidate_terminals),
            faresOrigin: num(row.candidate_fares_origin),
            faresDestination: num(row.candidate_fares_destination),
            childStops: num(row.candidate_child_stops),
            stopNames: num(row.candidate_stop_names),
            sourceLinks: num(row.candidate_source_links),
        };
    }

    private async loadMergePreviewReferenceCounts(
        currentStopId: bigint,
        candidateStopId: bigint,
    ): Promise<{
        current: TransportStopMergeReferenceCounts;
        candidate: TransportStopMergeReferenceCounts;
    }> {
        const hasFares = await this.resolveFaresStopColumns(this.prisma);
        const faresOrigin = (stopId: bigint) =>
            hasFares
                ? Prisma.sql`(SELECT count(*)::bigint FROM transport.fares WHERE origin_stop_id = ${stopId})`
                : Prisma.sql`0::bigint`;
        const faresDestination = (stopId: bigint) =>
            hasFares
                ? Prisma.sql`(SELECT count(*)::bigint FROM transport.fares WHERE destination_stop_id = ${stopId})`
                : Prisma.sql`0::bigint`;

        const rows = await this.prisma.$queryRaw<MergePreviewReferenceCountsRow[]>`
            SELECT
                (SELECT count(*)::bigint FROM transport.route_stops WHERE stop_id = ${currentStopId}) AS current_route_stops,
                (SELECT count(*)::bigint FROM transport.route_stops WHERE stop_id = ${candidateStopId}) AS candidate_route_stops,
                (SELECT count(*)::bigint FROM transport.route_variants WHERE deleted_at IS NULL AND origin_stop_id = ${currentStopId}) AS current_variant_origins,
                (SELECT count(*)::bigint FROM transport.route_variants WHERE deleted_at IS NULL AND origin_stop_id = ${candidateStopId}) AS candidate_variant_origins,
                (SELECT count(*)::bigint FROM transport.route_variants WHERE deleted_at IS NULL AND destination_stop_id = ${currentStopId}) AS current_variant_destinations,
                (SELECT count(*)::bigint FROM transport.route_variants WHERE deleted_at IS NULL AND destination_stop_id = ${candidateStopId}) AS candidate_variant_destinations,
                (SELECT count(*)::bigint FROM transport.terminals WHERE deleted_at IS NULL AND linked_stop_id = ${currentStopId}) AS current_terminals,
                (SELECT count(*)::bigint FROM transport.terminals WHERE deleted_at IS NULL AND linked_stop_id = ${candidateStopId}) AS candidate_terminals,
                ${faresOrigin(currentStopId)} AS current_fares_origin,
                ${faresOrigin(candidateStopId)} AS candidate_fares_origin,
                ${faresDestination(currentStopId)} AS current_fares_destination,
                ${faresDestination(candidateStopId)} AS candidate_fares_destination,
                (SELECT count(*)::bigint FROM transport.stops WHERE deleted_at IS NULL AND parent_stop_id = ${currentStopId}) AS current_child_stops,
                (SELECT count(*)::bigint FROM transport.stops WHERE deleted_at IS NULL AND parent_stop_id = ${candidateStopId}) AS candidate_child_stops,
                (SELECT count(*)::bigint FROM transport.stop_names WHERE stop_id = ${currentStopId}) AS current_stop_names,
                (SELECT count(*)::bigint FROM transport.stop_names WHERE stop_id = ${candidateStopId}) AS candidate_stop_names,
                (SELECT count(*)::bigint FROM transport.source_links WHERE entity_type = 'stop' AND entity_id = ${currentStopId}) AS current_source_links,
                (SELECT count(*)::bigint FROM transport.source_links WHERE entity_type = 'stop' AND entity_id = ${candidateStopId}) AS candidate_source_links
        `;

        const row = rows[0];
        return {
            current: this.mapMergePreviewReferenceCounts(row, "current"),
            candidate: this.mapMergePreviewReferenceCounts(row, "candidate"),
        };
    }

    private async countSingleStopReferences(
        client: { $queryRaw: PrismaClient["$queryRaw"] },
        stopId: bigint,
    ): Promise<TransportStopMergeReferenceCounts> {
        const hasFares = await this.resolveFaresStopColumns(client);
        const faresOrigin = hasFares
            ? Prisma.sql`(SELECT count(*)::bigint FROM transport.fares WHERE origin_stop_id = ${stopId})`
            : Prisma.sql`0::bigint`;
        const faresDestination = hasFares
            ? Prisma.sql`(SELECT count(*)::bigint FROM transport.fares WHERE destination_stop_id = ${stopId})`
            : Prisma.sql`0::bigint`;

        const rows = await client.$queryRaw<
            {
                route_stops: bigint;
                variant_origins: bigint;
                variant_destinations: bigint;
                terminals: bigint;
                fares_origin: bigint;
                fares_destination: bigint;
                child_stops: bigint;
                stop_names: bigint;
                source_links: bigint;
            }[]
        >`
            SELECT
                (SELECT count(*)::bigint FROM transport.route_stops WHERE stop_id = ${stopId}) AS route_stops,
                (SELECT count(*)::bigint FROM transport.route_variants WHERE deleted_at IS NULL AND origin_stop_id = ${stopId}) AS variant_origins,
                (SELECT count(*)::bigint FROM transport.route_variants WHERE deleted_at IS NULL AND destination_stop_id = ${stopId}) AS variant_destinations,
                (SELECT count(*)::bigint FROM transport.terminals WHERE deleted_at IS NULL AND linked_stop_id = ${stopId}) AS terminals,
                ${faresOrigin} AS fares_origin,
                ${faresDestination} AS fares_destination,
                (SELECT count(*)::bigint FROM transport.stops WHERE deleted_at IS NULL AND parent_stop_id = ${stopId}) AS child_stops,
                (SELECT count(*)::bigint FROM transport.stop_names WHERE stop_id = ${stopId}) AS stop_names,
                (SELECT count(*)::bigint FROM transport.source_links WHERE entity_type = 'stop' AND entity_id = ${stopId}) AS source_links
        `;

        const row = rows[0];
        return {
            routeStops: num(row?.route_stops),
            variantOrigins: num(row?.variant_origins),
            variantDestinations: num(row?.variant_destinations),
            terminals: num(row?.terminals),
            faresOrigin: num(row?.fares_origin),
            faresDestination: num(row?.fares_destination),
            childStops: num(row?.child_stops),
            stopNames: num(row?.stop_names),
            sourceLinks: num(row?.source_links),
        };
    }

    private async loadMergePreviewStopRow(
        client: { $queryRaw: PrismaClient["$queryRaw"] },
        publicId: string,
    ): Promise<MergePreviewStopRow | null> {
        const rows = await client.$queryRaw<MergePreviewStopRow[]>`
            SELECT
                s.id,
                s.public_id::text AS public_id,
                s.name,
                COALESCE(sn_mm.name, s.name_mm) AS name_mm,
                COALESCE(sn_en.name, s.name_en) AS name_en,
                s.mode,
                s.stop_type,
                s.admin_area_id::float8 AS admin_area_id,
                aa.canonical_name AS admin_area_name,
                s.review_status,
                s.confidence_score::float8 AS confidence_score,
                s.is_active,
                ST_X(s.geom)::float8 AS longitude,
                ST_Y(s.geom)::float8 AS latitude,
                s.updated_at
            FROM transport.stops s
            LEFT JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id
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
              AND s.deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    /**
     * Read-only merge preview for two active stops in the same mode. Reports variants
     * where both stop IDs occur (including repeated occurrences) but does not block merge.
     */
    async getStopMergePreview(
        currentStopPublicId: string,
        candidateStopPublicId: string,
    ): Promise<TransportStopMergePreviewResponse> {
        const routeIdsForLog: string[] = [];
        const variantIdsForLog: string[] = [];

        try {
            await this.assertSchemaAvailable();

            const stopRows = await this.prisma.$queryRaw<MergePreviewStopRow[]>`
                SELECT
                    s.id,
                    s.public_id::text AS public_id,
                    s.name,
                    COALESCE(sn_mm.name, s.name_mm) AS name_mm,
                    COALESCE(sn_en.name, s.name_en) AS name_en,
                    s.mode,
                    s.stop_type,
                    s.admin_area_id::float8 AS admin_area_id,
                    aa.canonical_name AS admin_area_name,
                    s.review_status,
                    s.confidence_score::float8 AS confidence_score,
                    s.is_active,
                    ST_X(s.geom)::float8 AS longitude,
                    ST_Y(s.geom)::float8 AS latitude,
                    s.updated_at
                FROM transport.stops s
                LEFT JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id
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
                WHERE s.public_id IN (${currentStopPublicId}::uuid, ${candidateStopPublicId}::uuid)
                  AND s.deleted_at IS NULL
            `;

            const currentRow = stopRows.find((row) => row.public_id === currentStopPublicId);
            const candidateRow = stopRows.find((row) => row.public_id === candidateStopPublicId);
            if (!currentRow) {
                throw new TransportNotFoundError("stop", currentStopPublicId);
            }
            if (!candidateRow) {
                throw new TransportNotFoundError("stop", candidateStopPublicId);
            }
            if (currentRow.mode !== candidateRow.mode) {
                throw new TransportReviewGuardError(
                    "MERGE_MODE_MISMATCH",
                    "Both stops must have the same transport mode.",
                );
            }

            const [geomRows, referenceCounts, usageRows, terminalRows] = await Promise.all([
                this.prisma.$queryRaw<{ geom_same: boolean; geom_distance_m: number | null }[]>`
                    SELECT
                        CASE
                            WHEN cur.geom IS NULL AND cand.geom IS NULL THEN true
                            WHEN cur.geom IS NULL OR cand.geom IS NULL THEN false
                            ELSE ST_Equals(cur.geom, cand.geom)
                        END AS geom_same,
                        CASE
                            WHEN cur.geom IS NOT NULL AND cand.geom IS NOT NULL
                            THEN ST_Distance(cur.geom::geography, cand.geom::geography)
                            ELSE NULL
                        END::float8 AS geom_distance_m
                    FROM transport.stops cur
                    JOIN transport.stops cand ON cand.id = ${candidateRow.id}
                    WHERE cur.id = ${currentRow.id}
                `,
                this.loadMergePreviewReferenceCounts(currentRow.id, candidateRow.id),
                this.fetchRouteUsageDetailRowsForStopIds([currentRow.id, candidateRow.id]),
                this.prisma.$queryRaw<MergePreviewTerminalRow[]>`
                    SELECT
                        id,
                        public_id::text AS public_id,
                        linked_stop_id,
                        name
                    FROM transport.terminals
                    WHERE deleted_at IS NULL
                      AND linked_stop_id IN (${currentRow.id}, ${candidateRow.id})
                `,
            ]);

            const geom = geomRows[0];
            const toMembership = (row: StopRouteUsageDetailByStopRow): MergePreviewUsageMembership => ({
                routeId: row.route_id,
                routeCode: row.route_code,
                routeName: row.route_name ?? row.route_code,
                variantId: row.variant_id,
                variantCode: row.variant_code,
                directionName: row.direction_name,
                routeStopId: row.route_stop_id,
                stopSequence: num(row.stop_sequence),
            });

            const currentUsageRows = usageRows
                .filter((row) => row.stop_internal_id === currentRow.id)
                .map((row) => ({
                    route_stop_id: row.route_stop_id,
                    route_id: row.route_id,
                    route_code: row.route_code,
                    route_name: row.route_name ?? row.route_code,
                    variant_id: row.variant_id,
                    variant_code: row.variant_code,
                    direction_name: row.direction_name,
                    direction_id: row.direction_id === null ? null : num(row.direction_id),
                    stop_sequence: num(row.stop_sequence),
                }));
            const candidateUsageRows = usageRows
                .filter((row) => row.stop_internal_id === candidateRow.id)
                .map((row) => ({
                    route_stop_id: row.route_stop_id,
                    route_id: row.route_id,
                    route_code: row.route_code,
                    route_name: row.route_name ?? row.route_code,
                    variant_id: row.variant_id,
                    variant_code: row.variant_code,
                    direction_name: row.direction_name,
                    direction_id: row.direction_id === null ? null : num(row.direction_id),
                    stop_sequence: num(row.stop_sequence),
                }));

            const currentMemberships = usageRows
                .filter((row) => row.stop_internal_id === currentRow.id)
                .map(toMembership);
            const candidateMemberships = usageRows
                .filter((row) => row.stop_internal_id === candidateRow.id)
                .map(toMembership);

            const conflictAnalysis = buildStopMergeConflictAnalysis(
                currentMemberships,
                candidateMemberships,
            );
            routeIdsForLog.push(...conflictAnalysis.affectedRoutes.map((row) => row.routeId));
            variantIdsForLog.push(...conflictAnalysis.affectedVariants.map((row) => row.variantId));

            const fieldComparison = buildStopMergeFieldComparison(
                this.toMergePreviewStopFields(currentRow),
                this.toMergePreviewStopFields(candidateRow),
                geom?.geom_same ?? false,
                jsonSafeNumber(geom?.geom_distance_m ?? null),
            );

            const sameVariantConflicts = conflictAnalysis.duplicateMembershipConflicts.map((row) => ({
                routeCode: row.routeCode,
                variantCode: row.variantCode,
                directionName: row.directionName,
                currentRouteStopId: row.currentRouteStopId,
                currentSequence: row.currentSequence,
                candidateRouteStopId: row.candidateRouteStopId,
                candidateSequence: row.candidateSequence,
            }));

            // Preview field names follow PART 6: current → canonicalTerminal, candidate → duplicateTerminal.
            const terminalConflict = buildStopMergeTerminalConflict(
                currentRow.id,
                candidateRow.id,
                terminalRows,
            );
            const mergeBlockers = [...conflictAnalysis.mergeBlockers];
            if (terminalConflict.exists) {
                mergeBlockers.push(MERGE_TERMINAL_CONFLICT_BLOCKER);
            }
            const mergeAllowed = mergeBlockers.length === 0;

            const preview: TransportStopMergePreviewResponse = {
                currentStop: this.mapMergePreviewStop(currentRow),
                candidateStop: this.mapMergePreviewStop(candidateRow),
                currentUsage: this.buildRouteUsageDetailFromRows(
                    currentRow.public_id,
                    currentUsageRows,
                ),
                candidateUsage: this.buildRouteUsageDetailFromRows(
                    candidateRow.public_id,
                    candidateUsageRows,
                ),
                sameVariantConflicts,
                sameVariantWarning: buildSameVariantMergeWarning(sameVariantConflicts.length),
                affectedRoutes: conflictAnalysis.affectedRoutes,
                affectedVariants: conflictAnalysis.affectedVariants,
                duplicateMembershipConflicts: conflictAnalysis.duplicateMembershipConflicts,
                sequenceConflicts: conflictAnalysis.sequenceConflicts,
                mergeAllowed,
                mergeBlockers,
                terminalConflict,
                referenceCounts,
                fieldComparison,
            };

            // Guard against residual bigint leakage before Fastify JSON serialization.
            JSON.stringify(preview);

            return preview;
        } catch (error) {
            if (
                error instanceof TransportNotFoundError ||
                error instanceof TransportReviewGuardError ||
                error instanceof TransportSchemaUnavailableError ||
                error instanceof TransportMergePreviewFailedError
            ) {
                throw error;
            }

            throw new TransportMergePreviewFailedError(
                "Failed to build stop merge preview.",
                {
                    currentStopId: currentStopPublicId,
                    candidateStopId: candidateStopPublicId,
                    routeIds: routeIdsForLog,
                    variantIds: variantIdsForLog,
                    sqlErrorCode: extractSqlErrorCode(error),
                },
                { cause: error },
            );
        }
    }

    private toMergeFieldSnapshot(row: MergePreviewStopRow): StopMergeFieldStopSnapshot {
        const fields = this.toMergePreviewStopFields(row);
        return {
            name: fields.name,
            name_mm: fields.name_mm,
            name_en: fields.name_en,
            stop_type: fields.stop_type,
            admin_area_id: fields.admin_area_id,
            confidence_score: fields.confidence_score,
            review_status: fields.review_status,
            is_active: fields.is_active,
            longitude: fields.longitude,
            latitude: fields.latitude,
        };
    }

    private async applyMergeFieldSourcesToCanonical(
        tx: Prisma.TransactionClient,
        params: {
            readonly canonicalId: bigint;
            readonly canonicalPublicId: string;
            readonly currentRow: MergePreviewStopRow;
            readonly candidateRow: MergePreviewStopRow;
            readonly fieldSources: StopMergeFieldSources;
            readonly audit?: TransportAuditContext;
        },
    ): Promise<void> {
        const current = this.toMergeFieldSnapshot(params.currentRow);
        const candidate = this.toMergeFieldSnapshot(params.candidateRow);
        const canonicalBefore = this.toMergeFieldSnapshot(params.currentRow.public_id === params.canonicalPublicId
            ? params.currentRow
            : params.candidateRow);
        const sets: Prisma.Sql[] = [];
        let effectiveMm: string | null | undefined;
        let effectiveEn: string | null | undefined;
        let derivedName: string | null | undefined;

        const applyField = (field: StopMergeFieldKey) => {
            const source = params.fieldSources[field];
            if (!source) {
                return;
            }
            return resolveMergeFieldValue(field, source, current, candidate);
        };

        if (params.fieldSources.name_mm) {
            effectiveMm = applyField("name_mm") as string | null;
            await this.upsertLocalizedStopName(tx, params.canonicalId, "my", effectiveMm);
        }
        if (params.fieldSources.name_en) {
            effectiveEn = applyField("name_en") as string | null;
            await this.upsertLocalizedStopName(tx, params.canonicalId, "en", effectiveEn);
        }
        if (params.fieldSources.name_mm || params.fieldSources.name_en) {
            if (effectiveMm === undefined) {
                effectiveMm = canonicalBefore.name_mm;
            }
            if (effectiveEn === undefined) {
                effectiveEn = canonicalBefore.name_en;
            }
            derivedName = effectiveMm ?? effectiveEn;
            sets.push(Prisma.sql`name_mm = ${effectiveMm}`);
            sets.push(Prisma.sql`name_en = ${effectiveEn}`);
            sets.push(Prisma.sql`name = ${derivedName}`);
        } else if (params.fieldSources.name) {
            const nameValue = applyField("name") as string;
            sets.push(Prisma.sql`name = ${nameValue}`);
        }

        if (params.fieldSources.stop_type) {
            sets.push(Prisma.sql`stop_type = ${applyField("stop_type") as string}`);
        }
        if (params.fieldSources.admin_area_id) {
            const adminAreaId = applyField("admin_area_id") as number | null;
            if (adminAreaId !== null) {
                await this.assertReferenceExists(
                    tx,
                    "admin_area_id",
                    adminAreaId,
                    params.canonicalId,
                );
            }
            sets.push(Prisma.sql`admin_area_id = ${adminAreaId}`);
        }
        if (params.fieldSources.confidence_score) {
            sets.push(
                Prisma.sql`confidence_score = ${applyField("confidence_score") as number | null}`,
            );
        }
        if (params.fieldSources.review_status) {
            sets.push(Prisma.sql`review_status = ${applyField("review_status") as string}`);
        }
        if (params.fieldSources.is_active) {
            sets.push(Prisma.sql`is_active = ${applyField("is_active") as boolean}`);
        }
        if (params.fieldSources.geom) {
            const point = applyField("geom") as { longitude: number; latitude: number } | null;
            if (point) {
                sets.push(
                    Prisma.sql`geom = ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)`,
                );
            } else {
                sets.push(Prisma.sql`geom = NULL`);
            }
        }

        if (sets.length === 0) {
            return;
        }

        await tx.$executeRaw(Prisma.sql`
            UPDATE transport.stops
            SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
            WHERE id = ${params.canonicalId}
        `);

        const syncName =
            params.fieldSources.name !== undefined ||
            params.fieldSources.name_mm !== undefined ||
            params.fieldSources.name_en !== undefined;
        const syncPoint = params.fieldSources.geom !== undefined;
        if (syncName || syncPoint) {
            const canonicalRow = await this.loadMergePreviewStopRow(tx, params.canonicalPublicId);
            if (canonicalRow) {
                await this.syncLinkedTerminalsFromStop(tx, {
                    stopId: params.canonicalId,
                    stopPublicId: params.canonicalPublicId,
                    name: syncName ? canonicalRow.name : undefined,
                    nameMm: syncName ? canonicalRow.name_mm : undefined,
                    nameEn: syncName ? canonicalRow.name_en : undefined,
                    point:
                        syncPoint &&
                        canonicalRow.longitude !== null &&
                        canonicalRow.latitude !== null
                            ? {
                                  longitude: canonicalRow.longitude,
                                  latitude: canonicalRow.latitude,
                              }
                            : undefined,
                    audit: params.audit,
                });
            }
        }
    }

    /**
     * Global keep-canonical merge: optionally apply selected field values, repoint all
     * duplicate references, preserve non-conflicting names/source links, verify zero
     * duplicate references, then hard-delete the duplicate stop.
     */
    async mergeStopsKeepCanonical(
        canonicalStopPublicId: string,
        duplicateStopPublicId: string,
        options: {
            readonly currentStopPublicId: string;
            readonly candidateStopPublicId: string;
            readonly fieldSources?: StopMergeFieldSources;
            readonly acknowledgeSameVariantOccurrences?: boolean;
            readonly canonicalUpdatedAt?: string;
            readonly duplicateUpdatedAt?: string;
            readonly audit?: TransportAuditContext;
            readonly reason?: string;
        },
    ): Promise<TransportStopMergeGlobalResult> {
        await this.assertSchemaAvailable();

        const trimmedReason = typeof options.reason === "string" ? options.reason.trim() : "";

        let stage = "begin_transaction";
        let canonicalNumericId: string | null = null;
        let duplicateNumericId: string | null = null;
        const routeIdsForLog: string[] = [];
        const variantIdsForLog: string[] = [];
        let sameVariantConflictCount = 0;
        const mergePerf = startPerf("mergeStopsKeepCanonical");
        mergePerf.mark("begin_transaction");

        try {
            const txStarted = performance.now();
            const result = await this.prisma.$transaction(async (tx) => {
            const advanceStage = (name: string) => {
                stage = name;
                mergePerf.mark(name);
            };
            advanceStage("lock_stops");
            const stopRows = await tx.$queryRaw<
                {
                    id: bigint;
                    public_id: string;
                    mode: string;
                    review_status: string;
                    parent_stop_id: bigint | null;
                    updated_at: Date;
                }[]
            >`
                SELECT id, public_id::text, mode, review_status, parent_stop_id, updated_at
                FROM transport.stops
                WHERE public_id IN (${canonicalStopPublicId}::uuid, ${duplicateStopPublicId}::uuid)
                  AND deleted_at IS NULL
                FOR UPDATE
            `;
            const canonical = stopRows.find((row) => row.public_id === canonicalStopPublicId);
            const duplicate = stopRows.find((row) => row.public_id === duplicateStopPublicId);
            if (!canonical) {
                throw new TransportNotFoundError("stop", canonicalStopPublicId);
            }
            if (!duplicate) {
                throw new TransportNotFoundError("stop", duplicateStopPublicId);
            }
            canonicalNumericId = String(canonical.id);
            duplicateNumericId = String(duplicate.id);

            if (options.canonicalUpdatedAt || options.duplicateUpdatedAt) {
                advanceStage("validate_preview_versions");
                const canonicalIso = new Date(canonical.updated_at).toISOString();
                const duplicateIso = new Date(duplicate.updated_at).toISOString();
                if (
                    (options.canonicalUpdatedAt &&
                        new Date(options.canonicalUpdatedAt).toISOString() !== canonicalIso) ||
                    (options.duplicateUpdatedAt &&
                        new Date(options.duplicateUpdatedAt).toISOString() !== duplicateIso)
                ) {
                    throw new TransportMergeStalePreviewError(
                        canonicalStopPublicId,
                        duplicateStopPublicId,
                    );
                }
            }

            if (canonical.mode !== duplicate.mode) {
                throw new TransportReviewGuardError(
                    "MERGE_MODE_MISMATCH",
                    "Both stops must have the same transport mode.",
                );
            }
            if (duplicate.review_status === "manual_protected") {
                throw new TransportReviewGuardError(
                    "MERGE_PROTECTED",
                    "Cannot delete a manual_protected stop during merge.",
                );
            }

            advanceStage("lock_terminals");
            const lockedTerminals = await tx.$queryRaw<
                {
                    id: bigint;
                    public_id: string;
                    linked_stop_id: bigint;
                    name: string | null;
                    review_status: string;
                    is_active: boolean;
                }[]
            >`
                SELECT
                    id,
                    public_id::text AS public_id,
                    linked_stop_id,
                    name,
                    review_status,
                    is_active
                FROM transport.terminals
                WHERE deleted_at IS NULL
                  AND linked_stop_id IN (${canonical.id}, ${duplicate.id})
                FOR UPDATE
            `;
            const canonicalTerminal =
                lockedTerminals.find((row) => row.linked_stop_id === canonical.id) ?? null;
            const duplicateTerminal =
                lockedTerminals.find((row) => row.linked_stop_id === duplicate.id) ?? null;
            if (canonicalTerminal && duplicateTerminal) {
                throw new TransportMergeTerminalConflictError(
                    canonicalStopPublicId,
                    duplicateStopPublicId,
                    String(canonicalTerminal.id),
                    String(duplicateTerminal.id),
                );
            }

            advanceStage("validate_membership_conflicts");
            const membershipRows = await tx.$queryRaw<
                {
                    stop_id: bigint;
                    route_id: string;
                    route_code: string;
                    route_name: string;
                    variant_id: string;
                    variant_code: string;
                    direction_name: string | null;
                    route_stop_id: string;
                    stop_sequence: number;
                }[]
            >`
                SELECT
                    rs.stop_id,
                    r.id::text AS route_id,
                    r.route_code,
                    coalesce(r.public_name, r.route_code) AS route_name,
                    v.id::text AS variant_id,
                    v.variant_code,
                    v.direction_name,
                    rs.id::text AS route_stop_id,
                    rs.stop_sequence
                FROM transport.route_stops rs
                JOIN transport.route_variants v
                    ON v.id = rs.route_variant_id AND v.deleted_at IS NULL
                JOIN transport.routes r
                    ON r.id = v.route_id AND r.deleted_at IS NULL
                WHERE rs.stop_id IN (${canonical.id}, ${duplicate.id})
            `;
            const toMembership = (
                row: (typeof membershipRows)[number],
            ): MergePreviewUsageMembership => ({
                routeId: row.route_id,
                routeCode: row.route_code,
                routeName: row.route_name,
                variantId: row.variant_id,
                variantCode: row.variant_code,
                directionName: row.direction_name,
                routeStopId: row.route_stop_id,
                stopSequence: num(row.stop_sequence),
            });
            const conflictAnalysis = buildStopMergeConflictAnalysis(
                membershipRows
                    .filter((row) => row.stop_id === canonical.id)
                    .map(toMembership),
                membershipRows
                    .filter((row) => row.stop_id === duplicate.id)
                    .map(toMembership),
            );
            for (const row of conflictAnalysis.affectedRoutes) {
                routeIdsForLog.push(row.routeId);
            }
            for (const row of conflictAnalysis.affectedVariants) {
                variantIdsForLog.push(row.variantId);
            }
            if (conflictAnalysis.sequenceConflicts.length > 0) {
                throw new TransportReviewGuardError(
                    "MERGE_SEQUENCE_CONFLICT",
                    "Cannot merge stops that share the same stop_sequence in a variant.",
                    conflictAnalysis.mergeBlockers,
                );
            }
            sameVariantConflictCount = conflictAnalysis.duplicateMembershipConflicts.length;
            assertSameVariantMergeAcknowledged(
                sameVariantConflictCount,
                options.acknowledgeSameVariantOccurrences,
            );

            advanceStage("resolve_canonical_parent");
            let canonicalParentStopId = canonical.parent_stop_id;
            if (canonicalParentStopId === duplicate.id) {
                await tx.$executeRaw`
                    UPDATE transport.stops
                    SET parent_stop_id = NULL, updated_at = now()
                    WHERE id = ${canonical.id}
                      AND deleted_at IS NULL
                `;
                canonicalParentStopId = null;
            }
            await this.assertMergeParentRepointSafe(
                tx,
                canonical.id,
                duplicate.id,
                canonicalParentStopId,
                canonicalStopPublicId,
                duplicateStopPublicId,
            );

            advanceStage("load_duplicate_snapshot");
            const duplicateSnapshotRow = await this.loadMergePreviewStopRow(tx, duplicateStopPublicId);
            if (!duplicateSnapshotRow) {
                throw new TransportNotFoundError("stop", duplicateStopPublicId);
            }

            if (options.fieldSources && Object.keys(options.fieldSources).length > 0) {
                advanceStage("apply_field_sources");
                // Sequential on the same interactive transaction client — parallel
                // queries can starve a connection_limit=1 pool (Prisma P2024).
                const currentRow = await this.loadMergePreviewStopRow(
                    tx,
                    options.currentStopPublicId,
                );
                const candidateRow = await this.loadMergePreviewStopRow(
                    tx,
                    options.candidateStopPublicId,
                );
                if (!currentRow || !candidateRow) {
                    throw new TransportNotFoundError(
                        "stop",
                        !currentRow ? options.currentStopPublicId : options.candidateStopPublicId,
                    );
                }
                await this.applyMergeFieldSourcesToCanonical(tx, {
                    canonicalId: canonical.id,
                    canonicalPublicId: canonicalStopPublicId,
                    currentRow,
                    candidateRow,
                    fieldSources: options.fieldSources,
                    audit: options.audit,
                });
            }

            // Skip full before-counts; RETURNING + one post-repoint verify is enough.
            const canonicalBefore = emptyStopMergeReferenceCounts();
            const duplicateBefore = emptyStopMergeReferenceCounts();
            const referencesChanged = emptyStopMergeReferenceChanges();
            const affectedRouteCodes = new Set<string>();
            const affectedVariantCodes = new Set<string>();
            const sameVariantAcknowledged = sameVariantConflictCount > 0;

            const collectAffected = async (variantIds: readonly bigint[]) => {
                if (variantIds.length === 0) {
                    return;
                }
                const rows = await tx.$queryRaw<{ route_code: string; variant_code: string }[]>`
                    SELECT DISTINCT r.route_code, v.variant_code
                    FROM transport.route_variants v
                    JOIN transport.routes r ON r.id = v.route_id
                    WHERE v.id IN (${Prisma.join(variantIds)})
                `;
                for (const row of rows) {
                    affectedRouteCodes.add(row.route_code);
                    affectedVariantCodes.add(row.variant_code);
                }
            };

            advanceStage("update_route_stops");
            const routeStopRows = await tx.$queryRaw<{ route_variant_id: bigint }[]>`
                UPDATE transport.route_stops
                SET stop_id = ${canonical.id}, updated_at = now()
                WHERE stop_id = ${duplicate.id}
                RETURNING route_variant_id
            `;
            referencesChanged.routeStops = routeStopRows.length;
            await collectAffected(routeStopRows.map((row) => row.route_variant_id));

            advanceStage("update_variant_origins");
            const variantOriginRows = await tx.$queryRaw<{ id: bigint }[]>`
                UPDATE transport.route_variants
                SET origin_stop_id = ${canonical.id}, updated_at = now()
                WHERE deleted_at IS NULL
                  AND origin_stop_id = ${duplicate.id}
                RETURNING id
            `;
            referencesChanged.variantOrigins = variantOriginRows.length;
            await collectAffected(variantOriginRows.map((row) => row.id));

            advanceStage("update_variant_destinations");
            const variantDestinationRows = await tx.$queryRaw<{ id: bigint }[]>`
                UPDATE transport.route_variants
                SET destination_stop_id = ${canonical.id}, updated_at = now()
                WHERE deleted_at IS NULL
                  AND destination_stop_id = ${duplicate.id}
                RETURNING id
            `;
            referencesChanged.variantDestinations = variantDestinationRows.length;
            await collectAffected(variantDestinationRows.map((row) => row.id));

            advanceStage("update_terminals");
            if (duplicateTerminal && !canonicalTerminal) {
                const terminalUpdateCount = await tx.$executeRaw`
                    UPDATE transport.terminals
                    SET linked_stop_id = ${canonical.id},
                        updated_at = now()
                    WHERE id = ${duplicateTerminal.id}
                      AND deleted_at IS NULL
                `;
                if (terminalUpdateCount !== 1) {
                    throw new TransportReviewGuardError(
                        "MERGE_INTEGRITY",
                        "Failed to repoint the duplicate stop terminal to the canonical stop.",
                        ["terminal_repoint_failed"],
                    );
                }
                referencesChanged.terminals = 1;
            } else {
                referencesChanged.terminals = 0;
            }

            const hasFares = await this.resolveFaresStopColumns(tx);
            if (hasFares) {
                advanceStage("update_fares_origin");
                const fareOriginRows = await tx.$queryRaw<{ count: bigint }[]>`
                    WITH updated AS (
                        UPDATE transport.fares
                        SET origin_stop_id = ${canonical.id}, updated_at = now()
                        WHERE origin_stop_id = ${duplicate.id}
                        RETURNING id
                    )
                    SELECT count(*)::bigint AS count FROM updated
                `;
                referencesChanged.faresOrigin = num(fareOriginRows[0]?.count);

                advanceStage("update_fares_destination");
                const fareDestinationRows = await tx.$queryRaw<{ count: bigint }[]>`
                    WITH updated AS (
                        UPDATE transport.fares
                        SET destination_stop_id = ${canonical.id}, updated_at = now()
                        WHERE destination_stop_id = ${duplicate.id}
                        RETURNING id
                    )
                    SELECT count(*)::bigint AS count FROM updated
                `;
                referencesChanged.faresDestination = num(fareDestinationRows[0]?.count);
            }

            advanceStage("update_child_stops");
            const childStopRows = await tx.$queryRaw<{ count: bigint }[]>`
                WITH updated AS (
                    UPDATE transport.stops
                    SET parent_stop_id = ${canonical.id}, updated_at = now()
                    WHERE deleted_at IS NULL
                      AND parent_stop_id = ${duplicate.id}
                      AND id <> ${canonical.id}
                    RETURNING id
                )
                SELECT count(*)::bigint AS count FROM updated
            `;
            referencesChanged.childStops = num(childStopRows[0]?.count);

            advanceStage("update_stop_names");
            const stopNameRows = await tx.$queryRaw<{ count: bigint }[]>`
                WITH updated AS (
                    UPDATE transport.stop_names dup
                    SET stop_id = ${canonical.id}, updated_at = now()
                    WHERE dup.stop_id = ${duplicate.id}
                      AND NOT EXISTS (
                        SELECT 1
                        FROM transport.stop_names keep
                        WHERE keep.stop_id = ${canonical.id}
                          AND keep.language_code = dup.language_code
                      )
                    RETURNING dup.id
                )
                SELECT count(*)::bigint AS count FROM updated
            `;
            referencesChanged.stopNames = num(stopNameRows[0]?.count);

            advanceStage("update_source_links");
            const sourceLinkRows = await tx.$queryRaw<{ count: bigint }[]>`
                WITH updated AS (
                    UPDATE transport.source_links sl
                    SET entity_id = ${canonical.id}
                    WHERE sl.entity_type = 'stop'
                      AND sl.entity_id = ${duplicate.id}
                      AND NOT EXISTS (
                        SELECT 1
                        FROM transport.source_links keep
                        WHERE keep.entity_type = 'stop'
                          AND keep.entity_id = ${canonical.id}
                          AND keep.source_name = sl.source_name
                          AND keep.source_kind = sl.source_kind
                          AND (
                            (keep.external_id IS NULL AND sl.external_id IS NULL)
                            OR keep.external_id = sl.external_id
                          )
                      )
                    RETURNING sl.id
                )
                SELECT count(*)::bigint AS count FROM updated
            `;
            referencesChanged.sourceLinks = num(sourceLinkRows[0]?.count);

            advanceStage("delete_leftover_names_links");
            await tx.$executeRaw`
                DELETE FROM transport.stop_names
                WHERE stop_id = ${duplicate.id}
            `;
            await tx.$executeRaw`
                DELETE FROM transport.source_links
                WHERE entity_type = 'stop' AND entity_id = ${duplicate.id}
            `;

            advanceStage("verify_duplicate_references_cleared");
            const duplicateAfter = await this.countSingleStopReferences(tx, duplicate.id);
            if (sumStopMergeReferenceCounts(duplicateAfter) > 0) {
                throw new TransportReviewGuardError(
                    "MERGE_REFERENCES_REMAIN",
                    "Duplicate stop still has references after merge repointing.",
                    ["duplicate_references_remain"],
                );
            }

            advanceStage("hard_delete_duplicate_stop");
            await tx.$executeRaw`
                DELETE FROM transport.stops
                WHERE id = ${duplicate.id}
            `;

            advanceStage("load_canonical_after");
            const canonicalAfter = await this.countSingleStopReferences(tx, canonical.id);
            const canonicalRow = await this.loadMergePreviewStopRow(tx, canonicalStopPublicId);
            if (!canonicalRow) {
                throw new TransportNotFoundError("stop", canonicalStopPublicId);
            }

            advanceStage("insert_audit_log");
            await insertTransportAuditLog(tx, {
                action: "transport.stop.merge",
                entityType: "transport_stop",
                entityId: canonical.id,
                entityPublicId: canonicalStopPublicId,
                changedFields: ["merged_duplicate_stop_id"],
                oldValues: {
                    duplicate_stop_public_id: duplicateStopPublicId,
                },
                newValues: {
                    merged_duplicate_stop_id: duplicateStopPublicId,
                    deleted_duplicate: true,
                },
                metadata: {
                    canonical_stop_public_id: canonicalStopPublicId,
                    duplicate_stop_public_id: duplicateStopPublicId,
                    references_changed: referencesChanged,
                    affected_route_codes: [...affectedRouteCodes],
                    affected_variant_codes: [...affectedVariantCodes],
                    counts: {
                        canonicalBefore,
                        canonicalAfter,
                        duplicateBefore,
                        duplicateAfter,
                    },
                    ...(trimmedReason ? { reason: trimmedReason } : {}),
                    ...(options.fieldSources
                        ? { field_sources: options.fieldSources }
                        : {}),
                    ...(sameVariantAcknowledged
                        ? {
                              same_variant_occurrences_acknowledged: true,
                              same_variant_conflict_count:
                                  sameVariantConflictCount,
                          }
                        : {}),
                },
                context: options.audit,
            });

            advanceStage("build_response");
            return {
                canonicalStop: this.mapMergePreviewStop(canonicalRow),
                deletedStop: this.mapMergePreviewStop(duplicateSnapshotRow),
                deletedStopId: duplicateStopPublicId,
                referencesChanged,
                affectedRouteCodes: [...affectedRouteCodes].sort(),
                affectedVariantCodes: [...affectedVariantCodes].sort(),
                counts: {
                    canonicalBefore,
                    canonicalAfter,
                    duplicateBefore,
                    duplicateAfter,
                },
            };
        }, ROUTE_STOP_TX_OPTIONS);
            this.lastMergeTransactionDurationMs = Number(
                (performance.now() - txStarted).toFixed(1),
            );
            mergePerf.mark("commit");
            mergePerf.done();
            return result;
        } catch (error) {
            if (
                error instanceof TransportReviewGuardError ||
                error instanceof TransportNotFoundError ||
                error instanceof TransportInvalidReferenceError ||
                error instanceof TransportMergeTerminalConflictError ||
                error instanceof TransportMergeParentConflictError ||
                error instanceof TransportMergeStalePreviewError ||
                error instanceof TransportMergeExecutionFailedError
            ) {
                throw error;
            }
            const constraint = extractConstraintMeta(error);
            throw new TransportMergeExecutionFailedError(
                "Stop merge failed due to an unexpected database or serialization error.",
                {
                    requestId: options.audit?.requestId ?? null,
                    currentStopId: options.currentStopPublicId,
                    candidateStopId: options.candidateStopPublicId,
                    canonicalStopId: canonicalStopPublicId,
                    duplicateStopId: duplicateStopPublicId,
                    canonicalNumericId,
                    duplicateNumericId,
                    stage,
                    routeIds: routeIdsForLog,
                    variantIds: variantIdsForLog,
                    sameVariantConflictCount,
                    prismaCode: extractPrismaErrorCode(error),
                    sqlErrorCode: extractSqlErrorCode(error),
                    constraintName: constraint.constraintName,
                    tableName: constraint.tableName,
                },
                { cause: error },
            );
        }
    }

    /**
     * Rejects merges that would create a parent_stop_id cycle after children of the
     * duplicate are repointed to the canonical stop.
     */
    private async assertMergeParentRepointSafe(
        tx: Prisma.TransactionClient,
        canonicalId: bigint,
        duplicateId: bigint,
        canonicalParentStopId: bigint | null,
        canonicalStopPublicId: string,
        duplicateStopPublicId: string,
    ): Promise<void> {
        const ancestors = new Set<bigint>();
        let cursor = canonicalParentStopId;
        const visited = new Set<bigint>([canonicalId]);

        while (cursor !== null) {
            if (visited.has(cursor)) {
                throw new TransportMergeParentConflictError(
                    canonicalStopPublicId,
                    duplicateStopPublicId,
                );
            }
            if (cursor === duplicateId) {
                throw new TransportMergeParentConflictError(
                    canonicalStopPublicId,
                    duplicateStopPublicId,
                );
            }
            visited.add(cursor);
            ancestors.add(cursor);
            const parentRows = await tx.$queryRaw<{ parent_stop_id: bigint | null }[]>`
                SELECT parent_stop_id
                FROM transport.stops
                WHERE id = ${cursor}
                  AND deleted_at IS NULL
                LIMIT 1
            `;
            cursor = parentRows[0]?.parent_stop_id ?? null;
        }

        const childRows = await tx.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM transport.stops
            WHERE deleted_at IS NULL
              AND parent_stop_id = ${duplicateId}
              AND id <> ${canonicalId}
        `;
        for (const child of childRows) {
            if (ancestors.has(child.id)) {
                throw new TransportMergeParentConflictError(
                    canonicalStopPublicId,
                    duplicateStopPublicId,
                );
            }
        }
    }

    /**
     * Confirms an FK target row exists; throws {@link TransportInvalidReferenceError} otherwise.
     * Callers inside an interactive transaction MUST pass that transaction client so the
     * lookup reuses the held connection (avoids Prisma P2024 with connection_limit=1).
     */
    private async assertReferenceExists(
        client: Pick<Prisma.TransactionClient, "$queryRaw">,
        field: "admin_area_id" | "parent_stop_id",
        id: number,
        currentStopId: bigint
    ): Promise<void> {
        if (field === "admin_area_id") {
            const rows = await client.$queryRaw<{ ok: number }[]>`
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
        const rows = await client.$queryRaw<{ ok: number }[]>`
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
            await this.assertReferenceExists(this.prisma, "admin_area_id", input.admin_area_id, stopId);
        }
        if (input.parent_stop_id !== undefined && input.parent_stop_id !== null) {
            await this.assertReferenceExists(this.prisma, "parent_stop_id", input.parent_stop_id, stopId);
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
     * Active, non-deleted stops within `radiusM` of a point, nearest first, with
     * the given stop excluded. GIST(geom) `&&` bbox prefilter (degrees) then exact
     * geography ST_DWithin — the same indexed pattern as stop search. Hard-capped.
     * No mode filter: cross-mode neighbours are useful when spotting a misplaced
     * point, and the row carries `mode` so the caller can judge.
     */
    private async findNearbyStops(params: {
        lng: number;
        lat: number;
        radiusM: number;
        excludeStopId: bigint;
    }): Promise<TransportNearbyStop[]> {
        const radiusDeg = params.radiusM / 90000;
        const rows = await this.prisma.$queryRaw<
            {
                stop_public_id: string;
                name: string;
                distance_m: number;
                mode: string;
                stop_type: string;
            }[]
        >(Prisma.sql`
            SELECT
                s.public_id::text AS stop_public_id,
                COALESCE(
                    NULLIF(btrim(s.name), ''),
                    NULLIF(btrim(s.name_mm), ''),
                    NULLIF(btrim(s.name_en), ''),
                    'Unnamed ' || replace(s.stop_type, '_', ' ')
                ) AS name,
                ST_Distance(
                    s.geom::geography,
                    ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography
                )::float8 AS distance_m,
                s.mode,
                s.stop_type
            FROM transport.stops s
            WHERE s.deleted_at IS NULL
              AND s.id <> ${params.excludeStopId}
              AND s.geom && ST_Expand(
                  ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326),
                  ${radiusDeg}::float8
              )
              AND ST_DWithin(
                  s.geom::geography,
                  ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography,
                  ${params.radiusM}::float8
              )
            ORDER BY distance_m ASC, s.id ASC
            LIMIT 50
        `);
        return rows.map((row) => ({
            stop_public_id: row.stop_public_id,
            name: row.name,
            distance_m: row.distance_m,
            mode: row.mode,
            stop_type: row.stop_type,
        }));
    }

    /**
     * Preview the stops within `radiusM` of an arbitrary point (self excluded),
     * for duplicate checks before committing a location edit. Validates the stop
     * exists (404) but does not write anything.
     */
    async getNearbyStops(
        publicId: string,
        query: NearbyStopsQuery
    ): Promise<TransportNearbyStop[]> {
        await this.assertSchemaAvailable();
        const stopId = await this.getStopIdByPublicId(publicId);
        return this.findNearbyStops({
            lng: query.lng,
            lat: query.lat,
            radiusM: query.radius_m,
            excludeStopId: stopId,
        });
    }

    /**
     * Focused stop location edit: moves the point and optionally updates
     * review_status / confidence_score. Names, mode, stop_type, admin area, and
     * parent are deliberately left unchanged. Stamps a minimal manual/admin marker
     * into `source_refs` (merge, preserving existing keys), bumps `updated_at`,
     * audits the point move (+ review/confidence diff), and keeps any linked
     * terminals' point in sync. Returns refreshed detail plus the stops within the
     * 30 m duplicate-check radius of the SAVED location.
     */
    async updateStopLocation(
        publicId: string,
        input: UpdateStopLocationInput,
        audit?: TransportAuditContext
    ): Promise<TransportStopLocationUpdateResult> {
        await this.assertSchemaAvailable();

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<
                {
                    id: bigint;
                    review_status: string;
                    confidence_score: number | null;
                    point_lng: number | null;
                    point_lat: number | null;
                }[]
            >`
                SELECT id, review_status, confidence_score::float8 AS confidence_score,
                       ST_X(geom)::float8 AS point_lng, ST_Y(geom)::float8 AS point_lat
                FROM transport.stops
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("stop", publicId);
            }

            const sets: Prisma.Sql[] = [
                Prisma.sql`geom = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)`,
                // Minimal manual/admin marker; merge so existing source_refs keys survive.
                Prisma.sql`source_refs = COALESCE(source_refs, '{}'::jsonb) || jsonb_build_object('location_edited_via', 'manual', 'location_edited_by', 'admin_dashboard')`,
            ];
            if (input.review_status !== undefined) {
                sets.push(Prisma.sql`review_status = ${input.review_status}`);
            }
            if (input.confidence_score !== undefined) {
                sets.push(Prisma.sql`confidence_score = ${input.confidence_score}`);
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.stops
                SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
            `);

            // Manual location edits update the canonical stop point. Clear per-variant
            // review_geom placeholders so reads prefer transport.stops.geom.
            await tx.$executeRaw(Prisma.sql`
                UPDATE transport.route_stops
                SET review_geom = NULL, updated_at = now()
                WHERE stop_id = ${before.id} AND review_geom IS NOT NULL
            `);

            const diff = diffScalarFields(before, input, ["review_status", "confidence_score"]);
            appendPointDiff(
                diff,
                { lat: before.point_lat, lng: before.point_lng },
                { latitude: input.lat, longitude: input.lng }
            );
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

            await this.syncLinkedTerminalsFromStop(tx, {
                stopId: before.id,
                stopPublicId: publicId,
                point: { longitude: input.lng, latitude: input.lat },
                audit,
            });
        });

        const stop = await this.getStopByPublicId(publicId);
        const stopId = await this.getStopIdByPublicId(publicId);
        const nearbyStops = await this.findNearbyStops({
            lng: input.lng,
            lat: input.lat,
            radiusM: 30,
            excludeStopId: stopId,
        });
        return { stop, nearby_stops: nearbyStops };
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

    /**
     * Creates a route plus its default variants in a single transaction.
     *
     * The route is server-stamped (review_status = needs_review, confidence 60,
     * is_active = true, manual/admin source_refs) and `route_kind` comes from the
     * mode config. Variants are generated from `route_code` per the create rules:
     *   - is_loop: one `${code}-LOOP` variant (direction_id 2)
     *   - bus/train: `${code}-A` outbound (0) + `${code}-B` inbound (1)
     *   - ferry: `${code}-A` outbound (0); `${code}-B` inbound (1) only when
     *     create_return_variant is set
     * A pre-check + unique-violation guard map duplicate route_code / variant_code
     * to {@link TransportRouteConflictError}. No hard deletes; audit rows are
     * written inside the transaction. Returns the new route detail + variants.
     */
    async createRoute(
        input: CreateRouteInput,
        audit?: TransportAuditContext
    ): Promise<TransportRouteCreateResult> {
        await this.assertSchemaAvailable();

        const routeKind = getDefaultRouteKind(input.mode);
        const originName = input.origin_name ?? null;
        const destinationName = input.destination_name ?? null;
        const operatorId = input.operator_id ?? null;
        const sourceRefs = JSON.stringify({ created_via: "manual", created_by: "admin_dashboard" });

        const variantSeeds = buildCreateRouteVariantSeeds(input, originName, destinationName);

        const publicId = await this.prisma
            .$transaction(async (tx) => {
                const existing = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id
                    FROM transport.routes
                    WHERE route_code = ${input.route_code} AND deleted_at IS NULL
                    LIMIT 1
                `;
                if (existing.length > 0) {
                    throw new TransportRouteConflictError(
                        `A route with code "${input.route_code}" already exists.`
                    );
                }

                const inserted = await tx.$queryRaw<{ id: bigint; public_id: string }[]>`
                    INSERT INTO transport.routes
                        (operator_id, route_code, public_name, mode, route_kind,
                         origin_name, destination_name, source_refs,
                         confidence_score, review_status, is_active)
                    VALUES
                        (${operatorId}, ${input.route_code}, ${input.public_name}, ${input.mode},
                         ${routeKind}, ${originName}, ${destinationName}, ${sourceRefs}::jsonb,
                         60, 'needs_review', true)
                    RETURNING id, public_id::text AS public_id
                `;
                const route = inserted[0];
                if (!route) {
                    throw new Error("Failed to create transport route");
                }

                if (operatorId !== null) {
                    const operatorRows = await tx.$queryRaw<{ id: bigint }[]>`
                        SELECT id FROM transport.operators WHERE id = ${operatorId} LIMIT 1
                    `;
                    if (operatorRows.length === 0) {
                        throw new TransportInvalidReferenceError("operator_id");
                    }
                }

                await insertTransportAuditLog(tx, {
                    action: "transport.route.create",
                    entityType: "transport_route",
                    entityId: route.id,
                    entityPublicId: route.public_id,
                    changedFields: [
                        "route_code",
                        "public_name",
                        "mode",
                        "route_kind",
                        "origin_name",
                        "destination_name",
                        "operator_id",
                        "review_status",
                        "confidence_score",
                        "is_active",
                    ],
                    oldValues: null,
                    newValues: {
                        route_code: input.route_code,
                        public_name: input.public_name,
                        mode: input.mode,
                        route_kind: routeKind,
                        origin_name: originName,
                        destination_name: destinationName,
                        operator_id: operatorId === null ? null : Number(operatorId),
                        review_status: "needs_review",
                        confidence_score: 60,
                        is_active: true,
                    },
                    metadata: null,
                    context: audit,
                });

                for (const seed of variantSeeds) {
                    const variantRows = await tx.$queryRaw<{ id: bigint; public_id: string }[]>`
                        INSERT INTO transport.route_variants
                            (route_id, variant_code, direction_name, direction_id,
                             origin_name, destination_name, confidence_score,
                             review_status, is_active)
                        VALUES
                            (${route.id}, ${seed.variant_code}, ${seed.direction_name},
                             ${seed.direction_id}, ${seed.origin_name}, ${seed.destination_name},
                             60, 'needs_review', true)
                        RETURNING id, public_id::text AS public_id
                    `;
                    const variant = variantRows[0];
                    if (!variant) {
                        throw new Error("Failed to create transport route variant");
                    }
                    await insertTransportAuditLog(tx, {
                        action: "transport.route_variant.create",
                        entityType: "transport_route_variant",
                        entityId: variant.id,
                        entityPublicId: variant.public_id,
                        changedFields: [
                            "variant_code",
                            "direction_name",
                            "direction_id",
                            "origin_name",
                            "destination_name",
                            "review_status",
                            "confidence_score",
                            "is_active",
                        ],
                        oldValues: null,
                        newValues: {
                            variant_code: seed.variant_code,
                            direction_name: seed.direction_name,
                            direction_id: seed.direction_id,
                            origin_name: seed.origin_name,
                            destination_name: seed.destination_name,
                            review_status: "needs_review",
                            confidence_score: 60,
                            is_active: true,
                        },
                        metadata: { route_public_id: route.public_id },
                        context: audit,
                    });
                }

                return route.public_id;
            })
            .catch((error: unknown) => {
                if (error instanceof TransportRouteConflictError) {
                    throw error;
                }
                if (isUniqueViolation(error)) {
                    throw new TransportRouteConflictError(
                        `A route or variant code derived from "${input.route_code}" already exists.`
                    );
                }
                throw error;
            });

        const [route, variants] = await Promise.all([
            this.getRouteByPublicId(publicId),
            this.listVariantsForRoute(publicId),
        ]);
        return { ...route, variants };
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
                r.normalized_data,
                (SELECT count(*) FROM transport.route_variants v
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL)::bigint AS variant_count,
                (SELECT count(*) FROM transport.route_variants v
                    JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL)::bigint AS stop_count,
                (SELECT count(*) FROM transport.route_variants v
                    JOIN transport.route_paths p ON p.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL AND p.deleted_at IS NULL)::bigint AS path_count,
                (SELECT count(*) FROM transport.source_links sl
                    WHERE sl.entity_type = 'route' AND sl.entity_id = r.id)::bigint AS source_links_count,
                EXISTS (
                    SELECT 1
                    FROM transport.route_stops rs
                    JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
                    JOIN transport.stops s ON s.id = rs.stop_id
                    WHERE rv.route_id = r.id
                      AND rv.deleted_at IS NULL
                      AND s.deleted_at IS NULL
                      AND s.geom IS NULL
                ) AS stops_missing_geom,
                EXISTS (
                    SELECT 1
                    FROM transport.route_stops rs
                    JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
                    JOIN transport.stops s ON s.id = rs.stop_id
                    WHERE rv.route_id = r.id
                      AND rv.deleted_at IS NULL
                      AND s.deleted_at IS NULL
                      AND (
                        coalesce(s.normalized_data->>'needs_geometry_review', 'false') = 'true'
                        OR s.normalized_data->>'geom_source' = 'generated_route_sequence_estimate'
                      )
                ) AS has_stop_geometry_review_flag,
                EXISTS (
                    SELECT 1
                    FROM transport.route_variants v
                    LEFT JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                    WHERE v.route_id = r.id AND v.deleted_at IS NULL
                    GROUP BY v.id, v.normalized_data
                    HAVING count(rs.id) < 2
                        OR min(rs.stop_sequence) IS DISTINCT FROM 1
                        OR (
                            max(rs.stop_sequence) IS DISTINCT FROM count(rs.id)
                            AND NOT (
                                (
                                    coalesce(
                                        (v.normalized_data->>'closing_duplicate_stop_skipped')::boolean,
                                        false
                                    )
                                    OR coalesce(
                                        (v.normalized_data->>'is_circular_route')::boolean,
                                        false
                                    )
                                )
                                AND max(rs.stop_sequence) = count(rs.id) + 1
                            )
                        )
                ) AS sequence_incomplete
            FROM transport.routes r
            LEFT JOIN transport.operators o ON o.id = r.operator_id
            WHERE r.public_id = ${publicId}::uuid
            LIMIT 1
        `;

        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("route", publicId);
        }

        const [nameRows, sourceRows, variantRows, stopNameRows] = await Promise.all([
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
            this.prisma.$queryRaw<RouteMetadataVariantQueryRow[]>`
                SELECT
                    v.headsign,
                    v.destination_name,
                    v.estimated_duration_min,
                    v.normalized_data,
                    (SELECT count(*) FROM transport.route_stops rs
                        WHERE rs.route_variant_id = v.id)::bigint AS stop_count
                FROM transport.route_variants v
                WHERE v.route_id = ${row.id} AND v.deleted_at IS NULL
                ORDER BY v.variant_code ASC
            `,
            this.prisma.$queryRaw<RouteMetadataStopNameRow[]>`
                SELECT DISTINCT s.name_mm, s.name_en, s.name
                FROM transport.stops s
                JOIN transport.route_stops rs ON rs.stop_id = s.id
                JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
                WHERE rv.route_id = ${row.id} AND rv.deleted_at IS NULL AND s.deleted_at IS NULL
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
        const metadataVariants: RouteMetadataVariantRow[] = variantRows.map((variant) => ({
            headsign: variant.headsign,
            destination_name: variant.destination_name,
            estimated_duration_min: variant.estimated_duration_min,
            stop_count: num(variant.stop_count),
            normalized_data: variant.normalized_data,
        }));

        const routeMetadata = buildTransportRouteMetadata({
            route_code: row.route_code,
            mode: row.mode,
            route_kind: row.route_kind,
            origin_name: row.origin_name,
            destination_name: row.destination_name,
            review_status: row.review_status,
            is_active: row.is_active,
            confidence_score: row.confidence_score,
            normalized_data: row.normalized_data,
            name_mm: nameMm,
            name_en: nameEn,
            variant_count: num(row.variant_count),
            stop_count: num(row.stop_count),
            path_count: num(row.path_count),
            source_links_count: num(row.source_links_count),
            variants: metadataVariants,
            diagnostics: {
                stops_missing_geom: row.stops_missing_geom,
                has_placeholder_stop_name: hasPlaceholderStopNames(stopNameRows),
                has_stop_geometry_review_flag: row.has_stop_geometry_review_flag,
                sequence_incomplete: row.sequence_incomplete,
            },
        });

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
            routeMetadata,
        };
    }

    async getRouteDiagnosticsData(routePublicId: string): Promise<
        Pick<TransportRouteDiagnostics, "route" | "variants" | "source_links">
    > {
        await this.assertSchemaAvailable();

        const routeRows = await this.prisma.$queryRaw<
            {
                id: bigint;
                normalized_data: Record<string, unknown> | null;
                source_refs: Record<string, unknown> | null;
            }[]
        >`
            SELECT id, normalized_data, source_refs
            FROM transport.routes
            WHERE public_id = ${routePublicId}::uuid AND deleted_at IS NULL
            LIMIT 1
        `;
        const route = routeRows[0];
        if (!route) {
            throw new TransportNotFoundError("route", routePublicId);
        }

        const [variantRows, sourceRows] = await Promise.all([
            this.prisma.$queryRaw<
                {
                    public_id: string;
                    variant_code: string;
                    normalized_data: Record<string, unknown> | null;
                }[]
            >`
                SELECT
                    v.public_id::text AS public_id,
                    v.variant_code,
                    v.normalized_data
                FROM transport.route_variants v
                WHERE v.route_id = ${route.id} AND v.deleted_at IS NULL
                ORDER BY v.variant_code ASC
            `,
            this.prisma.$queryRaw<SourceLinkRowListItem[]>`
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
                WHERE s.entity_type = 'route' AND s.entity_id = ${route.id}
                ORDER BY s.is_primary DESC, s.source_name ASC, s.id ASC
                LIMIT 100
            `,
        ]);

        return {
            route: {
                normalized_data: route.normalized_data,
                source_refs: route.source_refs,
            },
            variants: variantRows.map((variant) => ({
                public_id: variant.public_id,
                variant_code: variant.variant_code,
                normalized_data: variant.normalized_data,
            })),
            source_links: sourceRows.map((row) => ({
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
                v.is_active,
                v.normalized_data->>'departure_time_text' AS departure_time_text
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
                departure_time_text: row.departure_time_text?.trim() || null,
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
                ST_AsGeoJSON(COALESCE(s.geom, rs.review_geom))::jsonb AS geometry
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
                    p.id,
                    p.path_kind,
                    p.review_status,
                    p.distance_m::float8 AS distance_m,
                    ST_AsGeoJSON(p.geom)::jsonb AS geometry
                FROM transport.route_paths p
                WHERE p.route_variant_id = ${variant.id} AND p.deleted_at IS NULL
                ORDER BY p.id ASC
                LIMIT 1
            `;
            const p = pathRows[0];
            path = p
                ? {
                      id: String(p.id),
                      path_kind: p.path_kind,
                      review_status: p.review_status,
                      distance_m: p.distance_m,
                      geometry: asGeometry(p.geometry),
                  }
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
     * Read-only stop-quality diagnostics for one variant's ordered membership.
     *
     * Single query: one variant lookup (404 if missing) plus a CTE over
     * transport.route_stops ordered by stop_sequence. Per stop it reports the
     * straight-line gap from the previous stop (LAG + geography ST_Distance, null
     * for the first stop), deviation from the variant's active route path
     * (geography ST_Distance, null when no active path), a defensive
     * exact-duplicate flag (same stop_id more than once, excluding intentional
     * circular closing occurrences), and a count of other active same-mode stops within ~30 m. The nearby lookup
     * prefilters with the GIST(geom) index via a `&&` bbox before the exact
     * geography ST_DWithin, mirroring the stop-search path. Diagnostics only.
     */
    async getVariantStopQuality(
        variantPublicId: string
    ): Promise<TransportVariantStopQualityResponse> {
        await this.assertSchemaAvailable();

        const variantRows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM transport.route_variants WHERE public_id = ${variantPublicId}::uuid LIMIT 1
        `;
        const variant = variantRows[0];
        if (!variant) {
            throw new TransportNotFoundError("route variant", variantPublicId);
        }

        const NEARBY_RADIUS_M = 30;
        // Generous degree bbox (superset of the 30 m radius) so the GIST(geom)
        // index can prefilter; the exact geography ST_DWithin trims the remainder.
        const NEARBY_RADIUS_DEG = NEARBY_RADIUS_M / 90000;

        const rows = await this.prisma.$queryRaw<
            {
                route_stop_id: bigint;
                stop_public_id: string;
                stop_name: string | null;
                stop_sequence: number;
                lng: number | null;
                lat: number | null;
                distance_from_previous_m: number | null;
                distance_from_path_m: number | null;
                is_exact_duplicate_in_variant: boolean;
                is_loop_closure: boolean;
                nearby_duplicate_count: bigint;
            }[]
        >`
            WITH active_path AS (
                SELECT geom
                FROM transport.route_paths
                WHERE route_variant_id = ${variant.id} AND deleted_at IS NULL
                ORDER BY id ASC
                LIMIT 1
            ),
            ordered AS (
                SELECT
                    rs.id AS route_stop_id,
                    rs.stop_sequence,
                    rs.stop_id,
                    rs.normalized_data,
                    s.public_id AS stop_public_id,
                    s.name AS stop_name,
                    s.mode AS stop_mode,
                    coalesce(rs.review_geom, s.geom) AS geom,
                    ST_X(coalesce(rs.review_geom, s.geom))::float8 AS lng,
                    ST_Y(coalesce(rs.review_geom, s.geom))::float8 AS lat,
                    LAG(coalesce(rs.review_geom, s.geom)) OVER (ORDER BY rs.stop_sequence ASC, rs.id ASC) AS prev_geom,
                    count(*) OVER (PARTITION BY rs.stop_id) AS stop_id_count
                FROM transport.route_stops rs
                JOIN transport.stops s ON s.id = rs.stop_id
                WHERE rs.route_variant_id = ${variant.id}
            )
            SELECT
                o.route_stop_id,
                o.stop_public_id::text AS stop_public_id,
                o.stop_name,
                o.stop_sequence,
                o.lng,
                o.lat,
                CASE
                    WHEN o.prev_geom IS NULL OR o.geom IS NULL THEN NULL
                    ELSE ST_Distance(o.geom::geography, o.prev_geom::geography)
                END::float8 AS distance_from_previous_m,
                CASE
                    WHEN ap.geom IS NULL OR o.geom IS NULL THEN NULL
                    ELSE ST_Distance(o.geom::geography, ap.geom::geography)
                END::float8 AS distance_from_path_m,
                (o.stop_id_count > 1
                    AND coalesce(o.normalized_data->>'circular_closing_occurrence', 'false') <> 'true'
                ) AS is_exact_duplicate_in_variant,
                (coalesce(o.normalized_data->>'circular_closing_occurrence', 'false') = 'true'
                ) AS is_loop_closure,
                CASE
                    WHEN o.geom IS NULL THEN 0
                    ELSE (
                        SELECT count(*)
                        FROM transport.stops s2
                        WHERE s2.id <> o.stop_id
                          AND s2.deleted_at IS NULL
                          AND s2.mode = o.stop_mode
                          AND s2.geom && ST_Expand(o.geom, ${NEARBY_RADIUS_DEG}::float8)
                          AND ST_DWithin(
                              s2.geom::geography,
                              o.geom::geography,
                              ${NEARBY_RADIUS_M}::float8
                          )
                    )
                END::bigint AS nearby_duplicate_count
            FROM ordered o
            LEFT JOIN active_path ap ON true
            ORDER BY o.stop_sequence ASC, o.route_stop_id ASC
        `;

        return {
            items: rows.map((row) => ({
                route_stop_id: String(row.route_stop_id),
                stop_public_id: row.stop_public_id,
                stop_name: row.stop_name,
                stop_sequence: row.stop_sequence,
                lng: row.lng,
                lat: row.lat,
                distance_from_previous_m: row.distance_from_previous_m,
                distance_from_path_m: row.distance_from_path_m,
                is_exact_duplicate_in_variant: row.is_exact_duplicate_in_variant,
                is_loop_closure: row.is_loop_closure,
                nearby_duplicate_count: num(row.nearby_duplicate_count),
            })),
            total: rows.length,
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
        has_review_placeholder_path: boolean;
    }> {
        const variantRows = await this.prisma.$queryRaw<{
            id: bigint;
            has_verified_path: boolean;
            has_review_placeholder_path: boolean;
        }[]>`
            SELECT rv.id,
                   EXISTS (
                       SELECT 1 FROM transport.route_paths rp
                       WHERE rp.route_variant_id = rv.id
                         AND rp.deleted_at IS NULL
                         AND rp.review_status = 'verified'
                   ) AS has_verified_path,
                   EXISTS (
                       SELECT 1 FROM transport.route_paths rp
                       WHERE rp.route_variant_id = rv.id
                         AND rp.deleted_at IS NULL
                         AND (
                             rp.path_kind = 'corridor_estimate'
                             OR rp.review_status = 'needs_review'
                         )
                   ) AS has_review_placeholder_path
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
                    actual_longitude: number | null;
                    actual_latitude: number | null;
                    geometry_source: "route_stop_review_geom" | "stop_geom";
                    pickup_type: number;
                    drop_off_type: number;
                    is_timing_point: boolean;
                    review_status: string;
                    source_time_text: string | null;
                    source_time_type: string | null;
                    travel_time_from_previous_seconds: number | null;
                    waiting_time_seconds: number | null;
                    arrival_offset_seconds: number | null;
                    departure_offset_seconds: number | null;
                    is_loop_closure: boolean;
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
                    ST_X(COALESCE(s.geom, rs.review_geom))::float8 AS longitude,
                    ST_Y(COALESCE(s.geom, rs.review_geom))::float8 AS latitude,
                    ST_X(s.geom)::float8 AS actual_longitude,
                    ST_Y(s.geom)::float8 AS actual_latitude,
                    CASE
                        WHEN s.geom IS NOT NULL THEN 'stop_geom'
                        WHEN rs.review_geom IS NOT NULL THEN 'route_stop_review_geom'
                        ELSE 'stop_geom'
                    END AS geometry_source,
                    rs.pickup_type,
                    rs.drop_off_type,
                    rs.is_timing_point,
                    s.review_status,
                    rs.source_time_text,
                    rs.source_time_type,
                    rs.travel_time_from_previous_seconds,
                    rs.waiting_time_seconds,
                    rs.arrival_offset_seconds,
                    rs.departure_offset_seconds,
                    (coalesce(rs.normalized_data->>'circular_closing_occurrence', 'false') = 'true'
                    ) AS is_loop_closure
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
                actual_longitude: r.actual_longitude,
                actual_latitude: r.actual_latitude,
                geometry_source: r.geometry_source,
                pickup_type: r.pickup_type,
                drop_off_type: r.drop_off_type,
                is_timing_point: r.is_timing_point,
                review_status: r.review_status,
                source_time_text: r.source_time_text,
                source_time_type: r.source_time_type,
                travel_time_from_previous_seconds: r.travel_time_from_previous_seconds,
                waiting_time_seconds: r.waiting_time_seconds,
                arrival_offset_seconds: r.arrival_offset_seconds,
                departure_offset_seconds: r.departure_offset_seconds,
                is_loop_closure: r.is_loop_closure,
            })),
            route_stop_count: rows.length,
            has_verified_path: variant.has_verified_path,
            has_review_placeholder_path: variant.has_review_placeholder_path,
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
            has_review_placeholder_path: lite.has_review_placeholder_path,
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
     * `und` names, `source_refs`, and raw `normalized_data` blobs are never accepted.
     * Structured train metadata fields merge into `normalized_data` keys only.
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

        const editingTrainMetadata =
            input.train_type !== undefined ||
            input.train_model !== undefined ||
            input.operation_days !== undefined ||
            input.is_yangon_urban_service !== undefined;
        const editingDisplayHeadsign = input.display_headsign !== undefined;
        const editingNames = input.name_mm !== undefined || input.name_en !== undefined;

        if (sets.length === 0 && !editingNames && !editingTrainMetadata && !editingDisplayHeadsign) {
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

            if (editingTrainMetadata && before.mode !== "train") {
                throw new TransportRouteMetadataError(
                    "Train metadata fields can only be edited on train routes.",
                );
            }

            const normalizedPatch: Record<string, unknown> = {};
            if (input.train_type !== undefined) {
                normalizedPatch.train_type = input.train_type;
            }
            if (input.train_model !== undefined) {
                normalizedPatch.train_model = input.train_model;
            }
            if (input.operation_days !== undefined) {
                normalizedPatch.operation_days = input.operation_days;
            }
            if (input.is_yangon_urban_service !== undefined) {
                normalizedPatch.is_yangon_urban_service = input.is_yangon_urban_service;
            }
            if (Object.keys(normalizedPatch).length > 0) {
                sets.push(
                    Prisma.sql`normalized_data = coalesce(normalized_data, '{}'::jsonb) || ${JSON.stringify(normalizedPatch)}::jsonb`,
                );
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

            if (editingDisplayHeadsign) {
                await tx.$executeRaw`
                    UPDATE transport.route_variants
                    SET headsign = ${input.display_headsign}, updated_at = now()
                    WHERE id = (
                        SELECT v.id
                        FROM transport.route_variants v
                        WHERE v.route_id = ${before.id} AND v.deleted_at IS NULL
                        ORDER BY v.variant_code ASC
                        LIMIT 1
                    )
                `;
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
                    metadata:
                        Object.keys(normalizedPatch).length > 0 || editingDisplayHeadsign
                            ? {
                                  ...(Object.keys(normalizedPatch).length > 0
                                      ? { normalized_data_patch: normalizedPatch }
                                      : {}),
                                  ...(editingDisplayHeadsign
                                      ? { display_headsign: input.display_headsign }
                                      : {}),
                              }
                            : null,
                    context: audit,
                });
            } else if (Object.keys(normalizedPatch).length > 0 || editingDisplayHeadsign) {
                await insertTransportAuditLog(tx, {
                    action: "transport.route.update",
                    entityType: "transport_route",
                    entityId: before.id,
                    entityPublicId: publicId,
                    changedFields: [
                        ...Object.keys(normalizedPatch).map((key) => `normalized_data.${key}`),
                        ...(editingDisplayHeadsign ? ["display_headsign"] : []),
                    ],
                    oldValues: {},
                    newValues: {
                        ...normalizedPatch,
                        ...(editingDisplayHeadsign
                            ? { display_headsign: input.display_headsign }
                            : {}),
                    },
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
                v.is_active,
                v.normalized_data->>'departure_time_text' AS departure_time_text
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
            departure_time_text: row.departure_time_text?.trim() || null,
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

        // Resolve optional endpoint stop pointers (public_id -> stops.id). undefined
        // means "leave unchanged"; null clears the pointer. Resolved up front so a
        // bad reference fails before opening the write transaction.
        let originStopId: bigint | null | undefined;
        let destinationStopId: bigint | null | undefined;
        if (input.origin_stop_public_id !== undefined) {
            originStopId =
                input.origin_stop_public_id === null
                    ? null
                    : await this.resolveStopIdByPublicId(
                          input.origin_stop_public_id,
                          "origin_stop_public_id"
                      );
            sets.push(Prisma.sql`origin_stop_id = ${originStopId}`);
        }
        if (input.destination_stop_public_id !== undefined) {
            destinationStopId =
                input.destination_stop_public_id === null
                    ? null
                    : await this.resolveStopIdByPublicId(
                          input.destination_stop_public_id,
                          "destination_stop_public_id"
                      );
            sets.push(Prisma.sql`destination_stop_id = ${destinationStopId}`);
        }

        if (sets.length === 0) {
            return this.getVariantSummaryByPublicId(variantPublicId);
        }

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<
                (VariantAuditRow & { origin_stop_id: bigint | null; destination_stop_id: bigint | null })[]
            >`
                SELECT id, variant_code, direction_name, direction_id, headsign, origin_name,
                       destination_name, estimated_duration_min, review_status,
                       confidence_score::float8 AS confidence_score, is_active,
                       origin_stop_id, destination_stop_id
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
            // Endpoint stop pointers are not scalar body fields; diff them manually.
            if (originStopId !== undefined && before.origin_stop_id !== originStopId) {
                diff.changedFields.push("origin_stop_id");
                diff.oldValues.origin_stop_id =
                    before.origin_stop_id === null ? null : Number(before.origin_stop_id);
                diff.newValues.origin_stop_id = originStopId === null ? null : Number(originStopId);
            }
            if (
                destinationStopId !== undefined &&
                before.destination_stop_id !== destinationStopId
            ) {
                diff.changedFields.push("destination_stop_id");
                diff.oldValues.destination_stop_id =
                    before.destination_stop_id === null ? null : Number(before.destination_stop_id);
                diff.newValues.destination_stop_id =
                    destinationStopId === null ? null : Number(destinationStopId);
            }
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

    /**
     * Resolves an active stop's internal id from its public_id. Throws
     * {@link TransportInvalidReferenceError} (→ 400) when the stop is missing or
     * soft-deleted. `field` is the request field name for a clear error message.
     */
    private async resolveStopIdByPublicId(publicId: string, field: string): Promise<bigint> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM transport.stops
            WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            throw new TransportInvalidReferenceError(field);
        }
        return row.id;
    }

    /**
     * Creates a route variant under an active route. `variant_code` is unique per
     * route (route_id + variant_code) — a collision maps to
     * {@link TransportRouteConflictError} (409). Optional origin/destination stop
     * pointers are resolved from public_id. review_status defaults to
     * "needs_review" and confidence_score to 60 when omitted; is_active = true.
     * Returns the created variant summary via the shared mapper.
     */
    async createVariant(
        routePublicId: string,
        input: CreateVariantInput,
        audit?: TransportAuditContext
    ): Promise<TransportVariantSummary> {
        await this.assertSchemaAvailable();

        const originStopId =
            input.origin_stop_public_id == null
                ? null
                : await this.resolveStopIdByPublicId(
                      input.origin_stop_public_id,
                      "origin_stop_public_id"
                  );
        const destinationStopId =
            input.destination_stop_public_id == null
                ? null
                : await this.resolveStopIdByPublicId(
                      input.destination_stop_public_id,
                      "destination_stop_public_id"
                  );

        const directionName = input.direction_name ?? null;
        const directionId = input.direction_id ?? null;
        const headsign = input.headsign ?? null;
        const originName = input.origin_name ?? null;
        const destinationName = input.destination_name ?? null;
        const reviewStatus = input.review_status ?? "needs_review";
        const confidenceScore = input.confidence_score ?? 60;

        const publicId = await this.prisma
            .$transaction(async (tx) => {
                const routeRows = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id FROM transport.routes
                    WHERE public_id = ${routePublicId}::uuid AND deleted_at IS NULL
                    LIMIT 1
                `;
                const route = routeRows[0];
                if (!route) {
                    throw new TransportNotFoundError("route", routePublicId);
                }

                const inserted = await tx.$queryRaw<{ id: bigint; public_id: string }[]>`
                    INSERT INTO transport.route_variants
                        (route_id, variant_code, direction_name, direction_id, headsign,
                         origin_name, destination_name, origin_stop_id, destination_stop_id,
                         confidence_score, review_status, is_active)
                    VALUES
                        (${route.id}, ${input.variant_code}, ${directionName}, ${directionId},
                         ${headsign}, ${originName}, ${destinationName}, ${originStopId},
                         ${destinationStopId}, ${confidenceScore}, ${reviewStatus}, true)
                    RETURNING id, public_id::text AS public_id
                `;
                const variant = inserted[0];
                if (!variant) {
                    throw new Error("Failed to create transport route variant");
                }

                await insertTransportAuditLog(tx, {
                    action: "transport.route_variant.create",
                    entityType: "transport_route_variant",
                    entityId: variant.id,
                    entityPublicId: variant.public_id,
                    changedFields: [
                        "variant_code",
                        "direction_name",
                        "direction_id",
                        "headsign",
                        "origin_name",
                        "destination_name",
                        "origin_stop_id",
                        "destination_stop_id",
                        "review_status",
                        "confidence_score",
                        "is_active",
                    ],
                    oldValues: null,
                    newValues: {
                        variant_code: input.variant_code,
                        direction_name: directionName,
                        direction_id: directionId,
                        headsign,
                        origin_name: originName,
                        destination_name: destinationName,
                        origin_stop_id: originStopId === null ? null : Number(originStopId),
                        destination_stop_id:
                            destinationStopId === null ? null : Number(destinationStopId),
                        review_status: reviewStatus,
                        confidence_score: confidenceScore,
                        is_active: true,
                    },
                    metadata: { route_public_id: routePublicId },
                    context: audit,
                });

                return variant.public_id;
            })
            .catch((error: unknown) => {
                if (isUniqueViolation(error)) {
                    throw new TransportRouteConflictError(
                        `Variant code "${input.variant_code}" already exists for this route.`
                    );
                }
                throw error;
            });

        return this.getVariantSummaryByPublicId(publicId);
    }

    /**
     * Soft-deletes a route variant: sets deleted_at = now() and is_active = false.
     * Never hard-deletes the row and never touches route_stops / route_paths, so no
     * FK cascade is triggered. Writes an audit row and returns the parent route
     * detail (via the existing route mapper) so the caller can refresh counts.
     */
    async softDeleteVariant(
        variantPublicId: string,
        audit?: TransportAuditContext
    ): Promise<TransportRouteDetail> {
        await this.assertSchemaAvailable();

        const routePublicId = await this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<
                { id: bigint; is_active: boolean | null; route_public_id: string }[]
            >`
                SELECT v.id, v.is_active, r.public_id::text AS route_public_id
                FROM transport.route_variants v
                JOIN transport.routes r ON r.id = v.route_id
                WHERE v.public_id = ${variantPublicId}::uuid AND v.deleted_at IS NULL
                FOR UPDATE OF v
            `;
            const before = rows[0];
            if (!before) {
                throw new TransportNotFoundError("route variant", variantPublicId);
            }

            const updated = await tx.$queryRaw<{ deleted_at: Date }[]>`
                UPDATE transport.route_variants
                SET deleted_at = now(), is_active = false, updated_at = now()
                WHERE public_id = ${variantPublicId}::uuid AND deleted_at IS NULL
                RETURNING deleted_at
            `;

            await insertTransportAuditLog(tx, {
                action: "transport.route_variant.delete",
                entityType: "transport_route_variant",
                entityId: before.id,
                entityPublicId: variantPublicId,
                changedFields: ["is_active", "deleted_at"],
                oldValues: { is_active: before.is_active, deleted_at: null },
                newValues: { is_active: false, deleted_at: updated[0]?.deleted_at ?? null },
                metadata: { route_public_id: before.route_public_id },
                context: audit,
            });

            return before.route_public_id;
        });

        return this.getRouteByPublicId(routePublicId);
    }

    /**
     * Builds the {@link TransportVariantPathResult}: the variant's single active
     * route path (null when none) + the refreshed variant summary. Used as the
     * shared return for the path upsert/delete endpoints.
     */
    private async getVariantPathResult(
        variantPublicId: string
    ): Promise<TransportVariantPathResult> {
        const variant = await this.getVariantSummaryByPublicId(variantPublicId);
        const pathRows = await this.prisma.$queryRaw<RoutePathRow[]>`
            SELECT
                p.id,
                p.path_kind,
                p.review_status,
                p.distance_m::float8 AS distance_m,
                ST_AsGeoJSON(p.geom)::jsonb AS geometry
            FROM transport.route_paths p
            JOIN transport.route_variants v ON v.id = p.route_variant_id
            WHERE v.public_id = ${variantPublicId}::uuid AND p.deleted_at IS NULL
            ORDER BY p.id ASC
            LIMIT 1
        `;
        const p = pathRows[0];
        const path: TransportRoutePath | null = p
            ? {
                  id: String(p.id),
                  path_kind: p.path_kind,
                  review_status: p.review_status,
                  distance_m: p.distance_m,
                  geometry: asGeometry(p.geometry),
              }
            : null;
        return { path, variant };
    }

    /**
     * Upserts the variant's single active manual route path from an ordered
     * LineString (≥ 2 positions, SRID 4326). If an active path exists it is
     * updated in place; otherwise one is inserted. Sets path_kind from input
     * (manual or manual_drawn), review_status=needs_review, confidence_score=70,
     * is_active=true, and recomputes distance_m via PostGIS geography length.
     * When manually adjusted, merges normalized_data.manually_adjusted=true.
     * No snapping / Valhalla, and never creates a second active path.
     */
    async upsertVariantPath(
        variantPublicId: string,
        input: PutVariantPathInput,
        audit?: TransportAuditContext
    ): Promise<TransportVariantPathResult> {
        await this.assertSchemaAvailable();

        const geojson = JSON.stringify({ type: "LineString", coordinates: input.coordinates });
        const pathKind = input.path_kind ?? "manual";
        const manuallyAdjusted =
            input.manually_adjusted === true || pathKind === "manual_drawn";
        const normalizedDataPatch = manuallyAdjusted
            ? JSON.stringify({ manually_adjusted: true })
            : null;

        await this.prisma.$transaction(async (tx) => {
            const variantRows = await tx.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM transport.route_variants
                WHERE public_id = ${variantPublicId}::uuid AND deleted_at IS NULL
                LIMIT 1
            `;
            const variant = variantRows[0];
            if (!variant) {
                throw new TransportNotFoundError("route variant", variantPublicId);
            }

            const existingRows = await tx.$queryRaw<
                {
                    id: bigint;
                    path_kind: string | null;
                    distance_m: number | null;
                    review_status: string | null;
                    confidence_score: number | null;
                    normalized_data: unknown;
                }[]
            >`
                SELECT id, path_kind, distance_m::float8 AS distance_m,
                       review_status, confidence_score::float8 AS confidence_score,
                       normalized_data
                FROM transport.route_paths
                WHERE route_variant_id = ${variant.id} AND deleted_at IS NULL
                ORDER BY id ASC
                LIMIT 1
                FOR UPDATE
            `;
            const existing = existingRows[0];

            if (existing) {
                const updated = await tx.$queryRaw<{ distance_m: number | null }[]>`
                    UPDATE transport.route_paths
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
                        distance_m = ST_Length(
                            ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography
                        ),
                        path_kind = ${pathKind},
                        review_status = 'needs_review',
                        confidence_score = 70,
                        is_active = true,
                        normalized_data = CASE
                            WHEN ${manuallyAdjusted}
                                THEN coalesce(normalized_data, '{}'::jsonb) || ${normalizedDataPatch}::jsonb
                            ELSE normalized_data
                        END,
                        updated_at = now()
                    WHERE id = ${existing.id}
                    RETURNING distance_m::float8 AS distance_m
                `;
                await insertTransportAuditLog(tx, {
                    action: "transport.route_path.update",
                    entityType: "transport_route_path",
                    entityId: existing.id,
                    entityPublicId: null,
                    changedFields: [
                        "geom",
                        "distance_m",
                        "path_kind",
                        "review_status",
                        "confidence_score",
                        "is_active",
                        ...(manuallyAdjusted ? (["normalized_data"] as const) : []),
                    ],
                    oldValues: {
                        path_kind: existing.path_kind,
                        distance_m: existing.distance_m,
                        review_status: existing.review_status,
                        confidence_score: existing.confidence_score,
                        ...(manuallyAdjusted
                            ? { normalized_data: existing.normalized_data }
                            : {}),
                    },
                    newValues: {
                        path_kind: pathKind,
                        distance_m: updated[0]?.distance_m ?? null,
                        review_status: "needs_review",
                        confidence_score: 70,
                        is_active: true,
                        ...(manuallyAdjusted ? { normalized_data: { manually_adjusted: true } } : {}),
                    },
                    metadata: {
                        route_variant_public_id: variantPublicId,
                        point_count: input.coordinates.length,
                    },
                    context: audit,
                });
            } else {
                const sourceRefs = JSON.stringify({
                    created_via: "manual",
                    created_by: "admin_dashboard",
                });
                const inserted = await tx.$queryRaw<{ id: bigint; distance_m: number | null }[]>`
                    INSERT INTO transport.route_paths
                        (route_variant_id, path_kind, geom, distance_m, source_refs,
                         normalized_data, confidence_score, review_status, is_active)
                    VALUES
                        (${variant.id}, ${pathKind},
                         ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
                         ST_Length(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography),
                         ${sourceRefs}::jsonb,
                         CASE
                            WHEN ${manuallyAdjusted}
                                THEN ${normalizedDataPatch}::jsonb
                            ELSE '{}'::jsonb
                         END,
                         70, 'needs_review', true)
                    RETURNING id, distance_m::float8 AS distance_m
                `;
                const created = inserted[0];
                if (!created) {
                    throw new Error("Failed to create route path");
                }
                await insertTransportAuditLog(tx, {
                    action: "transport.route_path.create",
                    entityType: "transport_route_path",
                    entityId: created.id,
                    entityPublicId: null,
                    changedFields: [
                        "geom",
                        "distance_m",
                        "path_kind",
                        "review_status",
                        "confidence_score",
                        "is_active",
                        ...(manuallyAdjusted ? (["normalized_data"] as const) : []),
                    ],
                    oldValues: null,
                    newValues: {
                        path_kind: pathKind,
                        distance_m: created.distance_m,
                        review_status: "needs_review",
                        confidence_score: 70,
                        is_active: true,
                        ...(manuallyAdjusted ? { normalized_data: { manually_adjusted: true } } : {}),
                    },
                    metadata: {
                        route_variant_public_id: variantPublicId,
                        point_count: input.coordinates.length,
                    },
                    context: audit,
                });
            }
        });

        return this.getVariantPathResult(variantPublicId);
    }

    /**
     * Soft-deletes the variant's active route path(s): deleted_at = now(),
     * is_active = false. Never hard-deletes, never touches the variant or its
     * stops. A no-op (still 200) when there is no active path. Returns the path
     * (now null) + variant summary.
     */
    async deleteVariantPath(
        variantPublicId: string,
        audit?: TransportAuditContext
    ): Promise<TransportVariantPathResult> {
        await this.assertSchemaAvailable();

        await this.prisma.$transaction(async (tx) => {
            const variantRows = await tx.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM transport.route_variants
                WHERE public_id = ${variantPublicId}::uuid AND deleted_at IS NULL
                LIMIT 1
            `;
            const variant = variantRows[0];
            if (!variant) {
                throw new TransportNotFoundError("route variant", variantPublicId);
            }

            const deleted = await tx.$queryRaw<{ id: bigint }[]>`
                UPDATE transport.route_paths
                SET deleted_at = now(), is_active = false, updated_at = now()
                WHERE route_variant_id = ${variant.id} AND deleted_at IS NULL
                RETURNING id
            `;

            for (const row of deleted) {
                await insertTransportAuditLog(tx, {
                    action: "transport.route_path.delete",
                    entityType: "transport_route_path",
                    entityId: row.id,
                    entityPublicId: null,
                    changedFields: ["is_active", "deleted_at"],
                    oldValues: { is_active: true, deleted_at: null },
                    newValues: { is_active: false },
                    metadata: { route_variant_public_id: variantPublicId },
                    context: audit,
                });
            }
        });

        return this.getVariantPathResult(variantPublicId);
    }

    /**
     * Ordered route_stop occurrences for generate-path-from-stops. Returns every row
     * by stop_sequence without deduplicating stop_id (circular closing rows included).
     */
    async loadVariantPathGenerationStops(variantPublicId: string): Promise<{
        route_mode: string;
        stops: Array<{
            stop_sequence: number;
            lng: number;
            lat: number;
            is_loop_closure: boolean;
        }>;
    }> {
        await this.assertSchemaAvailable();

        const variantRows = await this.prisma.$queryRaw<{ id: bigint; route_mode: string }[]>`
            SELECT v.id, r.mode AS route_mode
            FROM transport.route_variants v
            JOIN transport.routes r ON r.id = v.route_id
            WHERE v.public_id = ${variantPublicId}::uuid AND v.deleted_at IS NULL
            LIMIT 1
        `;
        const variant = variantRows[0];
        if (!variant) {
            throw new TransportNotFoundError("route variant", variantPublicId);
        }

        const rows = await this.prisma.$queryRaw<
            {
                stop_sequence: number;
                lng: number | null;
                lat: number | null;
                normalized_data: unknown;
            }[]
        >`
            SELECT
                rs.stop_sequence,
                ST_X(COALESCE(s.geom, rs.review_geom))::float8 AS lng,
                ST_Y(COALESCE(s.geom, rs.review_geom))::float8 AS lat,
                rs.normalized_data
            FROM transport.route_stops rs
            JOIN transport.stops s ON s.id = rs.stop_id
            WHERE rs.route_variant_id = ${variant.id}
              AND s.deleted_at IS NULL
            ORDER BY rs.stop_sequence ASC, rs.id ASC
        `;

        if (rows.length < 2) {
            throw new TransportGeneratePathFromStopsError(
                "Select a variant with at least 2 ordered stops.",
            );
        }

        for (let i = 0; i < rows.length; i++) {
            if (rows[i]?.stop_sequence !== i + 1) {
                throw new TransportGeneratePathFromStopsError(
                    "Stop sequence must be continuous (1, 2, 3, …).",
                );
            }
        }

        const stops = rows.map((row) => {
            if (row.lng === null || row.lat === null) {
                throw new TransportGeneratePathFromStopsError(
                    "Every stop must have a saved location.",
                );
            }
            return {
                stop_sequence: row.stop_sequence,
                lng: row.lng,
                lat: row.lat,
                is_loop_closure: isCircularClosingRouteStop(row.normalized_data),
            };
        });

        return { route_mode: variant.route_mode, stops };
    }

    /**
     * Replaces the variant active path with a Valhalla-snapped LineString built from
     * ordered stop occurrences (path_kind = valhalla_snapped).
     */
    async upsertValhallaSnappedVariantPath(
        variantPublicId: string,
        coordinates: [number, number][],
        options: {
            warnings: string[];
            stop_occurrence_count: number;
        },
        audit?: TransportAuditContext,
    ): Promise<GeneratePathFromStopsResult> {
        await this.assertSchemaAvailable();

        if (coordinates.length < 2) {
            throw new TransportGeneratePathFromStopsError(
                "Generated path must contain at least two coordinates.",
            );
        }

        const geojson = JSON.stringify({ type: "LineString", coordinates });
        const pathKind = "valhalla_snapped";
        const normalizedData = JSON.stringify({
            geom_source: "valhalla_from_ordered_stops",
            stop_occurrence_count: options.stop_occurrence_count,
            warnings: options.warnings,
        });
        const sourceRefs = JSON.stringify({
            created_via: "generate_path_from_stops",
            created_by: "admin_dashboard",
        });

        const pathId = await this.prisma.$transaction(async (tx) => {
            const variantRows = await tx.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM transport.route_variants
                WHERE public_id = ${variantPublicId}::uuid AND deleted_at IS NULL
                LIMIT 1
            `;
            const variant = variantRows[0];
            if (!variant) {
                throw new TransportNotFoundError("route variant", variantPublicId);
            }

            const existingRows = await tx.$queryRaw<
                {
                    id: bigint;
                    path_kind: string | null;
                    distance_m: number | null;
                    review_status: string | null;
                    confidence_score: number | null;
                    normalized_data: unknown;
                }[]
            >`
                SELECT id, path_kind, distance_m::float8 AS distance_m,
                       review_status, confidence_score::float8 AS confidence_score,
                       normalized_data
                FROM transport.route_paths
                WHERE route_variant_id = ${variant.id} AND deleted_at IS NULL
                ORDER BY id ASC
                LIMIT 1
                FOR UPDATE
            `;
            const existing = existingRows[0];

            if (existing) {
                const updated = await tx.$queryRaw<{ id: bigint; distance_m: number | null }[]>`
                    UPDATE transport.route_paths
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
                        distance_m = ST_Length(
                            ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography
                        ),
                        path_kind = ${pathKind},
                        review_status = 'needs_review',
                        confidence_score = 70,
                        is_active = true,
                        normalized_data = ${normalizedData}::jsonb,
                        source_refs = coalesce(source_refs, '{}'::jsonb) || ${sourceRefs}::jsonb,
                        updated_at = now()
                    WHERE id = ${existing.id}
                    RETURNING id, distance_m::float8 AS distance_m
                `;
                const row = updated[0];
                if (!row) {
                    throw new Error("Failed to update generated route path");
                }
                await insertTransportAuditLog(tx, {
                    action: "transport.route_path.update",
                    entityType: "transport_route_path",
                    entityId: existing.id,
                    entityPublicId: null,
                    changedFields: [
                        "geom",
                        "distance_m",
                        "path_kind",
                        "review_status",
                        "confidence_score",
                        "is_active",
                        "normalized_data",
                        "source_refs",
                    ],
                    oldValues: {
                        path_kind: existing.path_kind,
                        distance_m: existing.distance_m,
                        review_status: existing.review_status,
                        confidence_score: existing.confidence_score,
                        normalized_data: existing.normalized_data,
                    },
                    newValues: {
                        path_kind: pathKind,
                        distance_m: row.distance_m,
                        review_status: "needs_review",
                        confidence_score: 70,
                        is_active: true,
                        normalized_data: JSON.parse(normalizedData),
                    },
                    metadata: {
                        route_variant_public_id: variantPublicId,
                        point_count: coordinates.length,
                        stop_occurrence_count: options.stop_occurrence_count,
                    },
                    context: audit,
                });
                return row.id;
            }

            const inserted = await tx.$queryRaw<{ id: bigint; distance_m: number | null }[]>`
                INSERT INTO transport.route_paths
                    (route_variant_id, path_kind, geom, distance_m, source_refs,
                     normalized_data, confidence_score, review_status, is_active)
                VALUES
                    (${variant.id}, ${pathKind},
                     ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
                     ST_Length(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography),
                     ${sourceRefs}::jsonb,
                     ${normalizedData}::jsonb,
                     70, 'needs_review', true)
                RETURNING id, distance_m::float8 AS distance_m
            `;
            const created = inserted[0];
            if (!created) {
                throw new Error("Failed to create generated route path");
            }
            await insertTransportAuditLog(tx, {
                action: "transport.route_path.create",
                entityType: "transport_route_path",
                entityId: created.id,
                entityPublicId: null,
                changedFields: [
                    "geom",
                    "distance_m",
                    "path_kind",
                    "review_status",
                    "confidence_score",
                    "is_active",
                    "normalized_data",
                    "source_refs",
                ],
                oldValues: null,
                newValues: {
                    path_kind: pathKind,
                    distance_m: created.distance_m,
                    review_status: "needs_review",
                    confidence_score: 70,
                    is_active: true,
                    normalized_data: JSON.parse(normalizedData),
                },
                metadata: {
                    route_variant_public_id: variantPublicId,
                    point_count: coordinates.length,
                    stop_occurrence_count: options.stop_occurrence_count,
                },
                context: audit,
            });
            return created.id;
        });

        const pathRows = await this.prisma.$queryRaw<
            {
                path_kind: string;
                review_status: string;
                distance_m: number | null;
                geometry: unknown;
            }[]
        >`
            SELECT
                p.path_kind,
                p.review_status,
                p.distance_m::float8 AS distance_m,
                ST_AsGeoJSON(p.geom)::jsonb AS geometry
            FROM transport.route_paths p
            WHERE p.id = ${pathId}
            LIMIT 1
        `;
        const path = pathRows[0];
        if (!path) {
            throw new Error("Failed to load generated route path");
        }

        return {
            route_path_id: String(pathId),
            path_kind: path.path_kind,
            review_status: path.review_status,
            geometry: asGeometry(path.geometry) as NonNullable<GeoJsonGeometry>,
            distance_m: path.distance_m,
            warnings: options.warnings,
        };
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
                rs.source_time_text,
                rs.source_time_type,
                rs.travel_time_from_previous_seconds,
                rs.waiting_time_seconds,
                rs.arrival_offset_seconds,
                rs.departure_offset_seconds,
                s.public_id::text AS stop_public_id,
                s.name AS stop_name,
                s.name_mm AS stop_name_mm,
                s.name_en AS stop_name_en,
                s.mode AS stop_mode,
                s.stop_type,
                ST_AsGeoJSON(COALESCE(s.geom, rs.review_geom))::jsonb AS geometry,
                (rs.review_geom IS NOT NULL) AS has_review_geom
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

    /** Partial update of a route stop's membership flags. Never touches stop_sequence or timetable fields. */
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
     * Updates editable timetable inputs on one route stop, recalculates offsets for
     * the whole variant in the same transaction, and returns the refreshed ordered stops.
     * Preserves imported source_time_text and source_time_type on every row.
     */
    async updateRouteStopTiming(
        id: bigint,
        input: UpdateRouteStopTimingInput,
        audit?: TransportAuditContext,
    ): Promise<TransportRouteStopMutationResult> {
        await this.assertSchemaAvailable();

        let variantPublicId: string | null = null;

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<RouteStopTimingAuditRow[]>`
                SELECT id,
                       route_variant_id,
                       travel_time_from_previous_seconds,
                       waiting_time_seconds,
                       arrival_offset_seconds,
                       departure_offset_seconds
                FROM transport.route_stops
                WHERE id = ${id}
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("route stop", String(id));
            }

            const variantRows = await tx.$queryRaw<{ public_id: string }[]>`
                SELECT public_id::text AS public_id
                FROM transport.route_variants
                WHERE id = ${before.route_variant_id}
                  AND deleted_at IS NULL
                LIMIT 1
            `;
            variantPublicId = variantRows[0]?.public_id ?? null;
            if (!variantPublicId) {
                throw new TransportNotFoundError("route variant", String(before.route_variant_id));
            }

            const sets: Prisma.Sql[] = [];
            if (input.travel_time_from_previous_seconds !== undefined) {
                sets.push(
                    Prisma.sql`travel_time_from_previous_seconds = ${input.travel_time_from_previous_seconds}`,
                );
            }
            if (input.waiting_time_seconds !== undefined) {
                sets.push(Prisma.sql`waiting_time_seconds = ${input.waiting_time_seconds}`);
            }

            if (sets.length > 0) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.route_stops
                    SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ", ")}
                    WHERE id = ${id}
                `);

                const diff = diffScalarFields(before, input, [
                    "travel_time_from_previous_seconds",
                    "waiting_time_seconds",
                ]);
                if (diff.changedFields.length > 0) {
                    await insertTransportAuditLog(tx, {
                        action: "transport.route_stop.update_timing",
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
            }

            await this.recalculateVariantTimetableOffsetsInTx(tx, before.route_variant_id);
        });

        if (!variantPublicId) {
            throw new TransportNotFoundError("route stop", String(id));
        }

        return this.getOrderedStops(variantPublicId);
    }

    /**
     * Updates variant departure_time_text in normalized_data and recalculates stop
     * offsets for the whole variant in one transaction.
     */
    async updateVariantDepartureTime(
        variantPublicId: string,
        departureTimeText: string | null,
        audit?: TransportAuditContext,
    ): Promise<TransportRouteStopMutationResult> {
        await this.assertSchemaAvailable();

        await this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<
                { id: bigint; normalized_data: unknown }[]
            >`
                SELECT id, normalized_data
                FROM transport.route_variants
                WHERE public_id = ${variantPublicId}::uuid
                  AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = beforeRows[0];
            if (!before) {
                throw new TransportNotFoundError("route variant", variantPublicId);
            }

            const normalizedPatch = { departure_time_text: departureTimeText };
            if (departureTimeText === null) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.route_variants
                    SET normalized_data = coalesce(normalized_data, '{}'::jsonb) - 'departure_time_text',
                        updated_at = now()
                    WHERE id = ${before.id}
                `);
            } else {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.route_variants
                    SET normalized_data = coalesce(normalized_data, '{}'::jsonb) || ${JSON.stringify(normalizedPatch)}::jsonb,
                        updated_at = now()
                    WHERE id = ${before.id}
                `);
            }

            await insertTransportAuditLog(tx, {
                action: "transport.route_variant.update_departure_time",
                entityType: "transport_route_variant",
                entityId: before.id,
                entityPublicId: variantPublicId,
                changedFields: ["normalized_data.departure_time_text"],
                oldValues: {
                    departure_time_text:
                        typeof before.normalized_data === "object" &&
                        before.normalized_data !== null &&
                        "departure_time_text" in (before.normalized_data as object)
                            ? (before.normalized_data as { departure_time_text?: unknown })
                                  .departure_time_text
                            : null,
                },
                newValues: { departure_time_text: departureTimeText },
                metadata: null,
                context: audit,
            });

            await this.recalculateVariantTimetableOffsetsInTx(tx, before.id);
        });

        return this.getOrderedStops(variantPublicId);
    }

    private async recalculateVariantTimetableOffsetsInTx(
        tx: Prisma.TransactionClient,
        variantId: bigint,
    ): Promise<void> {
        const perf = startPerf("recalculateVariantTimetableOffsets");
        const stops = await tx.$queryRaw<VariantTimetableStopRow[]>`
            SELECT id, travel_time_from_previous_seconds, waiting_time_seconds
            FROM transport.route_stops
            WHERE route_variant_id = ${variantId}
            ORDER BY stop_sequence ASC
            FOR UPDATE
        `;
        perf.mark(`loaded ${stops.length} stops FOR UPDATE`);

        if (stops.length === 0) {
            perf.done();
            return;
        }

        const calculated = variantTimetableScheduleToOffsets(
            calculateVariantTimetableSchedule({
                departureTimeText: null,
                stops,
            }),
        );

        // One set-based UPDATE instead of N sequential round trips (audit: ~47 ms/row).
        const valueRows = stops.map((stop, index) => {
            const offsets = calculated[index]!;
            return Prisma.sql`(
                ${stop.id}::bigint,
                ${offsets.arrival_offset_seconds}::int,
                ${offsets.departure_offset_seconds}::int
            )`;
        });
        await tx.$executeRaw(Prisma.sql`
            UPDATE transport.route_stops AS rs
            SET arrival_offset_seconds = v.arrival_offset_seconds,
                departure_offset_seconds = v.departure_offset_seconds,
                updated_at = now()
            FROM (VALUES ${Prisma.join(valueRows)}) AS v(id, arrival_offset_seconds, departure_offset_seconds)
            WHERE rs.id = v.id
        `);
        perf.mark(`updated ${stops.length} offset rows (batched)`);
        perf.done();
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
                    removed_sequence: before.stop_sequence,
                    first_sequence: remaining.length > 0 ? 1 : null,
                    last_sequence: remaining.length > 0 ? remaining.length : null,
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
                has_review_placeholder_path: false,
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
            has_review_placeholder_path: lite.has_review_placeholder_path,
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

    private async resolveFaresStopColumns(client: {
        $queryRaw: PrismaClient["$queryRaw"];
    }): Promise<boolean> {
        if (this.faresStopColumns !== null) {
            return this.faresStopColumns;
        }
        const rows = await client.$queryRaw<{ exists: boolean }[]>`
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'transport'
                  AND table_name = 'fares'
                  AND column_name = 'origin_stop_id'
            ) AS exists
        `;
        this.faresStopColumns = rows[0]?.exists ?? false;
        return this.faresStopColumns;
    }

    private async countFareStopReferences(
        client: { $queryRaw: PrismaClient["$queryRaw"] },
        stopId: bigint
    ): Promise<number> {
        const hasStopColumns = await this.resolveFaresStopColumns(client);
        if (!hasStopColumns) {
            return 0;
        }
        const countRows = await client.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM transport.fares
            WHERE (origin_stop_id = ${stopId} OR destination_stop_id = ${stopId})
        `;
        return num(countRows[0]?.count);
    }

    private async loadStopDeleteReferences(
        client: { $queryRaw: PrismaClient["$queryRaw"] },
        publicId: string,
        lockRow: boolean
    ): Promise<{ row: StopDeleteReferenceRow; fares: number } | null> {
        const stopRows = await client.$queryRaw<StopDeleteReferenceRow[]>`
            SELECT
                s.id,
                s.public_id::text AS public_id,
                s.review_status,
                s.name,
                s.mode,
                s.stop_type,
                (
                    SELECT count(*)::bigint
                    FROM transport.route_stops rs
                    WHERE rs.stop_id = s.id
                ) AS route_stops_count,
                (
                    SELECT count(*)::bigint
                    FROM transport.route_variants v
                    WHERE v.deleted_at IS NULL
                      AND (v.origin_stop_id = s.id OR v.destination_stop_id = s.id)
                ) AS variant_endpoints_count,
                (
                    SELECT count(*)::bigint
                    FROM transport.stops c
                    WHERE c.deleted_at IS NULL
                      AND c.id <> s.id
                      AND c.parent_stop_id = s.id
                ) AS child_stops_count,
                (
                    SELECT count(*)::bigint
                    FROM transport.terminals t
                    WHERE t.deleted_at IS NULL
                      AND t.linked_stop_id = s.id
                ) AS linked_terminals_count,
                (
                    SELECT count(DISTINCT v.route_id)::bigint
                    FROM transport.route_stops rs
                    JOIN transport.route_variants v
                        ON v.id = rs.route_variant_id AND v.deleted_at IS NULL
                    WHERE rs.stop_id = s.id
                ) AS route_count
            FROM transport.stops s
            WHERE s.public_id = ${publicId}::uuid
              AND s.deleted_at IS NULL
            ${lockRow ? Prisma.sql`FOR UPDATE` : Prisma.empty}
        `;
        const row = stopRows[0];
        if (!row) {
            return null;
        }
        const fares = await this.countFareStopReferences(client, row.id);
        return { row, fares };
    }

    /**
     * Read-only eligibility check for permanent stop deletion. Counts references
     * across route_stops, variant endpoints, child stops, linked terminals, and
     * fares (when fare stop columns exist). Blocks verified / manual_protected.
     */
    async getStopDeleteEligibilityByPublicId(
        publicId: string
    ): Promise<TransportStopDeleteEligibility> {
        await this.assertSchemaAvailable();
        const loaded = await this.loadStopDeleteReferences(this.prisma, publicId, false);
        if (!loaded) {
            throw new TransportNotFoundError("stop", publicId);
        }
        return buildStopDeleteEligibility(loaded.row, loaded.fares);
    }

    /**
     * Permanently deletes a stop when it has no blocking references and is not
     * verified / manual_protected. Removes related stop_names and source_links
     * in the same transaction, then hard-deletes the stop row.
     */
    async permanentDeleteStopByPublicId(
        publicId: string,
        audit?: TransportAuditContext,
        reason?: string
    ): Promise<TransportStopPermanentDeleteResult> {
        await this.assertSchemaAvailable();

        const trimmedReason = typeof reason === "string" ? reason.trim() : "";

        return this.prisma.$transaction(async (tx) => {
            const loaded = await this.loadStopDeleteReferences(tx, publicId, true);
            if (!loaded) {
                throw new TransportNotFoundError("stop", publicId);
            }

            const eligibility = buildStopDeleteEligibility(loaded.row, loaded.fares);
            assertStopDeleteAllowed(eligibility);

            const stop = loaded.row;

            await tx.$executeRaw`
                DELETE FROM transport.source_links
                WHERE entity_type = 'stop' AND entity_id = ${stop.id}
            `;
            await tx.$executeRaw`
                DELETE FROM transport.stop_names
                WHERE stop_id = ${stop.id}
            `;
            await tx.$executeRaw`
                DELETE FROM transport.stops
                WHERE id = ${stop.id}
            `;

            await insertTransportAuditLog(tx, {
                action: "transport.stop.delete",
                entityType: "transport_stop",
                entityId: stop.id,
                entityPublicId: stop.public_id,
                changedFields: ["deleted"],
                oldValues: {
                    name: stop.name,
                    mode: stop.mode,
                    stop_type: stop.stop_type,
                    review_status: stop.review_status,
                },
                newValues: { deleted: true },
                metadata: {
                    permanent: true,
                    ...(trimmedReason ? { reason: trimmedReason } : {}),
                },
                context: audit,
            });

            return {
                deleted: true,
                public_id: stop.public_id,
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
     *   - The same physical stop (stop_id) may appear more than once in a variant;
     *     each membership row is a distinct occurrence keyed by route_stops.id.
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
            has_review_placeholder_path: lite.has_review_placeholder_path,
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
            placeholder_longitude: number | null;
            placeholder_latitude: number | null;
        };
        try {
            txResult = await this.prisma.$transaction(async (tx) => {
            const variant = await this.resolveVariantForInsert(tx, variantPublicId);

            const sequenceRows = await tx.$queryRaw<RouteStopGeometryPoint[]>`
                SELECT
                    rs.id::text AS route_stop_id,
                    rs.stop_sequence,
                    ST_X(COALESCE(s.geom, rs.review_geom))::float8 AS longitude,
                    ST_Y(COALESCE(s.geom, rs.review_geom))::float8 AS latitude
                FROM transport.route_stops rs
                JOIN transport.stops s ON s.id = rs.stop_id
                WHERE rs.route_variant_id = ${variant.id}
                ORDER BY rs.stop_sequence ASC, rs.id ASC
            `;
            const placeholderResolved = resolvePlaceholderStopGeometry(
                sequenceRows,
                input.position,
                input.anchorRouteStopId,
                { longitude: input.longitude, latitude: input.latitude }
            );
            if (!placeholderResolved) {
                throw new TransportRouteMetadataError(
                    "Placeholder geometry is required when the variant has no stop geometry to derive from. Provide longitude and latitude from the review map."
                );
            }
            const placeholderGeometry = placeholderResolved.geometry;
            const normalizedData = buildCreatedFromRouteSequenceNormalizedData(
                placeholderResolved.source
            );

            const insertedStopRows = await tx.$queryRaw<{ id: bigint; public_id: string }[]>`
                INSERT INTO transport.stops (
                    name,
                    name_mm,
                    name_en,
                    mode,
                    stop_type,
                    review_status,
                    is_active,
                    normalized_data,
                    geom
                )
                VALUES (
                    ${derivedName},
                    ${nameMm},
                    ${nameEn},
                    ${input.mode},
                    ${input.stop_type},
                    'needs_review',
                    false,
                    ${JSON.stringify(normalizedData)}::jsonb,
                    ${
                        Prisma.sql`ST_SetSRID(ST_MakePoint(${placeholderGeometry.longitude}, ${placeholderGeometry.latitude}), 4326)`
                    }
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
                    review_status: "needs_review",
                    is_active: false,
                    normalized_data: normalizedData,
                    longitude: placeholderGeometry?.longitude ?? null,
                    latitude: placeholderGeometry?.latitude ?? null,
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
                placeholder_longitude: placeholderGeometry?.longitude ?? null,
                placeholder_latitude: placeholderGeometry?.latitude ?? null,
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
            longitude: txResult.placeholder_longitude,
            latitude: txResult.placeholder_latitude,
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
            has_review_placeholder_path: lite.has_review_placeholder_path,
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
     * exists. Runs entirely within the caller's transaction. Returns the new route_stop id.
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
        // FOR UPDATE below locks zero rows when the variant is empty, so concurrent
        // inserts must wait on the route_variants row before re-reading membership.
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

    /**
     * Swaps inbound/outbound direction metadata between the route's two active
     * variants (direction_id 0 and 1). Stops, paths, and endpoint pointers are
     * untouched. Uses temporary variant_code values inside the transaction to
     * avoid (route_id, variant_code) unique conflicts.
     */
    async swapRouteDirectionByPublicId(
        routePublicId: string,
        audit?: TransportAuditContext
    ): Promise<{ variants: TransportVariantSummary[] }> {
        await this.assertSchemaAvailable();

        type SwapVariantRow = {
            id: bigint;
            public_id: string;
            variant_code: string;
            direction_name: string | null;
            direction_id: number | null;
            normalized_data: Record<string, unknown> | null;
        };

        const swappedPublicIds = await this.prisma.$transaction(async (tx) => {
            const routeRows = await tx.$queryRaw<{ id: bigint; route_code: string }[]>`
                SELECT id, route_code
                FROM transport.routes
                WHERE public_id = ${routePublicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const route = routeRows[0];
            if (!route) {
                throw new TransportNotFoundError("route", routePublicId);
            }

            const rows = await tx.$queryRaw<SwapVariantRow[]>`
                SELECT
                    id,
                    public_id::text AS public_id,
                    variant_code,
                    direction_name,
                    direction_id,
                    normalized_data
                FROM transport.route_variants
                WHERE route_id = ${route.id}
                  AND deleted_at IS NULL
                  AND is_active = true
                FOR UPDATE
            `;

            if (rows.length !== 2) {
                throw new TransportRouteMetadataError(
                    "Change direction requires exactly two active variants (one inbound, one outbound)."
                );
            }

            const outbound = rows.find((row) => row.direction_id === 0);
            const inbound = rows.find((row) => row.direction_id === 1);
            if (!outbound || !inbound) {
                throw new TransportRouteMetadataError(
                    "Change direction requires one outbound (direction_id 0) and one inbound (direction_id 1) variant."
                );
            }

            const outboundBecomesInbound = {
                variant_code: `${route.route_code}-B`,
                direction_id: 1,
                direction_name: "inbound",
                direction_value: "inbound",
            };
            const inboundBecomesOutbound = {
                variant_code: `${route.route_code}-A`,
                direction_id: 0,
                direction_name: "outbound",
                direction_value: "outbound",
            };

            const outboundTemp = `__DIRSWAP_${outbound.public_id}`;
            const inboundTemp = `__DIRSWAP_${inbound.public_id}`;

            await tx.$executeRaw`
                UPDATE transport.route_variants
                SET variant_code = ${outboundTemp}, updated_at = now()
                WHERE id = ${outbound.id}
            `;
            await tx.$executeRaw`
                UPDATE transport.route_variants
                SET variant_code = ${inboundTemp}, updated_at = now()
                WHERE id = ${inbound.id}
            `;

            const applySwap = async (
                row: SwapVariantRow,
                target: typeof outboundBecomesInbound,
                partnerPublicId: string
            ) => {
                const hadNormalizedDirection =
                    row.normalized_data !== null &&
                    typeof row.normalized_data === "object" &&
                    "direction" in row.normalized_data;

                const oldValues: Record<string, unknown> = {
                    variant_code: row.variant_code,
                    direction_id: row.direction_id,
                    direction_name: row.direction_name,
                };
                const newValues: Record<string, unknown> = {
                    variant_code: target.variant_code,
                    direction_id: target.direction_id,
                    direction_name: target.direction_name,
                };
                const changedFields = ["variant_code", "direction_id", "direction_name"];

                if (hadNormalizedDirection) {
                    oldValues["normalized_data.direction"] = row.normalized_data?.direction;
                    newValues["normalized_data.direction"] = target.direction_value;
                    changedFields.push("normalized_data.direction");
                }

                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.route_variants
                    SET
                        variant_code = ${target.variant_code},
                        direction_id = ${target.direction_id},
                        direction_name = ${target.direction_name},
                        normalized_data = ${
                            hadNormalizedDirection
                                ? Prisma.sql`jsonb_set(
                                      COALESCE(normalized_data, '{}'::jsonb),
                                      '{direction}',
                                      to_jsonb(${target.direction_value}::text)
                                  )`
                                : Prisma.sql`normalized_data`
                        },
                        updated_at = now()
                    WHERE id = ${row.id}
                `);

                await insertTransportAuditLog(tx, {
                    action: "transport.route_variant.direction_swap",
                    entityType: "transport_route_variant",
                    entityId: row.id,
                    entityPublicId: row.public_id,
                    changedFields,
                    oldValues,
                    newValues,
                    metadata: {
                        route_public_id: routePublicId,
                        swap_partner_public_id: partnerPublicId,
                    },
                    context: audit,
                });
            };

            await applySwap(outbound, outboundBecomesInbound, inbound.public_id);
            await applySwap(inbound, inboundBecomesOutbound, outbound.public_id);

            return [outbound.public_id, inbound.public_id] as const;
        });

        const variants = await Promise.all(
            swappedPublicIds.map((publicId) => this.getVariantSummaryByPublicId(publicId))
        );
        variants.sort((a, b) => (a.direction_id ?? 99) - (b.direction_id ?? 99));

        return { variants };
    }
}
