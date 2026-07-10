import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStopMergeFieldComparison } from "./stopMergePreview.js";

describe("buildStopMergeFieldComparison", () => {
    const base = {
        name: "Stop A",
        name_mm: "မှတ်",
        name_en: "Stop A",
        stop_type: "station",
        admin_area_id: 1,
        confidence_score: 80,
        review_status: "reviewed",
        is_active: true,
        longitude: 96.15,
        latitude: 16.8,
    };

    it("marks differing scalar fields as not same", () => {
        const comparison = buildStopMergeFieldComparison(
            base,
            {
                ...base,
                name: "Stop B",
                review_status: "needs_review",
            },
            false,
            12.5,
        );

        assert.equal(comparison.name.same, false);
        assert.equal(comparison.review_status.same, false);
        assert.equal(comparison.geom.same, false);
        assert.equal(comparison.geom.distanceMeters, 12.5);
    });

    it("marks identical fields as same", () => {
        const comparison = buildStopMergeFieldComparison(base, base, true, 0);
        assert.equal(comparison.name.same, true);
        assert.equal(comparison.geom.same, true);
        assert.equal(comparison.geom.distanceMeters, 0);
    });
});
