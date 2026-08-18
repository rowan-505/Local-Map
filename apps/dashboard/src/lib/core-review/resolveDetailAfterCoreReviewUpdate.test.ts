import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isCompleteCoreReviewUpdateDetail,
    resolveDetailAfterCoreReviewUpdate,
} from "./resolveDetailAfterCoreReviewUpdate.js";

describe("isCompleteCoreReviewUpdateDetail", () => {
    it("accepts core-review street PATCH detail (camelCase)", () => {
        assert.equal(
            isCompleteCoreReviewUpdateDetail("streets", {
                publicId: "b9a8902c-d202-46b6-8e89-0a3bab75a648",
                roadClassId: "3",
                geometry: { type: "LineString", coordinates: [[96.1, 16.8], [96.2, 16.9]] },
            }),
            true,
        );
    });

    it("rejects street PATCH payload without geometry", () => {
        assert.equal(
            isCompleteCoreReviewUpdateDetail("streets", {
                publicId: "b9a8902c-d202-46b6-8e89-0a3bab75a648",
                roadClassId: "3",
            }),
            false,
        );
    });

    it("accepts landuse PATCH detail when public id is present", () => {
        assert.equal(
            isCompleteCoreReviewUpdateDetail("land-areas", {
                publicId: "abc",
                geometry: { type: "Polygon", coordinates: [] },
            }),
            true,
        );
    });
});

describe("resolveDetailAfterCoreReviewUpdate", () => {
    it("returns PATCH detail when complete and skips fetchDetail", async () => {
        const updated = {
            publicId: "street-1",
            roadClassId: "2",
            geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
        };
        let fetchCalls = 0;

        const fresh = await resolveDetailAfterCoreReviewUpdate({
            slug: "streets",
            recordId: "street-1",
            updated,
            fetchDetail: async () => {
                fetchCalls += 1;
                return { public_id: "legacy" } as never;
            },
        });

        assert.deepEqual(fresh, updated);
        assert.equal(fetchCalls, 0);
    });

    it("falls back to fetchDetail when PATCH detail is incomplete", async () => {
        let fetchCalls = 0;
        const legacy = { public_id: "legacy", road_class_id: "1", geometry: null };

        const fresh = await resolveDetailAfterCoreReviewUpdate({
            slug: "streets",
            recordId: "street-1",
            updated: { publicId: "street-1" },
            fetchDetail: async () => {
                fetchCalls += 1;
                return legacy as never;
            },
        });

        assert.deepEqual(fresh, legacy);
        assert.equal(fetchCalls, 1);
    });
});
