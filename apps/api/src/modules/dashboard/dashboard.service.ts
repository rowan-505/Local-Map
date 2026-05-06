import { DashboardStatsRepository } from "./dashboard.repo.js";
import type { DashboardStatsResponse } from "./dashboard.types.js";

function sumValues(record: Record<string, number>): number {
    let total = 0;

    for (const value of Object.values(record)) {
        total += value;
    }

    return total;
}

export class DashboardStatsService {
    constructor(private readonly dashboardStatsRepo: DashboardStatsRepository) {}

    async getDashboardStats(): Promise<DashboardStatsResponse> {
        const [main, metadata, transit, health] = await Promise.all([
            this.dashboardStatsRepo.getMainCounts(),
            this.dashboardStatsRepo.getMetadataCounts(),
            this.dashboardStatsRepo.getTransitCounts(),
            this.dashboardStatsRepo.getHealthCounts(),
        ]);

        return {
            overview: {
                total_main_rows: sumValues(main),
                total_metadata_rows: sumValues(metadata),
                total_transit_rows: sumValues(transit),
            },
            main,
            metadata,
            transit,
            health,
        };
    }
}
