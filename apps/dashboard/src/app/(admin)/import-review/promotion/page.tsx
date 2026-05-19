import { Suspense } from "react";

import ImportReviewPromotionClient from "../_components/ImportReviewPromotionClient";

export default function ImportReviewPromotionPage() {
    return (
        <Suspense
            fallback={
                <main className="p-6">
                    <p className="text-sm text-gray-600">Loading promotion…</p>
                </main>
            }
        >
            <ImportReviewPromotionClient />
        </Suspense>
    );
}
