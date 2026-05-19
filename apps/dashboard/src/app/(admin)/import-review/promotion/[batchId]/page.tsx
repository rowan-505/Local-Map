import { Suspense } from "react";

import ImportReviewPromotionBatchDetailClient from "../../_components/ImportReviewPromotionBatchDetailClient";

export default function ImportReviewPromotionBatchDetailPage() {
    return (
        <Suspense
            fallback={
                <main className="p-6">
                    <p className="text-sm text-gray-600">Loading batch…</p>
                </main>
            }
        >
            <ImportReviewPromotionBatchDetailClient />
        </Suspense>
    );
}
