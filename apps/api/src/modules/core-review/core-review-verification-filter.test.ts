import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    normalizeCoreReviewVerificationStatus,
    resolveCoreReviewVerificationFilter,
} from "./core-review-verification-filter.js";

describe("core-review-verification-filter", () => {
    it("normalizes rejected alias", () => {
        assert.equal(normalizeCoreReviewVerificationStatus("rejected"), "rejected_after_core_review");
    });

    it("returns verificationStatus when provided", () => {
        assert.deepEqual(resolveCoreReviewVerificationFilter({ verificationStatus: "needs_fix" }), {
            verificationStatus: "needs_fix",
        });
    });

    it("returns undefined when verificationStatus is omitted", () => {
        assert.equal(resolveCoreReviewVerificationFilter({}), undefined);
    });
});
