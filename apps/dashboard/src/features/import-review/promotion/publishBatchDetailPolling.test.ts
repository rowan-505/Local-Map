import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewPublishBatchProgressResponse } from "@/src/lib/api";

import { shouldPollPublishBatchDetail } from "./publishBatchDetailPolling";

function progress(
    partial: Partial<ImportReviewPublishBatchProgressResponse>
): ImportReviewPublishBatchProgressResponse {
    return {
        batch_id: "1",
        status: "ready",
        derived_status: "ready",
        derived_status_reason: null,
        stored_status_recommendation: null,
        status_note: null,
        workflow: "idle",
        validation_total: 0,
        validation_done: 0,
        validation_percent: 0,
        total_item_count: 0,
        item_processed_count: 0,
        stage_count: 0,
        validated_at: null,
        current_stage_key: null,
        current_stage_label: null,
        current_stage_status: null,
        current_entity_family: null,
        current_message: null,
        validation_result: null,
        validation_logs_summary: null,
        promotion_result: null,
        promotion_logs_summary: null,
        validation_heartbeat_at: null,
        validation_cancel_requested_at: null,
        validation_heartbeat_stale_warning: false,
        ...partial,
    };
}

describe("shouldPollPublishBatchDetail", () => {
    it("polls while validating", () => {
        assert.equal(shouldPollPublishBatchDetail(null, "validating"), true);
    });

    it("polls while promoting", () => {
        assert.equal(shouldPollPublishBatchDetail(null, "promoting"), true);
    });

    it("polls when pipeline stage is running", () => {
        assert.equal(
            shouldPollPublishBatchDetail(
                progress({ current_stage_status: "running", status: "ready" }),
                "ready"
            ),
            true
        );
    });

    it("polls when resume_validation is offered", () => {
        assert.equal(
            shouldPollPublishBatchDetail(
                progress({ resumable_actions: ["resume_validation", "cancel_validation"] }),
                "validating"
            ),
            true
        );
    });

    it("stops when batch is stable ready with no pipeline", () => {
        assert.equal(shouldPollPublishBatchDetail(progress({ resumable_actions: ["dry_run"] }), "ready"), false);
    });
});
