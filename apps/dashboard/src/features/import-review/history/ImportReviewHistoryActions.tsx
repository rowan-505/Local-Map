"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
    getImportReviewPromotionBatchVerify,
    postImportReviewPromotionBatchResetValidation,
    postImportReviewPromotionBatchResume,
} from "@/src/lib/api";
import { importReviewPath } from "@/src/lib/dashboardPaths";

type Props = {
    batchId: string;
    resumableActions: readonly string[];
    onActionComplete?: () => void;
};

export function ImportReviewHistoryPublishBatchActions({
    batchId,
    resumableActions,
    onActionComplete,
}: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const actions = new Set(resumableActions);

    const run = async (key: string, fn: () => Promise<unknown>) => {
        setBusy(key);
        setActionError(null);
        try {
            await fn();
            onActionComplete?.();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Action failed.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-1">
                <Link
                    href={importReviewPath(`promotion/${batchId}`)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50"
                >
                    Open
                </Link>
                {actions.has("resume_validation") || actions.has("resume_promotion") || actions.has("resume_dry_run") || actions.has("resume_verify") ? (
                    <button
                        type="button"
                        disabled={busy != null}
                        onClick={() =>
                            void run("resume", () => postImportReviewPromotionBatchResume(batchId))
                        }
                        className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                    >
                        {busy === "resume" ? "…" : "Resume"}
                    </button>
                ) : null}
                {actions.has("verify") || actions.has("resume_verify") ? (
                    <button
                        type="button"
                        disabled={busy != null}
                        onClick={() =>
                            void run("verify", () => getImportReviewPromotionBatchVerify(batchId))
                        }
                        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-950 hover:bg-emerald-100 disabled:opacity-50"
                    >
                        {busy === "verify" ? "…" : "Verify"}
                    </button>
                ) : null}
                {actions.has("reset_validation") ? (
                    <button
                        type="button"
                        disabled={busy != null}
                        onClick={() =>
                            void run("reset_validation", async () => {
                                await postImportReviewPromotionBatchResetValidation(batchId);
                                router.push(importReviewPath(`promotion/${batchId}`));
                            })
                        }
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-900 hover:bg-red-100 disabled:opacity-50"
                    >
                        {busy === "reset_validation" ? "…" : "Reset validation"}
                    </button>
                ) : null}
            </div>
            {actionError ? <span className="text-xs text-red-700">{actionError}</span> : null}
        </div>
    );
}

export function ImportReviewHistoryReviewBatchActions({ batchId }: { batchId: string }) {
    return (
        <Link
            href={importReviewPath(`history/review-batches/${batchId}`)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50"
        >
            Open
        </Link>
    );
}
