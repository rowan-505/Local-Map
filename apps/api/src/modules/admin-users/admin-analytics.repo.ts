import { Prisma, type PrismaClient } from "@prisma/client";

export type AnalyticsSummaryRow = {
    total_users: number;
    verified_users: number;
    unverified_users: number;
    new_today: number;
    new_this_week: number;
    new_this_month: number;
    active_this_week: number;
    disabled_users: number;
    admin_count: number;
    super_admin_count: number;
    total_saved_places: number;
    total_points_awarded: number;
};

export type GrowthBucketRow = { bucket: string; count: number };
export type RoleCountRow = { role: string; count: number };
export type RegionCountRow = { region_id: bigint | null; region_name: string | null; count: number };
export type PointsAnalyticsRow = {
    total_awarded: number;
    total_removed: number;
    net_points: number;
    ledger_entries: number;
    users_with_points: number;
};
export type SavedPlacesAnalyticsRow = {
    total_saved_places: number;
    users_with_saved_places: number;
    distinct_places_saved: number;
};

export type PointsByReasonRow = {
    reason_code: string;
    net_points: number;
    total_awarded: number;
    total_removed: number;
    entries: number;
};

const STEP_INTERVAL: Record<string, string> = {
    day: "1 day",
    week: "1 week",
    month: "1 month",
};

export class AdminAnalyticsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async summary(): Promise<AnalyticsSummaryRow> {
        const rows = await this.prisma.$queryRaw<AnalyticsSummaryRow[]>(Prisma.sql`
            SELECT
                (SELECT COUNT(*) FROM app_auth.auth_users WHERE deleted_at IS NULL)::int AS total_users,
                (SELECT COUNT(*) FROM app_auth.auth_users WHERE deleted_at IS NULL AND email_verified)::int AS verified_users,
                (SELECT COUNT(*) FROM app_auth.auth_users WHERE deleted_at IS NULL AND NOT email_verified)::int AS unverified_users,
                (SELECT COUNT(*) FROM app_auth.auth_users WHERE deleted_at IS NULL AND created_at >= date_trunc('day', now()))::int AS new_today,
                (SELECT COUNT(*) FROM app_auth.auth_users WHERE deleted_at IS NULL AND created_at >= date_trunc('week', now()))::int AS new_this_week,
                (SELECT COUNT(*) FROM app_auth.auth_users WHERE deleted_at IS NULL AND created_at >= date_trunc('month', now()))::int AS new_this_month,
                (SELECT COUNT(*) FROM app_auth.auth_users WHERE deleted_at IS NULL AND last_seen_at >= now() - interval '7 days')::int AS active_this_week,
                (SELECT COUNT(*) FROM app_auth.auth_users WHERE account_status = 'disabled')::int AS disabled_users,
                (SELECT COUNT(DISTINCT ur.user_id)
                   FROM app_auth.auth_user_roles ur
                   JOIN app_auth.auth_roles r ON r.id = ur.role_id
                   JOIN app_auth.auth_users u ON u.id = ur.user_id
                  WHERE r.code = 'admin' AND u.deleted_at IS NULL)::int AS admin_count,
                (SELECT COUNT(DISTINCT ur.user_id)
                   FROM app_auth.auth_user_roles ur
                   JOIN app_auth.auth_roles r ON r.id = ur.role_id
                   JOIN app_auth.auth_users u ON u.id = ur.user_id
                  WHERE r.code = 'super_admin' AND u.deleted_at IS NULL)::int AS super_admin_count,
                (SELECT COUNT(*) FROM app.user_saved_places)::int AS total_saved_places,
                (SELECT COALESCE(SUM(points_delta), 0) FROM contrib.point_ledger WHERE points_delta > 0)::int AS total_points_awarded
        `);

