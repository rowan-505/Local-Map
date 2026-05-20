"use client";

import { Card, CardContent } from "@/src/components/ui/card";

import type { ImportReviewFilterField } from "../config/types";
import {
    IMPORT_REVIEW_LIMIT_CHOICES,
    IMPORT_REVIEW_SELECT_CLASS,
    IMPORT_REVIEW_SORT_OPTIONS,
    IMPORT_REVIEW_UNREVIEWED_FILTER,
    type ImportReviewListFilters,
} from "../utils/entityPageUtils";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";

const FILTER_LABELS: Record<string, string> = {
    match_status: "Match status",
    auto_action: "Auto action",
    review_status: "Review status",
    review_decision: "Decision",
    promotion_status: "Promotion",
    class_code: "Class code",
};

export default function ImportReviewFiltersPanel({
    filterFields,
    filters,
    filterOptions,
    qDraft,
    sort,
    limit,
    showPromoted,
    isLoadingFilters,
    isApplyingFilters,
    totalLabel,
    onFiltersChange,
    onQDraftChange,
    onSortChange,
    onLimitChange,
    onShowPromotedChange,
    onApply,
    onClear,
}: {
    filterFields: readonly ImportReviewFilterField[];
    filters: ImportReviewListFilters;
    filterOptions: { [key: string]: string[] | string | number | null | undefined } | null;
    qDraft: string;
    sort: string;
    limit: number;
    showPromoted: boolean;
    isLoadingFilters: boolean;
    isApplyingFilters: boolean;
    totalLabel: string;
    onFiltersChange: (next: ImportReviewListFilters) => void;
    onQDraftChange: (value: string) => void;
    onSortChange: (value: string) => void;
    onLimitChange: (value: number) => void;
    onShowPromotedChange: (value: boolean) => void;
    onApply: () => void;
    onClear: () => void;
}) {
    const standardFilterKeys = filterFields.filter(
        (k) =>
            k !== "q" &&
            k !== "sort" &&
            k !== "limit" &&
            k !== "offset" &&
            k !== "include_promoted"
    );

    return (
        <Card className="border-gray-200 shadow-sm">
            <CardContent className="space-y-5 p-5">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {standardFilterKeys.map((key) => (
                        <label key={key} className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-gray-600">
                                {FILTER_LABELS[key] ?? key.replace(/_/g, " ")}
                            </span>
                            <select
                                value={filters[key as keyof ImportReviewListFilters] ?? ""}
                                onChange={(e) =>
                                    onFiltersChange({
                                        ...filters,
                                        [key]: e.target.value,
                                    } as ImportReviewListFilters)
                                }
                                className={IMPORT_REVIEW_SELECT_CLASS}
                            >
                                <option value="">All</option>
                                {(key === "review_status" || key === "review_decision") && (
                                    <option value={IMPORT_REVIEW_UNREVIEWED_FILTER}>Unreviewed</option>
                                )}
                                {(
                                    (Array.isArray(filterOptions?.[key])
                                        ? filterOptions[key]
                                        : undefined) ?? []
                                ).map((v) => (
                                    <option key={v} value={v}>
                                        {v}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ))}
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Search</span>
                        <input
                            value={qDraft}
                            onChange={(e) => onQDraftChange(e.target.value)}
                            className={IMPORT_REVIEW_SELECT_CLASS}
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Sort</span>
                        <select
                            value={sort}
                            onChange={(e) => onSortChange(e.target.value)}
                            className={IMPORT_REVIEW_SELECT_CLASS}
                        >
                            {IMPORT_REVIEW_SORT_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Page size</span>
                        <select
                            value={limit}
                            onChange={(e) => onLimitChange(Number(e.target.value))}
                            className={IMPORT_REVIEW_SELECT_CLASS}
                        >
                            {IMPORT_REVIEW_LIMIT_CHOICES.map((n) => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    <button
                        type="button"
                        onClick={onApply}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
                    >
                        Apply filters
                    </button>
                    <button
                        type="button"
                        onClick={onClear}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
                    >
                        Clear
                    </button>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={showPromoted}
                            onChange={(e) => onShowPromotedChange(e.target.checked)}
                        />
                        Show promoted
                    </label>
                    {isLoadingFilters ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingFilterOptions} />
                    ) : null}
                    {isApplyingFilters ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.applyingFilters} />
                    ) : null}
                    <span className="text-sm text-gray-600">{totalLabel}</span>
                </div>
            </CardContent>
        </Card>
    );
}
