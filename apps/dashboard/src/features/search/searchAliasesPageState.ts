export const SEARCH_ALIASES_TRUE_EMPTY_LABEL = "No search aliases have been created yet.";
export const SEARCH_ALIASES_FILTERED_EMPTY_LABEL = "No aliases match the current filters.";

export type SearchAliasListFiltersInput = {
    q: string;
    entity_type: string;
    language_code: string;
    alias_type: string;
    is_active: "" | "true" | "false";
};

export type SearchAliasesTableState =
    | "loading"
    | "error"
    | "idle"
    | "true-empty"
    | "filtered-empty"
    | "ready";

export function hasSearchAliasListFilters(
    filters: SearchAliasListFiltersInput,
    entityIdFilter: string,
): boolean {
    return Boolean(
        filters.q.trim() ||
            filters.entity_type ||
            filters.language_code ||
            filters.alias_type ||
            filters.is_active !== "" ||
            entityIdFilter.trim(),
    );
}

export function getSearchAliasesTableState({
    loading,
    error,
    data,
    hasFilters,
}: {
    loading: boolean;
    error: string;
    data: { items: readonly unknown[]; total: number } | null;
    hasFilters: boolean;
}): SearchAliasesTableState {
    if (loading) return "loading";
    if (error) return "error";
    if (!data) return "idle";
    if (data.items.length > 0) return "ready";
    return hasFilters ? "filtered-empty" : "true-empty";
}

export function readSearchAliasUrlFilters(searchParams: {
    get(name: string): string | null;
}): { entity_type: string; entity_id: string } {
    return {
        entity_type: searchParams.get("entity_type") ?? "",
        entity_id: searchParams.get("entity_id")?.replace(/\D/g, "") ?? "",
    };
}
