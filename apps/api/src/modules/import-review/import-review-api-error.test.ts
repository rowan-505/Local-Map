import assert from "node:assert/strict";
import test from "node:test";

import { buildApiErrorResponse } from "../../lib/api-error-response.js";
import { importReviewInternalErrorMessage } from "./import-review-error-response.js";

test("buildApiErrorResponse includes ok:false envelope", () => {
    const body = buildApiErrorResponse("INTERNAL_ERROR", "Something failed", { hint: "dev" });
    assert.equal(body.ok, false);
    assert.equal(body.error, "INTERNAL_ERROR");
    assert.equal(body.message, "Something failed");
    assert.deepEqual(body.details, { hint: "dev" });
});

test("importReviewInternalErrorMessage hides prisma errors in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
        const msg = importReviewInternalErrorMessage(
            new Error('syntax error at or near "CASE" — $queryRaw')
        );
        assert.equal(msg, "An unexpected error occurred");
    } finally {
        process.env.NODE_ENV = prev;
    }
});

test("importReviewInternalErrorMessage preserves message in development", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
        const err = new Error("Table import_review.place_candidates does not exist");
        assert.equal(importReviewInternalErrorMessage(err), err.message);
    } finally {
        process.env.NODE_ENV = prev;
    }
});
