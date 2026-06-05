import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
    type PublishBatchDryRunResult,
} from "./publishBatchDryRun";
import {
    isPublishBatchClosedForReuse,
    normalizePublishBatchLifecycleStatus,
} from "./publishBatchLifecycle";
import { validationOutcomeAllowsPromotion } from "@/src/features/import-review/utils/promotionPromoteUiState";
import type { ImportReviewPublishBatchValidationResultSummary } from "@/src/lib/api";

export type PublishBatchWorkflowCounts = {
    actualPromotable: number;
    publishPending: number;
    publishPromoted: number;
    publishFailed: number;
};

export function isPartialPromotionCompleted(counts: PublishBatchWorkflowCounts): boolean {
    return (
        counts.actualPromotable <= 0 &&
        counts.publishPromoted > 0 &&
        counts.publishFailed > 0
    );
}

/** No pending-ready items left after at least one publish attempt on this batch. */
export function isPublishBatchWorkflowExhausted(counts: PublishBatchWorkflowCounts): boolean {
    return (
        counts.actualPromotable <= 0 &&
        (counts.publishPromoted > 0 || counts.publishFailed > 0)
    );
}

export function publishBatchWorkflowStatusLabel(args: {
    lifecycleStatus: string;
    counts: PublishBatchWorkflowCounts;
}): string {
    if (isPartialPromotionCompleted(args.counts)) {
        return "Partial promotion completed";
    }
    return normalizePublishBatchLifecycleStatus(args.lifecycleStatus);
}

export function publishBatchWorkflowExhaustedMessage(counts: PublishBatchWorkflowCounts): string {
    const promoted = counts.publishPromoted;
    const failed = counts.publishFailed;
    return `${promoted.toLocaleString()} item${promoted === 1 ? "" : "s"} promoted. ${failed.toLocaleString()} item${failed === 1 ? "" : "s"} failed. This batch is closed; fix failed items and create a retry batch.`;
}

export function canValidatePublishBatchWorkflow(
    lifecycleStatus: string,
    counts: PublishBatchWorkflowCounts
): boolean {
    if (isPublishBatchClosedForReuse(lifecycleStatus) || isPublishBatchWorkflowExhausted(counts)) {
        return false;
    }
    const s = normalizePublishBatchLifecycleStatus(lifecycleStatus);
    return s === "draft" || s === "ready" || s === "partial";
}

export function canDryRunPublishBatchWorkflow(
    lifecycleStatus: string,
    counts: PublishBatchWorkflowCounts,
    dryRunResult?: PublishBatchDryRunResult | null
): boolean {
    if (isPublishBatchClosedForReuse(lifecycleStatus) || isPublishBatchWorkflowExhausted(counts)) {
        return false;
    }
    const s = normalizePublishBatchLifecycleStatus(lifecycleStatus);
    return (
        (s === "ready" || s === "partial") &&
        counts.actualPromotable > 0 &&
        !publishBatchDryRunPassed(dryRunResult)
    );
}

export function canPromotePublishBatchWorkflow(
    lifecycleStatus: string,
    counts: PublishBatchWorkflowCounts,
    dryRunResult?: PublishBatchDryRunResult | null,
    families: readonly string[] = []
): boolean {
    if (isPublishBatchClosedForReuse(lifecycleStatus) || isPublishBatchWorkflowExhausted(counts)) {
        return false;
    }
    const s = normalizePublishBatchLifecycleStatus(lifecycleStatus);
    if (!(s === "ready" || s === "partial") || counts.actualPromotable <= 0) {
        return false;
    }
    if (batchRequiresDryRunBeforePromote(families)) {
        return publishBatchDryRunPassed(dryRunResult);
    }
    return true;
}

/** Roads and routing-barrier batches must pass batch dry-run before promotion. */
export function batchRequiresDryRunBeforePromote(families: readonly string[]): boolean {
    return families.some((f) => f === "roads" || f === "routing_barriers");
}

export type BatchWorkflowNextStep = "validate" | "dry_run" | "promote" | "none";

export type BatchWorkflowState = {
    canValidate: boolean;
    canDryRun: boolean;
    canPromote: boolean;
    /** True when dry-run already passed but re-run is allowed. */
    dryRunIsRerun: boolean;
    nextStep: BatchWorkflowNextStep;
    message: string | null;
    dryRunPassed: boolean;
};

