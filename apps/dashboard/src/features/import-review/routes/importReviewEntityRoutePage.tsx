import dynamic from "next/dynamic";

import ImportReviewTransportMovedPage from "../components/ImportReviewTransportMovedPage";
import { ImportReviewLoadingBannerWithSpinner } from "../components/ImportReviewLoadingState";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import type { ImportReviewEntitySlug } from "../config/types";
import { isDeprecatedImportReviewBusSlug } from "../utils/deprecatedCoreBusPromotion";

const ImportReviewEntityPageShell = dynamic(
    () =>
        import("../components/ImportReviewEntityPage").then((mod) => ({
            default: mod.ImportReviewEntityPageShell,
        })),
    {
        loading: () => (
            <main className="min-h-screen bg-gray-50 p-6">
                <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingBatchContext} />
            </main>
        ),
    }
);

export type ImportReviewEntityRoutePageOptions = {
    showMapPreview?: boolean;
};

/** Thin Next.js route default export for config-driven import-review entity pages. */
export function createImportReviewEntityRoutePage(
    slug: ImportReviewEntitySlug,
    options: ImportReviewEntityRoutePageOptions = {}
) {
    if (isDeprecatedImportReviewBusSlug(slug)) {
        return function ImportReviewDeprecatedBusRoutePage() {
            return <ImportReviewTransportMovedPage slug={slug} />;
        };
    }

    return function ImportReviewEntityRoutePage() {
        return <ImportReviewEntityPageShell slug={slug} showMapPreview={options.showMapPreview} />;
    };
}
