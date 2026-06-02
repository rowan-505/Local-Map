import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    batchHasDeprecatedTransportPromotionItems,
    resolveBatchActiveFamilies,
    resolveBatchDeprecatedFamilies,
} from "./importReviewPromotionBatchFamilies.js";

describe("importReviewPromotionBatchFamilies", () => {
    it("splits active and deprecated families on legacy batches", () => {
        const detail = {
            entity_families: ["buildings", "bus_routes"],
            item_counts_by_entity_family: {
                buildings: { pending: 1, success: 0, failed: 0, skipped: 0, total: 1 },
                bus_routes: { pending: 2, success: 0, failed: 0, skipped: 0, total: 2 },
            },
        };

        assert.deepEqual(resolveBatchActiveFamilies(detail as never), ["buildings"]);
        assert.deepEqual(resolveBatchDeprecatedFamilies(detail as never), ["bus_routes"]);
        assert.equal(batchHasDeprecatedTransportPromotionItems(detail as never), true);
    });

    it("detects deprecated metadata without item counts", () => {
        const detail = {
            entity_families: ["bus_stops"],
            item_counts_by_entity_family: {},
        };
        assert.deepEqual(resolveBatchDeprecatedFamilies(detail as never), ["bus_stops"]);
        assert.equal(batchHasDeprecatedTransportPromotionItems(detail as never), false);
    });
});
