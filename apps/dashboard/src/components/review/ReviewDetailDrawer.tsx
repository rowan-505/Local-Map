"use client";

import type { ReactNode } from "react";

import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export default function ReviewDetailDrawer({
    title,
    subtitle,
    onClose,
    actions,
    children,
    ariaLabel = "Record details",
    palette = "core",
    maxWidthClass = "sm:max-w-xl",
}: {
    title: string;
    subtitle?: string | null;
    onClose: () => void;
    actions?: ReactNode;
    children: ReactNode;
    ariaLabel?: string;
    palette?: ReviewPalette;
    maxWidthClass?: string;
}) {
    const p = REVIEW_PALETTE[palette];
    return (
        <div
            className="fixed inset-0 z-40 flex justify-end bg-slate-900/30"
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            onClick={onClose}
        >
            <div
                className={`flex h-full w-full max-w-lg flex-col overflow-y-auto ${p.cardBg} shadow-xl ${maxWidthClass}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className={`sticky top-0 z-10 flex items-start justify-between gap-3 border-b ${p.cardBorder} ${p.cardBg} px-5 py-4`}
                >
                    <div className="min-w-0 pr-2">
                        <h2 className={`truncate text-lg font-semibold ${p.title}`}>{title}</h2>
                        {subtitle ? (
                            <p className={`mt-0.5 truncate text-sm ${p.muted}`}>{subtitle}</p>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {actions}
                        <button
                            type="button"
                            onClick={onClose}
                            className={`rounded-lg border ${p.inputBorder} ${p.cardBg} px-3 py-1.5 text-sm font-medium ${p.title} hover:bg-slate-50`}
                        >
                            Close
                        </button>
                    </div>
                </div>
                <div className="space-y-4 p-5">{children}</div>
            </div>
        </div>
    );
}
