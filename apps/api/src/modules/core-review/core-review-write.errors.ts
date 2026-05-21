import type { ValidationIssue } from "../../lib/core-review/ref-validation.js";

export class CoreReviewValidationError extends Error {
    readonly issues: ValidationIssue[];

    constructor(message: string, issues: ValidationIssue[] = []) {
        super(message);
        this.name = "CoreReviewValidationError";
        this.issues = issues;
    }
}

export class CoreReviewNotFoundError extends Error {
    constructor(message = "Record not found") {
        super(message);
        this.name = "CoreReviewNotFoundError";
    }
}

export class CoreReviewLifecycleNotSupportedError extends Error {
    constructor(message = "Soft delete is not supported for this entity") {
        super(message);
        this.name = "CoreReviewLifecycleNotSupportedError";
    }
}
