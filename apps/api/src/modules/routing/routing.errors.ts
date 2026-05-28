export { RoutingServiceDisabledError } from "../../config/env.js";

export class RoutingGraphBuildDisabledError extends Error {
    constructor() {
        super("Routing graph build is disabled. Set ENABLE_ROUTING_GRAPH_BUILD=true.");
        this.name = "RoutingGraphBuildDisabledError";
    }
}

export class RoutingGraphBuildInputError extends Error {
    readonly details?: Record<string, unknown>;

    constructor(message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "RoutingGraphBuildInputError";
        this.details = details;
    }
}

export class RoutingGraphBuildMaxRoadsError extends Error {
    readonly maxRoads: number;
    readonly requestedMaxRoads: number;

    constructor(requestedMaxRoads: number, maxRoads: number) {
        super(`max_roads ${requestedMaxRoads} exceeds allowed limit ${maxRoads}.`);
        this.name = "RoutingGraphBuildMaxRoadsError";
        this.maxRoads = maxRoads;
        this.requestedMaxRoads = requestedMaxRoads;
    }
}

export class RoutingGraphBuildJobNotFoundError extends Error {
    constructor(public readonly buildJobId: string) {
        super(`Routing build job not found: ${buildJobId}`);
        this.name = "RoutingGraphBuildJobNotFoundError";
    }
}

/** Base for route request policy failures (HTTP 400). */
export class RoutingRouteRequestError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown>;

    constructor(message: string, code: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "RoutingRouteRequestError";
        this.code = code;
        this.details = details;
    }
}

export class RoutingProfileUnsupportedError extends RoutingRouteRequestError {
    constructor(profile: string) {
        super(
            `Unsupported routing profile "${profile}". Expected one of: walk, car, motorcycle, multimodal.`,
            "ROUTING_PROFILE_UNSUPPORTED",
            { profile }
        );
        this.name = "RoutingProfileUnsupportedError";
    }
}

export class RoutingProfileDisabledError extends RoutingRouteRequestError {
    constructor(profile: string) {
        super(
            `Routing profile "${profile}" is not enabled yet.`,
            "ROUTING_PROFILE_DISABLED",
            { profile }
        );
        this.name = "RoutingProfileDisabledError";
    }
}

export class RoutingModeUnsupportedError extends RoutingRouteRequestError {
    constructor(mode: string) {
        super(
            `Unsupported transport mode "${mode}".`,
            "ROUTING_MODE_UNSUPPORTED",
            { mode }
        );
        this.name = "RoutingModeUnsupportedError";
    }
}

export class RoutingModeDisabledError extends RoutingRouteRequestError {
    constructor(mode: string) {
        super(
            `Transport mode "${mode}" is not enabled for routing yet.`,
            "ROUTING_MODE_DISABLED",
            { mode }
        );
        this.name = "RoutingModeDisabledError";
    }
}

export class RoutingEngineNotImplementedError extends Error {
    readonly engine: string;
    readonly statusCode = 501;

    constructor(engine: string) {
        super(`Routing engine "${engine}" is not implemented yet.`);
        this.name = "RoutingEngineNotImplementedError";
        this.engine = engine;
    }
}

export class RoutingEngineUpstreamError extends Error {
    readonly engine: string;
    readonly statusCode: number;
    readonly upstreamStatus?: number;
    readonly code: string;

    constructor(
        engine: string,
        message: string,
        options?: { statusCode?: number; upstreamStatus?: number; code?: string }
    ) {
        super(message);
        this.name = "RoutingEngineUpstreamError";
        this.engine = engine;
        this.statusCode = options?.statusCode ?? 502;
        this.upstreamStatus = options?.upstreamStatus;
        this.code = options?.code ?? "ROUTING_ENGINE_UPSTREAM_ERROR";
    }
}

/** Valhalla (or other engine) unreachable — maps to HTTP 503. */
export class RoutingEngineUnavailableError extends RoutingEngineUpstreamError {
    constructor(engine: string, message?: string, upstreamStatus?: number) {
        super(engine, message ?? "Routing engine is unavailable.", {
            statusCode: 503,
            upstreamStatus,
            code: "ROUTING_ENGINE_UNAVAILABLE",
        });
        this.name = "RoutingEngineUnavailableError";
    }
}

/** Upstream request timed out — maps to HTTP 504. */
export class RoutingEngineTimeoutError extends RoutingEngineUpstreamError {
    constructor(engine: string, message?: string) {
        super(engine, message ?? "Routing engine request timed out.", {
            statusCode: 504,
            code: "ROUTING_ENGINE_TIMEOUT",
        });
        this.name = "RoutingEngineTimeoutError";
    }
}

/** Malformed or unexpected engine payload — maps to HTTP 502. */
export class RoutingEngineInvalidResponseError extends RoutingEngineUpstreamError {
    constructor(engine: string, message: string) {
        super(engine, message, { statusCode: 502, code: "ROUTING_ENGINE_INVALID_RESPONSE" });
        this.name = "RoutingEngineInvalidResponseError";
    }
}

export class RoutingServiceClassUnsupportedError extends RoutingRouteRequestError {
    constructor(serviceClass: string) {
        super(
            `Unsupported service class "${serviceClass}".`,
            "ROUTING_SERVICE_CLASS_UNSUPPORTED",
            { serviceClass }
        );
        this.name = "RoutingServiceClassUnsupportedError";
    }
}
