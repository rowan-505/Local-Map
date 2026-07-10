import { randomUUID } from "node:crypto";

import type { ResolvedPublicSearchFilters } from "./public-search-filters.js";
import { normalizeFailedSearchQuery } from "./failed-search-log.js";

/** Minimum completed-query length aligned with public search. */
export const SEARCH_ANALYTICS_MIN_QUERY_LENGTH = 2;

export type SearchRequestAnalyticsInput = {
    q: string;
    lang?: string | null;
    filters: ResolvedPublicSearchFilters;
    resultCount: number;
    latencyMs: number;
    sessionKey?: string | null;
    isPaginationContinuation: boolean;
    searchAllowed: boolean;
};

export type SearchRequestAnalyticsPayload = {
    correlationId: string;
    normalizedQuery: string;
    lang: string | null;
    category: string;
    transportType: string;
    transportMode: string;
    resultCount: number;
    latencyMs: number;
    sessionKey: string | null;
};

export type SearchResultClickAnalyticsInput = {
    searchCorrelationId: string;
    entityType: string;
    entityId: string;
    clickedRank: number;
    timeToClickMs?: number | null;
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeSearchAnalyticsSessionKey(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length === 0 || trimmed.length > 128) {
        return null;
    }
    return trimmed;
}

export function isSearchAnalyticsCorrelationId(value: string): boolean {
    return UUID_RE.test(value.trim());
}

export function buildSearchRequestAnalyticsPayload(
    input: SearchRequestAnalyticsInput,
    correlationId: string = randomUUID(),
): SearchRequestAnalyticsPayload {
    return {
        correlationId,
        normalizedQuery: normalizeFailedSearchQuery(input.q),
        lang: input.lang ?? null,
        category: input.filters.category,
        transportType: input.filters.transportType,
        transportMode: input.filters.transportMode,
        resultCount: Math.max(0, input.resultCount),
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        sessionKey: normalizeSearchAnalyticsSessionKey(input.sessionKey),
    };
}

/** Only record completed meaningful first-page text searches. */
export function shouldRecordSearchRequestAnalytics(input: {
    normalizedQuery: string;
    isPaginationContinuation: boolean;
    searchAllowed: boolean;
}): boolean {
    if (!input.searchAllowed) {
        return false;
    }
    if (input.isPaginationContinuation) {
        return false;
    }
    if (input.normalizedQuery.length < SEARCH_ANALYTICS_MIN_QUERY_LENGTH) {
        return false;
    }
    return true;
}

export function clampSearchResultClickRank(value: number): number {
    if (!Number.isFinite(value)) {
        return 1;
    }
    return Math.max(1, Math.min(100, Math.floor(value)));
}

export function clampTimeToClickMs(value: number | null | undefined): number | null {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return null;
    }
    const rounded = Math.round(value);
    if (rounded < 0) {
        return null;
    }
    // Cap at 30 minutes to drop outliers / clock skew.
    return Math.min(rounded, 30 * 60 * 1000);
}
