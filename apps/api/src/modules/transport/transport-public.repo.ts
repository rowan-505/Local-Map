import { Prisma, type PrismaClient } from "@prisma/client";

import { transportStopNameLabelSelectSql } from "../../lib/entity-names/transport-stop-detail-select-sql.js";
import { TransportNotFoundError, TransportSchemaUnavailableError } from "./transport.errors.js";
import {
    classifyTransportStopLookupId,
    classifyTransportTerminalLookupId,
    sqlCanonicalTransportStopExists,
    sqlCanonicalTransportTerminalExists,
    sqlPublicReleaseVisible,
} from "./transport-public-visibility.js";
import type {
    PublicTransportFare,
    PublicTransportRouteDetail,
    PublicTransportRouteListItem,
    PublicTransportRouteStopsResponse,
    PublicTransportStopDetail,
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

export type PublicTerminalDetailRow = {
    id: bigint;
    public_id: string;
    terminal_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    terminal_role: string;
    review_status: string;
    confidence_score: number | null;
    admin_area_name: string | null;
    longitude: number;
    latitude: number;
    linked_stop_id: bigint | null;
    route_count: bigint;
};

export type PublicStopDetailRow = {
    id: bigint;
    public_id: string;
    stop_code: string | null;
    name_mm: string | null;
    name_en: string | null;
    name_und: string | null;
    canonical_name: string | null;
    mode: string;
    stop_type: string;
    review_status: string;
    confidence_score: number | null;
    admin_area_name: string | null;
    longitude: number;
    latitude: number;
    route_count: bigint;
};

export type PublicStopRouteServingRow = {
    route_id: bigint;
    route_public_id: string;
    route_code: string;
    public_name: string | null;
    variant_id: bigint;
    variant_public_id: string;
    variant_code: string;
    direction_name: string | null;
    origin_name: string | null;
    destination_name: string | null;
    stop_sequence: number;
};

export type PublicStopNextPreviewRow = {
    route_id: bigint;
    route_public_id: string;
    route_code: string;
    public_name: string | null;
    variant_id: bigint;
    variant_public_id: string;
    variant_code: string;
    direction_name: string | null;
    destination_name: string | null;
    anchor_stop_sequence: number;
    stop_sequence: number;
    stop_id: bigint;
    stop_public_id: string;
    name_mm: string | null;
    name_en: string | null;
    longitude: number;
    latitude: number;
};

export type RouteSearchCandidateVariantRow = {
    variant_id: bigint;
    variant_public_id: string;
    variant_code: string;
    direction_name: string | null;
    route_id: bigint;
    route_public_id: string;
    route_code: string;
    public_name: string | null;
    origin_name: string | null;
    destination_name: string | null;
};

export type RouteSearchVariantStopRow = {
    route_variant_id: bigint;
    route_stop_id: bigint;
    stop_id: bigint;
    stop_public_id: string;
    stop_sequence: number;
    name_mm: string | null;
    name_en: string | null;
};

/** Max downstream stops returned per route variant on public stop detail. */
export const PUBLIC_STOP_NEXT_PREVIEW_LIMIT = 3;

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

    /**
     * Public web map stop detail. UUID lookup uses `transport.stops.public_id` (tile contract).
     * Numeric lookup uses internal `id` for backward compatibility only.
     * Returns null when no active, non-deleted canonical stop matches.
     */
    async getPublicStopByLookupId(lookupId: string): Promise<PublicStopDetailRow | null> {
        const classified = classifyTransportStopLookupId(lookupId);

        // Neither a numeric id nor a uuid: do not guess and do not cast an invalid
        // string to ::uuid (which would raise a DB error). Treat as "not found".
        if (classified.kind === "invalid") {
            return null;
        }

        await this.assertSchemaAvailable();

        const idCondition =
            classified.kind === "numeric"
                ? Prisma.sql`s.id = ${classified.id}`
                : Prisma.sql`s.public_id = ${classified.publicId}::uuid`;

        const rows = await this.prisma.$queryRaw<PublicStopDetailRow[]>`
            SELECT
                s.id,
                s.public_id::text AS public_id,
                s.stop_code,
                ${transportStopNameLabelSelectSql},
                s.mode,
                s.stop_type,
                s.review_status,
                s.confidence_score::float8 AS confidence_score,
                aa.canonical_name AS admin_area_name,
                ST_X(s.geom)::float8 AS longitude,
                ST_Y(s.geom)::float8 AS latitude,
                (
                    SELECT count(DISTINCT v.id)::bigint
                    FROM transport.route_stops rs
                    JOIN transport.route_variants v ON v.id = rs.route_variant_id
                    JOIN transport.routes r ON r.id = v.route_id
                    WHERE rs.stop_id = s.id
                      AND ${sqlPublicReleaseVisible("r")}
                      AND ${sqlPublicReleaseVisible("v")}
                ) AS route_count
            FROM transport.stops s
            LEFT JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id
            WHERE ${idCondition}
              AND ${sqlCanonicalTransportStopExists("s")}
            LIMIT 1
        `;

        return rows[0] ?? null;
    }

    /**
     * Public web map terminal detail. UUID lookup uses `transport.terminals.public_id`.
     * Numeric lookup uses internal `id` for backward compatibility only.
     */
    async getPublicTerminalByLookupId(lookupId: string): Promise<PublicTerminalDetailRow | null> {
        const classified = classifyTransportTerminalLookupId(lookupId);
        if (classified.kind === "invalid") {
            return null;
        }

        await this.assertSchemaAvailable();

        const idCondition =
            classified.kind === "numeric"
                ? Prisma.sql`t.id = ${classified.id}`
                : Prisma.sql`t.public_id = ${classified.publicId}::uuid`;

        const rows = await this.prisma.$queryRaw<PublicTerminalDetailRow[]>`
            SELECT
                t.id,
                t.public_id::text AS public_id,
                t.terminal_code,
                t.name,
                t.name_mm,
                t.name_en,
                t.mode,
                t.terminal_role,
                t.review_status,
                t.confidence_score::float8 AS confidence_score,
                aa.canonical_name AS admin_area_name,
                ST_X(t.geom)::float8 AS longitude,
                ST_Y(t.geom)::float8 AS latitude,
                t.linked_stop_id,
                (
                    SELECT count(DISTINCT v.id)::bigint
                    FROM transport.route_stops rs
                    JOIN transport.route_variants v ON v.id = rs.route_variant_id
                    JOIN transport.routes r ON r.id = v.route_id
                    WHERE rs.stop_id = t.linked_stop_id
                      AND t.linked_stop_id IS NOT NULL
                      AND ${sqlPublicReleaseVisible("r")}
                      AND ${sqlPublicReleaseVisible("v")}
                ) AS route_count
            FROM transport.terminals t
            LEFT JOIN core.core_admin_areas aa ON aa.id = t.admin_area_id
            WHERE ${idCondition}
              AND ${sqlCanonicalTransportTerminalExists("t")}
            LIMIT 1
        `;

        return rows[0] ?? null;
    }

    /** Route variants that include this stop (public-release only, one row per variant). */
    async listRoutesServingPublicStop(stopId: bigint): Promise<PublicStopRouteServingRow[]> {
        await this.assertSchemaAvailable();

        return this.prisma.$queryRaw<PublicStopRouteServingRow[]>`
            SELECT
                serving.route_id,
                serving.route_public_id,
                serving.route_code,
                serving.public_name,
                serving.variant_id,
                serving.variant_public_id,
                serving.variant_code,
                serving.direction_name,
                serving.origin_name,
                serving.destination_name,
                serving.stop_sequence
            FROM (
                SELECT DISTINCT ON (v.id)
                    r.id AS route_id,
                    r.public_id::text AS route_public_id,
                    r.route_code,
                    r.public_name,
                    v.id AS variant_id,
                    v.public_id::text AS variant_public_id,
                    v.variant_code,
                    v.direction_name,
                    r.origin_name,
                    r.destination_name,
                    rs.stop_sequence
                FROM transport.route_stops rs
                JOIN transport.route_variants v ON v.id = rs.route_variant_id
                JOIN transport.routes r ON r.id = v.route_id
                WHERE rs.stop_id = ${stopId}
                  AND ${sqlPublicReleaseVisible("r")}
                  AND ${sqlPublicReleaseVisible("v")}
                ORDER BY v.id, rs.stop_sequence ASC
            ) AS serving
            ORDER BY serving.route_code ASC, serving.variant_code ASC, serving.stop_sequence ASC
        `;
    }

    /**
     * Next stops after this stop on each serving route variant (up to
     * {@link PUBLIC_STOP_NEXT_PREVIEW_LIMIT} per variant, public-release only).
     */
    async listNextStopsPreviewForPublicStop(
        stopId: bigint,
        maxPerVariant = PUBLIC_STOP_NEXT_PREVIEW_LIMIT,
    ): Promise<PublicStopNextPreviewRow[]> {
        await this.assertSchemaAvailable();

        return this.prisma.$queryRaw<PublicStopNextPreviewRow[]>`
            WITH serving AS (
                SELECT DISTINCT ON (rs.route_variant_id)
                    rs.route_variant_id,
                    rs.stop_sequence AS anchor_stop_sequence
                FROM transport.route_stops rs
                JOIN transport.route_variants v ON v.id = rs.route_variant_id
                JOIN transport.routes r ON r.id = v.route_id
                WHERE rs.stop_id = ${stopId}
                  AND ${sqlPublicReleaseVisible("r")}
                  AND ${sqlPublicReleaseVisible("v")}
                ORDER BY rs.route_variant_id, rs.stop_sequence ASC
            ),
            ranked AS (
                SELECT
                    r.id AS route_id,
                    r.public_id::text AS route_public_id,
                    r.route_code,
                    r.public_name,
                    v.id AS variant_id,
                    v.public_id::text AS variant_public_id,
                    v.variant_code,
                    v.direction_name,
                    r.destination_name,
                    srv.anchor_stop_sequence,
                    rs.stop_sequence,
                    s.id AS stop_id,
                    s.public_id::text AS stop_public_id,
                    sn_mm.name AS name_mm,
                    sn_en.name AS name_en,
                    ST_X(s.geom)::float8 AS longitude,
                    ST_Y(s.geom)::float8 AS latitude,
                    ROW_NUMBER() OVER (
                        PARTITION BY v.id
                        ORDER BY rs.stop_sequence ASC
                    ) AS rn
                FROM serving srv
                JOIN transport.route_stops rs
                    ON rs.route_variant_id = srv.route_variant_id
                   AND rs.stop_sequence > srv.anchor_stop_sequence
                JOIN transport.stops s ON s.id = rs.stop_id
                JOIN transport.route_variants v ON v.id = rs.route_variant_id
                JOIN transport.routes r ON r.id = v.route_id
                LEFT JOIN LATERAL (
                    SELECT x.name
                    FROM transport.stop_names AS x
                    WHERE x.stop_id = s.id
                      AND (
                          lower(btrim(coalesce(x.language_code, ''))) = 'my'
                          OR upper(btrim(coalesce(x.script_code, ''))) = 'MYMR'
                      )
                    ORDER BY
                        CASE
                            WHEN x.name_type = 'official' AND x.is_primary IS TRUE THEN 1
                            WHEN x.is_primary IS TRUE THEN 2
                            WHEN x.name_type = 'official' THEN 3
                            ELSE 4
                        END,
                        x.search_weight DESC NULLS LAST,
                        x.name ASC
                    LIMIT 1
                ) AS sn_mm ON true
                LEFT JOIN LATERAL (
                    SELECT x.name
                    FROM transport.stop_names AS x
                    WHERE x.stop_id = s.id
                      AND (
                          lower(btrim(coalesce(x.language_code, ''))) = 'en'
                          OR upper(btrim(coalesce(x.script_code, ''))) = 'LATN'
                      )
                    ORDER BY
                        CASE
                            WHEN x.name_type = 'official' AND x.is_primary IS TRUE THEN 1
                            WHEN x.is_primary IS TRUE THEN 2
                            WHEN x.name_type = 'official' THEN 3
                            ELSE 4
                        END,
                        x.search_weight DESC NULLS LAST,
                        x.name ASC
                    LIMIT 1
                ) AS sn_en ON true
                WHERE ${sqlPublicReleaseVisible("s")}
                  AND ${sqlPublicReleaseVisible("v")}
                  AND ${sqlPublicReleaseVisible("r")}
            )
            SELECT
                route_id,
                route_public_id,
                route_code,
                public_name,
                variant_id,
                variant_public_id,
                variant_code,
                direction_name,
                destination_name,
                anchor_stop_sequence,
                stop_sequence,
                stop_id,
                stop_public_id,
                name_mm,
                name_en,
                longitude,
                latitude
            FROM ranked
            WHERE rn <= ${maxPerVariant}
            ORDER BY route_code ASC, variant_code ASC, stop_sequence ASC
        `;
    }

    /**
     * Route variants that serve both stops (public-release only). Does not pick
     * occurrence pairs — pairing is done in {@link TransportPublicService.searchRoutesBetweenStops}.
     */
    async listCandidateVariantsBetweenStops(
        originStopId: bigint,
        destinationStopId: bigint,
    ): Promise<RouteSearchCandidateVariantRow[]> {
        await this.assertSchemaAvailable();

        return this.prisma.$queryRaw<RouteSearchCandidateVariantRow[]>`
            SELECT
                v.id AS variant_id,
                v.public_id::text AS variant_public_id,
                v.variant_code,
                v.direction_name,
                r.id AS route_id,
                r.public_id::text AS route_public_id,
                r.route_code,
                r.public_name,
                r.origin_name,
                r.destination_name
            FROM transport.route_variants v
            JOIN transport.routes r ON r.id = v.route_id
            WHERE ${sqlPublicReleaseVisible("r")}
              AND ${sqlPublicReleaseVisible("v")}
              AND EXISTS (
                    SELECT 1
                    FROM transport.route_stops rs_o
                    WHERE rs_o.route_variant_id = v.id
                      AND rs_o.stop_id = ${originStopId}
              )
              AND EXISTS (
                    SELECT 1
                    FROM transport.route_stops rs_d
                    WHERE rs_d.route_variant_id = v.id
                      AND rs_d.stop_id = ${destinationStopId}
              )
            ORDER BY r.route_code ASC, v.variant_code ASC
        `;
    }

    /** Ordered route_stops rows for route-search pairing (public-release only). */
    async listVariantStopsForRouteSearch(
        variantIds: readonly bigint[],
    ): Promise<RouteSearchVariantStopRow[]> {
        if (variantIds.length === 0) {
            return [];
        }

        await this.assertSchemaAvailable();

        return this.prisma.$queryRaw<RouteSearchVariantStopRow[]>`
            SELECT
                rs.route_variant_id,
                rs.id AS route_stop_id,
                rs.stop_id,
                s.public_id::text AS stop_public_id,
                rs.stop_sequence,
                sn_mm.name AS name_mm,
                sn_en.name AS name_en
            FROM transport.route_stops rs
            JOIN transport.stops s ON s.id = rs.stop_id
            JOIN transport.route_variants v ON v.id = rs.route_variant_id
            JOIN transport.routes r ON r.id = v.route_id
            LEFT JOIN LATERAL (
                SELECT x.name
                FROM transport.stop_names AS x
                WHERE x.stop_id = s.id
                  AND (
                      lower(btrim(coalesce(x.language_code, ''))) = 'my'
                      OR upper(btrim(coalesce(x.script_code, ''))) = 'MYMR'
                  )
                ORDER BY
                    CASE
                        WHEN x.name_type = 'official' AND x.is_primary IS TRUE THEN 1
                        WHEN x.is_primary IS TRUE THEN 2
                        WHEN x.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    x.search_weight DESC NULLS LAST,
                    x.name ASC
                LIMIT 1
            ) AS sn_mm ON true
            LEFT JOIN LATERAL (
                SELECT x.name
                FROM transport.stop_names AS x
                WHERE x.stop_id = s.id
                  AND (
                      lower(btrim(coalesce(x.language_code, ''))) = 'en'
                      OR upper(btrim(coalesce(x.script_code, ''))) = 'LATN'
                  )
                ORDER BY
                    CASE
                        WHEN x.name_type = 'official' AND x.is_primary IS TRUE THEN 1
                        WHEN x.is_primary IS TRUE THEN 2
                        WHEN x.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    x.search_weight DESC NULLS LAST,
                    x.name ASC
                LIMIT 1
            ) AS sn_en ON true
            WHERE rs.route_variant_id IN (${Prisma.join(variantIds)})
              AND ${sqlPublicReleaseVisible("s")}
              AND ${sqlPublicReleaseVisible("v")}
              AND ${sqlPublicReleaseVisible("r")}
            ORDER BY rs.route_variant_id ASC, rs.stop_sequence ASC, rs.id ASC
        `;
    }
}
