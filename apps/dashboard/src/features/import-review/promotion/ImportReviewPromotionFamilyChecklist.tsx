"use client";

import {
    DISABLED_IMPORT_REVIEW_PROMOTION_FAMILY_META,
    IMPORT_REVIEW_PROMOTION_FAMILY_META,
} from "@/src/features/import-review/config/importReviewPromotionFamilies";

type Props = {
    selected: Set<string>;
    onToggle: (family: string, checked: boolean) => void;
    disabled?: boolean;
};

export default function ImportReviewPromotionFamilyChecklist({ selected, onToggle, disabled }: Props) {
    return (
        <div className="space-y-6">
            <fieldset className="space-y-3" disabled={disabled}>
                <legend className="text-sm font-medium text-gray-900">Entity families</legend>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => (
                        <li
                            key={row.family}
                            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap"
                        >
                            <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-sm font-medium text-gray-900">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-300"
                                    checked={selected.has(row.family)}
                                    onChange={(e) => onToggle(row.family, e.target.checked)}
                                />
                                {row.label}
                            </label>
                            <span className="font-mono text-xs text-gray-500">{row.targetLabel}</span>
                        </li>
                    ))}
                </ul>
            </fieldset>

            <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-4 py-3">
                <p className="text-sm font-medium text-sky-950">Transport promotion moved to Import Transport.</p>
                <ul className="mt-2 space-y-2">
                    {DISABLED_IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => (
                        <li
                            key={row.family}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm text-sky-900/90"
                        >
                            <span className="text-gray-500">{row.label}</span>
                            <span className="text-xs text-sky-800">Not available here</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
