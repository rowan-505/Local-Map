type ImportTransportRouterReplace = {
    replace: (href: string, options?: { scroll?: boolean }) => void;
};

/** Updates the URL only when query params actually change (avoids RSC refetch loops). */
export function replaceImportTransportSearchParams(
    router: ImportTransportRouterReplace,
    pathname: string,
    currentSearchParams: Pick<URLSearchParams, "toString">,
    mutate: (params: URLSearchParams) => void
): void {
    const params = new URLSearchParams(currentSearchParams.toString());
    mutate(params);
    const qs = params.toString();
    const next = qs ? `${pathname}?${qs}` : pathname;
    const currentQs = currentSearchParams.toString();
    const current = currentQs ? `${pathname}?${currentQs}` : pathname;
    if (next === current) {
        return;
    }
    router.replace(next, { scroll: false });
}
