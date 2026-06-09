import type { ValidationIssue } from "../../lib/core-review/ref-validation.js";

export class EntityAdminAreaValidationError extends Error {
    readonly issues: ValidationIssue[];

    constructor(message: string, issues: ValidationIssue[]) {
        super(message);
        this.name = "EntityAdminAreaValidationError";
        this.issues = issues;
    }
}
