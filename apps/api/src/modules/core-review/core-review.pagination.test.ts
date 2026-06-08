import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildListResponse, buildPaginationMeta } from "./core-review.pagination.js";

describe("buildPaginationMeta", () => {
    it("returns null total and totalPages when count is skipped", () => {
        assert.deepEqual(buildPaginationMeta(1, 50, null), {
            page: 1,
            pageSize: 50,
            total: null,
            totalPages: null,
        });
    });

    it("computes totalPages for known totals", () => {
        assert.deepEqual(buildPaginationMeta(2, 25, 100), {
            page: 2,
            pageSize: 25,
            total: 100,
            totalPages: 4,
        });
    });
});

describe("buildListResponse", () => {
    it("embeds nullable pagination for progressive list responses", () => {
        const response = buildListResponse({
            data: [{ id: "1" }],
            page: 1,
            pageSize: 50,
            total: null,
            meta: { hasNextPage: true, totalKnown: false },
        });

        assert.equal(response.pagination.total, null);
        assert.equal(response.pagination.totalPages, null);
        assert.equal(response.meta?.hasNextPage, true);
    });
});
