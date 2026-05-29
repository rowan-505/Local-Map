import { Suspense } from "react";

import ImportTransportHistoryClient from "@/src/features/import-transport/components/ImportTransportHistoryClient";
import { ImportTransportLoadingBannerWithSpinner } from "@/src/features/import-transport/components/ImportTransportLoadingState";
import { IMPORT_TRANSPORT_LOADING } from "@/src/features/import-transport/utils/loadingMessages";

export default function ImportTransportHistoryPage() {
    return (
        <Suspense
            fallback={
                <main className="p-6">
                    <ImportTransportLoadingBannerWithSpinner message={IMPORT_TRANSPORT_LOADING.loadingHistory} />
                </main>
            }
        >
            <ImportTransportHistoryClient />
        </Suspense>
    );
}
