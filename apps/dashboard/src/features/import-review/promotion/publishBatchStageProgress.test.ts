import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewPublishBatchProgressResponse } from "@/src/lib/api";

import { getPromotionProgress, getValidationProgress } from "./publishBatchStageProgress.js";

function baseProgress(
    overrides: Partial<ImportReviewPublishBatchProgressResponse>
): ImportReviewPublishBatchProgressResponse {
    return {
        batch_id: "36",
        status: "promoting",
        derived_status: "promoting",
        derived_status_reason: null,
        stored_status_recommendation: null,
        status_note: null,
        workflow: "promotion",
        validation_total: 756,
        validation_done: 25,
        validation_percent: 3,
        total_item_count: 756,
        item_processed_count: 25,
        stage_count: 0,
        validated_at: "2026-06-01T12:00:00.000Z",
        current_stage_key: "promote_items",
        current_stage_label: "Promoting",
        current_stage_status: "running",
        current_entity_family: "roads",
        current_message: null,
        validation_result: {
            outcome: "ready",
            can_promote: true,
            requires_warning_confirmation: false,
            valid_count: 756,
            ready_count: 756,
            warning_count: 0,
            blocked_count: 0,
            skipped_count: 0,
            promotable_count: 756,
            total_count: 756,
            total_items: 756,
            by_publish_action: { insert: 756, update: 0, merge: 0 },
            by_entity: {},
            promotable_entity_families: [],
        },
        validation_logs_summary: null,
        promotion_result: null,
        promotion_logs_summary: null,
        validation_heartbeat_at: null,
        validation_cancel_requested_at: null,
        validation_heartbeat_stale_warning: false,
        current_stage: "promote_items",
        percent: 3,
        processed_count: 25,
        total: 756,
        last_heartbeat_at: null,
        resumable_actions: [],
        promotion_status: "promoting",
        ...overrides,
    };
}

describe("getValidationProgress", () => {
    it("keeps validation at 756/756 (100%) while promotion is at 25/756", () => {
        const progress = baseProgress({});
        const validation = getValidationProgress(progress);
        const promotion = getPromotionProgress(progress, {
            promotion_progress_done: 25,
            promotion_progress_total: 756,
        });

        assert.equal(validation.done, 756);
        assert.equal(validation.total, 756);
        assert.equal(validation.percent, 100);
        assert.equal(validation.active, false);

        assert.equal(promotion.done, 25);
        assert.equal(promotion.total, 756);
        assert.equal(promotion.percent, 3);
        assert.equal(promotion.active, true);
    });

    it("uses live validation counts only while validation stage is active", () => {
        const progress = baseProgress({
            status: "validating",
            workflow: "validation",
            validated_at: null,
            validation_done: 40,
            validation_total: 756,
            validation_percent: 5,
            current_stage: "validate_items",
            processed_count: 40,
            total: 756,
            percent: 5,
            validation_result: null,
        });

        const validation = getValidationProgress(progress);
        assert.equal(validation.active, true);
        assert.equal(validation.done, 40);
        assert.equal(validation.total, 756);
        assert.equal(validation.percent, 5);
    });
});
