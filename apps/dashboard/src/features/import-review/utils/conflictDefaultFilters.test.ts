import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readImportReviewListFilters } from "./entityPageUtils.js";

describe("import review default filters", () => {
    it("defaults review_decision to pending when URL omits it", () => {
        const filters = readImportReviewListFilters(new URLSearchParams("review_batch_id=5"));
        assert.equal(filters.review_decision, "pending");
        assert.equal(filters.match_status, "");
        assert.equal(filters.promotion_status, "");
    });

    it("respects explicit empty decision when URL sets review_decision=", () => {
        const filters = readImportReviewListFilters(new URLSearchParams("review_decision="));
        assert.equal(filters.review_decision, "");
    });

    it("respects explicit decision values", () => {
        const filters = readImportReviewListFilters(
            new URLSearchParams("review_decision=keep_existing&match_status=duplicate")
        );
        assert.equal(filters.review_decision, "keep_existing");
        assert.equal(filters.match_status, "duplicate");
    });
});
