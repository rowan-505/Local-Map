import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyImportReviewEffectiveFields } from "./import-review-effective-values.js";
import type { ImportReviewBuildingListItem } from "./import-review.types.js";

function minimalRoadItem(
    overrides: Partial<ImportReviewBuildingListItem> = {}
): ImportReviewBuildingListItem {
    return {
        id: "1",
        public_id: "pub-1",
        review_batch_id: "2",
        source_snapshot_version: "snap_v1",
        local_staging_id: "10",
        source_snapshot_id_local: "10",
        external_id: "osm:W:382363624",
        canonical_name: "osm:W:382363624",
        name: null,
        class_code: "residential",
        building_type: null,
        building_type_id: null,
        admin_area_id: null,
        levels: null,
        height_m: null,
        area_m2: null,
        confidence_score: 65,
        match_status: "new",
        auto_action: null,
        review_status: "pending",
        review_decision: null,
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        normalized_data: {},
        source_refs: null,
        review_overrides: {},
        matched_core_id: null,
        matched_core_table: null,
        matched_core_data: null,
        f2_comparison: null,
        validation_warnings: null,
        validation_errors: null,
        promotion_status: null,
        promoted_core_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
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

describe("import-review road name fields on API responses", () => {
    it("adds name_mm and name_en for roads list/detail mapping", () => {
        const mapped = applyImportReviewEffectiveFields(
            "roads",
            minimalRoadItem({
                normalized_data: {
                    tags: { "name:my": "မြန်မာလမ်း", "name:en": "Myanmar Street" },
                },
            })
        );

        assert.equal(mapped.name_mm, "မြန်မာလမ်း");
        assert.equal(mapped.name_en, "Myanmar Street");
        assert.equal(mapped.effective_name_mm, "မြန်မာလမ်း");
        assert.equal(mapped.effective_name_en, "Myanmar Street");
        assert.equal(mapped.canonical_name, "osm:W:382363624");
    });

    it("prefers review_overrides name fields over imported tags", () => {
        const mapped = applyImportReviewEffectiveFields(
            "roads",
            minimalRoadItem({
                review_overrides: { name_mm: "Override MM", name_en: "Override EN" },
                normalized_data: {
                    tags: { "name:my": "Tag MM", "name:en": "Tag EN" },
                },
            })
        );

        assert.equal(mapped.name_mm, "Override MM");
        assert.equal(mapped.name_en, "Override EN");
    });

    it("returns null names when only osm ref is available", () => {
        const mapped = applyImportReviewEffectiveFields("roads", minimalRoadItem());

        assert.equal(mapped.name_mm, null);
        assert.equal(mapped.name_en, null);
    });

    it("does not use road class_code as English name", () => {
        const mapped = applyImportReviewEffectiveFields(
            "roads",
            minimalRoadItem({
                canonical_name: "residential",
                class_code: "residential",
                normalized_data: {
                    tags: { highway: "residential" },
                },
            })
        );

        assert.equal(mapped.name_en, null);
        assert.equal(mapped.name_mm, null);
    });
});
