"use client";

import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export type ReviewPaginationProps = {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    palette?: ReviewPalette;
    disabled?: boolean;
    className?: string;
    /** When set, enables cursor-style next without exact total (streets progressive list). */
    hasNextPage?: boolean | null;
    /** When false, `total` is not yet known — show range-only summary until count loads. */
    totalKnown?: boolean;
    /** Background count request in flight. */
    totalLoading?: boolean;
    /** Count request failed — keep list usable without exact total. */
    countUnavailable?: boolean;
};

export default function ReviewPagination({
    page,
    pageSize,
    total,
    totalPages,
    onPageChange,
    palette = "core",
    disabled = false,
    className = "",
    hasNextPage = null,
    totalKnown = true,
    totalLoading = false,
    countUnavailable = false,
}: ReviewPaginationProps) {
    const p = REVIEW_PALETTE[palette];
    const progressive = hasNextPage !== null;
    const safeTotalPages = totalKnown ? Math.max(1, totalPages) : Math.max(1, page);
    const currentPage = Math.min(Math.max(1, page), safeTotalPages);
    const rangeStart = total === 0 && !progressive ? 0 : (currentPage - 1) * pageSize + 1;
    const rangeEnd =
        total === 0 && !progressive
            ? 0
            : totalKnown && total > 0
              ? Math.min(currentPage * pageSize, total)
              : currentPage * pageSize;

    const btnClass = `rounded-lg border ${p.inputBorder} ${p.cardBg} px-3 py-1.5 text-sm font-medium ${p.title} shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50`;

    let summary: string;
    if (total === 0 && !progressive) {
        summary = "No results";
    } else if (!totalKnown) {
        if (totalLoading) {
            summary = `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} (Counting…)`;
        } else if (countUnavailable) {
            summary = `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} · Total unavailable`;
        } else {
            summary = `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()}`;
        }
    } else {
        summary = `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()}`;
    }

    const canGoNext = progressive
        ? hasNextPage === true
        : !disabled && currentPage < safeTotalPages;

    return (
        <nav
            className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
            aria-label="Pagination"
        >
            <p className={`text-sm ${p.muted}`}>{summary}</p>
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    className={btnClass}
                    disabled={disabled || currentPage <= 1}
                    onClick={() => onPageChange(currentPage - 1)}
                >
                    Previous
                </button>
                <span className={`px-2 text-sm ${p.body}`}>
                    {totalKnown
                        ? `Page ${currentPage} of ${safeTotalPages}`
                        : `Page ${currentPage}`}
                </span>
                <button
                    type="button"
                    className={btnClass}
                    disabled={disabled || !canGoNext}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    Next
                </button>
            </div>
        </nav>
    );
}
