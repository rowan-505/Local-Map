/** User-facing message for import-transport API failures. Backend may not exist yet. */
export function formatImportTransportApiError(err: unknown, fallback = "Request failed."): string {
    if (!(err instanceof Error)) {
        return fallback;
    }

    if (err.name === "AbortError") {
        return "";
    }

    const message = err.message.trim();
    const lower = message.toLowerCase();

    if (
        lower.includes("failed to fetch") ||
        lower.includes("networkerror") ||
        lower.includes("load failed") ||
        err.name === "TypeError"
    ) {
        return "Import transport API is not available yet — check that /api/import-transport is running.";
    }

    if (lower.includes("404") || lower.includes("not found")) {
        return "Import transport API route not found — backend module may not be implemented yet.";
    }

    if (lower.includes("401") || lower.includes("authentication") || lower.includes("session expired")) {
        return "Unauthorized — sign in with an admin-capable account.";
    }

    if (lower.includes("403") || lower.includes("forbidden")) {
        return "Forbidden — import transport endpoints require admin.";
    }

    return message || fallback;
}
