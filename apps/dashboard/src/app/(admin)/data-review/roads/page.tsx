import dynamic from "next/dynamic";

import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";

const ImportReviewCandidatesPageShell = dynamic(
    () =>
        import("@/src/app/(admin)/dashboard/import-review/_components/ImportReviewCandidatesClient").then(
            (mod) => ({
                default: mod.ImportReviewCandidatesPageShell,
            })
        ),
    {
        loading: () => (
            <main className="min-h-screen bg-gray-50 p-6">
                <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingRoadCandidates} />
            </main>
        ),
    }
);

export default function DataReviewRoadsPage() {
    return <ImportReviewCandidatesPageShell family="roads" showMapPreview />;
}
