import { logImportReviewRouterCall } from "../utils/importReviewRequestDebug";

type ImportReviewRouterReplace = {
    replace: (href: string, options?: { scroll?: boolean }) => void;
};

export type ReplaceImportReviewSearchParamsMeta = {
    /** Caller label for dev request diagnostics (e.g. entity_page:apply_filters). */
    source: string;
};

/** Updates the URL only when query params actually change (avoids RSC refetch loops). */
export function replaceImportReviewSearchParams(
    router: ImportReviewRouterReplace,
    pathname: string,
    currentSearchParams: Pick<URLSearchParams, "toString">,
    mutate: (params: URLSearchParams) => void,
    meta?: ReplaceImportReviewSearchParamsMeta
): void {
    const params = new URLSearchParams(currentSearchParams.toString());
    mutate(params);
    const qs = params.toString();
    const next = qs ? `${pathname}?${qs}` : pathname;
    const currentQs = currentSearchParams.toString();
    const current = currentQs ? `${pathname}?${currentQs}` : pathname;
    if (next === current) {
        logImportReviewRouterCall({
            method: "replace",
            source: meta?.source ?? "replaceImportReviewSearchParams",
            pathname,
            from_query: currentQs,
            to_href: next,
            skipped: true,
            skip_reason: "query_unchanged",
        });
        return;
    }
    logImportReviewRouterCall({
        method: "replace",
        source: meta?.source ?? "replaceImportReviewSearchParams",
        pathname,
        from_query: currentQs,
        to_href: next,
    });
    router.replace(next, { scroll: false });
}
