import { ImportReviewEntityPageShell } from "../components/ImportReviewEntityPage";
import type { ImportReviewEntitySlug } from "../config/types";

export type ImportReviewEntityRoutePageOptions = {
    showMapPreview?: boolean;
};

/** Thin Next.js route default export for config-driven import-review entity pages. */
export function createImportReviewEntityRoutePage(
    slug: ImportReviewEntitySlug,
    options: ImportReviewEntityRoutePageOptions = {}
) {
    return function ImportReviewEntityRoutePage() {
        return <ImportReviewEntityPageShell slug={slug} showMapPreview={options.showMapPreview} />;
    };
}
