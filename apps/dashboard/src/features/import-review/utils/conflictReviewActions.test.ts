import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    availableConflictReviewActions,
    comparisonStatusOf,
    applyStatusOf,
} from "./conflictReviewActions.js";
import { buildConflictFieldCompareRows } from "./conflictFieldCompare.js";

describe("conflictReviewActions", () => {
    it("maps legacy match_status into comparison status", () => {
        assert.equal(comparisonStatusOf({ match_status: "duplicate_candidate" }), "duplicate");
        assert.equal(comparisonStatusOf({ match_status: "delete_candidate" }), "possible_delete");
        assert.equal(comparisonStatusOf({ comparison_status: "conflict", match_status: "x" }), "conflict");
    });

    it("maps promotion_status into apply status", () => {
        assert.equal(applyStatusOf({ promotion_status: "not_ready" }), "not_applied");
        assert.equal(applyStatusOf({ promotion_status: "batched" }), "applying");
        assert.equal(applyStatusOf({ apply_status: "ready", promotion_status: "not_ready" }), "ready");
    });

    it("shows confirm soft delete only for possible_delete with matched core", () => {
        const actions = availableConflictReviewActions({
            match_status: "possible_delete",
            matched_core_id: "12",
            auto_action: null,
            comparison_status: null,
        } as never);
        const decisions = actions.map((a) => a.decision);
        assert.ok(decisions.includes("confirm_soft_delete"));
        assert.ok(decisions.includes("keep_existing"));
        assert.equal(decisions.includes("replace_existing"), false);
    });

    it("requires matched core for replace/merge/mark duplicate", () => {
        const withCore = availableConflictReviewActions({
            match_status: "conflict",
            matched_core_id: "9",
            auto_action: null,
            comparison_status: null,
        } as never).map((a) => a.decision);
        assert.ok(withCore.includes("replace_existing"));
        assert.ok(withCore.includes("merge_fields"));
        assert.ok(withCore.includes("mark_duplicate"));
        assert.ok(withCore.includes("insert_separate"));

        const withoutCore = availableConflictReviewActions({
            match_status: "conflict",
            matched_core_id: null,
            auto_action: null,
            comparison_status: null,
        } as never).map((a) => a.decision);
        assert.equal(withoutCore.includes("replace_existing"), false);
        assert.ok(withoutCore.includes("insert_separate"));
        assert.ok(withoutCore.includes("ignore_import"));
    });
});

describe("conflictFieldCompare", () => {
    it("builds side-by-side rows from imported_values and core_snapshot", () => {
        const rows = buildConflictFieldCompareRows({
            id: "1",
            public_id: "p",
            review_batch_id: "1",
            source_snapshot_version: "s",
            local_staging_id: "1",
            source_snapshot_id_local: null,
            external_id: "osm:node:1",
            canonical_name: "Imported Pagoda",
            name: "Imported Pagoda",
            class_code: "place_of_worship",
            building_type: null,
            building_type_id: null,
            admin_area_id: "3",
            levels: null,
            height_m: null,
            area_m2: null,
            confidence_score: 50,
            match_status: "duplicate",
            auto_action: null,
            review_status: "pending",
            review_decision: null,
            reviewed_by: null,
            reviewed_at: null,
            review_note: null,
            normalized_data: {
                imported_values: {
                    primary_name: "Imported Pagoda",
                    external_id: "osm:node:1",
                },
            },
            source_refs: {},
            matched_core_id: "14",
            matched_core_table: "core_places",
            matched_core_data: {
                primary_name: "Existing Pagoda",
                external_id: "osm:N:1",
            },
            f2_comparison: {},
            validation_warnings: [],
            validation_errors: [],
            promotion_status: "not_ready",
            promoted_core_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            geometry: null,
            payload: {
                imported_values: { primary_name: "Imported Pagoda", external_id: "osm:node:1" },
                core_snapshot: { primary_name: "Existing Pagoda", external_id: "osm:N:1" },
            },
        } as never);

        const primary = rows.find((r) => r.field === "primary_name");
        assert.ok(primary);
        assert.equal(primary!.imported, "Imported Pagoda");
        assert.equal(primary!.existing, "Existing Pagoda");
    });
});
