import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isPublishBatchValidationSystemFailure,
    publishBatchValidationFailureHeadline,
    publishBatchValidationSystemFailureMessage,
} from "./publishBatchValidationFailure";

describe("publishBatchValidationFailure", () => {
    it("detects validation system failure from summary.validation_error", () => {
        assert.equal(
            isPublishBatchValidationSystemFailure({
                batchStatus: "failed",
                promotionStatus: "not_started",
                publishItemSuccessCount: 0,
                publishItemFailedCount: 10,
                summary: { validation_error: "invalid reference to FROM-clause entry for table spi" },
            }),
            true
        );
    });

    it("does not treat promotion_failed batches as validation failures", () => {
        assert.equal(
            isPublishBatchValidationSystemFailure({
                batchStatus: "failed",
                promotionStatus: "promotion_failed",
                publishItemSuccessCount: 0,
                publishItemFailedCount: 10,
                summary: { validation_error: "oops" },
            }),
            false
        );
    });

    it("uses validation headline and retry message copy", () => {
        assert.equal(publishBatchValidationFailureHeadline(true), "Validation failed");
        assert.equal(publishBatchValidationFailureHeadline(false), "Promotion failed");
        assert.match(
            publishBatchValidationSystemFailureMessage(),
            /Validation system error/i
        );
        assert.match(publishBatchValidationSystemFailureMessage(), /released for retry/i);
    });
});
