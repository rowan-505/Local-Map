import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectRoutingReadinessIssues } from "./import-review-road-routing-readiness-checks.js";
import type {
    RoadCandidatePromotionRow,
    RoadPublishItemRow,
} from "./import-review-promotion-road-dry-run.repo.js";

function item(): RoadPublishItemRow {
    return {
        publish_item_id: 1n,
        publish_action: "insert",
        review_candidate_id: 10n,
        review_batch_id: 2n,
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
        access: "yes",
        is_oneway: false,
        speed_kph: 40,
        bridge: false,
        tunnel: false,
        has_geom: true,
        srid: 4326,
        geom_type: "ST_LineString",
        is_valid: true,
        length_m: 100,
        part_count: 1,
        ...overrides,
    };
}

describe("collectRoutingReadinessIssues", () => {
    it("returns no errors for valid routing-ready row", () => {
        const { errors, warnings } = collectRoutingReadinessIssues({
            item: item(),
            candidate: candidate(),
            roadClassIdExists: true,
            duplicateExternalIdInCore: false,
            coreStreetExistsForUpdate: false,
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(warnings, []);
    });

    it("flags invalid geometry and missing road_class_id", () => {
        const { errors } = collectRoutingReadinessIssues({
            item: item(),
            candidate: candidate({
                has_geom: false,
                road_class_id: null,
                is_valid: null,
            }),
            roadClassIdExists: false,
            duplicateExternalIdInCore: false,
            coreStreetExistsForUpdate: false,
        });
        assert.ok(errors.includes("geom_missing"));
        assert.ok(errors.includes("road_class_id_missing"));
    });

    it("warns when speed_kph is null", () => {
        const { warnings } = collectRoutingReadinessIssues({
            item: item(),
            candidate: candidate({ speed_kph: null }),
            roadClassIdExists: true,
            duplicateExternalIdInCore: false,
            coreStreetExistsForUpdate: false,
        });
        assert.ok(warnings.includes("speed_kph_missing"));
    });

    it("flags invalid speed_kph and access", () => {
        const { errors } = collectRoutingReadinessIssues({
            item: item(),
            candidate: candidate({ speed_kph: 999, access: "not_a_real_access" }),
            roadClassIdExists: true,
            duplicateExternalIdInCore: false,
            coreStreetExistsForUpdate: false,
        });
        assert.ok(errors.includes("invalid_speed_kph"));
        assert.ok(errors.includes("invalid_access"));
    });
});
