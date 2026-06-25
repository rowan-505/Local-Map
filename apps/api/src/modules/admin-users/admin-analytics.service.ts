import {
    AdminAnalyticsRepository,
    type AnalyticsSummaryRow,
    type GrowthBucketRow,
    type PointsAnalyticsRow,
    type PointsByReasonRow,
    type RoleCountRow,
    type SavedPlacesAnalyticsRow,
} from "./admin-analytics.repo.js";

export type RegionCountResponse = {
    region_id: string | null;
    region_name: string | null;
    count: number;
};

export class AdminAnalyticsService {
    constructor(private readonly repo: AdminAnalyticsRepository) {}

    summary(): Promise<AnalyticsSummaryRow> {
        return this.repo.summary();
    }

    growth(bucket: string, days: number): Promise<GrowthBucketRow[]> {
        return this.repo.growth(bucket, days);
    }

    byRole(): Promise<RoleCountRow[]> {
        return this.repo.byRole();
    }

    async byRegion(): Promise<RegionCountResponse[]> {
        const rows = await this.repo.byRegion();
        return rows.map((row) => ({
            region_id: row.region_id !== null ? row.region_id.toString() : null,
            region_name: row.region_name,
            count: row.count,
        }));
    }

    points(): Promise<PointsAnalyticsRow> {
        return this.repo.points();
    }

    pointsByReason(): Promise<PointsByReasonRow[]> {
        return this.repo.pointsByReason();
    }

    savedPlaces(): Promise<SavedPlacesAnalyticsRow> {
        return this.repo.savedPlaces();
    }
}
