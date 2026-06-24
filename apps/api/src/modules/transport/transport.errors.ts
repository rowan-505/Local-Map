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
