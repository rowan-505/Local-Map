"use client";

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { bulkDecision, formatImportReviewApiError } from "@/src/features/import-review/api";
import {
    analyzeBulkSelection,
    bulkApproveBlockedReason,
    type BulkSelectionAnalysis,
} from "@/src/features/import-review/utils/bulkSelectionAnalysis";
import type {
    ImportReviewBuildingListItem,
    ImportReviewBulkDecisionResponse,
    ImportReviewDecision,
    PostImportReviewBuildingsBulkBody,
} from "@/src/lib/api";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";

import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";

export type ImportReviewBulkPhase = "idle" | "previewing" | "applying";

function mutationScope(
    list: { review_batch_id?: string | null } | null,
    scope: ImportReviewScopeQueryParams | null
): { review_batch_id?: string; source_snapshot_version?: string } {
    const batchId = list?.review_batch_id?.trim();
    if (batchId) {
        return { review_batch_id: batchId };
    }
    if (!scope) {
        return {};
    }
    if ("review_batch_id" in scope) {
        return { review_batch_id: scope.review_batch_id };
    }
    return { source_snapshot_version: scope.source_snapshot_version };
}

export function useImportReviewBulkActions(args: {
    items: ImportReviewBuildingListItem[];
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    list: { review_batch_id?: string | null } | null;
    apiScopeQuery: ImportReviewScopeQueryParams | null;
    apiFamily: string;
    supportsBulkActions: boolean;
    canEdit: boolean;
    onListRefresh: () => void;
}) {
    const [bulkNote, setBulkNote] = useState("");
    const [dangerForce, setDangerForce] = useState(false);
    const [overrideManualProtected, setOverrideManualProtected] = useState(false);
    const [overrideDuplicate, setOverrideDuplicate] = useState(false);
    const [isBulkActionRunning, setIsBulkActionRunning] = useState(false);
    const [bulkPhase, setBulkPhase] = useState<ImportReviewBulkPhase>("idle");
    const [bulkPreview, setBulkPreview] = useState<ImportReviewBulkDecisionResponse | null>(null);
    const [bulkMessage, setBulkMessage] = useState<string | null>(null);

    const analysis = useMemo(
        () => analyzeBulkSelection(args.items, args.selectedIds),
        [args.items, args.selectedIds]
    );

    const dangerForceEnabled = dangerForce || overrideManualProtected || overrideDuplicate;

    const approveBlockedReason = useMemo(
        () => bulkApproveBlockedReason(analysis, dangerForceEnabled),
        [analysis, dangerForceEnabled]
    );

    const runBulk = useCallback(
        async (
            decision: ImportReviewDecision,
            dryRun: boolean,
            opts?: { force?: boolean; filters?: PostImportReviewBuildingsBulkBody["filters"] }
        ) => {
            if (!args.supportsBulkActions || !args.apiFamily) {
                return;
            }
            const scopeBody = mutationScope(args.list, args.apiScopeQuery);
            if (!scopeBody.review_batch_id && !scopeBody.source_snapshot_version) {
                return;
            }
            if (!dryRun && args.selectedIds.size === 0 && !opts?.filters) {
                return;
            }

            setIsBulkActionRunning(true);
            setBulkPhase(dryRun ? "previewing" : "applying");
            setBulkMessage(
                dryRun ? IMPORT_REVIEW_LOADING.previewingBulkAction : IMPORT_REVIEW_LOADING.applyingBulkAction
            );
            if (!dryRun) {
                setBulkPreview(null);
            }

            try {
                const body: PostImportReviewBuildingsBulkBody = {
                    ...scopeBody,
                    review_decision: decision,
                    review_note: bulkNote.trim() || null,
                    dry_run: dryRun,
                    force: opts?.force ?? false,
                };
                if (opts?.filters) {
                    body.filters = opts.filters;
                } else {
                    body.ids = [...args.selectedIds];
                }

                const res = await bulkDecision(args.apiFamily, body);
                if (dryRun) {
                    setBulkPreview(res);
                    const processed = res.updated_count + res.skipped_count;
                    setBulkMessage(
                        `Preview: would update ${res.updated_count.toLocaleString()} of ${processed.toLocaleString()} (${res.skipped_count.toLocaleString()} skipped).`
                    );
                } else {
                    setBulkPreview(null);
                    args.setSelectedIds(new Set());
                    args.onListRefresh();
                    const processed = res.updated_count + res.skipped_count;
                    setBulkMessage(
                        `${IMPORT_REVIEW_LOADING.bulkActionCompleted}: ${res.updated_count.toLocaleString()} updated of ${processed.toLocaleString()} processed (${res.skipped_count.toLocaleString()} skipped).`
                    );
                }
            } catch (err) {
                setBulkMessage(formatImportReviewApiError(err, IMPORT_REVIEW_LOADING.bulkActionFailed));
                if (dryRun) {
                    setBulkPreview(null);
                }
            } finally {
                setIsBulkActionRunning(false);
                setBulkPhase("idle");
            }
        },
        [
            args.supportsBulkActions,
            args.apiFamily,
            args.list,
            args.apiScopeQuery,
            args.selectedIds,
            args.setSelectedIds,
            args.onListRefresh,
            bulkNote,
        ]
    );

    const confirmDangerApprove = useCallback((): boolean => {
        if (overrideManualProtected && analysis.hasManualProtected) {
            if (
                !window.confirm(
                    "Override manual_protected / protect_manual and bulk approve with force=true?"
                )
            ) {
                return false;
            }
            if (!bulkNote.trim()) {
                window.alert("A bulk review note is required when overriding manual_protected.");
                return false;
            }
        }
        if (overrideDuplicate && analysis.hasDuplicateCandidate) {
            if (!window.confirm("Override duplicate_candidate and bulk approve with force=true?")) {
                return false;
            }
            if (!bulkNote.trim()) {
                window.alert("A bulk review note is required when overriding duplicate_candidate.");
                return false;
            }
        }
        if (dangerForce && !overrideManualProtected && !overrideDuplicate) {
            if (!window.confirm("Force approve selected rows (force=true)?")) {
                return false;
            }
        }
        return true;
    }, [analysis, dangerForce, overrideManualProtected, overrideDuplicate, bulkNote]);

    const bulkApproveSelected = useCallback(async () => {
        const blocked = bulkApproveBlockedReason(analysis, dangerForceEnabled);
        if (blocked) {
            window.alert(blocked);
            return;
        }
        if (!confirmDangerApprove()) {
            return;
        }
        const ok = window.confirm(
            `Approve ${analysis.selectedCount} selected candidate(s)?${dangerForceEnabled ? " (force=true)" : ""}`
        );
        if (!ok) {
            return;
        }
        await runBulk("approved", false, { force: dangerForceEnabled });
    }, [analysis, dangerForceEnabled, confirmDangerApprove, runBulk]);

    const bulkDecisionSelected = useCallback(
        async (decision: ImportReviewDecision, label: string) => {
            if (analysis.selectedCount === 0) {
                return;
            }
            if (analysis.hasPromoted) {
                window.alert("Selection includes promoted rows. Clear them from the selection first.");
                return;
            }
            if (decision === "approved") {
                const blocked = bulkApproveBlockedReason(analysis, dangerForceEnabled);
                if (blocked) {
                    window.alert(blocked);
                    return;
                }
            }
            const ok = window.confirm(`${label} ${analysis.selectedCount} selected row(s)?`);
            if (!ok) {
                return;
            }
            await runBulk(decision, false, {
                force: decision === "approved" ? dangerForceEnabled : false,
            });
        },
        [analysis, dangerForceEnabled, runBulk]
    );

    const bulkPreviewApprove = useCallback(async () => {
        if (analysis.selectedCount === 0) {
            return;
        }
        if (analysis.hasPromoted) {
            window.alert("Cannot preview approve: selection includes promoted rows.");
            return;
        }
        await runBulk("approved", true, { force: dangerForceEnabled });
    }, [analysis, dangerForceEnabled, runBulk]);

    const bulkSafeFilterDryRun = useCallback(async () => {
        await runBulk("approved", true, {
            filters: { match_status: "new_auto", auto_action: "insert_candidate" },
            force: false,
        });
    }, [runBulk]);

    const bulkSafeFilterApply = useCallback(async () => {
        const ok = window.confirm(
            "Apply bulk APPROVED to all rows with match_status=new_auto and auto_action=insert_candidate?"
        );
        if (!ok) {
            return;
        }
        await runBulk("approved", false, {
            filters: { match_status: "new_auto", auto_action: "insert_candidate" },
            force: dangerForceEnabled,
        });
    }, [dangerForceEnabled, runBulk]);

    const clearSelection = useCallback(() => {
        args.setSelectedIds(new Set());
        setBulkPreview(null);
        setBulkMessage(null);
    }, [args.setSelectedIds]);

    return {
        bulkNote,
        setBulkNote,
        dangerForce,
        setDangerForce,
        overrideManualProtected,
        setOverrideManualProtected,
        overrideDuplicate,
        setOverrideDuplicate,
        dangerForceEnabled,
        isBulkActionRunning,
        bulkPhase,
        bulkPreview,
        bulkMessage,
        setBulkMessage,
        analysis,
        approveBlockedReason,
        clearSelection,
        bulkPreviewApprove,
        bulkApproveSelected,
        bulkRejectSelected: () => bulkDecisionSelected("rejected", "Reject"),
        bulkNeedsMoreReviewSelected: () => bulkDecisionSelected("needs_more_review", "Mark needs more review for"),
        bulkIgnoreSelected: () => bulkDecisionSelected("ignored", "Ignore"),
        bulkSafeFilterDryRun,
        bulkSafeFilterApply,
        runBulk,
    };
}

export type { BulkSelectionAnalysis };
