import { Suspense } from "react";

import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";

import ImportReviewPromotionBatchDetailClient from "../../_components/ImportReviewPromotionBatchDetailClient";

export default function ImportReviewPromotionBatchDetailPage() {
    return (
        <Suspense
            fallback={
                <main className="p-6">
                    <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingPromotionBatch} />
                </main>
            }
        >
            <ImportReviewPromotionBatchDetailClient />
        </Suspense>
    );
}
