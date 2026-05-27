import assert from "node:assert/strict";
import test from "node:test";

import {
    formatImportReviewApiErrorBody,
    parseImportReviewApiErrorBody,
} from "./importReviewApiErrors";

test("parseImportReviewApiErrorBody reads ok:false envelope", () => {
    const parsed = parseImportReviewApiErrorBody({
        ok: false,
        error: "NOT_FOUND",
        message: "Candidate not found",
        details: null,
    });
    assert.ok(parsed);
    assert.equal(parsed.code, "NOT_FOUND");
    assert.equal(parsed.message, "Candidate not found");
});

test("parseImportReviewApiErrorBody returns null for success-shaped payload", () => {
    assert.equal(parseImportReviewApiErrorBody({ review_batch_id: "2", items: [] }), null);
});

test("formatImportReviewApiErrorBody handles malformed legacy message-only JSON", () => {
    const text = formatImportReviewApiErrorBody({ message: "Unauthorized" }, "fallback");
    assert.equal(text, "Unauthorized");
});

test("formatImportReviewApiErrorBody handles ok:false envelope", () => {
    const text = formatImportReviewApiErrorBody({
        ok: false,
        error: "INTERNAL_ERROR",
        message: "We could not load candidates.",
        details: null,
    });
    assert.equal(text, "We could not load candidates.");
});
