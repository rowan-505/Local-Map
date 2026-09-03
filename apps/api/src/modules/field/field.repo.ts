import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    FieldRoutePathRow,
    FieldRouteRow,
    FieldRouteStopRow,
    FieldStopRow,
    FieldVariantRow,
} from "./field-dto.js";
import type { FieldRevisionParts } from "./field-revision.js";

function asInt(value: bigint | number | null | undefined): number {
    if (value == null) {
        return 0;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Field snapshot scope: canonical YBS bus only, active, not deleted, not rejected.
 * Broader than public release (reviewed/verified) so surveyors can work routes in review.
 */
const ybsRouteFilter = Prisma.sql`
    r.deleted_at IS NULL
    AND r.is_active = true
    AND r.mode = 'bus'
    AND r.route_code LIKE 'YBS-%'
    AND coalesce(r.review_status, '') IS DISTINCT FROM 'rejected'
`;

const ybsVariantFilter = Prisma.sql`
    v.deleted_at IS NULL
    AND v.is_active = true
    AND v.direction_id IN (0, 1)
    AND coalesce(v.review_status, '') IS DISTINCT FROM 'rejected'
`;

const ybsStopFilter = Prisma.sql`
    s.deleted_at IS NULL
    AND s.is_active = true
    AND s.geom IS NOT NULL
    AND coalesce(s.review_status, '') IS DISTINCT FROM 'rejected'
`;

const ybsPathFilter = Prisma.sql`
    p.deleted_at IS NULL
    AND p.is_active = true
    AND p.geom IS NOT NULL
    AND coalesce(p.review_status, '') IS DISTINCT FROM 'rejected'
`;

type RevisionRow = {
    route_count: bigint | number;
    variant_count: bigint | number;
    stop_count: bigint | number;
    route_stop_count: bigint | number;
    path_count: bigint | number;
    route_stop_sequence_sum: bigint | number;
    max_route_stop_id: bigint | number;
    max_updated_at_ms: bigint | number;
};

export type FieldSnapshotRows = {
    routes: FieldRouteRow[];
    variants: FieldVariantRow[];
    stops: FieldStopRow[];
    routeStops: FieldRouteStopRow[];
    routePaths: FieldRoutePathRow[];
};

export class FieldRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async loadRevisionParts(): Promise<FieldRevisionParts> {
        const rows = await this.prisma.$queryRaw<RevisionRow[]>`
            WITH ybs_routes AS (
                SELECT r.id, r.updated_at
                FROM transport.routes r
                WHERE ${ybsRouteFilter}
            ),
            ybs_variants AS (
                SELECT v.id, v.updated_at
                FROM transport.route_variants v
                JOIN ybs_routes r ON r.id = v.route_id
                WHERE ${ybsVariantFilter}
            ),
            ybs_route_stops AS (
                SELECT rs.id, rs.stop_id, rs.stop_sequence
                FROM transport.route_stops rs
                JOIN ybs_variants v ON v.id = rs.route_variant_id
            ),
            ybs_stops AS (
                SELECT s.id, s.updated_at
                FROM transport.stops s
                WHERE ${ybsStopFilter}
                  AND EXISTS (
                      SELECT 1 FROM ybs_route_stops rs WHERE rs.stop_id = s.id
                  )
            ),
            ybs_paths AS (
                SELECT DISTINCT ON (p.route_variant_id)
                    p.id,
                    p.updated_at
                FROM transport.route_paths p
                JOIN ybs_variants v ON v.id = p.route_variant_id
                WHERE ${ybsPathFilter}
                ORDER BY
                    p.route_variant_id,
                    CASE WHEN p.path_kind = 'primary' THEN 0 ELSE 1 END,
                    p.id ASC
            )
            SELECT
                (SELECT count(*) FROM ybs_routes) AS route_count,
                (SELECT count(*) FROM ybs_variants) AS variant_count,
                (SELECT count(*) FROM ybs_stops) AS stop_count,
                (SELECT count(*) FROM ybs_route_stops) AS route_stop_count,
                (SELECT count(*) FROM ybs_paths) AS path_count,
                (SELECT coalesce(sum(stop_sequence), 0) FROM ybs_route_stops) AS route_stop_sequence_sum,
                (SELECT coalesce(max(id), 0) FROM ybs_route_stops) AS max_route_stop_id,
                (
                    EXTRACT(
                        EPOCH FROM GREATEST(
                            (SELECT max(updated_at) FROM ybs_routes),
                            (SELECT max(updated_at) FROM ybs_variants),
                            (SELECT max(updated_at) FROM ybs_stops),
                            (SELECT max(updated_at) FROM ybs_paths)
                        )
                    ) * 1000
                )::bigint AS max_updated_at_ms
        `;
        const row = rows[0];
        return {
            routeCount: asInt(row?.route_count),
            variantCount: asInt(row?.variant_count),
            stopCount: asInt(row?.stop_count),
            routeStopCount: asInt(row?.route_stop_count),
            pathCount: asInt(row?.path_count),
            routeStopSequenceSum: asInt(row?.route_stop_sequence_sum),
            maxRouteStopId: asInt(row?.max_route_stop_id),
            maxUpdatedAtMs: asInt(row?.max_updated_at_ms),
        };
    }

    async loadSnapshot(): Promise<FieldSnapshotRows> {
        const [routes, variants, stops, routeStops, routePaths] = await Promise.all([
            this.prisma.$queryRaw<FieldRouteRow[]>`
                SELECT
                    r.public_id::text AS public_id,
                    r.route_code,
                    rn_my.name AS name_my,
                    rn_en.name AS name_en
                FROM transport.routes r
                LEFT JOIN LATERAL (
                    SELECT n.name
                    FROM transport.route_names AS n
                    WHERE n.route_id = r.id
                      AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                    ORDER BY n.is_primary DESC, n.id ASC
                    LIMIT 1
                ) AS rn_my ON true
                LEFT JOIN LATERAL (
                    SELECT n.name
                    FROM transport.route_names AS n
                    WHERE n.route_id = r.id
                      AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                    ORDER BY n.is_primary DESC, n.id ASC
                    LIMIT 1
                ) AS rn_en ON true
                WHERE ${ybsRouteFilter}
                ORDER BY r.route_code ASC
            `,
            this.prisma.$queryRaw<FieldVariantRow[]>`
                SELECT
                    v.public_id::text AS public_id,
                    r.public_id::text AS route_public_id,
                    r.route_code,
                    v.direction_id,
                    NULLIF(btrim(v.origin_name), '') AS origin_name,
                    NULLIF(btrim(v.destination_name), '') AS destination_name
                FROM transport.route_variants v
                JOIN transport.routes r ON r.id = v.route_id
                WHERE ${ybsRouteFilter}
                  AND ${ybsVariantFilter}
                ORDER BY r.route_code ASC, v.direction_id ASC
            `,
            this.prisma.$queryRaw<FieldStopRow[]>`
                SELECT
                    s.public_id::text AS public_id,
                    NULLIF(btrim(s.stop_code), '') AS stop_code,
                    sn_my.name AS name_my,
                    sn_en.name AS name_en,
                    ST_Y(s.geom)::float8 AS lat,
                    ST_X(s.geom)::float8 AS lng
                FROM transport.stops s
                LEFT JOIN LATERAL (
                    SELECT n.name
                    FROM transport.stop_names AS n
                    WHERE n.stop_id = s.id
                      AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                    ORDER BY n.is_primary DESC, n.id ASC
                    LIMIT 1
                ) AS sn_my ON true
                LEFT JOIN LATERAL (
                    SELECT n.name
                    FROM transport.stop_names AS n
                    WHERE n.stop_id = s.id
                      AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                    ORDER BY n.is_primary DESC, n.id ASC
                    LIMIT 1
                ) AS sn_en ON true
                WHERE ${ybsStopFilter}
                  AND EXISTS (
                      SELECT 1
                      FROM transport.route_stops rs
                      JOIN transport.route_variants v ON v.id = rs.route_variant_id
                      JOIN transport.routes r ON r.id = v.route_id
                      WHERE rs.stop_id = s.id
                        AND ${ybsRouteFilter}
                        AND ${ybsVariantFilter}
                  )
                ORDER BY s.public_id ASC
            `,
            this.prisma.$queryRaw<FieldRouteStopRow[]>`
                SELECT
                    v.public_id::text AS variant_public_id,
                    s.public_id::text AS stop_public_id,
                    rs.stop_sequence
                FROM transport.route_stops rs
                JOIN transport.route_variants v ON v.id = rs.route_variant_id
                JOIN transport.routes r ON r.id = v.route_id
                JOIN transport.stops s ON s.id = rs.stop_id
                WHERE ${ybsRouteFilter}
                  AND ${ybsVariantFilter}
                  AND ${ybsStopFilter}
                ORDER BY v.public_id ASC, rs.stop_sequence ASC
            `,
            this.prisma.$queryRaw<FieldRoutePathRow[]>`
                SELECT DISTINCT ON (p.route_variant_id)
                    v.public_id::text AS variant_public_id,
                    ST_AsGeoJSON(p.geom)::jsonb AS geometry
                FROM transport.route_paths p
                JOIN transport.route_variants v ON v.id = p.route_variant_id
                JOIN transport.routes r ON r.id = v.route_id
                WHERE ${ybsRouteFilter}
                  AND ${ybsVariantFilter}
                  AND ${ybsPathFilter}
                ORDER BY
                    p.route_variant_id,
                    CASE WHEN p.path_kind = 'primary' THEN 0 ELSE 1 END,
                    p.id ASC
            `,
        ]);

        return { routes, variants, stops, routeStops, routePaths };
    }
}
