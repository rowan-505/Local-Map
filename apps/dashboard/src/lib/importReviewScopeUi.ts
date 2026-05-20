import { formatImportReviewApiError } from "@/src/features/import-review/api";

/** @deprecated Use formatImportReviewApiError from @/src/features/import-review/api */
export function formatImportReviewScopeFetchError(err: unknown, fallback = "Failed to load data."): string {
    return formatImportReviewApiError(err, fallback);
}
