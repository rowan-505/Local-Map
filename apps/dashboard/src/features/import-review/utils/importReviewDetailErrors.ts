import { formatImportReviewApiError } from "../api/importReviewApiErrors";

const INTERNAL_ERROR_PATTERN =
    /prisma|queryraw|\$queryraw|syntax error|42601|raw query failed|invocation/i;

export function isImportReviewInternalErrorMessage(message: string): boolean {
    return INTERNAL_ERROR_PATTERN.test(message);
}

/** Admin-facing message; hides Prisma/SQL internals outside development. */
export function formatImportReviewUserError(err: unknown, fallback: string): string {
    const raw =
        formatImportReviewApiError(err, fallback).trim() || fallback;

    if (process.env.NODE_ENV === "development") {
        return raw;
    }

    if (isImportReviewInternalErrorMessage(raw)) {
        return fallback;
    }

    return raw;
}

/** Technical detail for development-only UI. */
export function formatImportReviewTechnicalError(err: unknown): string {
    if (err instanceof Error) {
        return err.message.trim();
    }
    if (typeof err === "string") {
        return err.trim();
    }
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

export const isImportReviewDevMode = process.env.NODE_ENV === "development";
