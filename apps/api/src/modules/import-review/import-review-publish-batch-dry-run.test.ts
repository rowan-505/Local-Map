import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    mergePublishBatchDryRunResult,
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
} from "./import-review-publish-batch-dry-run.js";

describe("publish batch dry-run summary", () => {
    it("parses dry_run_result with status, checked_at, total, entity_families", () => {
        const parsed = parsePublishBatchDryRunResultFromSummary({
            dry_run_result: {
                status: "passed",
                checked_at: "2026-06-03T12:00:00.000Z",
                total: 10,
                entity_families: ["roads"],
                ready_count: 2,
                blocked_count: 8,
            },
        });
        assert.ok(parsed);
        assert.equal(parsed?.status, "passed");
        assert.equal(parsed?.total, 10);
        assert.equal(publishBatchDryRunPassed(parsed), true);
    });

    it("does not treat batch status alone as dry-run passed", () => {
        assert.equal(publishBatchDryRunPassed(null), false);
    });

    it("preserves passed dry_run_result when merge gets empty failure", () => {
        const existing = {
            status: "passed",
            checked_at: "2026-06-03T12:00:00.000Z",
            total: 10,
            entity_families: ["roads"],
            ready_count: 2,
        };
        const merged = mergePublishBatchDryRunResult(existing, {
            status: "failed",
            checked_at: "2026-06-03T12:01:00.000Z",
            total: 0,
            entity_families: [],
        });
        assert.equal(merged.status, "passed");
        assert.equal(merged.total, 10);
    });
});
