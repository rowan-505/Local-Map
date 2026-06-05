import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    derivePublishBatchStatus,
    isPromotionFailedBatchState,
} from "./import-review-publish-batch-summary.js";

const baseCounts = {
    pending: 0,
    success: 0,
    failed: 35,
    skipped: 2,
    rolled_back: 0,
    total: 37,
};

describe("isPromotionFailedBatchState", () => {
    it("detects promotion_failed from summary promotion_status", () => {
        assert.equal(
            isPromotionFailedBatchState({
                stored_status: "partial",
                validated_at: new Date(),
                promoted_at: null,
                dry_run: false,
                validation_outcome: "partial",
                can_promote: true,
                promotion_status: "promotion_failed",
                item_counts: baseCounts,
                action_counts: { inserted: 0, updated: 0, merged: 0 },
                core_verified_count: 0,
                import_review_marked_promoted_count: 0,
                promotion_result_total: 37,
                promotion_result_success_count: 0,
                promotion_result_core_verified_count: 0,
                promotion_result_marked_promoted_count: 0,
            }),
            true
        );
    });

    it("partial validation before promotion is not promotion failed", () => {
        assert.equal(
            isPromotionFailedBatchState({
                stored_status: "partial",
                validated_at: new Date(),
                promoted_at: null,
                dry_run: false,
                validation_outcome: "partial",
                can_promote: true,
                promotion_status: null,
                item_counts: {
                    pending: 35,
                    success: 0,
                    failed: 0,
                    skipped: 2,
                    rolled_back: 0,
                    total: 37,
                },
                action_counts: { inserted: 0, updated: 0, merged: 0 },
                core_verified_count: 0,
                import_review_marked_promoted_count: 0,
                promotion_result_total: null,
                promotion_result_success_count: null,
                promotion_result_core_verified_count: null,
                promotion_result_marked_promoted_count: null,
            }),
            false
        );
    });
});

describe("derivePublishBatchStatus promotion vs validation", () => {
    it("0 promoted + 35 failed derives failed, not partial", () => {
        const derived = derivePublishBatchStatus({
            stored_status: "failed",
            validated_at: new Date(),
            promoted_at: null,
            dry_run: false,
            validation_outcome: "partial",
            can_promote: true,
            promotion_status: "promotion_failed",
            item_counts: baseCounts,
            action_counts: { inserted: 0, updated: 0, merged: 0 },
            core_verified_count: 0,
            import_review_marked_promoted_count: 0,
            promotion_result_total: 37,
            promotion_result_success_count: 0,
            promotion_result_core_verified_count: 0,
            promotion_result_marked_promoted_count: 0,
        });
        assert.equal(derived.derived_status, "failed");
        assert.equal(derived.stored_status_recommendation, "failed");
        assert.match(derived.derived_status_reason ?? "", /retry batch/i);
    });

    it("partial validation before promotion remains partial", () => {
        const derived = derivePublishBatchStatus({
            stored_status: "partial",
            validated_at: new Date(),
            promoted_at: null,
            dry_run: false,
            validation_outcome: "partial",
            can_promote: true,
            promotion_status: null,
            item_counts: {
                pending: 35,
                success: 0,
                failed: 0,
                skipped: 2,
                rolled_back: 0,
                total: 37,
            },
            action_counts: { inserted: 0, updated: 0, merged: 0 },
            core_verified_count: 0,
            import_review_marked_promoted_count: 0,
            promotion_result_total: null,
            promotion_result_success_count: null,
            promotion_result_core_verified_count: null,
            promotion_result_marked_promoted_count: null,
        });
        assert.equal(derived.derived_status, "partial");
    });

    it("stored blocked with promotable pending derives partial for UI", () => {
        const derived = derivePublishBatchStatus({
            stored_status: "blocked",
            validated_at: new Date(),
            promoted_at: null,
            dry_run: false,
            validation_outcome: "blocked",
            can_promote: true,
            promotion_status: null,
            item_counts: {
                pending: 35,
                success: 0,
                failed: 0,
                skipped: 2,
                rolled_back: 0,
                total: 37,
            },
            action_counts: { inserted: 0, updated: 0, merged: 0 },
            core_verified_count: 0,
            import_review_marked_promoted_count: 0,
            promotion_result_total: null,
            promotion_result_success_count: null,
            promotion_result_core_verified_count: null,
            promotion_result_marked_promoted_count: null,
        });
        assert.equal(derived.derived_status, "partial");
        assert.equal(derived.stored_status_recommendation, "partial");
    });

    it("draft stored status with partial validation derives partial not draft", () => {
        const derived = derivePublishBatchStatus({
            stored_status: "draft",
            validated_at: new Date(),
            promoted_at: null,
            dry_run: false,
            validation_outcome: "partial",
            can_promote: true,
            promotion_status: null,
            item_counts: {
                pending: 34,
                success: 0,
                failed: 0,
                skipped: 2,
                rolled_back: 0,
                total: 36,
            },
            action_counts: { inserted: 0, updated: 0, merged: 0 },
            core_verified_count: 0,
            import_review_marked_promoted_count: 0,
            promotion_result_total: null,
            promotion_result_success_count: null,
            promotion_result_core_verified_count: null,
            promotion_result_marked_promoted_count: null,
        });
        assert.equal(derived.derived_status, "partial");
        assert.equal(derived.stored_status_recommendation, "partial");
    });
});
