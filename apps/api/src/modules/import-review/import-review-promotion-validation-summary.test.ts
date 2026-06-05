import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computePublishBatchValidationFinalize } from "./import-review-promotion-validation-summary.js";

const emptyMeta = {
    promotableFamiliesCount: 1,
    by_publish_action: { insert: 0, update: 0, merge: 0 },
    by_entity: {},
    selected_entity_families: ["places"],
    promotable_entity_families: ["places"],
};

describe("computePublishBatchValidationFinalize", () => {
    it("35 ready + 2 blocked => validated (outcome partial), promotable_count=35", () => {
        const r = computePublishBatchValidationFinalize({
            ...emptyMeta,
            readyCount: 35,
            warningCount: 0,
            blockedCount: 2,
            skippedCount: 0,
            totalCount: 37,
        });
        assert.equal(r.batchStatus, "partial");
        assert.equal(r.validationResult.outcome, "partial");
        assert.equal(r.validationResult.promotable_count, 35);
        assert.equal(r.validationResult.ready_count, 35);
        assert.equal(r.validationResult.blocked_count, 2);
        assert.equal(r.validationResult.can_promote, true);
        assert.match(r.logsSummary, /Partial: 35 promotable, 2 blocked/);
    });

    it("0 ready + 2 blocked => validated, promotable_count=0", () => {
        const r = computePublishBatchValidationFinalize({
            ...emptyMeta,
            promotableFamiliesCount: 0,
            readyCount: 0,
            warningCount: 0,
            blockedCount: 2,
            skippedCount: 0,
            totalCount: 2,
        });
        assert.equal(r.batchStatus, "blocked");
        assert.equal(r.validationResult.outcome, "blocked");
        assert.equal(r.validationResult.promotable_count, 0);
        assert.equal(r.validationResult.can_promote, false);
    });

    it("all ready => ready", () => {
        const r = computePublishBatchValidationFinalize({
            ...emptyMeta,
            readyCount: 10,
            warningCount: 0,
            blockedCount: 0,
            skippedCount: 0,
            totalCount: 10,
        });
        assert.equal(r.batchStatus, "ready");
        assert.equal(r.validationResult.outcome, "passed");
        assert.equal(r.validationResult.promotable_count, 10);
        assert.equal(r.validationResult.can_promote, true);
    });

    it("ready + warnings => validated (outcome partial)", () => {
        const r = computePublishBatchValidationFinalize({
            ...emptyMeta,
            readyCount: 8,
            warningCount: 3,
            blockedCount: 0,
            skippedCount: 0,
            totalCount: 11,
        });
        assert.equal(r.batchStatus, "partial");
        assert.equal(r.validationResult.outcome, "partial");
        assert.equal(r.validationResult.promotable_count, 11);
        assert.equal(r.validationResult.requires_warning_confirmation, true);
        assert.equal(r.validationResult.can_promote, true);
    });
});
