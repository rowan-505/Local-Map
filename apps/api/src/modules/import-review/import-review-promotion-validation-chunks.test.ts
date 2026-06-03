import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    planFamilyValidationChunks,
    resolvePromotionValidationChunkSize,
} from "./import-review-promotion-validation-chunks.js";
import type { PublishItemValidationTarget } from "./import-review-promotion-simple-batch-validation.js";

function target(id: number, family: string): PublishItemValidationTarget {
    return {
        publish_item_id: BigInt(id),
        entity_family: family,
        review_candidate_id: BigInt(1000 + id),
        review_batch_id: 2n,
    };
}

describe("resolvePromotionValidationChunkSize", () => {
    it("uses 25 for roads and high-risk families", () => {
        assert.equal(resolvePromotionValidationChunkSize("roads"), 25);
        assert.equal(resolvePromotionValidationChunkSize("admin_areas"), 25);
        assert.equal(resolvePromotionValidationChunkSize("routing_barriers"), 25);
        assert.equal(resolvePromotionValidationChunkSize("addresses"), 25);
    });

    it("uses capped env chunk size for simple families", () => {
        const size = resolvePromotionValidationChunkSize("buildings");
        assert.ok(size >= 10);
        assert.ok(size <= 100);
    });
});

describe("planFamilyValidationChunks", () => {
    it("orders families buildings before places before roads", () => {
        const plans = planFamilyValidationChunks([
            target(3, "roads"),
            target(1, "buildings"),
            target(2, "places"),
        ]);
        assert.equal(plans[0]?.family, "buildings");
        assert.equal(plans[1]?.family, "places");
        assert.equal(plans[2]?.family, "roads");
    });

    it("splits 250 buildings into three chunks when chunk size is 100", () => {
        const targets = Array.from({ length: 250 }, (_, i) => target(i + 1, "buildings"));
        const plans = planFamilyValidationChunks(targets).filter((p) => p.family === "buildings");
        const chunkSize = resolvePromotionValidationChunkSize("buildings");
        const expectedChunks = Math.ceil(250 / chunkSize);
        assert.equal(plans.length, expectedChunks);
        assert.equal(
            plans.reduce((sum, p) => sum + p.targets.length, 0),
            250
        );
    });
});
