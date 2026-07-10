import { Prisma, type PrismaClient } from "@prisma/client";

import type { ResolvedSearchAnalyticsRange } from "./search-analytics-admin.schema.js";

export type SearchAnalyticsSummaryRow = {
    total_searches: number;
    zero_result_count: number;
    latency_p50_ms: number | null;
    latency_p95_ms: number | null;
    searches_with_click: number;
};

export type SearchAnalyticsTimeseriesRow = {
    bucket: Date;
    searches: number;
    zero_result_count: number;
    latency_p50_ms: number | null;
    latency_p95_ms: number | null;
    click_count: number;
};

export type SearchAnalyticsQueryCountRow = {
    normalized_query: string;
    search_count: number;
    zero_result_count: number;
    click_count: number;
};

export type SearchAnalyticsTrendingRow = {
    normalized_query: string;
    current_count: number;
    previous_count: number;
    growth: number;
};

export type SearchAnalyticsEntityClickRow = {
    entity_type: string;
    entity_id: bigint;
    click_count: number;
    display_name: string | null;
};

export type SearchAnalyticsBreakdownRow = {
    key: string;
    count: number;
};

function rangeWhere(alias: string, range: ResolvedSearchAnalyticsRange): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`${a}.created_at >= ${range.from} AND ${a}.created_at < ${range.to}`;
}

function previousRangeWhere(alias: string, range: ResolvedSearchAnalyticsRange): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`${a}.created_at >= ${range.previousFrom} AND ${a}.created_at < ${range.previousTo}`;
}

export class SearchAnalyticsAdminRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async getSummary(range: ResolvedSearchAnalyticsRange): Promise<SearchAnalyticsSummaryRow> {
        const rows = await this.prisma.$queryRaw<SearchAnalyticsSummaryRow[]>(Prisma.sql`
            WITH requests AS (
                SELECT correlation_id, result_count, latency_ms
                FROM search.search_request_events r
                WHERE ${rangeWhere("r", range)}
            ),
            clicks AS (
                SELECT count(DISTINCT c.search_correlation_id)::int AS searches_with_click
                FROM search.search_result_click_events c
                INNER JOIN requests r ON r.correlation_id = c.search_correlation_id
            )
            SELECT
                count(*)::int AS total_searches,
                count(*) FILTER (WHERE result_count = 0)::int AS zero_result_count,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS latency_p50_ms,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS latency_p95_ms,
                coalesce((SELECT searches_with_click FROM clicks), 0)::int AS searches_with_click
            FROM requests
        `);
        return (
            rows[0] ?? {
                total_searches: 0,
                zero_result_count: 0,
                latency_p50_ms: null,
                latency_p95_ms: null,
                searches_with_click: 0,
            }
        );
    }

    async getTimeseries(range: ResolvedSearchAnalyticsRange): Promise<SearchAnalyticsTimeseriesRow[]> {
        const trunc = range.timeseriesBucket === "hour" ? Prisma.sql`'hour'` : Prisma.sql`'day'`;
        return this.prisma.$queryRaw<SearchAnalyticsTimeseriesRow[]>(Prisma.sql`
            WITH buckets AS (
                SELECT
                    date_trunc(${trunc}, r.created_at AT TIME ZONE 'UTC') AS bucket,
                    r.correlation_id,
                    r.result_count,
                    r.latency_ms
                FROM search.search_request_events r
                WHERE ${rangeWhere("r", range)}
            ),
            request_agg AS (
                SELECT
                    bucket,
                    count(*)::int AS searches,
                    count(*) FILTER (WHERE result_count = 0)::int AS zero_result_count,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS latency_p50_ms,
                    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS latency_p95_ms
                FROM buckets
                GROUP BY bucket
            ),
            click_agg AS (
                SELECT
                    date_trunc(${trunc}, c.created_at AT TIME ZONE 'UTC') AS bucket,
                    count(*)::int AS click_count
                FROM search.search_result_click_events c
                WHERE ${rangeWhere("c", range)}
                GROUP BY bucket
            )
            SELECT
                ra.bucket,
                ra.searches,
                ra.zero_result_count,
                ra.latency_p50_ms,
                ra.latency_p95_ms,
                coalesce(ca.click_count, 0)::int AS click_count
            FROM request_agg ra
            LEFT JOIN click_agg ca ON ca.bucket = ra.bucket
            ORDER BY ra.bucket ASC
        `);
    }

    async getTopSearches(
        range: ResolvedSearchAnalyticsRange,
        limit = 15,
    ): Promise<SearchAnalyticsQueryCountRow[]> {
        return this.prisma.$queryRaw<SearchAnalyticsQueryCountRow[]>(Prisma.sql`
            WITH requests AS (
                SELECT
                    normalized_query,
                    correlation_id,
                    result_count
                FROM search.search_request_events r
                WHERE ${rangeWhere("r", range)}
            ),
            clicks AS (
                SELECT search_correlation_id, count(*)::int AS click_count
                FROM search.search_result_click_events c
                WHERE ${rangeWhere("c", range)}
                GROUP BY search_correlation_id
            )
            SELECT
                r.normalized_query,
                count(*)::int AS search_count,
                count(*) FILTER (WHERE r.result_count = 0)::int AS zero_result_count,
                coalesce(sum(coalesce(c.click_count, 0)), 0)::int AS click_count
            FROM requests r
            LEFT JOIN clicks c ON c.search_correlation_id = r.correlation_id
            GROUP BY r.normalized_query
            ORDER BY search_count DESC, r.normalized_query ASC
            LIMIT ${limit}
        `);
    }

    async getTopFailedSearches(
        range: ResolvedSearchAnalyticsRange,
        limit = 15,
    ): Promise<SearchAnalyticsQueryCountRow[]> {
        return this.prisma.$queryRaw<SearchAnalyticsQueryCountRow[]>(Prisma.sql`
            SELECT
                normalized_query,
                count(*)::int AS search_count,
                count(*)::int AS zero_result_count,
                0::int AS click_count
            FROM search.search_request_events r
            WHERE ${rangeWhere("r", range)}
              AND result_count = 0
            GROUP BY normalized_query
            ORDER BY search_count DESC, normalized_query ASC
            LIMIT ${limit}
        `);
    }

    async getTrendingQueries(
        range: ResolvedSearchAnalyticsRange,
        limit = 15,
    ): Promise<SearchAnalyticsTrendingRow[]> {
        return this.prisma.$queryRaw<SearchAnalyticsTrendingRow[]>(Prisma.sql`
            WITH current_counts AS (
                SELECT normalized_query, count(*)::int AS current_count
                FROM search.search_request_events r
                WHERE ${rangeWhere("r", range)}
                GROUP BY normalized_query
            ),
            previous_counts AS (
                SELECT normalized_query, count(*)::int AS previous_count
                FROM search.search_request_events r
                WHERE ${previousRangeWhere("r", range)}
                GROUP BY normalized_query
            )
            SELECT
                c.normalized_query,
                c.current_count,
                coalesce(p.previous_count, 0)::int AS previous_count,
                (c.current_count - coalesce(p.previous_count, 0))::int AS growth
            FROM current_counts c
            LEFT JOIN previous_counts p ON p.normalized_query = c.normalized_query
            WHERE c.current_count >= 2
            ORDER BY growth DESC, c.current_count DESC, c.normalized_query ASC
            LIMIT ${limit}
        `);
    }

    async getTopClickedEntities(
        range: ResolvedSearchAnalyticsRange,
        limit = 15,
    ): Promise<SearchAnalyticsEntityClickRow[]> {
        return this.prisma.$queryRaw<SearchAnalyticsEntityClickRow[]>(Prisma.sql`
            SELECT
                c.entity_type,
                c.entity_id,
                count(*)::int AS click_count,
                max(d.display_name) AS display_name
            FROM search.search_result_click_events c
            LEFT JOIN search.search_documents d
                ON d.entity_type = c.entity_type
               AND d.entity_id = c.entity_id
            WHERE ${rangeWhere("c", range)}
            GROUP BY c.entity_type, c.entity_id
            ORDER BY click_count DESC, c.entity_type ASC, c.entity_id ASC
            LIMIT ${limit}
        `);
    }

    async getSearchesByLanguage(range: ResolvedSearchAnalyticsRange): Promise<SearchAnalyticsBreakdownRow[]> {
        return this.prisma.$queryRaw<SearchAnalyticsBreakdownRow[]>(Prisma.sql`
            SELECT
                coalesce(nullif(btrim(lang), ''), 'unknown') AS key,
                count(*)::int AS count
            FROM search.search_request_events r
            WHERE ${rangeWhere("r", range)}
            GROUP BY 1
            ORDER BY count DESC, key ASC
        `);
    }

    async getSearchesByCategory(range: ResolvedSearchAnalyticsRange): Promise<SearchAnalyticsBreakdownRow[]> {
        return this.prisma.$queryRaw<SearchAnalyticsBreakdownRow[]>(Prisma.sql`
            SELECT
                category AS key,
                count(*)::int AS count
            FROM search.search_request_events r
            WHERE ${rangeWhere("r", range)}
            GROUP BY category
            ORDER BY count DESC, category ASC
        `);
    }
}
