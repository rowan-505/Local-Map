export type SearchListPageState = "loading" | "error" | "idle" | "empty" | "ready";

export function getSearchListPageState<T>({
    loading,
    error,
    data,
    items,
}: {
    loading: boolean;
    error: string;
    data: T | null;
    items: readonly unknown[];
}): SearchListPageState {
    if (loading) return "loading";
    if (error) return "error";
    if (!data) return "idle";
    if (items.length === 0) return "empty";
    return "ready";
}
