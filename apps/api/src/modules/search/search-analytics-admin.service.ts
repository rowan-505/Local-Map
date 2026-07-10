import {
    SearchAnalyticsAdminRepository,
    type SearchAnalyticsBreakdownRow,
    type SearchAnalyticsEntityClickRow,
    type SearchAnalyticsQueryCountRow,
    type SearchAnalyticsSummaryRow,
    type SearchAnalyticsTimeseriesRow,
    type SearchAnalyticsTrendingRow,
} from "./search-analytics-admin.repo.js";
import type {
    ResolvedSearchAnalyticsRange,
    SearchAnalyticsQuery,
} from "./search-analytics-admin.schema.js";
import { resolveSearchAnalyticsRange } from "./search-analytics-admin.schema.js";
import {
    formatClickedEntityLabel,
    roundAnalyticsRate,
    toAnalyticsEntityIdString,
} from "./search-analytics-admin.serialization.js";

export type SearchAnalyticsSummaryDto = {
    total_searches: number;
    zero_result_count: number;
    zero_result_rate: number;
    searches_with_click: number;
    click_through_rate: number;
    no_click_rate: number;
    latency_p50_ms: number | null;
    latency_p95_ms: number | null;
};

export type SearchAnalyticsTimeseriesPointDto = {
    bucket: string;
    searches: number;
    zero_result_rate: number;
    latency_p50_ms: number | null;
    latency_p95_ms: number | null;
    click_count: number;
};

export type SearchAnalyticsQueryCountDto = {
    normalized_query: string;
    search_count: number;
    zero_result_count: number;
    zero_result_rate: number;
    click_count: number;
};

export type SearchAnalyticsTrendingQueryDto = {
    normalized_query: string;
    current_count: number;
    previous_count: number;
    growth: number;
};

export type SearchAnalyticsClickedEntityDto = {
    entity_type: string;
    entity_id: string;
    display_name: string | null;
    click_count: number;
    label: string;
};

export type SearchAnalyticsBreakdownDto = {
    key: string;
    count: number;
};

export type SearchAnalyticsDashboardDto = {
    range: {
        period: ResolvedSearchAnalyticsRange["period"];
        from: string;
        to: string;
        previous_from: string;
        previous_to: string;
        timeseries_bucket: ResolvedSearchAnalyticsRange["timeseriesBucket"];
    };
    summary: SearchAnalyticsSummaryDto;
    timeseries: SearchAnalyticsTimeseriesPointDto[];
    top_searches: SearchAnalyticsQueryCountDto[];
    top_failed_searches: SearchAnalyticsQueryCountDto[];
    trending_queries: SearchAnalyticsTrendingQueryDto[];
    top_clicked_entities: SearchAnalyticsClickedEntityDto[];
    by_language: SearchAnalyticsBreakdownDto[];
    by_category: SearchAnalyticsBreakdownDto[];
};

function serializeSummary(row: SearchAnalyticsSummaryRow): SearchAnalyticsSummaryDto {
    const total = row.total_searches;
    const withClick = row.searches_with_click;
    return {
        total_searches: total,
        zero_result_count: row.zero_result_count,
        zero_result_rate: roundAnalyticsRate(row.zero_result_count, total),
        searches_with_click: withClick,
        click_through_rate: roundAnalyticsRate(withClick, total),
        no_click_rate: roundAnalyticsRate(total - withClick, total),
        latency_p50_ms: row.latency_p50_ms,
        latency_p95_ms: row.latency_p95_ms,
    };
}

function serializeTimeseries(rows: SearchAnalyticsTimeseriesRow[]): SearchAnalyticsTimeseriesPointDto[] {
    return rows.map((row) => ({
        bucket: row.bucket.toISOString(),
        searches: row.searches,
        zero_result_rate: roundAnalyticsRate(row.zero_result_count, row.searches),
        latency_p50_ms: row.latency_p50_ms,
        latency_p95_ms: row.latency_p95_ms,
        click_count: row.click_count,
    }));
}

