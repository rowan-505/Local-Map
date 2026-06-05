import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatImportReviewApiErrorBody } from "./importReviewApiErrors.js";

describe("formatImportReviewApiErrorBody bulk duplicate", () => {
    it("returns duplicate force approval message for 409 code", () => {
        const message = formatImportReviewApiErrorBody(
            {
                ok: false,
                error: "BULK_DUPLICATE_APPROVAL_REQUIRED",
                message: "Duplicate candidates require force approval.",
                details: { duplicate_ids: [1, 2] },
            },
            "fallback"
        );
        assert.equal(message, "Duplicate candidates require force approval.");
    });
});
