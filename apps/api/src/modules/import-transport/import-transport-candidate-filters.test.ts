import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    hidePromotedCandidatesSql,
    shouldHidePromotedCandidates,
} from "./import-transport-candidate-filters.js";

describe("import-transport candidate filters", () => {
    it("hides promoted rows by default", () => {
        assert.equal(shouldHidePromotedCandidates(undefined, undefined), true);
        assert.equal(shouldHidePromotedCandidates(false, undefined), true);
    });

    it("includes promoted rows when include_promoted=true", () => {
        assert.equal(shouldHidePromotedCandidates(true, undefined), false);
    });

    it("does not hide when promotion_status filter is explicit", () => {
        assert.equal(shouldHidePromotedCandidates(false, "promoted"), false);
        assert.equal(shouldHidePromotedCandidates(undefined, "ready"), false);
    });

    it("builds hide-promoted SQL only when column exists", () => {
        const clause = hidePromotedCandidatesSql("r", new Set(["promotion_status"]), false, undefined);
        assert.notEqual(clause, null);
        assert.match(String(clause?.sql ?? ""), /promotion_status/);
        assert.equal(
            hidePromotedCandidatesSql("r", new Set(["review_status"]), false, undefined),
            null
        );
        assert.equal(
            hidePromotedCandidatesSql("r", new Set(["promotion_status"]), true, undefined),
            null
        );
    });
});
