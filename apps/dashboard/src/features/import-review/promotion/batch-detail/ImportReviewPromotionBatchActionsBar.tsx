"use client";

import type { PromoteGate } from "@/src/features/import-review/promotion/publishBatchPromoteGate";
import type { BatchWorkflowState } from "@/src/features/import-review/promotion/publishBatchWorkflowUi";
import type { PromotionPromoteUiState } from "@/src/features/import-review/utils/promotionPromoteUiState";

export type PublishBatchDetailBusyKey =
    | "validate"
    | "dry-run"
    | "promote"
    | "resume"
    | "cancel-validation"
    | "reset-validation"
    | "cancel-promotion"
    | "reset-promotion"
    | "verify"
    | "retry"
    | null;

type ActionDef = {
    key: PublishBatchDetailBusyKey;
    resumable: string;
    label: string;
    variant: "primary" | "resume" | "danger" | "secondary";
    onClick: () => void;
};

type Props = {
    resumableActions: readonly string[];
    workflowState: BatchWorkflowState;
    promoteGate: PromoteGate;
    busy: PublishBatchDetailBusyKey;
    promoteUi: PromotionPromoteUiState;
    validateEnabled: boolean;
    dryRunEnabled: boolean;
    onValidate: () => void;
    onResumeValidation: () => void;
    onCancelValidation: () => void;
    onResetValidation: () => void;
    onDryRun: () => void;
    onResumeDryRun: () => void;
    onPromote: () => void;
    onResumePromotion: () => void;
    onCancelPromotion: () => void;
    onResetPromotion: () => void;
    onVerify: () => void;
    onRetryBatch?: () => void;
};

const VARIANT_CLASS: Record<ActionDef["variant"], string> = {
    primary: "rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50",
    resume:
        "rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50",
    danger: "rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50",
    secondary:
        "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50",
};

function busyLabel(isActive: boolean, idle: string): string {
    return isActive ? "…" : idle;
}

function actionVariant(
    resumable: string,
    workflow: BatchWorkflowState
): ActionDef["variant"] {
    if (workflow.nextStep === "validate" && resumable === "validate") {
        return "primary";
    }
    if (workflow.nextStep === "dry_run" && (resumable === "dry_run" || resumable === "resume_dry_run")) {
        return "primary";
    }
    if (workflow.nextStep === "promote" && resumable === "promote") {
        return "primary";
    }
    if (resumable === "promote") {
        return "secondary";
    }
    if (resumable === "dry_run" || resumable === "resume_dry_run") {
        return "secondary";
    }
    return "secondary";
}

