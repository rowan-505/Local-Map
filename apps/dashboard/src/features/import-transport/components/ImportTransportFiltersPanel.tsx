"use client";

import { Card, CardContent } from "@/src/components/ui/card";

import type { ImportTransportOptionsResponse } from "../api/importTransportApiClient";
import {
    IMPORT_TRANSPORT_LIMIT_CHOICES,
    IMPORT_TRANSPORT_SEARCH_PLACEHOLDERS,
    IMPORT_TRANSPORT_SELECT_CLASS,
    importTransportSortOptionsForSlug,
} from "../config/constants";
import type { ImportTransportEntitySlug, ImportTransportFilterField, ImportTransportListFilters } from "../config/types";
import { IMPORT_TRANSPORT_LOADING } from "../utils/loadingMessages";
import ImportTransportInlineSpinner from "./ImportTransportInlineSpinner";

const FILTER_LABELS: Record<string, string> = {
    review_status: "Review status",
    review_decision: "Decision",
    promotion_status: "Promotion",
    validation_status: "Validation",
    mode_type: "Mode type",
};

const FILTER_OPTION_KEYS: Record<string, keyof ImportTransportOptionsResponse> = {
    review_status: "review_statuses",
    review_decision: "review_decisions",
    promotion_status: "promotion_statuses",
    validation_status: "validation_statuses",
    mode_type: "mode_types",
};

export default function ImportTransportFiltersPanel({
    slug,
    filterFields,
    filters,
    options,
    qDraft,
    sort,
    limit,
    showPromoted,
    isLoadingOptions,
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
    slug: ImportTransportEntitySlug;
    filterFields: readonly ImportTransportFilterField[];
    filters: ImportTransportListFilters;
    options: ImportTransportOptionsResponse | null;
    qDraft: string;
    sort: string;
    limit: number;
    showPromoted: boolean;
    isLoadingOptions: boolean;
    isApplyingFilters: boolean;
    totalLabel: string;
    onFiltersChange: (next: ImportTransportListFilters) => void;
    onQDraftChange: (value: string) => void;
    onSortChange: (value: string) => void;
    onLimitChange: (value: number) => void;
    onShowPromotedChange: (value: boolean) => void;
    onApply: () => void;
    onClear: () => void;
}) {
    const standardFilterKeys = filterFields.filter(
        (key) =>
            key !== "q" &&
            key !== "sort" &&
            key !== "limit" &&
            key !== "offset" &&
            key !== "include_promoted"
    );
    const sortOptions = importTransportSortOptionsForSlug(slug);
    const searchPlaceholder = IMPORT_TRANSPORT_SEARCH_PLACEHOLDERS[slug] ?? "Search";

    return (
        <Card className="border-gray-200 shadow-sm">
            <CardContent className="space-y-5 p-5">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {standardFilterKeys.map((key) => {
                        const optionKey = FILTER_OPTION_KEYS[key];
                        const rawOptions = optionKey && options ? options[optionKey] : [];
                        const optionValues = Array.isArray(rawOptions)
                            ? rawOptions.filter((value): value is string => typeof value === "string")
                            : [];
                        return (
                            <label key={key} className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">
                                    {FILTER_LABELS[key] ?? key.replace(/_/g, " ")}
                                </span>
                                <select
                                    value={filters[key as keyof ImportTransportListFilters] ?? ""}
                                    onChange={(e) =>
                                        onFiltersChange({
                                            ...filters,
                                            [key]: e.target.value,
                                        } as ImportTransportListFilters)
                                    }
                                    className={IMPORT_TRANSPORT_SELECT_CLASS}
                                >
                                    <option value="">All</option>
                                    {optionValues.map((value) => (
                                        <option key={value} value={value}>
                                            {value}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        );
                    })}
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Search</span>
                        <input
                            value={qDraft}
                            onChange={(e) => onQDraftChange(e.target.value)}
                            placeholder={searchPlaceholder}
                            className={IMPORT_TRANSPORT_SELECT_CLASS}
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Sort</span>
                        <select
                            value={sort}
                            onChange={(e) => onSortChange(e.target.value)}
                            className={IMPORT_TRANSPORT_SELECT_CLASS}
                        >
                            {sortOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Page size</span>
                        <select
                            value={limit}
                            onChange={(e) => onLimitChange(Number(e.target.value))}
                            className={IMPORT_TRANSPORT_SELECT_CLASS}
                        >
                            {IMPORT_TRANSPORT_LIMIT_CHOICES.map((n) => (
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
                        Show promoted rows
                    </label>
                    {isLoadingOptions ? (
                        <ImportTransportInlineSpinner label={IMPORT_TRANSPORT_LOADING.loadingFilterOptions} />
                    ) : null}
                    {isApplyingFilters ? (
                        <ImportTransportInlineSpinner label={IMPORT_TRANSPORT_LOADING.applyingFilters} />
                    ) : null}
                    <span className="text-sm text-gray-600">{totalLabel}</span>
                </div>
            </CardContent>
        </Card>
    );
}
