import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCoreReviewExactIdSearch } from "./core-review-id-search.js";

describe("parseCoreReviewExactIdSearch", () => {
    it("recognizes an exact numeric id", () => {
        assert.deepEqual(parseCoreReviewExactIdSearch(" 12345 "), {
            numericId: 12345n,
            publicId: null,
        });
    });

    it("recognizes a complete UUID public id", () => {
        const publicId = "2f0e7e1a-5ad2-4d73-9706-18ce4e3dd420";
        assert.deepEqual(parseCoreReviewExactIdSearch(publicId), {
            numericId: null,
            publicId,
        });
    });

    it("leaves partial and non-id values for normal text search", () => {
        assert.deepEqual(parseCoreReviewExactIdSearch("2f0e7e1a"), {
            numericId: null,
            publicId: null,
        });
        assert.deepEqual(parseCoreReviewExactIdSearch("Kyauktan"), {
            numericId: null,
            publicId: null,
        });
    });

    it("does not produce an out-of-range PostgreSQL bigint", () => {
        assert.deepEqual(parseCoreReviewExactIdSearch("9223372036854775808"), {
            numericId: null,
            publicId: null,
        });
    });
});
