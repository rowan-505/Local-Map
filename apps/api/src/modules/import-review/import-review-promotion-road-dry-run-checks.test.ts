import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectRoadDryRunItemErrors } from "./import-review-promotion-road-dry-run-checks.js";
import type {
    RoadCandidatePromotionRow,
    RoadPublishItemRow,
} from "./import-review-promotion-road-dry-run.repo.js";

function item(overrides: Partial<RoadPublishItemRow> = {}): RoadPublishItemRow {
    return {
        publish_item_id: 1n,
        publish_action: "insert",
        review_candidate_id: 10n,
        review_batch_id: 2n,
        ...overrides,
    };
}

function candidate(overrides: Partial<RoadCandidatePromotionRow> = {}): RoadCandidatePromotionRow {
    return {
        id: 10n,
        review_batch_id: 2n,
        external_id: "way/1",
        canonical_name: "Road",
        class_code: "primary",
        road_class: "primary",
        review_status: "approved",
        review_decision: "approved",
        promotion_status: "pending",
        auto_action: null,
        confidence_score: 80,
        source_refs: {},
        validation_errors: [],
        validation_warnings: [],
        matched_core_id: null,
        road_class_id: 1n,
        access: null,
        is_oneway: null,
        speed_kph: null,
        bridge: null,
        tunnel: null,
        has_geom: true,
        srid: 4326,
        geom_type: "ST_LineString",
        is_valid: true,
        length_m: 100,
        part_count: 1,
        ...overrides,
    };
}

describe("collectRoadDryRunItemErrors", () => {
    it("returns no errors for a valid insert candidate", () => {
        const errors = collectRoadDryRunItemErrors({
            item: item(),
            candidate: candidate(),
            roadClassResolvable: true,
            duplicateExternalIdInCore: false,
            coreStreetExistsForUpdate: false,
        });
        assert.deepEqual(errors, []);
    });

    it("flags null geometry and invalid geom type", () => {
        const errors = collectRoadDryRunItemErrors({
            item: item(),
            candidate: candidate({ has_geom: false, geom_type: null, is_valid: null }),
            roadClassResolvable: true,
            duplicateExternalIdInCore: false,
            coreStreetExistsForUpdate: false,
        });
        assert.ok(errors.includes("geom_missing"));
    });

    it("flags invalid geometry and point types", () => {
        const errors = collectRoadDryRunItemErrors({
            item: item(),
            candidate: candidate({
                is_valid: false,
                geom_type: "ST_Point",
            }),
            roadClassResolvable: true,
            duplicateExternalIdInCore: false,
            coreStreetExistsForUpdate: false,
        });
        assert.ok(errors.includes("invalid_geom"));
        assert.ok(errors.includes("invalid_geom_type"));
    });

    it("flags duplicate external_id in core for inserts", () => {
        const errors = collectRoadDryRunItemErrors({
            item: item({ publish_action: "insert" }),
            candidate: candidate(),
            roadClassResolvable: true,
            duplicateExternalIdInCore: true,
            coreStreetExistsForUpdate: false,
        });
        assert.ok(errors.includes("duplicate_external_id_in_core"));
    });
});
