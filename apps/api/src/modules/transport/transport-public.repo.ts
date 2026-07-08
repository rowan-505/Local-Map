import { Prisma, type PrismaClient } from "@prisma/client";

import { TransportNotFoundError, TransportSchemaUnavailableError } from "./transport.errors.js";
import { sqlPublicReleaseVisible } from "./transport-public-visibility.js";
import type {
    PublicTransportFare,
    PublicTransportRouteDetail,
    PublicTransportRouteListItem,
    PublicTransportRouteStopsResponse,
    PublicTransportStopOnRoute,
    PublicTransportStopRouteUsage,
    PublicTransportVariant,
} from "./transport-public.types.js";
import type { GeoJsonGeometry, TransportPaginated } from "./transport.types.js";
import type { ListPublicTransportRoutesQuery } from "./transport.schema.js";
import type { StopRoutesQuery } from "./transport.schema.js";

type RouteListRow = {
    route_code: string;
    name_mm: string | null;
    name_en: string | null;
    operator_name: string | null;
};

type RouteIdRow = {
    id: bigint;
    route_code: string;
};

type FareRow = {
    fare_type: string;
    amount_min: number | null;
    amount_max: number | null;
    currency_code: string;
    note: string | null;
};

type VariantRow = {
    id: bigint;
    variant_code: string;
    direction_name: string | null;
    direction_id: number | null;
    headsign: string | null;
    distance_m: number | null;
};

type PathRow = {
    path_kind: string;
    distance_m: number | null;
    geometry: unknown;
};

type StopRow = {
    stop_sequence: number;
    stop_public_id: string;
    name_mm: string | null;
    name_en: string | null;
    geometry: unknown;
    distance_from_start_m: number | null;
};

type StopRouteUsageRow = {
    route_code: string;
    name_mm: string | null;
    name_en: string | null;
    variant_code: string;
    direction_name: string | null;
    stop_sequence: number;
};

function num(value: bigint | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    return typeof value === "bigint" ? Number(value) : value;
}

function asGeometry(value: unknown): GeoJsonGeometry | null {
    if (value && typeof value === "object" && "type" in value) {
        return value as GeoJsonGeometry;
    }
    return null;
}

function toLikeParam(search: string | undefined): string | null {
    if (!search) return null;
    const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
    return `%${escaped}%`;
}

function mapFare(row: FareRow | undefined): PublicTransportFare | null {
    if (!row) return null;
    return {
        fare_type: row.fare_type,
        amount_min: row.amount_min,
        amount_max: row.amount_max,
        currency_code: row.currency_code,
        note: row.note,
    };
}

function mapStopRow(row: StopRow): PublicTransportStopOnRoute {
    return {
        stop_sequence: row.stop_sequence,
        public_id: row.stop_public_id,
        name_my: row.name_mm,
        name_en: row.name_en,
        geometry: asGeometry(row.geometry),
        distance_from_start_m: row.distance_from_start_m,
    };
}

/**
 * Read-only transport queries for public map/API/mobile.
 * Every query applies Phase 12 release filters on routes, variants, paths, stops, and fares.
 */
export class TransportPublicRepository {
    constructor(private readonly prisma: PrismaClient) {}

    private async assertSchemaAvailable(): Promise<void> {
        try {
            await this.prisma.$queryRaw`SELECT 1 FROM transport.routes LIMIT 1`;
        } catch {
            throw new TransportSchemaUnavailableError();
        }
    }

