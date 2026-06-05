import { Suspense } from "react";

import ImportReviewHistoryPageClient from "@/src/features/import-review/history/ImportReviewHistoryPage";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";

export default function ImportReviewHistoryPage() {
    return (
        <Suspense
            fallback={
                <main className="p-6">
                    <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingHistory} />
                </main>
            }
        >
            <ImportReviewHistoryPageClient />
        </Suspense>
    );
}
