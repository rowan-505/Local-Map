/**
 * Temporary diagnostics for repeated import-review requests / RSC refetches.
 * Enabled when NODE_ENV=development and NEXT_PUBLIC_IMPORT_REVIEW_REQUEST_DEBUG is not "0".
 * Set NEXT_PUBLIC_IMPORT_REVIEW_REQUEST_DEBUG=0 to silence without removing calls.
 */

const LOG_PREFIX = "[import-review:requests]";

export function isImportReviewRequestDebugEnabled(): boolean {
    if (process.env.NODE_ENV !== "development") {
        return false;
    }
    const flag = process.env.NEXT_PUBLIC_IMPORT_REVIEW_REQUEST_DEBUG?.trim();
    return flag !== "0" && flag !== "false";
}

function emit(event: string, payload: Record<string, unknown>): void {
    if (!isImportReviewRequestDebugEnabled()) {
        return;
    }
    console.debug(LOG_PREFIX, event, payload);
}

export type ImportReviewScopeLog = {
    review_batch_id?: string | null;
    source_snapshot_version?: string | null;
};

export function logImportReviewPageRender(input: {
    component: string;
    route_slug: string;
    route_family?: string | null;
    pathname: string;
    route_active: boolean;
    scope: ImportReviewScopeLog;
}): void {
    emit("page_render", {
        component: input.component,
        route_slug: input.route_slug,
        route_family: input.route_family ?? null,
        pathname: input.pathname,
        route_active: input.route_active,
        review_batch_id: input.scope.review_batch_id?.trim() || null,
        source_snapshot_version: input.scope.source_snapshot_version?.trim() || null,
    });
}

export function logImportReviewListFetchStart(input: {
    family: string;
    query_key: readonly unknown[] | unknown[];
    fetch_url: string;
    enabled: boolean;
}): void {
    emit("list_fetch_start", {
        family: input.family,
        query_key: input.query_key,
        fetch_url: input.fetch_url,
        enabled: input.enabled,
    });
}

export function logImportReviewListFetchEnd(input: {
    family: string;
    status: "success" | "error" | "aborted";
    item_count?: number;
    error_message?: string;
}): void {
    emit("list_fetch_end", {
        family: input.family,
        status: input.status,
        item_count: input.item_count,
        error_message: input.error_message,
    });
}

export type ImportReviewRouterMethod = "replace" | "push" | "refresh";

export function logImportReviewRouterCall(input: {
    method: ImportReviewRouterMethod;
    source: string;
    pathname: string;
    from_query: string;
    to_href: string;
    skipped?: boolean;
    skip_reason?: string;
}): void {
    emit("router", {
        method: input.method,
        source: input.source,
        pathname: input.pathname,
        from_query: input.from_query || "(empty)",
        to_href: input.to_href,
        skipped: input.skipped ?? false,
        skip_reason: input.skip_reason ?? null,
    });
}

export function logImportReviewUserAction(input: {
    action: "apply_scope" | "apply_filters" | "clear_filters" | "select_batch" | "pagination";
    source: string;
    route_slug?: string;
    scope?: ImportReviewScopeLog;
}): void {
    emit("user_action", {
        action: input.action,
        source: input.source,
        route_slug: input.route_slug ?? null,
        review_batch_id: input.scope?.review_batch_id?.trim() || null,
        source_snapshot_version: input.scope?.source_snapshot_version?.trim() || null,
    });
}

/** URL/searchParams changed without an explicit user_action log in the same tick. */
export function logImportReviewQueryKeyChange(input: {
    source: string;
    route_slug: string;
    list_query_key: string;
    react_query_key: readonly unknown[];
}): void {
    emit("query_key", {
        source: input.source,
        route_slug: input.route_slug,
        list_query_key: input.list_query_key,
        react_query_key: input.react_query_key,
    });
}

export function logImportReviewUrlSync(input: {
    source: string;
    reason: string;
    pathname: string;
    previous_query: string;
    next_query: string;
    changed_keys: string[];
}): void {
    emit("url_sync", {
        source: input.source,
        reason: input.reason,
        pathname: input.pathname,
        previous_query: input.previous_query || "(empty)",
        next_query: input.next_query || "(empty)",
        changed_keys: input.changed_keys,
    });
}

export function diffImportReviewSearchKeys(prev: string, next: string): string[] {
    const prevParams = new URLSearchParams(prev);
    const nextParams = new URLSearchParams(next);
    const keys = new Set<string>([...prevParams.keys(), ...nextParams.keys()]);
    const changed: string[] = [];
    for (const key of keys) {
        if (prevParams.get(key) !== nextParams.get(key)) {
            changed.push(key);
        }
    }
    return changed.sort();
}

/** Preview list API URL (no auth headers logged). */
export function buildImportReviewListFetchUrlPreview(
    apiFamily: string,
    query: Record<string, string | number | boolean | undefined>
): string {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://127.0.0.1:3031";
    const path = `/api/import-review/${encodeURIComponent(apiFamily)}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === "") {
            continue;
        }
        params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${apiBase}${path}?${qs}` : `${apiBase}${path}`;
}

export function logImportReviewEligibilityFetch(input: {
    phase: "start" | "success" | "error";
    review_batch_id: string;
    families: string;
    include_warnings?: boolean;
    row_count?: number;
    message?: string;
}): void {
    emit("promotion_eligibility_fetch", {
        phase: input.phase,
        review_batch_id: input.review_batch_id,
        families: input.families,
        include_warnings: input.include_warnings ?? false,
        row_count: input.row_count,
        message: input.message,
    });
}
