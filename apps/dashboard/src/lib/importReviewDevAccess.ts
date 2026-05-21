/** DEV ONLY — temporary import-review access without app_auth JWT (see AGENTS / import-review admin token). */

import { IMPORT_REVIEW_PATH } from "@/src/lib/dashboardPaths";

const ADMIN_HEADER = "x-import-review-admin-token";

export function isImportReviewDevTokenConfigured(): boolean {
    if (process.env.NODE_ENV === "production") {
        return false;
    }
    return Boolean(process.env.NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN?.trim());
}

export function isImportReviewRoutePath(pathname: string): boolean {
    return (
        pathname === IMPORT_REVIEW_PATH ||
        pathname.startsWith(`${IMPORT_REVIEW_PATH}/`) ||
        pathname === "/import-review" ||
        pathname.startsWith("/import-review/")
    );
}

/**
 * Route-level dev bypass: allow `/import-review/*` UI without JWT when admin token env is set.
 */
export function isImportReviewDevRouteBypassActive(pathname?: string): boolean {
    if (!isImportReviewDevTokenConfigured()) {
        return false;
    }
    const path =
        pathname ??
        (typeof window !== "undefined" ? window.location.pathname : "");
    return isImportReviewRoutePath(path);
}

export function isImportReviewApiPath(path: string): boolean {
    return path.startsWith("/api/import-review/");
}

/**
 * Attaches `x-import-review-admin-token` for `/api/import-review/*` in development when configured.
 * Never logs the token value.
 */
export function attachImportReviewDevAdminTokenHeader(headers: Headers, path: string): boolean {
    if (!isImportReviewApiPath(path)) {
        return false;
    }
    if (!isImportReviewDevTokenConfigured()) {
        return false;
    }
    const token = process.env.NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN!.trim();
    headers.set(ADMIN_HEADER, token);
    return true;
}

const IMPORT_REVIEW_API_AUTH_FAILED_KEY = "import-review-api-auth-failed";

export function markImportReviewApiAuthFailed(): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        sessionStorage.setItem(IMPORT_REVIEW_API_AUTH_FAILED_KEY, "1");
    } catch {
        /* ignore quota / private mode */
    }
}

export function consumeImportReviewApiAuthFailed(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    try {
        const v = sessionStorage.getItem(IMPORT_REVIEW_API_AUTH_FAILED_KEY);
        if (v) {
            sessionStorage.removeItem(IMPORT_REVIEW_API_AUTH_FAILED_KEY);
            return true;
        }
    } catch {
        /* ignore */
    }
    return false;
}

export type ImportReviewAuthDebugState = {
    pathname: string;
    authLoading: boolean;
    hasAccessToken: boolean;
    importReviewDevBypassActive: boolean;
    importReviewAdminHeaderConfigured: boolean;
    importReviewApiAuthFailedFlag: boolean;
};

export function readImportReviewAuthDebugState(
    pathname: string,
    authLoading: boolean
): ImportReviewAuthDebugState {
    const hasAccessToken =
        typeof window !== "undefined" && Boolean(window.localStorage.getItem("accessToken")?.trim());

    let importReviewApiAuthFailedFlag = false;
    if (typeof window !== "undefined") {
        try {
            importReviewApiAuthFailedFlag = Boolean(
                sessionStorage.getItem(IMPORT_REVIEW_API_AUTH_FAILED_KEY)
            );
        } catch {
            importReviewApiAuthFailedFlag = false;
        }
    }

    return {
        pathname,
        authLoading,
        hasAccessToken,
        importReviewDevBypassActive: isImportReviewDevRouteBypassActive(pathname),
        importReviewAdminHeaderConfigured: isImportReviewDevTokenConfigured(),
        importReviewApiAuthFailedFlag,
    };
}

export function logImportReviewAuthDecision(
    context: string,
    decision: string,
    state: ImportReviewAuthDebugState
): void {
    if (process.env.NODE_ENV === "production") {
        return;
    }
    console.debug("[import-review auth]", {
        context,
        decision,
        pathname: state.pathname,
        authLoading: state.authLoading,
        hasAccessToken: state.hasAccessToken,
        importReviewDevBypassActive: state.importReviewDevBypassActive,
        importReviewAdminHeaderConfigured: state.importReviewAdminHeaderConfigured,
        importReviewApiAuthFailedFlag: state.importReviewApiAuthFailedFlag,
    });
}
