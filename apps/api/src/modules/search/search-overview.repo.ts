import { Prisma, type PrismaClient } from "@prisma/client";

export type SearchOverviewCounts = {
    total_search_documents: number;
    total_aliases: number;
    active_aliases: number;
    unresolved_failed_searches: number;
    today_searches: number;
};

type SearchOverviewCountsRow = {
    total_search_documents: bigint | number;
    total_aliases: bigint | number;
    active_aliases: bigint | number;
    unresolved_failed_searches: bigint | number;
    today_searches: bigint | number;
};

function toCount(value: bigint | number | undefined): number {
    if (typeof value === "bigint") return Number(value);
    return value ?? 0;
}

export class SearchOverviewRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async getCounts(): Promise<SearchOverviewCounts> {
        const rows = await this.prisma.$queryRaw<SearchOverviewCountsRow[]>(Prisma.sql`
            SELECT
                (SELECT count(*)::bigint FROM search.search_documents) AS total_search_documents,
                (SELECT count(*)::bigint FROM search.search_aliases) AS total_aliases,
                (
                    SELECT count(*)::bigint
                    FROM search.search_aliases
                    WHERE is_active = true
                ) AS active_aliases,
                (
                    SELECT count(*)::bigint
                    FROM search.failed_search_logs
                    WHERE resolved_at IS NULL
                ) AS unresolved_failed_searches,
                (
                    SELECT count(*)::bigint
                    FROM search.search_request_events
                    WHERE created_at >= date_trunc('day', now())
                ) AS today_searches
        `);
        const row = rows[0];

        return {
            total_search_documents: toCount(row?.total_search_documents),
            total_aliases: toCount(row?.total_aliases),
            active_aliases: toCount(row?.active_aliases),
            unresolved_failed_searches: toCount(row?.unresolved_failed_searches),
            today_searches: toCount(row?.today_searches),
        };
    }
}
