import type { ResolvedPublicSearchFilters } from "./public-search-filters.js";

/** Minimum completed-query length aligned with public search (planPublicSearch). */
export const FAILED_SEARCH_MIN_QUERY_LENGTH = 2;

export type FailedSearchLogBuildInput = {
    q: string;
    lang?: string | null;
    lat?: number | null;
    lng?: number | null;
    filters: ResolvedPublicSearchFilters;
    legacyTypes?: readonly string[];
    resultCount: number;
};

export type FailedSearchLogPayload = {
    q: string;
    normalizedQuery: string;
    lang: string | null;
    category: string;
    transportType: string;
    transportMode: string;
    entityTypesKey: string;
    areaContextKey: string;
    dedupeKey: string;
    types: string[] | null;
    resultCount: number;
};

/** Normalize query text for dedupe and analytics (not for ranking). */
export function normalizeFailedSearchQuery(q: string): string {
    return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Round lat/lng to one decimal (~11 km) for coarse, non-precise map context. */
export function buildFailedSearchAreaContextKey(
    lat?: number | null,
    lng?: number | null,
): string {
    if (
        lat === undefined ||
        lng === undefined ||
        lat === null ||
        lng === null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return "";
    }

    const round = (value: number) => Math.round(value * 10) / 10;
    return `${round(lat)},${round(lng)}`;
}

/** Stable entity-type filter signature for aggregation. */
export function buildFailedSearchEntityTypesKey(
    filters: ResolvedPublicSearchFilters,
    legacyTypes?: readonly string[],
): string {
    const legacy = (legacyTypes ?? []).filter((value) => value.length > 0);
    if (legacy.length > 0) {
        return [...new Set(legacy.map((value) => value.toLowerCase()))].sort().join(",");
    }

    if (filters.category === "all") {
        return "all";
    }

    if (filters.entityTypes.length === 0) {
        return "all";
    }

    return [...new Set(filters.entityTypes.map((value) => value.toLowerCase()))].sort().join(",");
}

export function buildFailedSearchDedupeKey(input: {
    normalizedQuery: string;
    lang?: string | null;
    category: string;
    transportType: string;
    transportMode: string;
    entityTypesKey: string;
    areaContextKey: string;
}): string {
    return [
        input.normalizedQuery,
        input.lang ?? "",
        input.category,
        input.transportType,
        input.transportMode,
        input.entityTypesKey,
        input.areaContextKey,
    ].join("|");
}

export function buildFailedSearchLogPayload(input: FailedSearchLogBuildInput): FailedSearchLogPayload {
    const normalizedQuery = normalizeFailedSearchQuery(input.q);
    const entityTypesKey = buildFailedSearchEntityTypesKey(input.filters, input.legacyTypes);
    const areaContextKey = buildFailedSearchAreaContextKey(input.lat, input.lng);
    const category = input.filters.category;
    const transportType = input.filters.transportType;
    const transportMode = input.filters.transportMode;

    const legacyTypes = (input.legacyTypes ?? []).filter((value) => value.length > 0);
    const types =
        legacyTypes.length > 0
            ? [...legacyTypes]
            : entityTypesKey === "all"
              ? null
              : entityTypesKey.split(",");

    return {
        q: input.q.trim(),
        normalizedQuery,
        lang: input.lang ?? null,
        category,
        transportType,
        transportMode,
        entityTypesKey,
        areaContextKey,
        dedupeKey: buildFailedSearchDedupeKey({
            normalizedQuery,
            lang: input.lang ?? null,
            category,
            transportType,
            transportMode,
            entityTypesKey,
            areaContextKey,
        }),
        types,
        resultCount: input.resultCount,
    };
}

/** Only log completed meaningful searches — not keystrokes or pagination continuations. */
export function shouldRecordFailedSearch(input: {
    normalizedQuery: string;
    resultCount: number;
    isPaginationContinuation: boolean;
    searchAllowed: boolean;
}): boolean {
    if (!input.searchAllowed) {
        return false;
    }
    if (input.isPaginationContinuation) {
        return false;
    }
    if (input.resultCount !== 0) {
        return false;
    }
    if (input.normalizedQuery.length < FAILED_SEARCH_MIN_QUERY_LENGTH) {
        return false;
    }
    return true;
}
