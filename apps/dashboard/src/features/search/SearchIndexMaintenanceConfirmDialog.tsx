"use client";

import { useState } from "react";

import { PRIMARY_BTN, SECONDARY_BTN } from "./ui";

export default function SearchIndexMaintenanceConfirmDialog({
    title,
    description,
    confirmLabel,
    saving,
    error,
    onClose,
    onConfirm,
}: {
    title: string;
    description: string;
    confirmLabel: string;
    saving: boolean;
    error: string;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
}) {
    const [confirmed, setConfirmed] = useState(false);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
            <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="Close dialog"
                onClick={onClose}
            />
            <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-xl">
                <div className="border-b border-gray-200 px-5 py-4">
                    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    <p className="mt-1 text-sm text-gray-600">{description}</p>
                </div>

                <form
                    className="space-y-4 px-5 py-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!confirmed) return;
                        void onConfirm();
                    }}
                >
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                            className="mt-1"
                        />
                        <span>
                            I understand this is a heavy search index operation and may take several
                            minutes.
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
                        <button type="submit" className={PRIMARY_BTN} disabled={saving || !confirmed}>
                            {saving ? "Running…" : confirmLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
