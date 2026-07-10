"use client";

import { useState } from "react";

import { FAILED_SEARCH_RESOLUTION_TYPES, resolutionTypeLabel } from "./constants";
import type { FailedSearchResolutionType } from "./types";
import { PRIMARY_BTN, SECONDARY_BTN, SELECT_CLASS } from "./ui";

export default function FailedSearchResolveDialog({
    query,
    saving,
    error,
    onClose,
    onConfirm,
}: {
    query: string;
    saving: boolean;
    error: string;
    onClose: () => void;
    onConfirm: (resolutionType: FailedSearchResolutionType) => void | Promise<void>;
}) {
    const [resolutionType, setResolutionType] =
        useState<FailedSearchResolutionType>("ignored");
    const [confirmed, setConfirmed] = useState(false);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
            <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="Close dialog"
                onClick={onClose}
            />
            <div className="relative z-10 w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl">
                <div className="border-b border-gray-200 px-5 py-4">
                    <h2 className="text-lg font-semibold text-gray-900">Mark failed search resolved</h2>
                    <p className="mt-1 text-sm text-gray-600">
                        Close &quot;{query}&quot; without creating an alias.
                    </p>
                </div>

                <form
                    className="space-y-4 px-5 py-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!confirmed) return;
                        void onConfirm(resolutionType);
                    }}
                >
                    <label className="block space-y-1 text-sm">
                        <span className="text-gray-700">Resolution type</span>
                        <select
                            value={resolutionType}
                            onChange={(e) =>
                                setResolutionType(e.target.value as FailedSearchResolutionType)
                            }
                            className={SELECT_CLASS}
                        >
                            {FAILED_SEARCH_RESOLUTION_TYPES.filter((type) => type !== "alias").map(
                                (type) => (
                                    <option key={type} value={type}>
                                        {resolutionTypeLabel(type)}
                                    </option>
                                ),
                            )}
                        </select>
                    </label>

                    <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                            className="mt-1"
                        />
                        <span>
                            I confirm this failed search has been reviewed and should be marked
                            resolved without adding an alias.
                        </span>
                    </label>

                    {error ? (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {error}
                        </div>
                    ) : null}

                    <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                        <button type="button" className={SECONDARY_BTN} onClick={onClose} disabled={saving}>
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className={PRIMARY_BTN}
                            disabled={saving || !confirmed}
                        >
                            {saving ? "Saving…" : "Mark resolved"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
