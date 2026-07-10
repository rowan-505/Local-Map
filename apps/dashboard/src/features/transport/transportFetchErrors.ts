import { isAbortError } from "@/src/lib/api";

/** Calm, user-facing copy when review-readiness cannot be loaded. */
export const REVIEW_READINESS_UNAVAILABLE_MESSAGE =
    "Review readiness unavailable. Other route data is still available.";

/** Browser network failure (API down, wrong port, CORS block surfaced as TypeError, etc.). */
export function isTransportNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.trim().toLowerCase();
    if (error.name === "AbortError") {
        return false;
    }

    return (
        message === "failed to fetch" ||
        message.includes("networkerror") ||
        message.includes("load failed") ||
        message.includes("connection refused") ||
        message.includes("err_connection_refused")
    );
}

/** Technical detail for logs; never shown in main transport UI. */
export function getTransportFetchErrorDetail(error: unknown, fallback: string): string {
    if (isAbortError(error)) {
        return "";
    }

    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    return fallback;
}

/** Log review-readiness fetch failures in development only. */
export function logTransportReadinessFetchError(error: unknown, fallback: string): void {
    if (process.env.NODE_ENV !== "development") {
        return;
    }

    const detail = getTransportFetchErrorDetail(error, fallback);
    if (!detail) {
        return;
    }

    console.warn("[transport] review-readiness:", detail, error);
}

/** @deprecated Prefer REVIEW_READINESS_UNAVAILABLE_MESSAGE in UI. */
export function formatTransportFetchError(error: unknown, _fallback: string): string {
    if (isAbortError(error)) {
        return "";
    }

    if (isTransportNetworkError(error)) {
        return REVIEW_READINESS_UNAVAILABLE_MESSAGE;
    }

    return REVIEW_READINESS_UNAVAILABLE_MESSAGE;
}
