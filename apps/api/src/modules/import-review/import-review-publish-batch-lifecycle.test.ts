import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishBatchDryRunPassed } from "./import-review-publish-batch-dry-run.js";
import {
    canDryRunPublishBatch,
    canPromotePublishBatch,
    canValidatePublishBatch,
    isPublishBatchClosedForReuse,
    normalizePublishBatchStoredStatus,
    publishBatchClosedForReuseMessage,
} from "./import-review-publish-batch-lifecycle.js";
import { computePublishBatchValidationFinalize } from "./import-review-promotion-validation-summary.js";

describe("publish batch DB lifecycle", () => {
    it("maps legacy statuses to ready/partial", () => {
        assert.equal(normalizePublishBatchStoredStatus("validated"), "ready");
        assert.equal(normalizePublishBatchStoredStatus("dry_run_passed"), "ready");
        assert.equal(normalizePublishBatchStoredStatus("partially_promoted"), "partial");
    });

    it("35 ready + 2 blocked => partial batch status", () => {
        const result = computePublishBatchValidationFinalize({
            readyCount: 35,
            warningCount: 0,
            blockedCount: 2,
            skippedCount: 0,
            totalCount: 37,
            promotableFamiliesCount: 1,
            by_publish_action: { insert: 37, update: 0, merge: 0 },
            by_entity: {},
            selected_entity_families: ["roads"],
            promotable_entity_families: ["roads"],
        });
        assert.equal(result.batchStatus, "partial");
    });

    it("dry-run and promote gates use ready/partial + summary dry_run_result", () => {
        assert.equal(canDryRunPublishBatch("partial", 10), true);
        assert.equal(canDryRunPublishBatch("ready", 0), false);
        const dryRun = {
            status: "passed",
            checked_at: "2026-06-03T00:00:00.000Z",
            total: 10,
            entity_families: ["roads"],
        };
        assert.equal(
            canPromotePublishBatch("partial", 2, publishBatchDryRunPassed(dryRun)),
            true
        );
        assert.equal(canPromotePublishBatch("partial", 2, false), false);
        assert.equal(
            canPromotePublishBatch("blocked", 35, publishBatchDryRunPassed(dryRun)),
            true
        );
        assert.equal(canPromotePublishBatch("blocked", 0, publishBatchDryRunPassed(dryRun)), false);
    });

    it("can re-validate ready and partial batches", () => {
        assert.equal(canValidatePublishBatch("ready"), true);
        assert.equal(canValidatePublishBatch("partial"), true);
        assert.equal(canValidatePublishBatch("promoted"), false);
        assert.equal(canValidatePublishBatch("failed"), false);
    });

    it("closes failed batches for dry-run and promote", () => {
        assert.equal(isPublishBatchClosedForReuse("failed"), true);
        assert.equal(canDryRunPublishBatch("failed", 2), false);
        assert.equal(canPromotePublishBatch("failed", 2, true), false);
        assert.match(publishBatchClosedForReuseMessage("failed"), /failed and is closed/i);
    });

    it("dry-run and promote require actual promotable count not validation snapshot", () => {
        assert.equal(canDryRunPublishBatch("partial", 0), false);
        assert.equal(canDryRunPublishBatch("partial", 2), true);
    });
});
