"use client";

import { Card, CardContent } from "@/src/components/ui/card";

import { IMPORT_REVIEW_SELECT_CLASS } from "../utils/entityPageUtils";

export default function ImportReviewBatchScopeBar({
    snapshotInput,
    batchInput,
    onSnapshotChange,
    onBatchChange,
    onApplyScope,
    disabled,
}: {
    snapshotInput: string;
    batchInput: string;
    onSnapshotChange: (value: string) => void;
    onBatchChange: (value: string) => void;
    onApplyScope: () => void;
    disabled?: boolean;
}) {
    return (
        <Card className="border-gray-200 shadow-sm">
            <CardContent className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                        <span className="text-xs font-semibold uppercase text-gray-500">Snapshot</span>
                        <input
                            value={snapshotInput}
                            onChange={(e) => onSnapshotChange(e.target.value)}
                            disabled={disabled || Boolean(batchInput.trim())}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                            placeholder="Xor with review_batch_id"
                        />
                    </label>
                    <label className="block text-sm">
                        <span className="text-xs font-semibold uppercase text-gray-500">Review batch ID</span>
                        <input
                            value={batchInput}
                            onChange={(e) => onBatchChange(e.target.value)}
                            disabled={disabled || Boolean(snapshotInput.trim())}
                            inputMode="numeric"
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm disabled:bg-gray-100"
                        />
                    </label>
                </div>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onApplyScope}
                    className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50"
                >
                    Apply scope
                </button>
            </CardContent>
        </Card>
    );
}
