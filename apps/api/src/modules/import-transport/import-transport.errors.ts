import type { ImportTransportFamily } from "./import-transport.config.js";

export class ImportTransportUnknownFamilyError extends Error {
    readonly statusCode = 404;
    readonly errorCode = "UNKNOWN_IMPORT_TRANSPORT_FAMILY";

    constructor(public readonly family: string) {
        super(`Unknown import-transport entity family: ${family}`);
        this.name = "ImportTransportUnknownFamilyError";
    }
}

export class ImportTransportInvalidScopeError extends Error {
    readonly statusCode = 400;
    readonly errorCode = "INVALID_SCOPE";

    constructor(message: string) {
        super(message);
        this.name = "ImportTransportInvalidScopeError";
    }
}

export class ImportTransportBatchNotFoundError extends Error {
    readonly statusCode = 404;
    readonly errorCode = "BATCH_NOT_FOUND";

    constructor(public readonly batchIdOrSnapshot: string) {
        super(`Import transport scope not found: ${batchIdOrSnapshot}`);
        this.name = "ImportTransportBatchNotFoundError";
    }
}

export class ImportTransportCandidateNotFoundError extends Error {
    readonly statusCode = 404;
    readonly errorCode = "NOT_FOUND";

    constructor(
        public readonly family: ImportTransportFamily,
        public readonly candidateId: string
    ) {
        super(`Import transport ${family} candidate not found: ${candidateId}`);
        this.name = "ImportTransportCandidateNotFoundError";
    }
}

export {
    ImportTransportPromotionBlockedError,
    ImportTransportPromotionWarningConfirmationRequiredError,
} from "./import-transport-promotion-eligibility.js";

export class ImportTransportValidationWarningNoteRequiredError extends Error {
    readonly statusCode = 400;
    readonly errorCode = "VALIDATION_WARNING_NOTE_REQUIRED";

    constructor(
        message = "A review note is required when confirming validation warnings."
    ) {
        super(message);
        this.name = "ImportTransportValidationWarningNoteRequiredError";
    }
}
