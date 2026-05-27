import assert from "node:assert/strict";
import test from "node:test";

import {
    formatImportReviewTechnicalError,
    isImportReviewInternalErrorMessage,
} from "./importReviewDetailErrors.js";

test("isImportReviewInternalErrorMessage detects Prisma/SQL errors", () => {
    assert.equal(
        isImportReviewInternalErrorMessage(
            'Invalid `prisma.$queryRaw()` invocation: syntax error at or near "CASE"'
        ),
        true
    );
    assert.equal(isImportReviewInternalErrorMessage("Network request failed"), false);
});

test("formatImportReviewTechnicalError returns error message", () => {
    assert.equal(
        formatImportReviewTechnicalError(new Error("syntax error at or near CASE")),
        "syntax error at or near CASE"
    );
});
