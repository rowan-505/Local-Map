import type { RoutingGraphProfileCode } from "./routing.config.js";
import type {
    RoutingEngineCode,
    RoutingLegModeCode,
    RoutingPhysicalModeCode,
    RoutingRoutePreferenceCode,
    RoutingRouteProfileCode,
    RoutingRouteStatusCode,
    RoutingServiceClassCode,
} from "./routing.config.js";

// -----------------------------------------------------------------------------
// Graph build (Phase 9E admin)
// -----------------------------------------------------------------------------

export type RoutingGraphBuildInput = {
    profileCode: RoutingGraphProfileCode;
    sourcePublishBatchId: bigint | null;
    sourceReviewBatchId: bigint | null;
    bbox: {
        minLon: number;
        minLat: number;
        maxLon: number;
        maxLat: number;
    } | null;
    regionCode: string | null;
    maxRoads: number;
    dryRun: boolean;
    createdBy: bigint | null;
};

export type RoutingGraphBuildResult = {
    build_job_id: string;
    build_job_public_id: string;
    status: "completed" | "failed" | "dry_run";
    dry_run: boolean;
    profile_code: RoutingGraphProfileCode;
    selected_core_road_count: number;
    generated_node_count: number;
    generated_edge_count: number;
    generated_edge_name_count: number;
    warning_count: number;
    error_count: number;
    validation_codes: string[];
    message: string;
    metadata_id: string | null;
};

// -----------------------------------------------------------------------------
// Universal route API (public directions contract)
// -----------------------------------------------------------------------------

/** Public GeoJSON LineString — not tied to Valhalla or OTP response shapes. */
export type RouteGeoJsonLineString = {
    readonly type: "LineString";
    readonly coordinates: readonly (readonly [number, number])[];
};

export type RouteWaypoint = {
    readonly lat: number;
    readonly lng: number;
    readonly label?: string;
};

export type PostRouteRequestBody = {
    readonly origin: RouteWaypoint;
    readonly destination: RouteWaypoint;
    readonly profile: RoutingRouteProfileCode;
    readonly allowedModes?: readonly string[];
    readonly excludedModes?: readonly string[];
    readonly serviceClasses?: readonly string[];
    readonly preference?: RoutingRoutePreferenceCode;
    readonly departureTime?: string | null;
    readonly maxWalkMeters?: number;
    readonly maxTransfers?: number;
};

export type RouteSummary = {
    readonly distanceMeters: number;
    readonly durationSeconds: number;
    readonly transferCount: number;
};

/** Optional transit metadata for future OTP legs (no engine-specific fields). */
export type RouteLegTransitDetails = {
    readonly agencyName?: string;
    readonly routeShortName?: string;
    readonly routeLongName?: string;
    readonly headsign?: string;
    readonly serviceClass?: RoutingServiceClassCode | string;
    readonly physicalMode?: RoutingPhysicalModeCode | string;
};

export type RouteLeg = {
    readonly mode: RoutingLegModeCode;
    readonly profile?: RoutingRouteProfileCode | string;
    readonly physicalMode?: RoutingPhysicalModeCode | string;
    readonly serviceClass?: RoutingServiceClassCode | string;
    readonly distanceMeters: number;
    readonly durationSeconds: number;
    readonly from: RouteWaypoint;
    readonly to: RouteWaypoint;
    readonly geometry?: RouteGeoJsonLineString | null;
    readonly transit?: RouteLegTransitDetails | null;
    readonly instructions?: readonly string[];
};

export type RouteResponseDebug = {
    readonly buildCode?: string;
    readonly requestId?: string;
};

export type PostRouteResponseBody = {
    readonly status: RoutingRouteStatusCode;
    readonly routingEngine: RoutingEngineCode;
    readonly profile: string;
    readonly summary: RouteSummary;
    readonly geometry: RouteGeoJsonLineString | null;
    readonly legs: readonly RouteLeg[];
    readonly warnings: readonly string[];
    readonly debug?: RouteResponseDebug;
};

// -----------------------------------------------------------------------------
// Routing engine adapters (normalized — no Valhalla/OTP shapes)
// -----------------------------------------------------------------------------

/** Production routing backends wired through adapters (excludes API-only `mock`). */
export type RoutingEngineName = "valhalla" | "otp" | "external";

export type RoutingEngineHealthStatus = "healthy" | "degraded" | "down" | "unknown";

export type RoutingEngineHealth = {
    readonly engine: RoutingEngineName;
    readonly status: RoutingEngineHealthStatus;
    readonly latencyMs?: number;
    readonly message?: string;
    readonly checkedAt: string;
};

/** Engine-neutral route input (same shape as the public POST /routing/route body). */
export type NormalizedRouteRequest = PostRouteRequestBody;

/** Engine-neutral route output (same shape as the public route response). */
export type NormalizedRouteResponse = PostRouteResponseBody;

export type RoutingPublicProfile = {
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly isPublicEnabled: boolean;
    readonly isRoutingEnabled: boolean;
    readonly sortOrder: number;
    readonly primaryPhysicalModeCode: string | null;
    readonly source: "database" | "env";
};

export type RoutingProfilesResponse = {
    readonly profiles: readonly RoutingPublicProfile[];
    readonly source: "database" | "env";
};

export type RoutingHealthResponse = {
    readonly routingEnabled: boolean;
    readonly defaultEngine: string;
    readonly configuredPublicProfiles: readonly string[];
    readonly activeEngine: string;
    readonly engineHealth: RoutingEngineHealth | null;
};

// -----------------------------------------------------------------------------
// Route request audit log (routing.routing_requests)
// -----------------------------------------------------------------------------

/** Values allowed by migration 060 `routing_requests_status_chk`. */
export type RoutingDbRequestStatus = "success" | "error" | "timeout" | "rejected";

export type RoutingActiveBuildRef = {
    readonly routingBuildId: bigint;
    readonly buildCode: string;
};

export type RouteRequestLogStartResult = {
    readonly publicId: string;
    readonly internalId: bigint;
};

export type RoutingRequestLogCompletion = {
    readonly status: RoutingDbRequestStatus;
    readonly distanceM: number | null;
    readonly durationS: number | null;
    readonly durationMs: number;
    readonly requestSummaryPatch: Record<string, unknown>;
    readonly responseSummary: Record<string, unknown>;
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
};

export type RoutingRouteRequestContext = {
    readonly userId?: bigint | null;
    readonly warn?: (message: string, meta?: Record<string, unknown>) => void;
};
