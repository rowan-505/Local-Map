import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewPublishBatchValidationResultSummary } from "@/src/lib/api";

import {
    batchRequiresDryRunBeforePromote,
    buildWorkflowResumableActions,
    canDryRunPublishBatchWorkflow,
    canPromotePublishBatchWorkflow,
    canValidatePublishBatchWorkflow,
    getBatchWorkflowState,
    isPartialPromotionCompleted,
    isPublishBatchWorkflowExhausted,
    publishBatchWorkflowExhaustedMessage,
    publishBatchWorkflowStatusLabel,
    type PublishBatchWorkflowCounts,
} from "./publishBatchWorkflowUi.js";

const partialBatch: PublishBatchWorkflowCounts = {
    actualPromotable: 0,
    publishPending: 0,
    publishPromoted: 8,
    publishFailed: 2,
};

const openCounts: PublishBatchWorkflowCounts = {
    actualPromotable: 5,
    publishPending: 5,
    publishPromoted: 0,
    publishFailed: 0,
};

const passedValidation: ImportReviewPublishBatchValidationResultSummary = {
    outcome: "passed",
    ready_count: 5,
    valid_count: 5,
    promotable_count: 5,
    blocked_count: 0,
    total_count: 5,
    can_promote: true,
    requires_warning_confirmation: false,
    warning_count: 0,
    skipped_count: 0,
    total_items: 5,
    by_publish_action: { insert: 5, update: 0, merge: 0 },
    by_entity: {},
    promotable_entity_families: [],
};

function workflowArgs(overrides: {
    status?: string;
    families?: string[];
    dryRunStatus?: string;
    counts?: PublishBatchWorkflowCounts;
}) {
    return {
        batch: { status: overrides.status ?? "ready" },
        summary: overrides.dryRunStatus
            ? { dry_run_result: { status: overrides.dryRunStatus, checked_at: "2026-01-01T00:00:00Z" } }
            : undefined,
        families: overrides.families ?? ["roads"],
        counts: overrides.counts ?? openCounts,
        validation: passedValidation,
        validationComplete: true,
    };
}

describe("publishBatchWorkflowUi", () => {
    it("detects partial promotion completed", () => {
        assert.equal(isPartialPromotionCompleted(partialBatch), true);
        assert.equal(
            publishBatchWorkflowStatusLabel({ lifecycleStatus: "partial", counts: partialBatch }),
            "Partial promotion completed"
        );
        assert.equal(
            publishBatchWorkflowExhaustedMessage(partialBatch),
            "8 items promoted. 2 items failed. This batch is closed; fix failed items and create a retry batch."
        );
    });

    it("disables validate, dry-run, and promote when workflow is exhausted", () => {
        assert.equal(isPublishBatchWorkflowExhausted(partialBatch), true);
        assert.equal(canValidatePublishBatchWorkflow("partial", partialBatch), false);
        assert.equal(
            canDryRunPublishBatchWorkflow("partial", partialBatch, { status: "passed" }),
            false
        );
        assert.equal(
            canPromotePublishBatchWorkflow("partial", partialBatch, { status: "passed" }, ["roads"]),
            false
        );
    });

    it("allows dry-run only when dry-run has not passed", () => {
        assert.equal(canDryRunPublishBatchWorkflow("ready", openCounts, null), true);
        assert.equal(
            canDryRunPublishBatchWorkflow("ready", openCounts, { status: "passed" }),
            false
        );
    });

    it("road batch ready without dry-run: Dry-run enabled, Promote disabled", () => {
        const state = getBatchWorkflowState(workflowArgs({ dryRunStatus: undefined }));
        assert.equal(state.canDryRun, true);
        assert.equal(state.canPromote, false);
        assert.equal(state.nextStep, "dry_run");
        assert.equal(state.message, "Run dry-run before promotion.");
        const actions = buildWorkflowResumableActions([], state);
        assert.ok(actions.includes("dry_run"));
        assert.ok(!actions.includes("promote"));
    });

    it("road batch ready with dry-run passed: Promote enabled and re-run dry-run visible", () => {
        const state = getBatchWorkflowState(workflowArgs({ dryRunStatus: "passed" }));
        assert.equal(state.canDryRun, false);
        assert.equal(state.dryRunIsRerun, true);
        assert.equal(state.canPromote, true);
        assert.equal(state.nextStep, "promote");
        assert.equal(state.message, "Dry-run passed");
        const actions = buildWorkflowResumableActions([], state);
        assert.ok(actions.includes("promote"));
        assert.ok(actions.includes("dry_run"));
    });

    it("place batch ready without dry-run: Promote enabled (dry-run optional)", () => {
        const state = getBatchWorkflowState(
            workflowArgs({ families: ["places"], dryRunStatus: undefined })
        );
        assert.equal(batchRequiresDryRunBeforePromote(["places"]), false);
        assert.equal(state.canPromote, true);
        assert.equal(state.canDryRun, true);
        assert.equal(state.nextStep, "dry_run");
    });

    it("promoted batch has no active workflow actions", () => {
        const state = getBatchWorkflowState({
            ...workflowArgs({ status: "promoted" }),
            counts: partialBatch,
        });
        assert.equal(state.canValidate, false);
        assert.equal(state.canDryRun, false);
        assert.equal(state.canPromote, false);
        assert.equal(state.nextStep, "none");
        const actions = buildWorkflowResumableActions(["validate", "dry_run", "promote"], state);
        assert.ok(!actions.includes("validate"));
        assert.ok(!actions.includes("dry_run"));
        assert.ok(!actions.includes("promote"));
    });

    it("failed batch has no active workflow actions", () => {
        const state = getBatchWorkflowState(workflowArgs({ status: "failed" }));
        assert.equal(state.canValidate, false);
        assert.equal(state.canDryRun, false);
        assert.equal(state.canPromote, false);
    });

    it("draft before validation: Validate only", () => {
        const state = getBatchWorkflowState({
            batch: { status: "draft" },
            families: ["roads"],
            counts: openCounts,
            validation: null,
            validationComplete: false,
        });
        assert.equal(state.canValidate, true);
        assert.equal(state.canDryRun, false);
        assert.equal(state.canPromote, false);
        assert.equal(state.nextStep, "validate");
    });
});
