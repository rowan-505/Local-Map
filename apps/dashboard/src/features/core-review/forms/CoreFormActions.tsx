"use client";

import Link from "next/link";

export type CoreFormActionsProps = {
    cancelHref: string;
    submitLabel: string;
    isSubmitting?: boolean;
    disabled?: boolean;
    showSubmit?: boolean;
    saveError?: string | null;
    saveSuccess?: string | null;
};

export default function CoreFormActions({
    cancelHref,
    submitLabel,
    isSubmitting = false,
    disabled = false,
    showSubmit = true,
    saveError,
    saveSuccess,
}: CoreFormActionsProps) {
    return (
        <div className="sticky bottom-0 z-10 -mx-6 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-white/80">
            {saveSuccess ? (
                <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {saveSuccess}
                </div>
            ) : null}
            {saveError ? (
                <div className="mb-3 whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {saveError}
                </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-3">
                <Link
                    href={cancelHref}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                    {showSubmit ? "Cancel" : "Back to list"}
                </Link>
                {showSubmit ? (
                    <button
                        type="submit"
                        disabled={disabled || isSubmitting}
                        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isSubmitting ? "Saving…" : submitLabel}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
