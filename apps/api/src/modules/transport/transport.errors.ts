/** Thrown when the `transport` schema/tables are not present in the connected database. */
export class TransportSchemaUnavailableError extends Error {
    constructor() {
        super(
            "Transport schema is not available. Ensure the transport.* tables exist in the connected database."
        );
        this.name = "TransportSchemaUnavailableError";
    }
}

/** Thrown when a transport entity lookup by id/publicId returns no row. */
export class TransportNotFoundError extends Error {
    constructor(
        public readonly entity: string,
        public readonly id: string
    ) {
        super(`Transport ${entity} not found: ${id}`);
        this.name = "TransportNotFoundError";
    }
}

/** Thrown when an update references a non-existent FK (e.g. admin_area_id, parent_stop_id). */
export class TransportInvalidReferenceError extends Error {
    constructor(public readonly field: string) {
        super(`Invalid reference for field: ${field}`);
        this.name = "TransportInvalidReferenceError";
    }
}

/**
 * Thrown when a manual name edit would leave an entity with neither a Myanmar
 * nor an English name. At least one of name_mm / name_en must remain set.
 */
export class TransportNameRequiredError extends Error {
    constructor() {
        super("At least one of name_mm or name_en is required.");
        this.name = "TransportNameRequiredError";
    }
}

/** Thrown when route metadata fields are invalid for the route mode or shape. */
export class TransportRouteMetadataError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TransportRouteMetadataError";
    }
}

/**
 * Thrown when an interactive route-stop transaction is closed by Prisma before
 * all of its queries finish (Prisma error P2028). Surfaced as a clear, retryable
 * error instead of leaking the raw Prisma transaction-not-found message.
 */
export class TransportRouteStopTransactionTimeoutError extends Error {
    constructor() {
        super("Transport route stop transaction timed out");
        this.name = "TransportRouteStopTransactionTimeoutError";
    }
}

/**
 * Thrown when creating a route (or its auto-generated variants) would collide
 * with an existing unique value — e.g. a duplicate `route_code` or a
 * `variant_code` already used by another route. Surfaced as a 409 conflict.
 */
export class TransportRouteConflictError extends Error {
    constructor(public readonly conflict: string) {
        super(conflict);
        this.name = "TransportRouteConflictError";
    }
}

/** Thrown when a review action or status transition is not allowed. */
export class TransportReviewGuardError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly blockers: string[] = [],
    ) {
        super(message);
        this.name = "TransportReviewGuardError";
    }
}

/**
 * Thrown when a transport admin feature is declared in the API but not implemented yet.
 * Surfaced as HTTP 501 so clients can show a stable "not implemented" state.
 */
export class TransportFeatureNotImplementedError extends Error {
    constructor(public readonly feature: string) {
        super(`Transport feature not implemented: ${feature}`);
        this.name = "TransportFeatureNotImplementedError";
    }
}

/** Thrown when generate-path-from-stops preconditions fail (stops, geometry, sequence). */
export class TransportGeneratePathFromStopsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TransportGeneratePathFromStopsError";
    }
}

/** Thrown when archiving a stop that is still referenced by one or more routes
 * (counted as distinct routes via non-deleted variants). The stop must be
 * removed from all routes first; archiving never deletes route_stops rows.
 */
export class TransportStopInUseError extends Error {
    constructor(public readonly routeCount: number) {
        super(
            "This stop is still used by routes. Remove it from all routes before deleting."
        );
        this.name = "TransportStopInUseError";
    }
}

/** Blocker codes returned when a stop cannot be permanently deleted. */
export type TransportStopDeleteBlocker =
    | "route_stops"
    | "variant_endpoints"
    | "child_stops"
    | "linked_terminals"
    | "fares"
    | "verified"
    | "manual_protected";

/**
 * Thrown when permanent stop deletion is blocked by references or protected
 * review_status (verified / manual_protected).
 */
export class TransportStopDeleteBlockedError extends Error {
    constructor(
        message: string,
        public readonly blockers: TransportStopDeleteBlocker[],
        public readonly hasRouteUsage: boolean,
        public readonly routeCount: number
    ) {
        super(message);
        this.name = "TransportStopDeleteBlockedError";
    }
}
