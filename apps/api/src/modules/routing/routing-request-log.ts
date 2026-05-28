import {
    RoutingEngineTimeoutError,
    RoutingRouteRequestError,
} from "./routing.errors.js";
import type { PostRouteRequestBodyParsed } from "./routing.schema.js";
import type {
    NormalizedRouteResponse,
    RoutingDbRequestStatus,
    RoutingRequestLogCompletion,
} from "./routing.types.js";

export function buildRouteRequestStartSummary(
    parsed: PostRouteRequestBodyParsed,
    requestedAt: string
): Record<string, unknown> {
    return {
        requestStatus: "running",
        requestedAt,
        allowedModes: parsed.allowedModes ?? null,
        excludedModes: parsed.excludedModes ?? null,
        serviceClasses: parsed.serviceClasses ?? null,
        preference: parsed.preference ?? null,
        departureTime: parsed.departureTime ?? null,
        maxWalkMeters: parsed.maxWalkMeters ?? null,
        maxTransfers: parsed.maxTransfers ?? null,
        originLabel: parsed.origin.label ?? null,
        destinationLabel: parsed.destination.label ?? null,
    };
}

export function buildRouteRequestCompletedSummary(completedAt: string): Record<string, unknown> {
    return {
        requestStatus: "completed",
        completedAt,
    };
}

export function buildRouteRequestResponseSummary(
    response: NormalizedRouteResponse,
    options?: { buildCode?: string | null }
): Record<string, unknown> {
    return {
        routeStatus: response.status,
        engine: response.routingEngine,
        buildCode: options?.buildCode ?? response.debug?.buildCode ?? null,
        legCount: response.legs.length,
        warningCount: response.warnings.length,
        hasGeometry: response.geometry !== null,
        transferCount: response.summary.transferCount,
    };
}

/** Maps API route outcome to `routing.routing_requests.status` (060 CHECK constraint). */
export function mapApiRouteStatusToDbStatus(
    routeStatus: NormalizedRouteResponse["status"]
): RoutingDbRequestStatus {
    if (routeStatus === "error") {
        return "error";
    }
    return "success";
}

export function mapThrownErrorToDbStatus(error: unknown): RoutingDbRequestStatus {
    if (error instanceof RoutingEngineTimeoutError) {
        return "timeout";
    }
    if (error instanceof RoutingRouteRequestError) {
        return "rejected";
    }
    return "error";
}

export function mapThrownErrorToLogFields(error: unknown): {
    errorCode: string | null;
    errorMessage: string;
} {
    if (error instanceof RoutingRouteRequestError) {
        return {
            errorCode: error.code,
            errorMessage: error.message,
        };
    }
    if (error instanceof Error) {
        const code =
            "code" in error && typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : error.name;
        return {
            errorCode: code,
            errorMessage: error.message,
        };
    }
    return {
        errorCode: "UNKNOWN",
        errorMessage: "Routing request failed",
    };
}

export function buildRouteRequestFailureResponseSummary(
    error: unknown,
    options?: { buildCode?: string | null; engine?: string }
): Record<string, unknown> {
    const fields = mapThrownErrorToLogFields(error);
    return {
        routeStatus: "error",
        engine: options?.engine ?? null,
        buildCode: options?.buildCode ?? null,
        errorCode: fields.errorCode,
    };
}

export function toRouteRequestLogCompletion(
    response: NormalizedRouteResponse,
    durationMs: number,
    options?: { buildCode?: string | null }
): RoutingRequestLogCompletion {
    const completedAt = new Date().toISOString();
    return {
        status: mapApiRouteStatusToDbStatus(response.status),
        distanceM: response.summary.distanceMeters,
        durationS: response.summary.durationSeconds,
        durationMs,
        requestSummaryPatch: buildRouteRequestCompletedSummary(completedAt),
        responseSummary: buildRouteRequestResponseSummary(response, options),
        errorCode: response.status === "error" ? "ROUTE_ERROR" : null,
        errorMessage: response.status === "error" ? "Routing engine returned error status" : null,
    };
}

export function toRouteRequestLogFailure(
    error: unknown,
    durationMs: number,
    options?: { buildCode?: string | null; engine?: string }
): RoutingRequestLogCompletion {
    const fields = mapThrownErrorToLogFields(error);
    const completedAt = new Date().toISOString();
    return {
        status: mapThrownErrorToDbStatus(error),
        distanceM: null,
        durationS: null,
        durationMs,
        requestSummaryPatch: buildRouteRequestCompletedSummary(completedAt),
        responseSummary: buildRouteRequestFailureResponseSummary(error, options),
        errorCode: fields.errorCode,
        errorMessage: fields.errorMessage,
    };
}
