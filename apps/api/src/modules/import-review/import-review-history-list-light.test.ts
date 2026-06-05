import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapReviewBatchHistoryListItemLight } from "./import-review-history-list-light.js";
import type { ReviewBatchRowDb } from "./import-review-history.repo.js";

function reviewRow(overrides: Partial<ReviewBatchRowDb> = {}): ReviewBatchRowDb {
    return {
        id: 18n,
        public_id: "rb-1",
        batch_name: "Test batch",
        source_snapshot_version: "snap-v1",
        source_snapshot_id_local: null,
        region_code: "yangon",
        entity_families: ["places"],
        status: "review_completed",
        upload_mode: "full",
        total_candidate_count: 100,
        uploaded_candidate_count: 95,
        preserved_reviewed_count: 40,
        skipped_count: 5,
        summary: {},
        uploaded_at: new Date("2024-06-01T00:00:00Z"),
        created_at: new Date("2024-06-01T00:00:00Z"),
        publish_batch_count: 2n,
        latest_validated_at: null,
        latest_promoted_at: null,
        validation_success_count: 1n,
        validation_fail_count: 0n,
        promotion_success_count: 10n,
        promotion_fail_count: 0n,
        ...overrides,
    };
}

describe("mapReviewBatchHistoryListItemLight", () => {
    it("maps summary counts without family table scans", () => {
        const item = mapReviewBatchHistoryListItemLight(reviewRow());
        assert.equal(item.id, "18");
        assert.equal(item.region_code, "yangon");
        assert.equal(item.counts.batch_total_candidates, 100);
        assert.equal(item.counts_by_entity_family.length, 0);
        assert.equal(item.publish_batches.publish_batch_count, 2);
    });
});