export type GetBatchWorkflowStateInput = {
    batch: { status: string };
    summary?: unknown;
    families: readonly string[];
    counts: PublishBatchWorkflowCounts;
    validation: ImportReviewPublishBatchValidationResultSummary | null | undefined;
    validationComplete: boolean;
    inFlight?: boolean;
};

function resolveDryRunResult(
    summary: unknown | undefined
): PublishBatchDryRunResult | null {
    if (!summary || typeof summary !== "object") {
        return null;
    }
    return parsePublishBatchDryRunResultFromSummary(summary);
}

export function getBatchWorkflowState(input: GetBatchWorkflowStateInput): BatchWorkflowState {
    const lifecycleStatus = normalizePublishBatchLifecycleStatus(input.batch.status);
    const closed = isPublishBatchClosedForReuse(lifecycleStatus);
    const exhausted = isPublishBatchWorkflowExhausted(input.counts);
    const inFlight =
        input.inFlight ??
        (lifecycleStatus === "validating" || lifecycleStatus === "promoting");
    const dryRunResult = resolveDryRunResult(input.summary);
    const dryRunPassed = publishBatchDryRunPassed(dryRunResult);
    const validationPassed = validationOutcomeAllowsPromotion(input.validation);
    const validationReady = input.validationComplete && validationPassed;
    const promotable = input.counts.actualPromotable > 0;
    const postValidationStatus =
        lifecycleStatus === "ready" || lifecycleStatus === "partial";
    const requiresDryRun = batchRequiresDryRunBeforePromote(input.families);

    const canValidate =
        !closed &&
        !exhausted &&
        !inFlight &&
        canValidatePublishBatchWorkflow(lifecycleStatus, input.counts) &&
        (!validationReady || lifecycleStatus === "draft");

    const canDryRun =
        validationReady &&
        postValidationStatus &&
        !dryRunPassed &&
        promotable &&
        !closed &&
        !exhausted &&
        !inFlight;

    const dryRunIsRerun =
        validationReady &&
        postValidationStatus &&
        dryRunPassed &&
        promotable &&
        !closed &&
        !exhausted &&
        !inFlight;

    const canPromote =
        validationReady &&
        postValidationStatus &&
        promotable &&
        !closed &&
        !exhausted &&
        !inFlight &&
        (!requiresDryRun || dryRunPassed);

    let nextStep: BatchWorkflowNextStep = "none";
    if (canValidate) {
        nextStep = "validate";
    } else if (canDryRun) {
        nextStep = "dry_run";
    } else if (canPromote) {
        nextStep = "promote";
    }

    let message: string | null = null;
    if (closed) {
        message = null;
    } else if (validationReady && requiresDryRun && !dryRunPassed && promotable) {
        message = "Run dry-run before promotion.";
    } else if (dryRunPassed && requiresDryRun && promotable) {
        message = "Dry-run passed";
    } else if (validationReady && !promotable && !exhausted) {
        message = "No promotable items in this batch.";
    }

    return {
        canValidate,
        canDryRun,
        canPromote,
        dryRunIsRerun,
        nextStep,
        message,
        dryRunPassed,
    };
}

/** Merge API resumable actions with client workflow rules for Validate / Dry-run / Promote. */
export function buildWorkflowResumableActions(
    apiResumableActions: readonly string[],
    workflow: BatchWorkflowState
): string[] {
    const pipelineOnly = new Set([
        "resume_validation",
        "cancel_validation",
        "reset_validation",
        "resume_dry_run",
        "resume_promotion",
        "cancel_promotion",
        "reset_promotion",
        "verify",
        "resume_verify",
    ]);
    const out = apiResumableActions.filter(
        (a) =>
            pipelineOnly.has(a) ||
            (a !== "validate" && a !== "dry_run" && a !== "promote")
    );
    if (workflow.canValidate) {
        out.push("validate");
    }
    if (workflow.canDryRun || workflow.dryRunIsRerun) {
        out.push("dry_run");
    }
    if (apiResumableActions.includes("resume_dry_run") && !out.includes("resume_dry_run")) {
        out.push("resume_dry_run");
    }
    if (workflow.canPromote) {
        out.push("promote");
    }
    return [...new Set(out)];
}
