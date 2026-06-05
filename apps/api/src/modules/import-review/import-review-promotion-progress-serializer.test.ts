import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildMinimalPublishBatchProgressResponse,
    normalizePromotionResultForResponse,
    normalizeValidationResultForResponse,
    serializePublishBatchProgressResponse,
} from "./import-review-promotion-progress-serializer.js";
import type { ImportReviewPublishBatchProgressResponse } from "./import-review-promotion.types.js";

describe("import-review-promotion-progress-serializer", () => {
    it("drops promotion_result when started_at/finished_at are empty (polluted batch summary)", () => {
        const normalized = normalizePromotionResultForResponse({
            status: "partially_promoted",
            inserted_count: 10,
            updated_count: 0,
            success_count: 10,
            failed_count: 5,
            skipped_count: 0,
            total: 15,
            core_verified_count: 0,
            import_review_marked_promoted_count: 10,
            verification_metadata_applied_count: 0,
            verification_metadata_skipped_already_verified_count: 0,
            started_at: "",
            finished_at: "",
            duration_ms: 0,
            promoted_entity_families: ["roads"],
        });
        assert.equal(normalized, null);
    });

    it("normalizes by_entity ready+valid for OpenAPI entity counts", () => {
        const normalized = normalizeValidationResultForResponse({
            outcome: "partial",
            can_promote: true,
            requires_warning_confirmation: false,
            ready_count: 200,
            valid_count: 200,
            warning_count: 10,
            blocked_count: 66,
            skipped_count: 0,
            promotable_count: 210,
            total_count: 276,
            total_items: 276,
            by_publish_action: { insert: 276, update: 0, merge: 0 },
            by_entity: {
                roads: {
                    total: 276,
                    ready: 200,
                    valid: 200,
                    warning: 10,
                    blocked: 66,
                    skipped: 0,
                },
            },
            entity_family: { buildings: 0 },
            promotable_entity_families: ["roads"],
        });
        assert.equal(normalized?.by_entity.roads?.ready, 200);
        assert.equal(normalized?.by_entity.roads?.valid, 200);
    });

    it("serializes progress with required booleans and road gates extras", () => {
        const base: ImportReviewPublishBatchProgressResponse = {
            batch_id: "24",
            status: "partial",
            derived_status: "partial",
            derived_status_reason: "Partial promotion",
            stored_status_recommendation: null,
            status_note: "Partial promotion",
            workflow: "idle",
            validation_total: 276,
            validation_done: 276,
            validation_percent: 100,
            total_item_count: 276,
            item_processed_count: 276,
            stage_count: 5,
            validated_at: "2026-06-01T00:00:00.000Z",
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
            current_promotable_count: 50,
            validation_promotable_count: 200,
            publish_item_status_counts: {
                pending: 50,
                success: 160,
                failed: 66,
                skipped: 0,
                total: 276,
            },
            promotion_status: "partially_promoted",
            failed_ready_retry_count: 0,
            dry_run_result: null,
            current_stage: null,
            percent: 100,
            processed_count: 276,
            total: 276,
            last_heartbeat_at: null,
            resumable_actions: [],
            road_promotion_gates: {
                applies: true,
                can_promote: false,
                road_item_count: 276,
                roads_ready_count: 200,
                recommend_sql_bulk_promotion: true,
                api_bulk_promotion_allowed: false,
                sql_bulk_promotion_ready_threshold: 50,
                sql_bulk_promote_script: "tools/data-pipeline/import-review-bulk/roads_bulk_promote_new_auto.sql",
                sql_bulk_validate_script: "tools/data-pipeline/import-review-bulk/roads_bulk_validate.sql",
                env_enabled: true,
                gates: [],
                primary_blocker: "road_dry_run_completed",
                primary_blocker_message: "Run road dry-run first.",
            },
        };

        const serialized = serializePublishBatchProgressResponse(base);
        assert.equal(serialized.batch_id, "24");
        assert.equal(serialized.status, "partial");
        assert.equal(serialized.road_promotion_gates?.recommend_sql_bulk_promotion, true);

        const withDryRun = serializePublishBatchProgressResponse({
            ...base,
            dry_run_result: {
                status: "passed",
                checked_at: "2026-06-04T00:00:00.000Z",
                total: 10,
                ready_count: 10,
                entity_families: ["roads"],
            },
        });
        assert.equal(withDryRun.dry_run_result?.status, "passed");
        assert.equal(serialized.promotion_heartbeat_stale_warning, false);
        assert.equal(serialized.promotion_worker_in_process, false);
    });

    it("minimal progress preserves dry_run_result from batch summary", () => {
        const minimal = buildMinimalPublishBatchProgressResponse({
            batchId: "29",
            status: "ready",
            message: "pool busy",
            summary: {
                dry_run_result: {
                    status: "passed",
                    checked_at: "2026-06-04T00:00:00.000Z",
                    ran_at: "2026-06-04T00:00:00.000Z",
                    total: 10,
                    ready_count: 10,
                    blocked_count: 0,
                    failed_count: 0,
                    would_insert_count: 10,
                    would_update_count: 0,
                    entity_families: ["roads"],
                    sample_errors: [],
                },
            },
        });
        assert.equal(minimal.dry_run_result?.status, "passed");
    });
});