        return rows[0]!;
    }

    async growth(bucket: string, days: number): Promise<GrowthBucketRow[]> {
        const step = STEP_INTERVAL[bucket] ?? STEP_INTERVAL.day;

        return this.prisma.$queryRaw<GrowthBucketRow[]>(Prisma.sql`
            WITH series AS (
                SELECT generate_series(
                    date_trunc(${bucket}, now()) - (${days} * interval '1 day'),
                    date_trunc(${bucket}, now()),
                    ${step}::interval
                ) AS bucket
            ),
            counts AS (
                SELECT date_trunc(${bucket}, created_at) AS bucket, COUNT(*)::int AS count
                FROM app_auth.auth_users
                WHERE deleted_at IS NULL
                  AND created_at >= date_trunc(${bucket}, now()) - (${days} * interval '1 day')
                GROUP BY 1
            )
            SELECT to_char(s.bucket, 'YYYY-MM-DD') AS bucket, COALESCE(c.count, 0)::int AS count
            FROM series s
            LEFT JOIN counts c ON c.bucket = s.bucket
            ORDER BY s.bucket
        `);
    }

    async byRole(): Promise<RoleCountRow[]> {
        return this.prisma.$queryRaw<RoleCountRow[]>(Prisma.sql`
            SELECT r.code AS role, COUNT(u.id)::int AS count
            FROM app_auth.auth_roles r
            LEFT JOIN app_auth.auth_user_roles ur ON ur.role_id = r.id
            LEFT JOIN app_auth.auth_users u ON u.id = ur.user_id AND u.deleted_at IS NULL
            GROUP BY r.code
            ORDER BY r.code
        `);
    }

    async byRegion(): Promise<RegionCountRow[]> {
        return this.prisma.$queryRaw<RegionCountRow[]>(Prisma.sql`
            SELECT u.primary_region_id AS region_id, a.canonical_name AS region_name, COUNT(*)::int AS count
            FROM app_auth.auth_users u
            LEFT JOIN core.core_admin_areas a ON a.id = u.primary_region_id
            WHERE u.deleted_at IS NULL
            GROUP BY u.primary_region_id, a.canonical_name
            ORDER BY count DESC, region_name NULLS LAST
        `);
    }

    async points(): Promise<PointsAnalyticsRow> {
        const rows = await this.prisma.$queryRaw<PointsAnalyticsRow[]>(Prisma.sql`
            SELECT
                COALESCE(SUM(points_delta) FILTER (WHERE points_delta > 0), 0)::int AS total_awarded,
                COALESCE(SUM(ABS(points_delta)) FILTER (WHERE points_delta < 0), 0)::int AS total_removed,
                COALESCE(SUM(points_delta), 0)::int AS net_points,
                COUNT(*)::int AS ledger_entries,
                (SELECT COUNT(*) FROM contrib.user_point_summary WHERE total_points <> 0)::int AS users_with_points
            FROM contrib.point_ledger
        `);

        return rows[0]!;
    }

    async pointsByReason(): Promise<PointsByReasonRow[]> {
        return this.prisma.$queryRaw<PointsByReasonRow[]>(Prisma.sql`
            SELECT
                reason_code,
                COALESCE(SUM(points_delta), 0)::int AS net_points,
                COALESCE(SUM(points_delta) FILTER (WHERE points_delta > 0), 0)::int AS total_awarded,
                COALESCE(SUM(ABS(points_delta)) FILTER (WHERE points_delta < 0), 0)::int AS total_removed,
                COUNT(*)::int AS entries
            FROM contrib.point_ledger
            GROUP BY reason_code
            ORDER BY net_points DESC
        `);
    }

    async savedPlaces(): Promise<SavedPlacesAnalyticsRow> {
        const rows = await this.prisma.$queryRaw<SavedPlacesAnalyticsRow[]>(Prisma.sql`
            SELECT
                COUNT(*)::int AS total_saved_places,
                COUNT(DISTINCT user_id)::int AS users_with_saved_places,
                COUNT(DISTINCT entity_id)::int AS distinct_places_saved
            FROM app.user_saved_places
            WHERE entity_type = 'place'
        `);

        return rows[0]!;
    }
}
