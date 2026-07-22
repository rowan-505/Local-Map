import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    mergePromotionFailureRows,
    promotionFailureRowFromHistoryItem,
    promotionFailureRowFromSample,
    sanitizeOperatorMessage,
} from "./formatPromotionFailure";

describe("sanitizeOperatorMessage", () => {
    it("hides prisma stack traces from default display", () => {
        const msg = sanitizeOperatorMessage(
            "Invalid `prisma.$queryRaw()` invocation\nthis.prisma.$transaction is not a function"
        );
        assert.match(msg, /system error/i);
        assert.doesNotMatch(msg, /\$transaction/);
    });
});

describe("promotionFailureRowFromSample", () => {
    it("renders sample failures for dashboard table", () => {
        const row = promotionFailureRowFromSample({
            publish_item_id: "101",
            entity_family: "places",
            review_candidate_id: "55",
            external_id: "osm:node/1",
            target_schema: "core",
            target_table: "core_places",
            error_code: "CATEGORY_REQUIRED",
            error_message: "typed category_id is required",
            reason: "typed category_id is required",
        });
        assert.equal(row.target_table, "core.core_places");
        assert.equal(row.error_code, "CATEGORY_REQUIRED");
    });
});

describe("promotionFailureRowFromHistoryItem", () => {
    it("maps legacy after_data.error to technical_detail.raw_message", () => {
        const row = promotionFailureRowFromHistoryItem({
            run_id: "30",
            id: "1843",
            entity_family: "places",
            entity_id: null,
            publish_action: "insert",
            publish_status: "failed",
            review_decision: "replace_existing",
            source_snapshot_version: "snap-v1",
            review_candidate_table: "import_review.place_candidates",
            review_candidate_id: "100",
            external_id: "osm:node/1",
            target_schema: "core",
            target_table: "core_places",
            target_id: null,
            error_message: "Place promotion failed: this.prisma.$transaction is not a function",
            candidate_promotion_status: "not_ready",
            after_data: {
                error: "Place promotion failed: this.prisma.$transaction is not a function",
            },
            validation_result: null,
            applied_by: null,
            applied_at: null,
            published_at: null,
            created_at: "2026-06-03T00:00:00.000Z",
        });
        assert.equal(row.error_code, "PROMOTION_SYSTEM_ERROR");
        assert.match(row.error_message, /system error/i);
        assert.equal(
            row.technical_detail?.raw_message,
            "Place promotion failed: this.prisma.$transaction is not a function"
        );
    });
});

describe("mergePromotionFailureRows", () => {
    it("uses API sample failures when history list is empty", () => {
        const rows = mergePromotionFailureRows(
            [
                {
                    publish_item_id: "1",
                    entity_family: "places",
                    review_candidate_id: "10",
                    external_id: null,
                    target_schema: "core",
                    target_table: "core_places",
                    error_code: "INVALID_CATEGORY_ID",
                    error_message: "bad category",
                    reason: "bad category",
                },
            ],
            []
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.error_message, "bad category");
    });
});
