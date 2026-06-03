import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canCancelImportReviewPublishBatchValidation,
    canResetImportReviewPublishBatchValidation,
} from "./validationControl.js";

describe("validationControl", () => {
    it("allows reset for validating batch when heartbeat is stale", () => {
        assert.equal(
            canResetImportReviewPublishBatchValidation("validating", { heartbeatStaleWarning: true }),
            true
        );
        assert.equal(
            canResetImportReviewPublishBatchValidation("validating", { heartbeatStaleWarning: false }),
            false
        );
    });

    it("allows reset for failed or draft batches", () => {
        assert.equal(canResetImportReviewPublishBatchValidation("failed"), true);
        assert.equal(canResetImportReviewPublishBatchValidation("draft"), true);
    });

    it("blocks reset for promoted or promoting batches", () => {
        assert.equal(canResetImportReviewPublishBatchValidation("promoted"), false);
        assert.equal(canResetImportReviewPublishBatchValidation("promoting"), false);
    });

    it("allows cancel only while validating", () => {
        assert.equal(canCancelImportReviewPublishBatchValidation("validating"), true);
        assert.equal(canCancelImportReviewPublishBatchValidation("draft"), false);
    });
});
