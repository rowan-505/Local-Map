import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishBatchReadyForPromotion } from "./import-review-promotion-promote-readiness.js";

describe("validation abort stage cleanup contract", () => {
    it("promotion is blocked while batch status is validating", () => {
        assert.equal(
            publishBatchReadyForPromotion({
                batch: {
                    status: "validating",
                    validation_percent: 50,
                    validated_at: null,
                },
                validation: null,
            }),
            false
        );
    });

    it("promotion is blocked while batch status is failed after cancel", () => {
        assert.equal(
            publishBatchReadyForPromotion({
                batch: {
                    status: "failed",
                    validation_percent: 30,
                    validated_at: null,
                },
                validation: null,
            }),
            false
        );
    });
});
