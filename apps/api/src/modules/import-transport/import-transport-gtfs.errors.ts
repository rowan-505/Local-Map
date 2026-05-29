export class ImportTransportGtfsSchemaMissingError extends Error {
    readonly statusCode = 503;
    readonly errorCode = "GTFS_EXPORT_SCHEMA_MISSING";

    constructor() {
        super(
            "gtfs_export schema is not available. Apply migrations 068 and 074 before using GTFS export APIs."
        );
        this.name = "ImportTransportGtfsSchemaMissingError";
    }
}

export class ImportTransportGtfsExportNotFoundError extends Error {
    readonly statusCode = 404;
    readonly errorCode = "GTFS_EXPORT_NOT_FOUND";

    constructor(public readonly exportId: string) {
        super(`GTFS export build not found: ${exportId}`);
        this.name = "ImportTransportGtfsExportNotFoundError";
    }
}
