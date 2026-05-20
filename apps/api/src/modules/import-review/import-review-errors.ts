export class ImportReviewBatchNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(public readonly batchIdOrSnapshotVersion: string) {
        super(`review scope not found: ${batchIdOrSnapshotVersion}`);
        this.name = "ImportReviewBatchNotFoundError";
    }
}

export class ImportReviewBatchAmbiguousError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly sourceSnapshotVersion: string,
        public readonly batches: import("./import-review-batch-resolver.js").ImportReviewBatchChoice[]
    ) {
        super(`Multiple review batches matched source_snapshot_version=${sourceSnapshotVersion}`);
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

export class ImportReviewCandidateNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(
        public readonly family: string,
        public readonly candidateId: string,
        public readonly scopeHint: string
    ) {
        super(`${family} candidate not found for id=${candidateId} (scope=${scopeHint})`);
        this.name = "ImportReviewCandidateNotFoundError";
    }
}

export class ImportReviewBuildingNotFoundError extends ImportReviewCandidateNotFoundError {
    constructor(
        public readonly buildingId: string,
        scopeHint: string
    ) {
        super("buildings", buildingId, scopeHint);
        this.name = "ImportReviewBuildingNotFoundError";
    }
}

export class ImportReviewPlaceNotFoundError extends ImportReviewCandidateNotFoundError {
    constructor(
        public readonly placeId: string,
        scopeHint: string
    ) {
        super("places", placeId, scopeHint);
        this.name = "ImportReviewPlaceNotFoundError";
    }
}

export class ImportReviewRoadNotFoundError extends ImportReviewCandidateNotFoundError {
    constructor(
        public readonly roadId: string,
        scopeHint: string
    ) {
        super("roads", roadId, scopeHint);
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
