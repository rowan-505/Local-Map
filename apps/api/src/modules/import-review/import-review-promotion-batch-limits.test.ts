import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertPublishBatchLimits,
    batchRequiresMixedHighRiskConfirm,
    IMPORT_REVIEW_DEFAULT_MAX_PUBLISH_BATCH_ITEMS,
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

    it("rejects roads without allow_high_risk_families", () => {
        assert.throws(
            () =>
                assertPublishBatchLimits({
                    families: ["roads"],
                    totalItems: 10,
                    confirmation: {},
                    context: "validate",
                }),
            (err: unknown) =>
                err instanceof ImportReviewPromotionBatchLimitsError &&
                err.details.violations.some((v) => v.code === "high_risk_families")
        );
    });

    it("allows roads-only with allow_high_risk_families", () => {
        assert.doesNotThrow(() =>
            assertPublishBatchLimits({
                families: ["roads"],
                totalItems: 50,
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
