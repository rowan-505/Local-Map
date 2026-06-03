import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import {
    isCandidateAlreadyPromoted,
    isCandidateFailedPromotionRetry,
    resolveCandidatePromotionUiState,
} from "./candidatePromotionUiState.js";

function row(
    overrides: Partial<ImportReviewBuildingListItem> = {}
): ImportReviewBuildingListItem {
    return {
        id: "59",
        public_id: "p59",
        review_batch_id: "2",
        source_snapshot_version: "v1",
        local_staging_id: "1",
        source_snapshot_id_local: null,
        external_id: null,
        canonical_name: "Test",
        name: "Test",
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
        source_refs: null,
        matched_core_id: null,
        matched_core_table: null,
        matched_core_data: null,
        f2_comparison: null,
        validation_warnings: null,
        validation_errors: null,
        promotion_status: "ready",
        promoted_core_id: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        geometry: null,
        ...overrides,
    };
}

describe("candidatePromotionUiState", () => {
    it("detects already promoted from promotion_status or promoted_core_id", () => {
        assert.equal(isCandidateAlreadyPromoted(row({ promotion_status: "promoted" })), true);
        assert.equal(isCandidateAlreadyPromoted(row({ promoted_core_id: "1001" })), true);
        assert.equal(isCandidateAlreadyPromoted(row({ promotion_status: "failed" })), false);
    });

    it("detects failed promotion retry state", () => {
        assert.equal(
            isCandidateFailedPromotionRetry(row({ promotion_status: "failed", review_status: "promotion_failed" })),
            true
        );
        assert.equal(isCandidateFailedPromotionRetry(row({ promotion_status: "promoted" })), false);
    });

    it("shows already promoted UI with core review link for places", () => {
        const state = resolveCandidatePromotionUiState({
            apiFamily: "places",
            row: row({ promotion_status: "promoted", promoted_core_id: "1001", promoted_at: "2024-06-01T00:00:00.000Z" }),
            reviewBatchId: "2",
            canEdit: true,
            promotable: true,
        });
        assert.equal(state.kind, "already_promoted");
        if (state.kind === "already_promoted") {
            assert.equal(state.promotedCoreId, "1001");
            assert.match(state.coreReviewHref ?? "", /\/places\/1001\/edit/);
        }
    });

    it("warns when review_decision is not approved", () => {
        const state = resolveCandidatePromotionUiState({
            apiFamily: "places",
            row: row({ review_decision: "rejected" }),
            reviewBatchId: "2",
            canEdit: true,
            promotable: true,
        });
        assert.equal(state.kind, "not_approved");
    });

    it("blocks when active publish batch is in-flight", () => {
        const state = resolveCandidatePromotionUiState({
            apiFamily: "places",
            row: row({ promotion_status: "batched" }),
            reviewBatchId: "2",
            canEdit: true,
            promotable: true,
            activePublishBatch: { id: "88", status: "validating" },
        });
        assert.equal(state.kind, "active_publish_batch");
    });

    it("allows retry label after failed promotion", () => {
        const state = resolveCandidatePromotionUiState({
            apiFamily: "places",
            row: row({ promotion_status: "failed", review_status: "promotion_failed" }),
            reviewBatchId: "2",
            canEdit: true,
            promotable: true,
        });
        assert.equal(state.kind, "retry_failed");
    });
});
