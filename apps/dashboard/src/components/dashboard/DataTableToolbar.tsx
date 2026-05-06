"use client";

import { useEffect, type ChangeEvent } from "react";

/** Drives which arrange options appear in the second dropdown. */
export type DataTableSortOptionType = "date" | "text";

export type DataTableSortOption = {
    value: string;
    label: string;
    type: DataTableSortOptionType;
};

/** User-facing arrange values for date-based sorts. */
export type DataTableArrangeDate = "newest" | "oldest";

/** User-facing arrange values for text-based sorts. */
export type DataTableArrangeText = "az" | "za";

export type DataTableArrange = DataTableArrangeDate | DataTableArrangeText;

type DataTableToolbarProps = {
    searchValue: string;
    onSearchChange: (value: string) => void;
    placeholder: string;
    sortBy: string;
    onSortByChange: (value: string) => void;
    sortOptions: DataTableSortOption[];
    arrange: DataTableArrange;
    onArrangeChange: (value: DataTableArrange) => void;
    /** Full dataset size (before client filters, or server total as applicable). */
    totalCount: number;
    /** Size after applying current filters / search context. */
    filteredCount: number;
    /** Clears search and returns sort/arrange to parent-defined defaults. */
    onClearFilters: () => void;
    className?: string;
};

function arrangeOptionsForType(
    type: DataTableSortOptionType | undefined
): { value: DataTableArrange; label: string }[] {
    if (type === "date") {
        return [
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
        ];
    }

    return [
        { value: "az", label: "A–Z" },
        { value: "za", label: "Z–A" },
    ];
}

function coerceArrangeForType(
    arrange: DataTableArrange,
    type: DataTableSortOptionType | undefined
): DataTableArrange {
    const opts = arrangeOptionsForType(type);
    const ok = opts.some((o) => o.value === arrange);
    if (ok) {
        return arrange;
    }
    return opts[0]?.value ?? "newest";
}

export default function DataTableToolbar({
    searchValue,
    onSearchChange,
    placeholder,
    sortBy,
    onSortByChange,
    sortOptions,
    arrange,
    onArrangeChange,
    totalCount,
    filteredCount,
    onClearFilters,
    className,
}: DataTableToolbarProps) {
    const selectedSort = sortOptions.find((o) => o.value === sortBy);
    const arrangeKind = selectedSort?.type ?? "text";
    const arrangeChoices = arrangeOptionsForType(arrangeKind);
    const arrangeValue = coerceArrangeForType(arrange, arrangeKind);

    const handleSearchInput = (event: ChangeEvent<HTMLInputElement>) => {
        onSearchChange(event.target.value);
    };

    const handleSortChange = (event: ChangeEvent<HTMLSelectElement>) => {
        onSortByChange(event.target.value);
    };

    const handleArrangeChange = (event: ChangeEvent<HTMLSelectElement>) => {
        onArrangeChange(event.target.value as DataTableArrange);
    };

    useEffect(() => {
        const valid = coerceArrangeForType(arrange, arrangeKind);
        if (valid !== arrange) {
            onArrangeChange(valid);
        }
    }, [arrange, arrangeKind, onArrangeChange]);

    return (
        <div
            className={`flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end sm:justify-between ${className ?? ""}`}
        >
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:max-w-md">
                <label className="block">
                    <span className="sr-only">Search</span>
                    <input
                        type="search"
                        value={searchValue}
                        onChange={handleSearchInput}
                        placeholder={placeholder}
                        autoComplete="off"
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                </label>

                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                    <span aria-live="polite">
                        <span className="font-medium text-gray-900">{filteredCount}</span>
                        {filteredCount !== totalCount ? (
                            <>
                                {" "}
                                of <span className="font-medium text-gray-900">{totalCount}</span>
                            </>
                        ) : null}{" "}
                        {filteredCount === 1 ? "result" : "results"}
                    </span>
                </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Sort by
                    </span>
                    <select
                        value={sortBy}
                        onChange={handleSortChange}
                        disabled={sortOptions.length === 0}
                        className="min-w-40 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                    >
                        {sortOptions.length === 0 ? (
                            <option value="">No options</option>
                        ) : (
                            sortOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))
                        )}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Arrange
                    </span>
                    <select
                        key={arrangeKind}
                        value={arrangeValue}
                        onChange={handleArrangeChange}
                        disabled={sortOptions.length === 0}
                        className="min-w-40 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                    >
                        {arrangeChoices.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </label>

                <button
                    type="button"
                    onClick={onClearFilters}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:mb-0 sm:self-end"
                >
                    Clear filters
                </button>
            </div>
        </div>
    );
}
