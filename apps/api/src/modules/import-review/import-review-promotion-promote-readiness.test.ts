import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PromotionPreflightValidation } from "./import-review-promotion-promote-api.js";
import {
    batchValidatedForPromotion,
    publishBatchReadyForPromotion,
    validationSummaryAllowsPromotion,
} from "./import-review-promotion-promote-readiness.js";

function validation(overrides: Partial<PromotionPreflightValidation> = {}): PromotionPreflightValidation {
    return {
        outcome: "passed",
        blocked_count: 0,
        warning_count: 0,
        ready_count: 1,
        promotable_count: 1,
        can_promote: true,
        requires_warning_confirmation: false,
        ...overrides,
    };
}

describe("import-review-promotion-promote-readiness", () => {
    it("batch status draft + validation complete allows promote", () => {
        assert.equal(
            publishBatchReadyForPromotion({
                batch: {
                    status: "draft",
                    validation_percent: 100,
                    validated_at: new Date("2024-01-01T00:00:00Z"),
                },
                validation: validation(),
            }),
            true
        );
    });

    it("validation_percent < 100 blocks promote", () => {
        assert.equal(
            publishBatchReadyForPromotion({
                batch: {
                    status: "ready",
                    validation_percent: 50,
                    validated_at: new Date(),
                },
                validation: validation(),
            }),
            false
        );
    });

    it("promotable_count = 0 blocks promote", () => {
        assert.equal(
            publishBatchReadyForPromotion({
                batch: {
                    status: "partial",
                    validation_percent: 100,
                    validated_at: new Date(),
                },
                validation: validation({ promotable_count: 0, ready_count: 0, outcome: "blocked" }),
            }),
            false
        );
    });

    it("partial outcome with promotable_count > 0 allows promote", () => {
        assert.equal(
            validationSummaryAllowsPromotion(
                validation({ outcome: "partial", promotable_count: 2, ready_count: 1, warning_count: 1 })
            ),
            true
        );
        assert.equal(
            publishBatchReadyForPromotion({
                batch: {
                    status: "draft",
                    validation_percent: 100,
                    validated_at: new Date(),
                },
                validation: validation({
                    outcome: "partial",
                    promotable_count: 2,
                    ready_count: 1,
                    warning_count: 1,
                    blocked_count: 1,
                }),
            }),
            true
        );
    });

    it("blocked-only batch blocks promote", () => {
        assert.equal(
            validationSummaryAllowsPromotion(
                validation({ outcome: "blocked", promotable_count: 0, blocked_count: 3 })
            ),
            false
        );
    });

    it("validating batch status blocks promote attempt", () => {
        assert.equal(
            publishBatchReadyForPromotion({
                batch: {
                    status: "validating",
                    validation_percent: 100,
                    validated_at: new Date(),
                },
                validation: validation(),
            }),
            false
        );
    });

    it("batchValidatedForPromotion requires validation_percent 100 only", () => {
        assert.equal(
            batchValidatedForPromotion({
                status: "draft",
                validation_percent: 100,
                validated_at: "2024-01-01T00:00:00Z",
            }),
            true
        );
        assert.equal(
            batchValidatedForPromotion({
                status: "draft",
                validation_percent: 100,
                validated_at: null,
            }),
            true
        );
        assert.equal(
            batchValidatedForPromotion({
                status: "draft",
                validation_percent: 99,
                validated_at: new Date(),
            }),
            false
        );
    });

    it("can_promote=false blocks even with partial outcome", () => {
        assert.equal(
            validationSummaryAllowsPromotion(
                validation({ outcome: "partial", promotable_count: 2, can_promote: false })
            ),
            false
        );
    });

    it("ready outcome alias allows promote", () => {
        assert.equal(
            validationSummaryAllowsPromotion(
                validation({ outcome: "ready", promotable_count: 3, ready_count: 3 })
            ),
            true
        );
    });
});
