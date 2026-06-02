"use client";

import { useMemo } from "react";

import type { ImportReviewPromotionEligibilityDetailItem } from "@/src/lib/api";

export type EligibilityDetailsSortPreset = "id_asc" | "updated_desc" | "confidence_asc";

export type EligibilityDetailsFilterState = {
    search: string;
    reasonCode: string;
    sortPreset: EligibilityDetailsSortPreset;
};

export const DEFAULT_ELIGIBILITY_DETAILS_FILTERS: EligibilityDetailsFilterState = {
    search: "",
    reasonCode: "",
    sortPreset: "id_asc",
};

export function eligibilityDetailsSortPresetToApi(sortPreset: EligibilityDetailsSortPreset): {
    sort_by: "id" | "updated_at" | "confidence_score";
    sort_order: "asc" | "desc";
} {
    switch (sortPreset) {
        case "updated_desc":
            return { sort_by: "updated_at", sort_order: "desc" };
        case "confidence_asc":
            return { sort_by: "confidence_score", sort_order: "asc" };
        case "id_asc":
        default:
            return { sort_by: "id", sort_order: "asc" };
    }
}

function collectReasonCodes(items: readonly ImportReviewPromotionEligibilityDetailItem[]): string[] {
    const set = new Set<string>();
    for (const item of items) {
        for (const code of item.reason_codes) {
            const trimmed = code.trim();
            if (trimmed) {
                set.add(trimmed);
            }
        }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}

export default function ImportReviewPromotionEligibilityDetailsFilters({
    items,
    value,
    onChange,
    onSearchDraftChange,
    disabled,
}: {
    items: ImportReviewPromotionEligibilityDetailItem[];
    value: EligibilityDetailsFilterState;
    onChange: (next: EligibilityDetailsFilterState) => void;
    onSearchDraftChange: (search: string) => void;
    disabled?: boolean;
}) {

    const reasonOptions = useMemo(() => collectReasonCodes(items), [items]);

    const inputClass =
        "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm disabled:opacity-60";

    return (
        <div className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-3">
            <label className="block sm:col-span-3">
                <span className="mb-1 block text-xs font-medium text-gray-600">Search</span>
                <input
                    type="search"
                    value={value.search}
                    disabled={disabled}
                    onChange={(e) => onSearchDraftChange(e.target.value)}
                    placeholder="ID, external ID, name, reason…"
                    className={inputClass}
                />
            </label>
            <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Reason code</span>
                <select
                    value={value.reasonCode}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...value, reasonCode: e.target.value })}
                    className={inputClass}
                >
                    <option value="">All reasons</option>
                    {reasonOptions.map((code) => (
                        <option key={code} value={code}>
                            {code}
                        </option>
                    ))}
                </select>
            </label>
            <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-gray-600">Sort</span>
                <select
                    value={value.sortPreset}
                    disabled={disabled}
                    onChange={(e) =>
                        onChange({
                            ...value,
                            sortPreset: e.target.value as EligibilityDetailsSortPreset,
                        })
                    }
                    className={inputClass}
                >
                    <option value="id_asc">ID ascending</option>
                    <option value="updated_desc">Updated (newest first)</option>
                    <option value="confidence_asc">Confidence (low first)</option>
                </select>
            </label>
        </div>
    );
}