function serializeQueryCounts(rows: SearchAnalyticsQueryCountRow[]): SearchAnalyticsQueryCountDto[] {
    return rows.map((row) => ({
        normalized_query: row.normalized_query,
        search_count: row.search_count,
        zero_result_count: row.zero_result_count,
        zero_result_rate: roundAnalyticsRate(row.zero_result_count, row.search_count),
        click_count: row.click_count,
    }));
}

function serializeTrending(rows: SearchAnalyticsTrendingRow[]): SearchAnalyticsTrendingQueryDto[] {
    return rows.map((row) => ({
        normalized_query: row.normalized_query,
        current_count: row.current_count,
        previous_count: row.previous_count,
        growth: row.growth,
    }));
}

export function serializeClickedEntities(
    rows: SearchAnalyticsEntityClickRow[],
): SearchAnalyticsClickedEntityDto[] {
    return rows
        .map((row) => {
            const entityId = toAnalyticsEntityIdString(row.entity_id);
            if (!entityId) {
                return null;
            }
            const displayName = row.display_name?.trim() ? row.display_name.trim() : null;
            return {
                entity_type: row.entity_type,
                entity_id: entityId,
                display_name: displayName,
                click_count: row.click_count,
                label: formatClickedEntityLabel(row.entity_type, entityId, displayName),
            };
        })
        .filter((row): row is SearchAnalyticsClickedEntityDto => row !== null);
}

function serializeBreakdown(rows: SearchAnalyticsBreakdownRow[]): SearchAnalyticsBreakdownDto[] {
    return rows.map((row) => ({ key: row.key, count: row.count }));
}

export type SearchAnalyticsDashboardResponse = SearchAnalyticsDashboardDto;

export class SearchAnalyticsAdminService {
    constructor(private readonly repo: SearchAnalyticsAdminRepository) {}

    async getDashboard(query: SearchAnalyticsQuery): Promise<SearchAnalyticsDashboardDto> {
        const range = resolveSearchAnalyticsRange(query);
        const [
            summary,
            timeseries,
            topSearches,
            topFailedSearches,
            trendingQueries,
            topClickedEntities,
            byLanguage,
            byCategory,
        ] = await Promise.all([
            this.repo.getSummary(range),
            this.repo.getTimeseries(range),
            this.repo.getTopSearches(range),
            this.repo.getTopFailedSearches(range),
            this.repo.getTrendingQueries(range),
            this.repo.getTopClickedEntities(range),
            this.repo.getSearchesByLanguage(range),
            this.repo.getSearchesByCategory(range),
        ]);

        return this.buildResponse(range, {
            summary,
            timeseries,
            topSearches,
            topFailedSearches,
            trendingQueries,
            topClickedEntities,
            byLanguage,
            byCategory,
        });
    }

    private buildResponse(
        range: ResolvedSearchAnalyticsRange,
        data: {
            summary: SearchAnalyticsSummaryRow;
            timeseries: SearchAnalyticsTimeseriesRow[];
            topSearches: SearchAnalyticsQueryCountRow[];
            topFailedSearches: SearchAnalyticsQueryCountRow[];
            trendingQueries: SearchAnalyticsTrendingRow[];
            topClickedEntities: SearchAnalyticsEntityClickRow[];
            byLanguage: SearchAnalyticsBreakdownRow[];
            byCategory: SearchAnalyticsBreakdownRow[];
        },
    ): SearchAnalyticsDashboardDto {
        return {
            range: {
                period: range.period,
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                previous_from: range.previousFrom.toISOString(),
                previous_to: range.previousTo.toISOString(),
                timeseries_bucket: range.timeseriesBucket,
            },
            summary: serializeSummary(data.summary),
            timeseries: serializeTimeseries(data.timeseries),
            top_searches: serializeQueryCounts(data.topSearches),
            top_failed_searches: serializeQueryCounts(data.topFailedSearches),
            trending_queries: serializeTrending(data.trendingQueries),
            top_clicked_entities: serializeClickedEntities(data.topClickedEntities),
            by_language: serializeBreakdown(data.byLanguage),
            by_category: serializeBreakdown(data.byCategory),
        };
    }
}
