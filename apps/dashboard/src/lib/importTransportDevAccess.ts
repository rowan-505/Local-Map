/** DEV ONLY — temporary import-transport access without app_auth JWT (same admin token as import-review). */

import { IMPORT_TRANSPORT_PATH } from "@/src/lib/dashboardPaths";

import {
    isImportReviewDevTokenConfigured,
    type ImportReviewAuthDebugState,
} from "./importReviewDevAccess";

const ADMIN_HEADER = "x-import-review-admin-token";

export function isImportTransportRoutePath(pathname: string): boolean {
    return (
        pathname === IMPORT_TRANSPORT_PATH ||
        pathname.startsWith(`${IMPORT_TRANSPORT_PATH}/`)
    );
}

/**
 * Route-level dev bypass: allow `/dashboard/import-transport/*` UI without JWT when admin token env is set.
 */
export function isImportTransportDevRouteBypassActive(pathname?: string): boolean {
    if (!isImportReviewDevTokenConfigured()) {
        return false;
    }
    const path =
        pathname ??
        (typeof window !== "undefined" ? window.location.pathname : "");
    return isImportTransportRoutePath(path);
}

export function isImportTransportApiPath(path: string): boolean {
    return path.startsWith("/api/import-transport/");
}

/**
 * Attaches `x-import-review-admin-token` for `/api/import-transport/*` in development when configured.
 * Never logs the token value.
 */
export function attachImportTransportDevAdminTokenHeader(headers: Headers, path: string): boolean {
    if (!isImportTransportApiPath(path)) {
        return false;
    }
    if (!isImportReviewDevTokenConfigured()) {
        return false;
    }
    const token = process.env.NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN!.trim();
    headers.set(ADMIN_HEADER, token);
    return true;
}

const IMPORT_TRANSPORT_API_AUTH_FAILED_KEY = "import-transport-api-auth-failed";

export function markImportTransportApiAuthFailed(): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        sessionStorage.setItem(IMPORT_TRANSPORT_API_AUTH_FAILED_KEY, "1");
    } catch {
        /* ignore quota / private mode */
    }
}

export function consumeImportTransportApiAuthFailed(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    try {
        const v = sessionStorage.getItem(IMPORT_TRANSPORT_API_AUTH_FAILED_KEY);
        if (v) {
            sessionStorage.removeItem(IMPORT_TRANSPORT_API_AUTH_FAILED_KEY);
            return true;
        }
    } catch {
        /* ignore */
    }
    return false;
}

export type ImportTransportAuthDebugState = ImportReviewAuthDebugState & {
    importTransportDevBypassActive: boolean;
};

export function readImportTransportAuthDebugState(
    pathname: string,
    authLoading: boolean
): ImportTransportAuthDebugState {
    const hasAccessToken =
        typeof window !== "undefined" && Boolean(window.localStorage.getItem("accessToken")?.trim());

    let importTransportApiAuthFailedFlag = false;
    if (typeof window !== "undefined") {
        try {
            importTransportApiAuthFailedFlag = Boolean(
                sessionStorage.getItem(IMPORT_TRANSPORT_API_AUTH_FAILED_KEY)
            );
        } catch {
            importTransportApiAuthFailedFlag = false;
        }
    }

    return {
        pathname,
        authLoading,
        hasAccessToken,
        importReviewDevBypassActive: isImportTransportDevRouteBypassActive(pathname),
        importReviewAdminHeaderConfigured: isImportReviewDevTokenConfigured(),
        importReviewApiAuthFailedFlag: importTransportApiAuthFailedFlag,
        importTransportDevBypassActive: isImportTransportDevRouteBypassActive(pathname),
    };
}

export function logImportTransportAuthDecision(
    context: string,
    decision: string,
    state: ImportTransportAuthDebugState
): void {
    if (process.env.NODE_ENV === "production") {
        return;
    }
    console.debug("[import-transport auth]", {
        context,
        decision,
        pathname: state.pathname,
        authLoading: state.authLoading,
        hasAccessToken: state.hasAccessToken,
        importTransportDevBypassActive: state.importTransportDevBypassActive,
        importReviewAdminHeaderConfigured: state.importReviewAdminHeaderConfigured,
        importTransportApiAuthFailedFlag: state.importReviewApiAuthFailedFlag,
    });
}
