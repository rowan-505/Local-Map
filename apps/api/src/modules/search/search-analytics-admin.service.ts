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

function roundRate(numerator: number, denominator: number): number {
    if (denominator <= 0) {
        return 0;
    }
    return Math.round((numerator / denominator) * 1000) / 10;
}

function serializeSummary(row: SearchAnalyticsSummaryRow) {
    const total = row.total_searches;
    const withClick = row.searches_with_click;
    const ctr = roundRate(withClick, total);
    return {
        total_searches: total,
        zero_result_count: row.zero_result_count,
        zero_result_rate: roundRate(row.zero_result_count, total),
        searches_with_click: withClick,
        click_through_rate: ctr,
        no_click_rate: roundRate(total - withClick, total),
        latency_p50_ms: row.latency_p50_ms,
        latency_p95_ms: row.latency_p95_ms,
    };
}

function serializeTimeseries(rows: SearchAnalyticsTimeseriesRow[]) {
    return rows.map((row) => ({
        bucket: row.bucket.toISOString(),
        searches: row.searches,
        zero_result_rate: roundRate(row.zero_result_count, row.searches),
        latency_p50_ms: row.latency_p50_ms,
        latency_p95_ms: row.latency_p95_ms,
        click_count: row.click_count,
    }));
}

function serializeQueryCounts(rows: SearchAnalyticsQueryCountRow[]) {
    return rows.map((row) => ({
        normalized_query: row.normalized_query,
        search_count: row.search_count,
        zero_result_count: row.zero_result_count,
        zero_result_rate: roundRate(row.zero_result_count, row.search_count),
        click_count: row.click_count,
    }));
}

function serializeTrending(rows: SearchAnalyticsTrendingRow[]) {
    return rows.map((row) => ({
        normalized_query: row.normalized_query,
        current_count: row.current_count,
        previous_count: row.previous_count,
        growth: row.growth,
    }));
}

function serializeEntityClicks(rows: SearchAnalyticsEntityClickRow[]) {
    return rows.map((row) => ({
        entity_type: row.entity_type,
        entity_id: row.entity_id.toString(),
        display_name: row.display_name,
        click_count: row.click_count,
    }));
}

function serializeBreakdown(rows: SearchAnalyticsBreakdownRow[]) {
    return rows.map((row) => ({ key: row.key, count: row.count }));
}

export type SearchAnalyticsDashboardResponse = ReturnType<SearchAnalyticsAdminService["getDashboard"]>;

export class SearchAnalyticsAdminService {
    constructor(private readonly repo: SearchAnalyticsAdminRepository) {}

    async getDashboard(query: SearchAnalyticsQuery) {
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
    ) {
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
            top_clicked_entities: serializeEntityClicks(data.topClickedEntities),
            by_language: serializeBreakdown(data.byLanguage),
            by_category: serializeBreakdown(data.byCategory),
        };
    }
}
