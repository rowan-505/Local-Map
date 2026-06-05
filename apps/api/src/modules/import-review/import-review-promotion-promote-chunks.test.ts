import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    chunkPublishItemIdsForFamily,
    isPerItemOnlyPromotionFamily,
    planFamilyPromotionIdChunks,
    resolvePromotionChunkSize,
    usesSimplePolygonPromotionPath,
} from "./import-review-promotion-promote-chunks.js";

describe("resolvePromotionChunkSize", () => {
    it("uses 100 for simple polygon/point families", () => {
        assert.equal(resolvePromotionChunkSize("places"), 100);
        assert.equal(resolvePromotionChunkSize("buildings"), 100);
        assert.equal(resolvePromotionChunkSize("landuse"), 100);
    });

    it("uses 25 for roads, admin_areas, routing_barriers, addresses", () => {
        assert.equal(resolvePromotionChunkSize("roads"), 25);
        assert.equal(resolvePromotionChunkSize("admin_areas"), 25);
        assert.equal(resolvePromotionChunkSize("routing_barriers"), 25);
        assert.equal(resolvePromotionChunkSize("addresses"), 25);
    });
});

describe("planFamilyPromotionIdChunks", () => {
    it("promote 35 places in one chunk", () => {
        const ids = Array.from({ length: 35 }, (_, i) => BigInt(i + 1));
        const plans = planFamilyPromotionIdChunks("places", ids);
        assert.equal(plans.length, 1);
        assert.equal(plans[0]?.publishItemIds.length, 35);
        assert.equal(plans[0]?.chunkSize, 100);
    });

    it("splits 26 roads into 25 + 1 chunks", () => {
        const ids = Array.from({ length: 26 }, (_, i) => BigInt(i + 1));
        const plans = planFamilyPromotionIdChunks("roads", ids);
        assert.equal(plans.length, 2);
        assert.equal(plans[0]?.publishItemIds.length, 25);
        assert.equal(plans[1]?.publishItemIds.length, 1);
    });

    it("chunkPublishItemIdsForFamily preserves order", () => {
        const ids = [3n, 1n, 2n];
        const chunks = chunkPublishItemIdsForFamily(ids, "places");
        assert.deepEqual(chunks, [ids]);
    });
});

describe("promotion family paths", () => {
    it("classifies simple polygon vs per-item families", () => {
        assert.equal(usesSimplePolygonPromotionPath("places"), true);
        assert.equal(isPerItemOnlyPromotionFamily("roads"), true);
        assert.equal(isPerItemOnlyPromotionFamily("places"), false);
    });
});
