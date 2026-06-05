import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeBulkCandidateIds } from "./bulkCandidateIds.js";

describe("normalizeBulkCandidateIds", () => {
    it("converts string IDs to numbers", () => {
        assert.deepEqual(normalizeBulkCandidateIds(["1", "3", "7"]), [1, 3, 7]);
    });

    it("accepts numeric IDs", () => {
        assert.deepEqual(normalizeBulkCandidateIds([1, 3, 7]), [1, 3, 7]);
    });

    it("filters invalid values and de-duplicates", () => {
        assert.deepEqual(
            normalizeBulkCandidateIds(["1", "bad", "", null, undefined, "3", 1, "NaN", "7", "7"]),
            [1, 3, 7]
        );
    });

    it("returns empty array when nothing valid", () => {
        assert.deepEqual(normalizeBulkCandidateIds(["", "x", null]), []);
    });
});
