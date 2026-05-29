import dynamic from "next/dynamic";

import { ImportTransportLoadingBannerWithSpinner } from "../components/ImportTransportLoadingState";
import { IMPORT_TRANSPORT_LOADING } from "../utils/loadingMessages";
import type { ImportTransportEntitySlug } from "../config/types";

const ImportTransportEntityPageShell = dynamic(
    () =>
        import("../components/ImportTransportEntityPage").then((mod) => ({
            default: mod.ImportTransportEntityPageShell,
        })),
    {
        loading: () => (
            <main className="min-h-screen bg-gray-50 p-6">
                <ImportTransportLoadingBannerWithSpinner
                    message={IMPORT_TRANSPORT_LOADING.loadingBatchContext}
                />
            </main>
        ),
    }
);

export type ImportTransportEntityRoutePageOptions = {
    showMapPreview?: boolean;
};

/** Thin Next.js route default export for config-driven import-transport entity pages. */
export function createImportTransportEntityRoutePage(
    slug: ImportTransportEntitySlug,
    options: ImportTransportEntityRoutePageOptions = {}
) {
    return function ImportTransportEntityRoutePage() {
        return (
            <ImportTransportEntityPageShell slug={slug} showMapPreview={options.showMapPreview} />
        );
    };
}
