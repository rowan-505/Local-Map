import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    evaluatePublishBatchLimits,
    IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_ITEM_THRESHOLD,
} from "./batchLimits.js";

describe("evaluatePublishBatchLimits", () => {
    it("does not require high-risk confirmation for roads batch with 10 items", () => {
        const evaluation = evaluatePublishBatchLimits({
            families: ["roads"],
            totalItems: 10,
            confirmation: {
                confirmLargeBatch: false,
                allowHighRiskFamilies: false,
                mixedHighRiskConfirm: false,
            },
        });
        assert.equal(evaluation.needsHighRiskConfirm, false);
        assert.equal(evaluation.canProceed, true);
    });

    it("requires high-risk confirmation for roads batch above threshold", () => {
        const evaluation = evaluatePublishBatchLimits({
            families: ["roads"],
            totalItems: IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_ITEM_THRESHOLD + 1,
            confirmation: {
                confirmLargeBatch: false,
                allowHighRiskFamilies: false,
                mixedHighRiskConfirm: false,
            },
        });
        assert.equal(evaluation.needsHighRiskConfirm, true);
        assert.equal(evaluation.canProceed, false);
        assert.ok(evaluation.missingConfirmations.includes("allow_high_risk_families"));
    });

    it("requires large-batch confirmation above 200 items", () => {
        const evaluation = evaluatePublishBatchLimits({
            families: ["roads"],
            totalItems: 201,
            confirmation: {
                confirmLargeBatch: false,
                allowHighRiskFamilies: true,
                mixedHighRiskConfirm: false,
            },
        });
        assert.equal(evaluation.needsLargeBatchConfirm, true);
        assert.equal(evaluation.canProceed, false);
    });
});
