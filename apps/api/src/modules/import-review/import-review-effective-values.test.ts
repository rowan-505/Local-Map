import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyImportReviewEffectiveFields } from "./import-review-effective-values.js";
import type { ImportReviewBuildingListItem } from "./import-review.types.js";

function minimalItem(overrides: Partial<ImportReviewBuildingListItem> = {}): ImportReviewBuildingListItem {
    return {
        id: "1",
        public_id: "pub",
        review_batch_id: "2",
        source_snapshot_version: "v1",
        local_staging_id: "1",
        source_snapshot_id_local: null,
        external_id: null,
        canonical_name: "residential",
        name: "residential",
        name_mm: null,
        name_en: null,
        class_code: "residential",
        building_type: null,
        building_type_id: null,
        admin_area_id: null,
        levels: null,
        height_m: null,
        area_m2: null,
        confidence_score: null,
        match_status: null,
        auto_action: null,
        review_status: null,
        review_decision: null,
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        normalized_data: { tags: {} },
        source_refs: {},
        matched_core_id: null,
        matched_core_table: null,
        matched_core_data: {},
        f2_comparison: {},
        validation_warnings: [],
        validation_errors: [],
        promotion_status: null,
        promoted_core_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        geometry: null,
        geom: null,
        centroid: null,
        road_candidate_road_class_id: null,
        road_candidate_class_label: null,
        road_candidate_surface: null,
        road_candidate_is_oneway: null,
        ...overrides,
    };
}

describe("applyImportReviewEffectiveFields typed columns", () => {
    it("returns typed name_en from DB row, not derived null", () => {
        const base = minimalItem({ name_en: null });
        const enriched = applyImportReviewEffectiveFields("buildings", base, {
            name_en: "smoke-test-direct",
            name_mm: null,
            canonical_name: "residential",
            class_code: "residential",
            normalized_data: { tags: {} },
        });
        assert.equal(enriched.name_en, "smoke-test-direct");
        assert.equal(enriched.effective_name_en, "smoke-test-direct");
    });

    it("returns typed class_code for routing_barriers", () => {
        const base = minimalItem({ class_code: "gate", name: "gate" });
        const enriched = applyImportReviewEffectiveFields("routing_barriers", base, {
            class_code: "smoke-test-gate",
            barrier_type: "gate",
            normalized_data: {},
        });
        assert.equal(enriched.class_code, "smoke-test-gate");
    });
});