export function ImportReviewPromotionBatchActionsBar({
    resumableActions,
    workflowState,
    promoteGate,
    busy,
    promoteUi,
    validateEnabled,
    dryRunEnabled,
    onValidate,
    onResumeValidation,
    onCancelValidation,
    onResetValidation,
    onDryRun,
    onResumeDryRun,
    onPromote,
    onResumePromotion,
    onCancelPromotion,
    onResetPromotion,
    onVerify,
    onRetryBatch,
}: Props) {
    const actions = new Set(resumableActions);
    const defs: ActionDef[] = [];

    if (actions.has("validate")) {
        defs.push({
            key: "validate",
            resumable: "validate",
            label: busyLabel(busy === "validate", "Validate"),
            variant: actionVariant("validate", workflowState),
            onClick: onValidate,
        });
    }
    if (actions.has("resume_validation")) {
        defs.push({
            key: "resume",
            resumable: "resume_validation",
            label: busyLabel(busy === "resume", "Resume validation"),
            variant: "resume",
            onClick: onResumeValidation,
        });
    }
    if (actions.has("cancel_validation")) {
        defs.push({
            key: "cancel-validation",
            resumable: "cancel_validation",
            label: busyLabel(busy === "cancel-validation", "Cancel validation"),
            variant: "danger",
            onClick: onCancelValidation,
        });
    }
    if (actions.has("reset_validation")) {
        defs.push({
            key: "reset-validation",
            resumable: "reset_validation",
            label: busyLabel(busy === "reset-validation", "Reset validation"),
            variant: "danger",
            onClick: onResetValidation,
        });
    }
    if (actions.has("dry_run")) {
        const dryRunLabel = workflowState.dryRunIsRerun ? "Re-run dry-run" : "Run dry-run";
        defs.push({
            key: "dry-run",
            resumable: "dry_run",
            label: busyLabel(busy === "dry-run", dryRunLabel),
            variant: actionVariant("dry_run", workflowState),
            onClick: onDryRun,
        });
    }
    if (actions.has("resume_dry_run")) {
        defs.push({
            key: "resume",
            resumable: "resume_dry_run",
            label: busyLabel(busy === "resume", "Resume dry-run"),
            variant: "resume",
            onClick: onResumeDryRun,
        });
    }
    if (actions.has("promote")) {
        defs.push({
            key: "promote",
            resumable: "promote",
            label:
                busy === "promote"
                    ? "…"
                    : promoteUi.promoteButtonLabel.startsWith("Promote")
                      ? promoteUi.promoteButtonLabel
                      : `Promote ${promoteUi.currentPromotableCount.toLocaleString()} ready items`,
            variant: actionVariant("promote", workflowState),
            onClick: onPromote,
        });
    }
    if (actions.has("resume_promotion")) {
        defs.push({
            key: "resume",
            resumable: "resume_promotion",
            label: busyLabel(busy === "resume", "Resume promotion"),
            variant: "resume",
            onClick: onResumePromotion,
        });
    }
    if (actions.has("cancel_promotion")) {
        defs.push({
            key: "cancel-promotion",
            resumable: "cancel_promotion",
            label: busyLabel(busy === "cancel-promotion", "Cancel promotion"),
            variant: "danger",
            onClick: onCancelPromotion,
        });
    }
    if (actions.has("reset_promotion")) {
        defs.push({
            key: "reset-promotion",
            resumable: "reset_promotion",
            label: busyLabel(busy === "reset-promotion", "Reset promotion"),
            variant: "danger",
            onClick: onResetPromotion,
        });
    }
    if (actions.has("verify") || actions.has("resume_verify")) {
        defs.push({
            key: "verify",
            resumable: "verify",
            label: busyLabel(busy === "verify", actions.has("resume_verify") ? "Resume verify" : "Verify promotion"),
            variant: "secondary",
            onClick: onVerify,
        });
    }

    const disabled = (def: ActionDef) => {
        if (busy != null) {
            return true;
        }
        if (def.resumable === "validate" && !validateEnabled) {
            return true;
        }
        if ((def.resumable === "dry_run" || def.resumable === "resume_dry_run") && !dryRunEnabled) {
            return true;
        }
        if (def.resumable === "promote" && !promoteGate.canPromote) {
            return true;
        }
        return false;
    };

    const promoteHint = promoteGate.reason;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                {defs.map((def) => (
                    <button
                        key={def.resumable}
                        type="button"
                        disabled={disabled(def)}
                        onClick={() => void def.onClick()}
                        className={VARIANT_CLASS[def.variant]}
                        title={
                            def.resumable === "promote" ? (promoteHint ?? undefined) : undefined
                        }
                    >
                        {def.label}
                    </button>
                ))}
                {promoteUi.canCreateRetryBatch && onRetryBatch ? (
                    <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => void onRetryBatch()}
                        className={VARIANT_CLASS.resume}
                    >
                        {busy === "retry"
                            ? "…"
                            : (promoteUi.retryBatchButtonLabel ?? "Retry failed items")}
                    </button>
                ) : null}
            </div>
            {promoteHint && actions.has("promote") ? (
                <p className="text-xs text-gray-600">{promoteHint}</p>
            ) : null}
        </div>
    );
}
