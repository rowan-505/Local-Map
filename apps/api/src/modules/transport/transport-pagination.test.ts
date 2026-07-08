import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toTransportListResponse } from "./transport-pagination.js";

describe("toTransportListResponse", () => {
    it("returns empty list with page metadata", () => {
        assert.deepEqual(toTransportListResponse(undefined, { limit: 50, page: 1 }), {
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
            page: 1,
            hasNextPage: false,
        });
    });

    it("computes hasNextPage from offset and total", () => {
        assert.deepEqual(
            toTransportListResponse(
                { items: [{ id: 1 }], total: 120, limit: 50, offset: 50 },
                { page: 2 }
            ),
            {
                items: [{ id: 1 }],
                total: 120,
                limit: 50,
                offset: 50,
                page: 2,
                hasNextPage: true,
            }
        );
    });
});
