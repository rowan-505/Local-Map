import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PUBLISH_BATCH_ITEMS_MAX_LIMIT,
    parsePublishBatchItemsQuery,
    resolvePublishBatchItemFilter,
} from "./import-review-history-publish-batch-items-query.js";

describe("resolvePublishBatchItemFilter", () => {
    it("maps promoted to publish_status success", () => {
        assert.deepEqual(resolvePublishBatchItemFilter("promoted"), { publish_status: "success" });
    });

    it("maps blocked to validation_result status", () => {
        assert.deepEqual(resolvePublishBatchItemFilter("blocked"), { validation_status: "blocked" });
    });

    it("maps skipped_blocked to pending + blocked validation", () => {
        assert.deepEqual(resolvePublishBatchItemFilter("skipped_blocked"), {
            publish_status: "pending",
            validation_status: "blocked",
        });
    });
});

describe("parsePublishBatchItemsQuery", () => {
    it("accepts publish_status=failed with limit 200", () => {
        const parsed = parsePublishBatchItemsQuery({
            publish_status: "failed",
            limit: "200",
            offset: "0",
        });
        assert.equal(parsed.success, true);
        if (!parsed.success) {
            return;
        }
        assert.equal(parsed.data.publish_status, "failed");
        assert.equal(parsed.data.limit, 200);
        assert.equal(parsed.data.offset, 0);
    });

    it("accepts status=failed alias", () => {
        const parsed = parsePublishBatchItemsQuery({
            status: "failed",
            limit: 100,
        });
        assert.equal(parsed.success, true);
        if (!parsed.success) {
            return;
        }
        assert.equal(parsed.data.publish_status, "failed");
        assert.equal(parsed.data.validation_status, undefined);
    });

    it("rejects limit above max", () => {
        const parsed = parsePublishBatchItemsQuery({
            publish_status: "failed",
            limit: PUBLISH_BATCH_ITEMS_MAX_LIMIT + 1,
        });
        assert.equal(parsed.success, false);
    });

    it("rejects unknown filter token", () => {
        const parsed = parsePublishBatchItemsQuery({
            publish_status: "not_a_real_filter",
        });
        assert.equal(parsed.success, false);
    });

    it("rejects publish_status and status together", () => {
        const parsed = parsePublishBatchItemsQuery({
            publish_status: "failed",
            status: "pending",
        });
        assert.equal(parsed.success, false);
    });
});
