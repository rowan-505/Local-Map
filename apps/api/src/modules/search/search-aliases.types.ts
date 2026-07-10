/** Supported values for search.search_aliases.alias_type (migration 131). */
export const SEARCH_ALIAS_TYPES = [
    "common_name",
    "abbreviation",
    "alternative_spelling",
    "old_name",
    "transliteration",
    "local_name",
    "search_correction",
] as const;

export type SearchAliasType = (typeof SEARCH_ALIAS_TYPES)[number];

export type SearchAliasRefreshResult = {
    entity_type: string | null;
    entity_ids: string[] | null;
    names_removed: number;
    names_added: number;
    documents_updated: number;
};
