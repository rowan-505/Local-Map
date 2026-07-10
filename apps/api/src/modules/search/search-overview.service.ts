import type { PrismaClient } from "@prisma/client";

import {
    getSearchIndexHealthSeveritySummary,
    type SearchIndexHealthReport,
} from "./search-index-health.js";
import type { SearchOverviewCounts, SearchOverviewRepository } from "./search-overview.repo.js";

export type SearchOverviewSummary = SearchOverviewCounts & {
    overall_index_health_severity: SearchIndexHealthReport["overall_severity"];
};

type SearchIndexHealthLoader = (
    prisma: PrismaClient,
) => Promise<Pick<SearchIndexHealthReport, "overall_severity">>;

export class SearchOverviewService {
    constructor(
        private readonly repo: SearchOverviewRepository,
        private readonly prisma: PrismaClient,
        private readonly loadHealth: SearchIndexHealthLoader = getSearchIndexHealthSeveritySummary,
    ) {}

    async getOverview(): Promise<SearchOverviewSummary> {
        const [counts, health] = await Promise.all([
            this.repo.getCounts(),
            this.loadHealth(this.prisma),
        ]);

        return {
            ...counts,
            overall_index_health_severity: health.overall_severity,
        };
    }
}
