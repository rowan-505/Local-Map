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

/**
 * Thrown when inserting a stop into a route variant that already contains it.
 * route_stops has a UNIQUE (route_variant_id, stop_id) constraint, so the same
 * stop may appear at most once per variant.
 */
export class TransportRouteStopDuplicateError extends Error {
    constructor(public readonly stopRef: string) {
        super(`Stop is already in this route variant: ${stopRef}`);
        this.name = "TransportRouteStopDuplicateError";
    }
}
