import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeReviewOverridesForJsonStorage } from "./import-review-overrides-normalize.js";

describe("normalizeReviewOverridesForJsonStorage", () => {
    it("stores road ids as numbers", () => {
        const normalized = normalizeReviewOverridesForJsonStorage("roads", {
            road_class_id: "6",
            admin_area_id: "12",
            is_oneway: false,
        });
        assert.equal(normalized.road_class_id, 6);
        assert.equal(normalized.admin_area_id, 12);
        assert.equal(normalized.is_oneway, false);
    });
});
