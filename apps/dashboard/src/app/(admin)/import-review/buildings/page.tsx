import { Suspense } from "react";

import { ImportReviewBuildingsClient } from "../_components/ImportReviewBuildingsClient";

export default function ImportReviewBuildingsPage() {
    return (
        <Suspense
            fallback={
                <main className="min-h-screen bg-gray-50 p-6">
                    <div className="text-gray-600">Loading…</div>
                </main>
            }
        >
            <ImportReviewBuildingsClient />
        </Suspense>
    );
}
