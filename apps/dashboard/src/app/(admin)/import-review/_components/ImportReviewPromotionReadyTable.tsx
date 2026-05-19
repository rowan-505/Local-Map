"use client";

import Link from "next/link";
import { useMemo } from "react";

import {
    ImportReviewTableFrame,
    importReviewStickyActionsTdClass,
    importReviewStickyActionsThClass,
} from "@/src/app/(admin)/import-review/_components/importReviewTableUi";
import { PromotionStatusBadge } from "@/src/app/(admin)/import-review/_components/importReviewPromotionUi";
import type { ImportReviewPromotionReadyCandidateItem } from "@/src/lib/api";
import { applyImportReviewScopeSearchParams } from "@/src/lib/importReviewSnapshot";

type LoadedScope =
    | { kind: "source_snapshot"; value: string }
    | { kind: "review_batch"; value: string };

function displayName(row: ImportReviewPromotionReadyCandidateItem): string {
    return row.name?.trim() || row.canonical_name?.trim() || "—";
}

function buildingsReviewHref(scope: LoadedScope, row: ImportReviewPromotionReadyCandidateItem): string {
    const p = new URLSearchParams();
    if (scope.kind === "review_batch") {
        p.set("review_batch_id", scope.value);
    } else {
        applyImportReviewScopeSearchParams(p, scope.value, "");
    }
    const q = row.external_id?.trim() || row.name?.trim() || row.id;
    p.set("q", q);
    return `/import-review/buildings?${p.toString()}`;
}

export default function ImportReviewPromotionReadyTable({
    items,
    total,
    limit,
    offset,
    scope,
    isLoading,
    onPageChange,
    onViewDetails,
}: {
    items: ImportReviewPromotionReadyCandidateItem[];
    total: number;
    limit: number;
    offset: number;
    scope: LoadedScope | null;
    isLoading: boolean;
    onPageChange: (nextOffset: number) => void;
    onViewDetails: (row: ImportReviewPromotionReadyCandidateItem) => void;
}) {
    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const canPrev = offset > 0;
    const canNext = offset + limit < total;

    const emptyMessage = useMemo(() => {
        if (!scope) {
            return "Apply a scope to load ready candidates.";
        }
        if (total === 0) {
            return "No building candidates are ready for publish batching in this scope.";
        }
        return null;
    }, [scope, total]);

    if (emptyMessage && !isLoading) {
        return (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
                {emptyMessage}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
                <span>
                    Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + items.length, total)} of{" "}
                    {total.toLocaleString()} ready
                </span>
                <PromotionTablePagination
                    page={page}
                    totalPages={totalPages}
                    canPrev={canPrev}
                    canNext={canNext}
                    isLoading={isLoading}
                    onPageChange={onPageChange}
                    limit={limit}
                    offset={offset}
                />
            </div>

            <ImportReviewTableFrame>
                <table className="min-w-[1400px] w-full divide-y divide-gray-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="px-3 py-3">ID</th>
                            <th className="px-3 py-3">External ID</th>
                            <th className="px-3 py-3">Name</th>
                            <th className="px-3 py-3">Class</th>
                            <th className="px-3 py-3">Building type</th>
                            <th className="px-3 py-3">Confidence</th>
                            <th className="px-3 py-3">Match</th>
                            <th className="px-3 py-3">Auto action</th>
                            <th className="px-3 py-3">Decision</th>
                            <th className="px-3 py-3">Promotion</th>
                            <th className="px-3 py-3">Warnings</th>
                            <th className="px-3 py-3">Updated</th>
                            <th className={importReviewStickyActionsThClass()}>Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {isLoading && items.length === 0 ? (
                            <tr>
                                <td colSpan={13} className="px-4 py-8 text-center text-gray-500">
                                    Loading candidates…
                                </td>
                            </tr>
                        ) : null}
                        {items.map((row) => (
                            <tr key={row.id} className="hover:bg-gray-50/80">
                                <td className="px-3 py-2 font-mono text-xs text-gray-800">{row.id}</td>
                                <td className="max-w-[8rem] truncate px-3 py-2 text-gray-700" title={row.external_id ?? ""}>
                                    {row.external_id ?? "—"}
                                </td>
                                <td className="max-w-[10rem] truncate px-3 py-2 font-medium text-gray-900" title={displayName(row)}>
                                    {displayName(row)}
                                </td>
                                <td className="px-3 py-2 text-gray-700">{row.class_code ?? "—"}</td>
                                <td className="max-w-[8rem] truncate px-3 py-2 text-gray-700" title={row.building_type ?? ""}>
                                    {row.building_type ?? "—"}
                                </td>
                                <td className="px-3 py-2 tabular-nums text-gray-700">
                                    {row.confidence_score != null ? row.confidence_score.toFixed(2) : "—"}
                                </td>
                                <td className="px-3 py-2">
                                    <PromotionStatusBadge value={row.match_status} />
                                </td>
                                <td className="px-3 py-2">
                                    <PromotionStatusBadge value={row.auto_action} />
                                </td>
                                <td className="px-3 py-2">
                                    <PromotionStatusBadge value={row.review_decision} />
                                </td>
                                <td className="px-3 py-2">
                                    <PromotionStatusBadge value={row.promotion_status} />
                                </td>
                                <td className="px-3 py-2 tabular-nums text-amber-800">
                                    {row.validation_warnings_count > 0 ? row.validation_warnings_count : "—"}
                                </td>
                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                                    {new Date(row.updated_at).toLocaleString()}
                                </td>
                                <td className={importReviewStickyActionsTdClass("bg-white")}>
                                    <div className="flex flex-col gap-1">
                                        <button
                                            type="button"
                                            onClick={() => onViewDetails(row)}
                                            className="text-left text-sm font-medium text-emerald-800 hover:underline"
                                        >
                                            View details
                                        </button>
                                        {scope ? (
                                            <Link
                                                href={buildingsReviewHref(scope, row)}
                                                className="text-left text-xs text-gray-600 hover:underline"
                                            >
                                                Open in review
                                            </Link>
                                        ) : null}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ImportReviewTableFrame>
        </div>
    );
}

function PromotionTablePagination({
    page,
    totalPages,
    canPrev,
    canNext,
    isLoading,
    onPageChange,
    limit,
    offset,
}: {
    page: number;
    totalPages: number;
    canPrev: boolean;
    canNext: boolean;
    isLoading: boolean;
    onPageChange: (nextOffset: number) => void;
    limit: number;
    offset: number;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
                Page {page} / {totalPages}
            </span>
            <button
                type="button"
                disabled={!canPrev || isLoading}
                onClick={() => onPageChange(Math.max(0, offset - limit))}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-40"
            >
                Previous
            </button>
            <button
                type="button"
                disabled={!canNext || isLoading}
                onClick={() => onPageChange(offset + limit)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-40"
            >
                Next
            </button>
        </div>
    );
}
