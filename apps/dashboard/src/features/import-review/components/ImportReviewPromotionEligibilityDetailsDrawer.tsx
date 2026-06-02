"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import ReviewDetailDrawer from "@/src/components/review/ReviewDetailDrawer";
import ReviewPagination from "@/src/components/review/ReviewPagination";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewPromotionEligibilityDetailsFilters, {
    DEFAULT_ELIGIBILITY_DETAILS_FILTERS,
    eligibilityDetailsSortPresetToApi,
    type EligibilityDetailsFilterState,
} from "@/src/features/import-review/components/ImportReviewPromotionEligibilityDetailsFilters";
import ImportReviewPromotionEligibilityDetailsTable from "@/src/features/import-review/components/ImportReviewPromotionEligibilityDetailsTable";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import {
    promotionEligibilityBucketLabel,
    promotionEligibilityDetailsTitle,
} from "@/src/features/import-review/utils/promotionEligibilityBucketLabels";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    getImportReviewPromotionEligibilityDetails,
    isAbortError,
    type ImportReviewPromotionEligibilityBucket,
    type ImportReviewPromotionEligibilityDetailItem,
} from "@/src/lib/api";

const PAGE_SIZE = 50;

export type ImportReviewPromotionEligibilityDetailsDrawerProps = {
    open: boolean;
    onClose: () => void;
    reviewBatchId: string;
    family: string;
    familyLabel: string;
    bucket: ImportReviewPromotionEligibilityBucket;
    includeWarnings: boolean;
    formatError: (err: unknown) => string;
};

function MetaRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="text-sm">
            <span className="font-medium text-gray-500">{label}</span>
            <span className="ml-1.5 text-gray-900">{value}</span>
        </div>
    );
}

export default function ImportReviewPromotionEligibilityDetailsDrawer({
    open,
    onClose,
    reviewBatchId,
    family,
    familyLabel,
    bucket,
    includeWarnings,
    formatError,
}: ImportReviewPromotionEligibilityDetailsDrawerProps) {
    const [items, setItems] = useState<ImportReviewPromotionEligibilityDetailItem[]>([]);
    const [total, setTotal] = useState(0);
    const [targetTable, setTargetTable] = useState("");
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [filters, setFilters] = useState<EligibilityDetailsFilterState>(
        DEFAULT_ELIGIBILITY_DETAILS_FILTERS
    );
    const [searchDraft, setSearchDraft] = useState("");

    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const apiSort = useMemo(
        () => eligibilityDetailsSortPresetToApi(filters.sortPreset),
        [filters.sortPreset]
    );

    const loadPage = useCallback(
        async (pageOffset: number, signal?: AbortSignal) => {
            if (!open || !reviewBatchId.trim()) {
                return;
            }
            setLoading(true);
            setError("");
            try {
                const res = await getImportReviewPromotionEligibilityDetails(
                    {
                        review_batch_id: reviewBatchId,
                        family,
                        bucket,
                        include_warnings: includeWarnings,
                        limit: PAGE_SIZE,
                        offset: pageOffset,
                        search: filters.search || undefined,
                        reason_code: filters.reasonCode || undefined,
                        sort_by: apiSort.sort_by,
                        sort_order: apiSort.sort_order,
                    },
                    signal ? { signal } : undefined
                );
                setTotal(res.total);
                setTargetTable(res.target);
                setItems(res.items);
                setOffset(res.offset);
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                setError(formatError(err));
                setItems([]);
                setTotal(0);
                setTargetTable("");
            } finally {
                setLoading(false);
            }
        },
        [
            open,
            reviewBatchId,
            family,
            bucket,
            includeWarnings,
            filters.search,
            filters.reasonCode,
            apiSort.sort_by,
            apiSort.sort_order,
            formatError,
        ]
    );

    useEffect(() => {
        if (!open) {
            setItems([]);
            setTotal(0);
            setTargetTable("");
            setOffset(0);
            setError("");
            setLoading(false);
            setFilters(DEFAULT_ELIGIBILITY_DETAILS_FILTERS);
            setSearchDraft("");
            return;
        }
        const controller = new AbortController();
        void loadPage(0, controller.signal);
        return () => controller.abort();
    }, [open, loadPage]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handle = window.setTimeout(() => {
            setFilters((prev) =>
                prev.search === searchDraft ? prev : { ...prev, search: searchDraft }
            );
        }, 300);
        return () => window.clearTimeout(handle);
    }, [open, searchDraft]);

    const handleFiltersChange = useCallback((next: EligibilityDetailsFilterState) => {
        setFilters(next);
        if (next.search !== searchDraft) {
            setSearchDraft(next.search);
        }
    }, [searchDraft]);

    const handlePageChange = useCallback(
        (nextPage: number) => {
            const nextOffset = (nextPage - 1) * PAGE_SIZE;
            void loadPage(nextOffset);
        },
        [loadPage]
    );

    const bucketLabel = useMemo(() => promotionEligibilityBucketLabel(bucket), [bucket]);
    const title = promotionEligibilityDetailsTitle(familyLabel, bucket);

    if (!open) {
        return null;
    }

    return (
        <ReviewDetailDrawer
            title={title}
            subtitle={total > 0 ? `${total.toLocaleString()} candidate(s)` : undefined}
            onClose={onClose}
            palette="import"
            maxWidthClass="sm:max-w-5xl"
            ariaLabel="Promotion eligibility candidates"
        >
            <div className="grid gap-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3 sm:grid-cols-2">
                <MetaRow label="Family:" value={familyLabel} />
                <MetaRow label="Bucket:" value={bucketLabel} />
                <MetaRow label="Target table:" value={targetTable || "—"} />
                <MetaRow label="Total:" value={total.toLocaleString()} />
            </div>

            <ImportReviewPromotionEligibilityDetailsFilters
                items={items}
                value={{ ...filters, search: searchDraft }}
                onChange={handleFiltersChange}
                onSearchDraftChange={setSearchDraft}
                disabled={loading}
            />

            {total > 0 ? (
                <ReviewPagination
                    page={page}
                    pageSize={PAGE_SIZE}
                    total={total}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                    palette="import"
                    disabled={loading}
                />
            ) : null}

            {loading && items.length === 0 ? (
                <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingCandidates} />
            ) : null}

            {error ? <ImportReviewStatusBanner message={error} tone="error" compact /> : null}

            {!loading && !error && items.length === 0 ? (
                <p className="text-sm text-gray-600">No candidates match the current filters.</p>
            ) : null}

            {items.length > 0 ? (
                <ImportReviewPromotionEligibilityDetailsTable
                    items={items}
                    family={family}
                    reviewBatchId={reviewBatchId}
                    bucket={bucket}
                />
            ) : null}

            {total > 0 && items.length > 0 ? (
                <ReviewPagination
                    page={page}
                    pageSize={PAGE_SIZE}
                    total={total}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                    palette="import"
                    disabled={loading}
                    className="border-t border-gray-200 pt-3"
                />
            ) : null}
        </ReviewDetailDrawer>
    );
}