    async listRoutes(
        query: ListPublicTransportRoutesQuery,
    ): Promise<TransportPaginated<PublicTransportRouteListItem>> {
        await this.assertSchemaAvailable();

        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;
        const mode = query.mode ?? null;
        const searchLike = toLikeParam(query.search);

        const rows = await this.prisma.$queryRaw<RouteListRow[]>`
            SELECT
                r.route_code,
                rn_mm.name AS name_mm,
                rn_en.name AS name_en,
                o.name AS operator_name
            FROM transport.routes r
            LEFT JOIN transport.operators o ON o.id = r.operator_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                ORDER BY n.is_primary DESC, n.search_weight DESC, n.id ASC
                LIMIT 1
            ) AS rn_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY n.is_primary DESC, n.search_weight DESC, n.id ASC
                LIMIT 1
            ) AS rn_en ON true
            WHERE ${sqlPublicReleaseVisible("r")}
              AND (${mode}::text IS NULL OR r.mode = ${mode})
              AND (
                ${searchLike}::text IS NULL OR (
                    r.route_code ILIKE ${searchLike}
                    OR r.public_name ILIKE ${searchLike}
                    OR EXISTS (
                        SELECT 1 FROM transport.route_names rn
                        WHERE rn.route_id = r.id AND rn.name ILIKE ${searchLike}
                    )
                )
              )
            ORDER BY r.route_code ASC, r.id ASC
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM transport.routes r
            WHERE ${sqlPublicReleaseVisible("r")}
              AND (${mode}::text IS NULL OR r.mode = ${mode})
              AND (
                ${searchLike}::text IS NULL OR (
                    r.route_code ILIKE ${searchLike}
                    OR r.public_name ILIKE ${searchLike}
                    OR EXISTS (
                        SELECT 1 FROM transport.route_names rn
                        WHERE rn.route_id = r.id AND rn.name ILIKE ${searchLike}
                    )
                )
              )
        `;

        const items = await Promise.all(
            rows.map(async (row) => {
                const fare = await this.loadRouteFareByCode(row.route_code);
                return {
                    route_code: row.route_code,
                    route_name_my: row.name_mm,
                    route_name_en: row.name_en,
                    operator: row.operator_name ? { name: row.operator_name } : null,
                    fare,
                };
            }),
        );

        return {
            items,
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    async getRouteByCode(routeCode: string): Promise<PublicTransportRouteDetail> {
        await this.assertSchemaAvailable();

        const route = await this.getPublicRouteIdByCode(routeCode);
        const [names, fare, variants] = await Promise.all([
            this.loadRouteNames(route.id),
            this.loadRouteFare(route.id),
            this.loadPublicVariants(route.id),
        ]);

        return {
            route_code: route.route_code,
            route_name_my: names.name_mm,
            route_name_en: names.name_en,
            operator: names.operator_name ? { name: names.operator_name } : null,
            fare,
            variants,
        };
    }

    async listVariantsForRouteCode(routeCode: string): Promise<PublicTransportVariant[]> {
        const route = await this.getPublicRouteIdByCode(routeCode);
        return this.loadPublicVariants(route.id);
    }

    async listStopsForRouteCode(routeCode: string): Promise<PublicTransportRouteStopsResponse> {
        const route = await this.getPublicRouteIdByCode(routeCode);
        const variants = await this.loadPublicVariants(route.id);
        return {
            route_code: route.route_code,
            variants: variants.map((v) => ({
                variant_code: v.variant_code,
                direction_name: v.direction_name,
                stops: v.stops,
            })),
        };
    }

    async listRoutesForStop(
        stopPublicId: string,
        query: StopRoutesQuery,
    ): Promise<TransportPaginated<PublicTransportStopRouteUsage>> {
        await this.assertSchemaAvailable();

        const stopRows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT s.id
            FROM transport.stops s
            WHERE s.public_id = ${stopPublicId}::uuid
              AND ${sqlPublicReleaseVisible("s")}
            LIMIT 1
        `;
        const stop = stopRows[0];
        if (!stop) {
            throw new TransportNotFoundError("stop", stopPublicId);
        }

        const limit = query.limit;
        const offset = query.offset;

        const rows = await this.prisma.$queryRaw<StopRouteUsageRow[]>`
            SELECT
                r.route_code,
                rn_mm.name AS name_mm,
                rn_en.name AS name_en,
                v.variant_code,
                v.direction_name,
                rs.stop_sequence
            FROM transport.route_stops rs
            JOIN transport.route_variants v ON v.id = rs.route_variant_id
            JOIN transport.routes r ON r.id = v.route_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                ORDER BY n.is_primary DESC, n.id ASC
                LIMIT 1
            ) AS rn_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY n.is_primary DESC, n.id ASC
                LIMIT 1
            ) AS rn_en ON true
            WHERE rs.stop_id = ${stop.id}
              AND ${sqlPublicReleaseVisible("r")}
              AND ${sqlPublicReleaseVisible("v")}
              AND ${sqlPublicReleaseVisible("s")}
            ORDER BY r.route_code ASC, v.variant_code ASC, rs.stop_sequence ASC
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM transport.route_stops rs
            JOIN transport.route_variants v ON v.id = rs.route_variant_id
            JOIN transport.routes r ON r.id = v.route_id
            JOIN transport.stops s ON s.id = rs.stop_id
            WHERE rs.stop_id = ${stop.id}
              AND ${sqlPublicReleaseVisible("r")}
              AND ${sqlPublicReleaseVisible("v")}
              AND ${sqlPublicReleaseVisible("s")}
        `;

        return {
            items: rows.map((row) => ({
                route_code: row.route_code,
                route_name_my: row.name_mm,
                route_name_en: row.name_en,
                variant_code: row.variant_code,
                direction_name: row.direction_name,
                stop_sequence: row.stop_sequence,
            })),
            total: num(countRows[0]?.count),
            limit,
            offset,
        };
    }

    private async getPublicRouteIdByCode(routeCode: string): Promise<RouteIdRow> {
        const rows = await this.prisma.$queryRaw<RouteIdRow[]>`
            SELECT r.id, r.route_code
            FROM transport.routes r
            WHERE r.route_code = ${routeCode}
              AND ${sqlPublicReleaseVisible("r")}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            throw new TransportNotFoundError("route", routeCode);
        }
        return row;
    }

    private async loadRouteNames(routeId: bigint): Promise<{
        name_mm: string | null;
        name_en: string | null;
        operator_name: string | null;
    }> {
        const rows = await this.prisma.$queryRaw<
            { name_mm: string | null; name_en: string | null; operator_name: string | null }[]
        >`
            SELECT
                rn_mm.name AS name_mm,
                rn_en.name AS name_en,
                o.name AS operator_name
            FROM transport.routes r
            LEFT JOIN transport.operators o ON o.id = r.operator_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                ORDER BY n.is_primary DESC, n.id ASC
                LIMIT 1
            ) AS rn_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY n.is_primary DESC, n.id ASC
                LIMIT 1
            ) AS rn_en ON true
            WHERE r.id = ${routeId}
            LIMIT 1
        `;
        return rows[0] ?? { name_mm: null, name_en: null, operator_name: null };
    }

    private async loadRouteFare(routeId: bigint): Promise<PublicTransportFare | null> {
        const rows = await this.prisma.$queryRaw<FareRow[]>`
            SELECT
                f.fare_type,
                f.amount_min::float8 AS amount_min,
                f.amount_max::float8 AS amount_max,
                f.currency_code,
                f.note
            FROM transport.fares f
            WHERE f.route_id = ${routeId}
              AND ${sqlPublicReleaseVisible("f")}
            ORDER BY f.id ASC
            LIMIT 1
        `;
        return mapFare(rows[0]);
    }

    private async loadRouteFareByCode(routeCode: string): Promise<PublicTransportFare | null> {
        const rows = await this.prisma.$queryRaw<FareRow[]>`
            SELECT
                f.fare_type,
                f.amount_min::float8 AS amount_min,
                f.amount_max::float8 AS amount_max,
                f.currency_code,
                f.note
            FROM transport.fares f
            JOIN transport.routes r ON r.id = f.route_id
            WHERE r.route_code = ${routeCode}
              AND ${sqlPublicReleaseVisible("r")}
              AND ${sqlPublicReleaseVisible("f")}
            ORDER BY f.id ASC
            LIMIT 1
        `;
        return mapFare(rows[0]);
    }

    private async loadPublicVariants(routeId: bigint): Promise<PublicTransportVariant[]> {
        const variantRows = await this.prisma.$queryRaw<VariantRow[]>`
            SELECT
                v.id,
                v.variant_code,
                v.direction_name,
                v.direction_id,
                v.headsign,
                v.distance_m::float8 AS distance_m
            FROM transport.route_variants v
            WHERE v.route_id = ${routeId}
              AND ${sqlPublicReleaseVisible("v")}
            ORDER BY v.variant_code ASC
        `;

        return Promise.all(
            variantRows.map(async (variant) => {
                const [pathRows, stopRows] = await Promise.all([
                    this.prisma.$queryRaw<PathRow[]>`
                        SELECT
                            p.path_kind,
                            p.distance_m::float8 AS distance_m,
                            ST_AsGeoJSON(p.geom)::jsonb AS geometry
                        FROM transport.route_paths p
                        WHERE p.route_variant_id = ${variant.id}
                          AND ${sqlPublicReleaseVisible("p")}
                        ORDER BY
                            CASE WHEN p.path_kind = 'primary' THEN 0 ELSE 1 END,
                            p.id ASC
                        LIMIT 1
                    `,
                    this.prisma.$queryRaw<StopRow[]>`
                        SELECT
                            rs.stop_sequence,
                            s.public_id::text AS stop_public_id,
                            sn_mm.name AS name_mm,
                            sn_en.name AS name_en,
                            ST_AsGeoJSON(s.geom)::jsonb AS geometry,
                            rs.distance_from_start_m::float8 AS distance_from_start_m
                        FROM transport.route_stops rs
                        JOIN transport.stops s ON s.id = rs.stop_id
                        LEFT JOIN LATERAL (
                            SELECT n.name
                            FROM transport.stop_names AS n
                            WHERE n.stop_id = s.id
                              AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                            ORDER BY n.is_primary DESC, n.id ASC
                            LIMIT 1
                        ) AS sn_mm ON true
                        LEFT JOIN LATERAL (
                            SELECT n.name
                            FROM transport.stop_names AS n
                            WHERE n.stop_id = s.id
                              AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                            ORDER BY n.is_primary DESC, n.id ASC
                            LIMIT 1
                        ) AS sn_en ON true
                        WHERE rs.route_variant_id = ${variant.id}
                          AND ${sqlPublicReleaseVisible("s")}
                        ORDER BY rs.stop_sequence ASC
                    `,
                ]);

                const path = pathRows[0];
                return {
                    variant_code: variant.variant_code,
                    direction_name: variant.direction_name,
                    direction_id: variant.direction_id,
                    headsign: variant.headsign,
                    distance_m: variant.distance_m,
                    path: path
                        ? {
                              path_kind: path.path_kind,
                              distance_m: path.distance_m,
                              geometry: asGeometry(path.geometry),
                          }
                        : null,
                    stops: stopRows.map(mapStopRow),
                };
            }),
        );
    }
}
