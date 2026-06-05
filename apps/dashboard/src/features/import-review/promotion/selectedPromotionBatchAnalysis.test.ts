import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import {
    analyzeSelectedPromotionBatch,
    selectedPromotionBatchBlockedReason,
} from "./selectedPromotionBatchAnalysis.js";

function row(
    overrides: Partial<ImportReviewBuildingListItem> = {}
): ImportReviewBuildingListItem {
    return {
        id: "10",
        public_id: "p10",
        review_batch_id: "2",
        source_snapshot_version: "v1",
        local_staging_id: "1",
        source_snapshot_id_local: null,
        external_id: null,
        canonical_name: "Road A",
        name: "Road A",
        class_code: null,
        building_type: null,
        building_type_id: null,
        admin_area_id: null,
        levels: null,
        height_m: null,
        area_m2: null,
        confidence_score: null,
        match_status: null,
        auto_action: null,
        review_status: "approved",
        review_decision: "approved",
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        normalized_data: null,
        promotion_status: null,
        promoted_core_id: null,
        ...overrides,
    } as ImportReviewBuildingListItem;
}

describe("analyzeSelectedPromotionBatch", () => {
    it("counts not-approved and promoted selections", () => {
        const items = [
            row({ id: "1", review_decision: "approved" }),
            row({ id: "2", review_decision: "needs_more_review" }),
            row({ id: "3", promotion_status: "promoted", promoted_core_id: "99" }),
        ];
        const analysis = analyzeSelectedPromotionBatch(items, new Set(["1", "2", "3"]));
        assert.equal(analysis.selectedCount, 3);
        assert.equal(analysis.notApprovedCount, 1);
        assert.equal(analysis.promotedCount, 1);
        assert.equal(analysis.selectedRows.length, 3);
    });

    it("detects manual_protected and batched rows", () => {
        const items = [
            row({ id: "1", match_status: "manual_protected" }),
            row({ id: "2", promotion_status: "batched" }),
        ];
        const analysis = analyzeSelectedPromotionBatch(items, new Set(["1", "2"]));
        assert.equal(analysis.manualProtectedCount, 1);
        assert.equal(analysis.batchedCount, 1);
    });
});

describe("selectedPromotionBatchBlockedReason", () => {
    it("blocks empty, promoted, and not-approved selections", () => {
        assert.match(
            selectedPromotionBatchBlockedReason({
                selectedCount: 0,
                selectedRows: [],
                notApprovedCount: 0,
                promotedCount: 0,
                manualProtectedCount: 0,
                batchedCount: 0,
            }) ?? "",
            /at least one/
        );
        assert.match(
            selectedPromotionBatchBlockedReason({
                selectedCount: 1,
                selectedRows: [row()],
                notApprovedCount: 0,
                promotedCount: 1,
                manualProtectedCount: 0,
                batchedCount: 0,
            }) ?? "",
            /already promoted/
        );
        assert.match(
            selectedPromotionBatchBlockedReason({
                selectedCount: 1,
                selectedRows: [row({ review_decision: "rejected" })],
                notApprovedCount: 1,
                promotedCount: 0,
                manualProtectedCount: 0,
                batchedCount: 0,
            }) ?? "",
            /approved/
        );
        assert.equal(
            selectedPromotionBatchBlockedReason({
                selectedCount: 1,
                selectedRows: [row()],
                notApprovedCount: 0,
                promotedCount: 0,
                manualProtectedCount: 0,
                batchedCount: 0,
            }),
            null
        );
    });
});
