import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { promotionPromoteUiState } from "./promotionPromoteUiState.js";

const baseValidation = {
    outcome: "partial" as const,
    can_promote: true,
    requires_warning_confirmation: false,
    valid_count: 35,
    ready_count: 35,
    warning_count: 0,
    blocked_count: 2,
    skipped_count: 0,
    promotable_count: 35,
    total_count: 37,
    total_items: 37,
    by_publish_action: { insert: 37, update: 0, merge: 0 },
    by_entity: { places: { total: 37, valid: 35, warning: 0, blocked: 2, skipped: 0 } },
    promotable_entity_families: ["places"],
};

describe("promotionPromoteUiState", () => {
    it("enables promote for draft batch when validation_percent=100 and items are promotable now", () => {
        const state = promotionPromoteUiState({
            batchStatus: "draft",
            workflowBlocked: false,
            validatedAt: "2026-01-01T00:00:00Z",
            validationPercent: 100,
            validation: baseValidation,
            currentPromotableCount: 35,
            validationPromotableCount: 35,
            publishItemStatus: { pending: 35, success: 0, failed: 0, skipped: 2, total: 37 },
        });
        assert.equal(state.canPromote, true);
        assert.equal(state.promoteDisabledReason, null);
        assert.equal(state.promoteButtonLabel, "Promote 35 ready items");
    });

    it("blocks promote when validation snapshot is promotable but all ready items already failed", () => {
        const state = promotionPromoteUiState({
            batchStatus: "partial",
            workflowBlocked: false,
            validatedAt: "2026-01-01T00:00:00Z",
            validationPercent: 100,
            validation: baseValidation,
            currentPromotableCount: 0,
            validationPromotableCount: 35,
            publishItemStatus: { pending: 0, success: 0, failed: 35, skipped: 2, total: 37 },
        });
        assert.equal(state.canPromote, false);
        assert.equal(state.currentPromotableCount, 0);
        assert.equal(state.validationPromotableCount, 35);
        assert.equal(state.promotionAttemptExhausted, true);
        assert.match(state.promoteDisabledReason ?? "", /No currently promotable items/);
        assert.match(state.promoteDisabledReason ?? "", /new batch after fixing/i);
        assert.equal(state.promoteButtonLabel, "No items to promote");
        assert.match(state.exhaustedBatchMessage ?? "", /35 promotable/);
        assert.match(state.exhaustedBatchMessage ?? "", /35 already failed/);
    });

    it("shows promotion failed message when promotion_status is promotion_failed", () => {
        const state = promotionPromoteUiState({
            batchStatus: "failed",
            workflowBlocked: false,
            validatedAt: "2026-01-01T00:00:00Z",
            validationPercent: 100,
            validation: baseValidation,
            currentPromotableCount: 0,
            validationPromotableCount: 35,
            publishItemStatus: { pending: 0, success: 0, failed: 35, skipped: 2, total: 37 },
            promotionStatus: "promotion_failed",
        });
        assert.equal(state.promotionFailed, true);
        assert.equal(state.canPromote, false);
        assert.equal(state.exhaustedBatchMessage, "Promotion failed. Create a new retry batch after fixing the error.");
    });

    it("offers retry batch button when failed ready retry count is available", () => {
        const state = promotionPromoteUiState({
            batchStatus: "partial",
            workflowBlocked: false,
            validatedAt: "2026-01-01T00:00:00Z",
            validationPercent: 100,
            validation: baseValidation,
            currentPromotableCount: 0,
            validationPromotableCount: 35,
            publishItemStatus: { pending: 0, success: 0, failed: 35, skipped: 2, total: 37 },
            failedReadyRetryCount: 35,
        });
        assert.equal(state.canCreateRetryBatch, true);
        assert.equal(state.retryBatchButtonLabel, "Create retry batch from 35 failed ready items");
    });

    it("enables promote for one ready item with singular label", () => {
        const state = promotionPromoteUiState({
            batchStatus: "draft",
            workflowBlocked: false,
            validatedAt: "2026-01-01T00:00:00Z",
            validationPercent: 100,
            validation: {
                ...baseValidation,
                outcome: "passed",
                ready_count: 1,
                valid_count: 1,
                promotable_count: 1,
                total_count: 1,
                blocked_count: 0,
            },
            currentPromotableCount: 1,
            validationPromotableCount: 1,
        });
        assert.equal(state.canPromote, true);
        assert.equal(state.promoteButtonLabel, "Promote 1 ready item");
    });

    it("blocks when validation_percent < 100", () => {
        const state = promotionPromoteUiState({
            batchStatus: "draft",
            workflowBlocked: false,
            validatedAt: null,
            validationPercent: 40,
            validation: baseValidation,
            currentPromotableCount: 35,
        });
        assert.equal(state.canPromote, false);
        assert.match(state.promoteDisabledReason ?? "", /Run batch validation first/);
    });

    it("blocks when current promotable count is 0 at validation", () => {
        const state = promotionPromoteUiState({
            batchStatus: "partial",
            workflowBlocked: false,
            validatedAt: "2026-01-01T00:00:00Z",
            validationPercent: 100,
            validation: {
                ...baseValidation,
                can_promote: false,
                ready_count: 0,
                valid_count: 0,
                promotable_count: 0,
                blocked_count: 2,
                outcome: "partial",
            },
            currentPromotableCount: 0,
            validationPromotableCount: 0,
        });
        assert.equal(state.canPromote, false);
        assert.match(state.promoteDisabledReason ?? "", /No promotable items/);
    });

    it("allows partial validation with current promotable items on draft status", () => {
        const state = promotionPromoteUiState({
            batchStatus: "draft",
            workflowBlocked: false,
            validatedAt: "2026-01-01T00:00:00Z",
            validationPercent: 100,
            validation: {
                ...baseValidation,
                outcome: "partial",
            },
            currentPromotableCount: 35,
        });
        assert.equal(state.canPromote, true);
        assert.equal(state.promoteDisabledReason, null);
    });

    it("allows promote when validation_percent=100 without validated_at", () => {
        const state = promotionPromoteUiState({
            batchStatus: "draft",
            workflowBlocked: false,
            validatedAt: null,
            validationPercent: 100,
            validation: {
                ...baseValidation,
                ready_count: 34,
                valid_count: 34,
                promotable_count: 34,
                blocked_count: 2,
            },
            currentPromotableCount: 34,
        });
        assert.equal(state.canPromote, true);
        assert.match(state.promoteButtonLabel, /Promote 34 ready items/);
        assert.match(state.blockedWarningMessage ?? "", /34 ready items can be promoted/);
        assert.match(state.blockedWarningMessage ?? "", /2 blocked items will be left in import-review/);
    });

    it("blocks when can_promote is false at validation", () => {
        const state = promotionPromoteUiState({
            batchStatus: "draft",
            workflowBlocked: false,
            validatedAt: null,
            validationPercent: 100,
            validation: {
                ...baseValidation,
                can_promote: false,
                promotable_count: 0,
                ready_count: 0,
            },
            currentPromotableCount: 0,
        });
        assert.equal(state.canPromote, false);
        assert.match(state.promoteDisabledReason ?? "", /No promotable items at validation/);
    });

    it("does not count failed publish items as current promotable", () => {
        const state = promotionPromoteUiState({
            batchStatus: "failed",
            workflowBlocked: false,
            validatedAt: "2026-01-01T00:00:00Z",
            validationPercent: 100,
            validation: baseValidation,
            currentPromotableCount: 0,
            validationPromotableCount: 35,
            publishItemStatus: { pending: 0, success: 0, failed: 35, skipped: 2, total: 37 },
        });
        assert.equal(state.currentPromotableCount, 0);
        assert.equal(state.canPromote, false);
    });
});
