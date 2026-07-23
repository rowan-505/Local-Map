import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    applyStatusToLegacyPromotionStatus,
    comparisonStatusToMatchStatus,
    decisionToStorageValue,
    isApplyBatchDecision,
    isApplyReadyDecision,
    isSkipApplyDecision,
    matchStatusStorageValuesForFilter,
    projectCandidateStatuses,
    promotionStatusStorageValuesForFilter,
    publishItemStatusToApplyMeaning,
    reviewStatusForDecisionStorage,
    toApplyStatus,
    toComparisonStatus,
    toReviewDecisionMeaning,
} from "./import-review-status-model.js";

describe("import-review-status-model", () => {
    it("maps legacy match_status into comparison_status", () => {
        assert.equal(toComparisonStatus("duplicate_candidate"), "duplicate");
        assert.equal(toComparisonStatus("manual_protected"), "manual_protected");
        assert.equal(toComparisonStatus("delete_candidate"), "possible_delete");
        assert.equal(toComparisonStatus("verified_conflict"), "verified_conflict");
        assert.equal(toComparisonStatus("new_auto"), null);
        assert.equal(comparisonStatusToMatchStatus("duplicate"), "duplicate");
    });

    it("expands comparison filters to legacy storage values", () => {
        assert.deepEqual(matchStatusStorageValuesForFilter("duplicate"), [
            "duplicate",
            "duplicate_candidate",
            "possible_duplicate",
        ]);
        assert.deepEqual(promotionStatusStorageValuesForFilter("not_applied"), [
            "not_applied",
            "not_ready",
        ]);
        assert.deepEqual(promotionStatusStorageValuesForFilter("applying"), [
            "applying",
            "batched",
            "promoting",
        ]);
    });

    it("treats NULL review_decision as pending", () => {
        assert.equal(toReviewDecisionMeaning(null), "pending");
        assert.equal(toReviewDecisionMeaning(""), "pending");
        assert.equal(toReviewDecisionMeaning("pending"), "pending");
    });

    it("normalizes legacy decisions toward target storage", () => {
        assert.equal(decisionToStorageValue("approved"), "replace_existing");
        assert.equal(decisionToStorageValue("rejected"), "ignore_import");
        assert.equal(decisionToStorageValue("ignored"), "ignore_import");
        assert.equal(decisionToStorageValue("merged"), "mark_duplicate");
        assert.equal(decisionToStorageValue("keep_existing"), "keep_existing");
        assert.equal(decisionToStorageValue("confirm_soft_delete"), "confirm_soft_delete");
    });

    it("derives CHECK-compatible review_status for every writable decision", () => {
        assert.equal(reviewStatusForDecisionStorage("replace_existing"), "approved");
        assert.equal(reviewStatusForDecisionStorage("keep_existing"), "ignored");
        assert.equal(reviewStatusForDecisionStorage("ignore_import"), "ignored");
        assert.equal(reviewStatusForDecisionStorage("mark_duplicate"), "merged");
        assert.equal(reviewStatusForDecisionStorage("needs_more_review"), "needs_review");
        assert.equal(reviewStatusForDecisionStorage("confirm_soft_delete"), "approved");
    });

    it("marks apply-ready decisions for promotion eligibility", () => {
        assert.equal(isApplyReadyDecision("approved"), true);
        assert.equal(isApplyReadyDecision("replace_existing"), true);
        assert.equal(isApplyReadyDecision("merge_fields"), true);
        assert.equal(isApplyReadyDecision("insert_separate"), true);
        assert.equal(isApplyReadyDecision("confirm_soft_delete"), true);
        assert.equal(isApplyReadyDecision("keep_existing"), false);
        assert.equal(isApplyReadyDecision("ignore_import"), false);
        assert.equal(isApplyReadyDecision(null), false);
        assert.equal(isSkipApplyDecision("keep_existing"), true);
        assert.equal(isSkipApplyDecision("mark_duplicate"), true);
        assert.equal(isApplyBatchDecision("keep_existing"), true);
        assert.equal(isApplyBatchDecision("replace_existing"), true);
        assert.equal(isApplyBatchDecision("needs_more_review"), false);
    });

    it("maps promotion_status ↔ apply_status without dropping legacy history meanings", () => {
        assert.equal(toApplyStatus("not_ready"), "not_applied");
        assert.equal(toApplyStatus("batched"), "applying");
        assert.equal(toApplyStatus("promoting"), "applying");
        assert.equal(toApplyStatus("promoted"), "applied");
        assert.equal(toApplyStatus("failed"), "failed");
        assert.equal(applyStatusToLegacyPromotionStatus("not_applied"), "not_ready");
        assert.equal(applyStatusToLegacyPromotionStatus("applying"), "batched");
        assert.equal(applyStatusToLegacyPromotionStatus("applied"), "promoted");
    });

    it("projects candidate rows for API/UI without requiring review_status filters", () => {
        const projected = projectCandidateStatuses({
            match_status: "duplicate_candidate",
            auto_action: "possible_duplicate",
            review_status: "pending",
            review_decision: null,
            promotion_status: "not_ready",
        });
        assert.equal(projected.comparison_status, "duplicate");
        assert.equal(projected.review_decision_meaning, "pending");
        assert.equal(projected.apply_status, "not_applied");
    });

    it("maps historical publish item statuses for history pages", () => {
        assert.equal(publishItemStatusToApplyMeaning("success"), "applied");
        assert.equal(publishItemStatusToApplyMeaning("failed"), "failed");
        assert.equal(publishItemStatusToApplyMeaning("pending"), "pending");
        assert.equal(publishItemStatusToApplyMeaning("skipped"), "applied");
    });
});
