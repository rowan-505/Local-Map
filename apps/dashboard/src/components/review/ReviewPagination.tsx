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
}: ReviewPaginationProps) {
    const p = REVIEW_PALETTE[palette];
    const safeTotalPages = Math.max(1, totalPages);
    const currentPage = Math.min(Math.max(1, page), safeTotalPages);
    const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const rangeEnd = total === 0 ? 0 : Math.min(currentPage * pageSize, total);

    const btnClass = `rounded-lg border ${p.inputBorder} ${p.cardBg} px-3 py-1.5 text-sm font-medium ${p.title} shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50`;

    return (
        <nav
            className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
            aria-label="Pagination"
        >
            <p className={`text-sm ${p.muted}`}>
                {total === 0
                    ? "No results"
                    : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()}`}
            </p>
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
                    Page {currentPage} of {safeTotalPages}
                </span>
                <button
                    type="button"
                    className={btnClass}
                    disabled={disabled || currentPage >= safeTotalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    Next
                </button>
            </div>
        </nav>
    );
}
