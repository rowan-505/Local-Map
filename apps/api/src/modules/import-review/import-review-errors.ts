export class ImportReviewBatchNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(public readonly batchIdOrSnapshotVersion: string) {
        super(`review scope not found: ${batchIdOrSnapshotVersion}`);
        this.name = "ImportReviewBatchNotFoundError";
    }
}

export class ImportReviewBatchAmbiguousError extends Error {
    readonly statusCode = 409;

    constructor(public readonly sourceSnapshotVersion: string) {
        super(`Multiple import_review.review_batches matched source_snapshot_version=${sourceSnapshotVersion}`);
        this.name = "ImportReviewBatchAmbiguousError";
    }
}

export class ImportReviewInvalidScopeError extends Error {
    readonly statusCode = 400;

    constructor(message: string) {
        super(message);
        this.name = "ImportReviewInvalidScopeError";
    }
}

export class ImportReviewBuildingNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(
        public readonly buildingId: string,
        public readonly scopeHint: string
    ) {
        super(`Building candidate not found for id=${buildingId} (scope=${scopeHint})`);
        this.name = "ImportReviewBuildingNotFoundError";
    }
}

export class ImportReviewPlaceNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(
        public readonly placeId: string,
        public readonly scopeHint: string
    ) {
        super(`Place candidate not found for id=${placeId} (scope=${scopeHint})`);
        this.name = "ImportReviewPlaceNotFoundError";
    }
}

export class ImportReviewRoadNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(
        public readonly roadId: string,
        public readonly scopeHint: string
    ) {
        super(`Road candidate not found for id=${roadId} (scope=${scopeHint})`);
        this.name = "ImportReviewRoadNotFoundError";
    }
}

export class ImportReviewDecisionRuleError extends Error {
    readonly statusCode = 400;
    override readonly name = "ImportReviewDecisionRuleError";

    constructor(message: string) {
        super(message);
    }
}

/** PATCH road overrides rejected before persistence (missing road_class FK, malformed geom, unsafe surface…). */
export class ImportReviewRoadOverridesValidationFailedError extends Error {
    readonly statusCode = 400;
    override readonly name = "ImportReviewRoadOverridesValidationFailedError";

    constructor(
        public readonly errors: string[],
        public readonly warnings: string[]
    ) {
        super(errors[0] ?? "Road overrides validation failed");
    }
}

/** Routing continuity warnings — call again with confirm_acknowledge_routing_warnings=true. */
export class ImportReviewRoadOverridesWarningsPendingError extends Error {
    readonly statusCode = 409;
    override readonly name = "ImportReviewRoadOverridesWarningsPendingError";

    constructor(public readonly warnings: string[]) {
        super(warnings[0] ?? "Routing warnings require acknowledgement");
    }
}
