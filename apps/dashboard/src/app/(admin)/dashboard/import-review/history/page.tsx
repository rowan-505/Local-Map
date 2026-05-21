import { Suspense } from "react";

import ImportReviewHistoryClient from "../_components/ImportReviewHistoryClient";
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
            <ImportReviewHistoryClient />
        </Suspense>
    );
}
