import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeCanApprove } from "./import-review-road-routing-validation.js";
import type { ImportReviewRoadValidationIssue } from "./import-review-road-routing-validation.types.js";
import { collectRoadDryRunItemErrors } from "./import-review-promotion-road-dry-run-checks.js";
import { resolveItemStatus } from "./import-review-promotion-road-dry-run.helpers.js";
import { roadValidationSqlRowToOutcome } from "./import-review-promotion-roads-validate-sql.js";
import { roadStoredValidationHasPromotionBlockers } from "./import-review-road-promotion-policy.js";

function warn(code: string, message: string): ImportReviewRoadValidationIssue {
    return { code, message, severity: "warning" };
}

function err(code: string, message: string): ImportReviewRoadValidationIssue {
    return { code, message, severity: "error" };
}

describe("import-review road routing warnings non-blocking", () => {
    it("allows approve when only one-way routing warnings exist without confirm flag", () => {
        const warnings = [
            warn("ONEWAY_CHANGED_WITHOUT_NOTE", "One-way changed on candidate without review_note."),
        ];
        assert.equal(computeCanApprove([], warnings, false), true);
    });

    it("allows approve when routing_validation-style warnings exist without confirm flag", () => {
        const warnings = [
            warn("START_ENDPOINT_ISOLATED", "Start endpoint has no connection within 35 m."),
            warn("ROAD_ISLAND", "Both endpoints appear disconnected from the road network."),
        ];
        assert.equal(computeCanApprove([], warnings, false), true);
    });

    it("still blocks approve when validation errors exist", () => {
        assert.equal(
            computeCanApprove([err("GEOMETRY_MISSING", "Road geometry is missing.")], [], false),
            false
        );
    });

    it("dry-run treats routing warnings as promote_with_warning not needs_manual_review", () => {
        assert.equal(resolveItemStatus([], ["ROAD_ISLAND"], false), "promote_with_warning");
        assert.equal(resolveItemStatus([], ["ONEWAY_CHANGED_WITHOUT_NOTE"], false), "promote_with_warning");
    });

    it("promotion validate SQL blocks missing admin_area_id", () => {
        const outcome = roadValidationSqlRowToOutcome({
            publish_item_id: 1n,
            candidate_id: 101n,
            validation_status: "blocked",
            error_code: "missing_admin_area",
            error_message: "Admin area is required.",
            validation_warnings: [],
        });
        assert.equal(outcome.status, "blocked");
        assert.equal(outcome.result.errors[0]?.code, "missing_admin_area");
    });

    it("promotion validate SQL blocks missing road_class", () => {
        const outcome = roadValidationSqlRowToOutcome({
            publish_item_id: 2n,
            candidate_id: 102n,
            validation_status: "blocked",
            error_code: "missing_road_class",
            error_message: "Road class is required.",
            validation_warnings: [],
        });
        assert.equal(outcome.status, "blocked");
        assert.equal(outcome.result.errors[0]?.code, "missing_road_class");
    });

    it("dry-run blocks duplicate external_id insert conflict in core", () => {
        const errors = collectRoadDryRunItemErrors({
            item: {
                publish_item_id: 1n,
                publish_action: "insert",
                review_candidate_id: 10n,
                review_batch_id: 2n,
            },
            candidate: {
                id: 10n,
                review_batch_id: 2n,
                external_id: "way/duplicate",
                canonical_name: "Road",
                class_code: "primary",
                road_class: "primary",
                review_status: "approved",
                review_decision: "approved",
                promotion_status: "pending",
                auto_action: "insert_candidate",
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
            },
            roadClassResolvable: true,
            duplicateExternalIdInCore: true,
            coreStreetExistsForUpdate: false,
        });
        assert.ok(errors.includes("duplicate_external_id_in_core"));
    });

    it("dry-run blocks update publish action without matched_core_id", () => {
        const errors = collectRoadDryRunItemErrors({
            item: {
                publish_item_id: 3n,
                publish_action: "update",
                review_candidate_id: 11n,
                review_batch_id: 2n,
            },
            candidate: {
                id: 11n,
                review_batch_id: 2n,
                external_id: "way/update",
                canonical_name: "Road",
                class_code: "primary",
                road_class: "primary",
                review_status: "approved",
                review_decision: "approved",
                promotion_status: "pending",
                auto_action: "update_candidate",
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
            },
            roadClassResolvable: true,
            duplicateExternalIdInCore: false,
            coreStreetExistsForUpdate: false,
        });
        assert.ok(errors.includes("update_target_missing"));
    });

    it("roadStoredValidationHasPromotionBlockers ignores routing warnings in validation_warnings", () => {
        assert.equal(
            roadStoredValidationHasPromotionBlockers([
                { code: "ROAD_ISLAND", severity: "warning", message: "island" },
            ]),
            false
        );
    });

    it("roadStoredValidationHasPromotionBlockers still blocks promotion-blocking validation_errors", () => {
        assert.equal(
            roadStoredValidationHasPromotionBlockers([
                { code: "GEOMETRY_MISSING", severity: "error", message: "missing geom" },
            ]),
            true
        );
    });
});
