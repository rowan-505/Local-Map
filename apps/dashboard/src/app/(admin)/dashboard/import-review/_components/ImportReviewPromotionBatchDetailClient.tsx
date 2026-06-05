"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import ImportReviewPromotionSimpleStepPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionSimpleStepPanel";
import {
    PublishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { formatImportReviewPromotionError } from "@/src/features/import-review/promotion/formatPromotionError";
import {
    IMPORT_REVIEW_PROMOTION_BATCH_INVALID_ROUTE_ID_MESSAGE,
    parseValidImportReviewPromotionBatchRouteId,
} from "@/src/features/import-review/promotion/promotionBatchRouteId";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    batchHasDeprecatedTransportPromotionItems,
    orderedBatchFamiliesForDisplay,
    resolveBatchActiveFamilies,
} from "@/src/features/import-review/utils/importReviewPromotionBatchFamilies";
import { importReviewHistoryHref } from "@/src/lib/importReviewEntityConfig";
import {
    getImportReviewPromotionBatchById,
    isAbortError,
    type ImportReviewPublishBatchDetail,
} from "@/src/lib/api";
import { importReviewPath } from "@/src/lib/dashboardNavigation";

export default function ImportReviewPromotionBatchDetailClient() {
    const params = useParams();
    const searchParams = useSearchParams();
    const routeBatchId = typeof params.batchId === "string" ? params.batchId : "";
    const batchId = parseValidImportReviewPromotionBatchRouteId(routeBatchId);
    const invalidRouteBatchId = batchId === null;
    const backQuery = searchParams.toString();
    const backHref = backQuery
        ? `${importReviewPath("promotion")}?${backQuery}`
        : importReviewPath("promotion");

    const [batchDetail, setBatchDetail] = useState<ImportReviewPublishBatchDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(!invalidRouteBatchId);

    const loadBatch = useCallback(async (signal?: AbortSignal) => {
        if (!batchId) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const detail = await getImportReviewPromotionBatchById(
                batchId,
                signal ? { signal } : undefined
            );
            setBatchDetail(detail);
        } catch (err) {
            if (!isAbortError(err)) {
                setError(formatImportReviewPromotionError(err));
                setBatchDetail(null);
            }
        } finally {
            setLoading(false);
        }
    }, [batchId]);

    useEffect(() => {
        if (invalidRouteBatchId) {
            setLoading(false);
            setBatchDetail(null);
            setError(null);
            return;
        }
        const controller = new AbortController();
        void loadBatch(controller.signal);
        return () => controller.abort();
    }, [invalidRouteBatchId, loadBatch]);

    const activeFamilies = useMemo(
        () => (batchDetail ? resolveBatchActiveFamilies(batchDetail) : []),
        [batchDetail]
    );

    const displayFamilies = useMemo(
        () =>
            batchDetail
                ? orderedBatchFamiliesForDisplay(
                      activeFamilies,
                      batchDetail.item_counts_by_entity_family ?? {}
                  )
                : [],
        [batchDetail, activeFamilies]
    );

    const transportPromotionBlocked = batchHasDeprecatedTransportPromotionItems(batchDetail);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-6xl space-y-6">
                <p className="text-sm text-gray-600">
                    <Link href={backHref} prefetch={false} className="font-medium text-emerald-800 hover:underline">
                        ← Promotion scope
                    </Link>
                    {" · "}
                    <Link
                        href={importReviewHistoryHref()}
                        prefetch={false}
                        className="font-medium text-gray-700 hover:underline"
                    >
                        History
                    </Link>
                </p>

                <header className="space-y-2 border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Publish batch</h1>
                    <p className="text-sm text-gray-600">
                        Validate typed columns, dry-run insert/update targets, then promote pending ready items.
                    </p>
                </header>

                {invalidRouteBatchId ? (
                    <ImportReviewStatusBanner
                        message={IMPORT_REVIEW_PROMOTION_BATCH_INVALID_ROUTE_ID_MESSAGE}
                        tone="error"
                    />
                ) : null}

                {loading ? (
                    <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingPromotionBatch} />
                ) : null}

                {!invalidRouteBatchId && error ? (
                    <ImportReviewStatusBanner message={error} tone="error" />
                ) : null}

                {transportPromotionBlocked ? (
                    <ImportReviewStatusBanner
                        message="This batch includes deprecated transport items. Use Import transport for those families."
                        tone="warning"
                    />
                ) : null}

                {batchDetail && batchId && !transportPromotionBlocked ? (
                    <ImportReviewPromotionSimpleStepPanel
                        batchId={batchId}
                        batchDetail={batchDetail}
                        families={displayFamilies}
                        onBatchUpdated={setBatchDetail}
                    />
                ) : null}

                {batchDetail && displayFamilies.length > 0 ? (
                    <p className="text-xs text-gray-500">
                        Families:{" "}
                        {displayFamilies.map((f) => (
                            <span key={f} className="mr-2">
                                <PublishEntityFamilyLabel family={f} />
                            </span>
                        ))}
                    </p>
                ) : null}
            </div>
        </main>
    );
}
