import type { SearchDocumentList } from "./types";

export type SearchDocumentsTableState = "loading" | "error" | "idle" | "empty" | "ready";

export function getSearchDocumentsTableState({
    loading,
    error,
    data,
}: {
    loading: boolean;
    error: string;
    data: SearchDocumentList | null;
}): SearchDocumentsTableState {
    if (loading) return "loading";
    if (error) return "error";
    if (!data) return "idle";
    if (data.items.length === 0) return "empty";
    return "ready";
}
