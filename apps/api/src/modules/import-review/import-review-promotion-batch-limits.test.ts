import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertPublishBatchLimits,
    batchRequiresMixedHighRiskConfirm,
    IMPORT_REVIEW_DEFAULT_MAX_PUBLISH_BATCH_ITEMS,
    IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_ITEM_THRESHOLD,
    IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_REQUIRED_MESSAGE,
    requiresPublishBatchHighRiskConfirmation,
} from "./import-review-promotion-batch-limits.js";
import { ImportReviewPromotionBatchLimitsError } from "./import-review-promotion.errors.js";

describe("assertPublishBatchLimits", () => {
    it("allows small selected batch without confirmation flags", () => {
        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["buildings"],
                totalItems: 5,
                confirmation: {},
                context: "create",
            })
        );
    });

    it("rejects batch >200 without confirm_large_batch", () => {
        assert.throws(
            () =>
                assertPublishBatchLimits({
                    families: ["buildings"],
                    totalItems: 250,
                    confirmation: {},
                    context: "create",
                }),
            (err: unknown) => {
                if (!(err instanceof ImportReviewPromotionBatchLimitsError)) {
                    return false;
                }
                return err.details.violations.some((v) => v.code === "batch_too_large");
            }
        );
    });

    it("allows batch >200 with confirm_large_batch", () => {
        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["buildings"],
                totalItems: 250,
                confirmation: { confirm_large_batch: true },
                context: "create",
            })
        );
    });

    it("allows roads batch with 10 items without allow_high_risk_families", () => {
        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["roads"],
                totalItems: 10,
                confirmation: {},
                context: "validate",
            })
        );
    });

    it("allows roads batch at threshold 50 without allow_high_risk_families", () => {
        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["roads"],
                totalItems: IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_ITEM_THRESHOLD,
                confirmation: {},
                context: "validate",
            })
        );
    });

    it("rejects roads batch with 51 items unless allow_high_risk_families=true", () => {
        assert.throws(
            () =>
                assertPublishBatchLimits({
                    families: ["roads"],
                    totalItems: 51,
                    confirmation: {},
                    context: "validate",
                }),
            (err: unknown) => {
                if (!(err instanceof ImportReviewPromotionBatchLimitsError)) {
                    return false;
                }
                const violation = err.details.violations.find((v) => v.code === "high_risk_families");
                return (
                    violation?.message === IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_REQUIRED_MESSAGE
                );
            }
        );

        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["roads"],
                totalItems: 51,
                confirmation: { allow_high_risk_families: true },
                context: "validate",
            })
        );
    });

    it("rejects roads batch with 201 items unless confirm_large_batch=true", () => {
        assert.throws(
            () =>
                assertPublishBatchLimits({
                    families: ["roads"],
                    totalItems: 201,
                    confirmation: { allow_high_risk_families: true },
                    context: "validate",
                }),
            (err: unknown) =>
                err instanceof ImportReviewPromotionBatchLimitsError &&
                err.details.violations.some((v) => v.code === "batch_too_large")
        );

        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["roads"],
                totalItems: 201,
                confirmation: {
                    allow_high_risk_families: true,
                    confirm_large_batch: true,
                },
                context: "validate",
            })
        );
    });

    it("allows roads-only with allow_high_risk_families when over threshold", () => {
        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["roads"],
                totalItems: 100,
                confirmation: { allow_high_risk_families: true },
                context: "create",
            })
        );
    });

    it("rejects mixed roads and buildings without mixed_high_risk_confirm", () => {
        assert.equal(
            batchRequiresMixedHighRiskConfirm(["roads", "buildings"]),
            true
        );
        assert.throws(
            () =>
                assertPublishBatchLimits({
                    families: ["roads", "buildings"],
                    totalItems: 20,
                    confirmation: { allow_high_risk_families: true },
                    context: "create",
                }),
            (err: unknown) =>
                err instanceof ImportReviewPromotionBatchLimitsError &&
                err.details.violations.some((v) => v.code === "mixed_high_risk")
        );
    });

    it("allows large mixed batch with all explicit flags", () => {
        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["roads", "buildings", "places"],
                totalItems: 1826,
                confirmation: {
                    confirm_large_batch: true,
                    allow_high_risk_families: true,
                    mixed_high_risk_confirm: true,
                },
                context: "validate",
            })
        );
    });
});

describe("IMPORT_REVIEW_DEFAULT_MAX_PUBLISH_BATCH_ITEMS", () => {
    it("defaults to 200", () => {
        assert.equal(IMPORT_REVIEW_DEFAULT_MAX_PUBLISH_BATCH_ITEMS, 200);
    });
});

describe("requiresPublishBatchHighRiskConfirmation", () => {
    it("is false for roads at 10 items", () => {
        assert.equal(requiresPublishBatchHighRiskConfirmation(["roads"], 10), false);
    });

    it("is true for roads at 51 items", () => {
        assert.equal(requiresPublishBatchHighRiskConfirmation(["roads"], 51), true);
    });
});
