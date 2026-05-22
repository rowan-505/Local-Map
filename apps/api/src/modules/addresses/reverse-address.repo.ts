import { Prisma, type PrismaClient } from "@prisma/client";

import {
    REVERSE_CANDIDATE_LIMIT,
    REVERSE_EXACT_ADDRESS_MAX_M,
    REVERSE_PLACE_MAX_M,
    REVERSE_STREET_MAX_M,
    REVERSE_VILLAGE_HINT_MAX_M,
} from "./reverse-address.constants.js";

export type ClickPoint = { lng: number; lat: number };

export type NearbyCoreAddressRow = {
    id: bigint;
    public_id: string;
    distance_m: number;
    match_geom: string;
};

export type BuildingAtPointRow = {
    id: bigint;
    public_id: string;
    name: string | null;
    linked_address_id: bigint | null;
    linked_address_public_id: string | null;
};

export type NearbyPlaceRow = {
    id: bigint;
    public_id: string;
    display_name: string | null;
    primary_name: string | null;
    linked_address_id: bigint | null;
    distance_m: number;
};

export type NearbyStreetRow = {
    id: bigint;
    public_id: string;
    canonical_name: string | null;
    name_en: string | null;
    name_my: string | null;
    name_und: string | null;
    distance_m: number;
};

export type AdminAreaAtPointRow = {
    id: bigint;
    canonical_name: string;
    name_en: string | null;
    name_my: string | null;
    admin_level_code: string;
    admin_level_rank: number;
    boundary_status: string | null;
    address_usage: string | null;
    boundary_confidence_score: number | null;
    area_m2: number | null;
    match_type: string;
};

export type LanduseAtPointRow = {
    id: bigint;
    public_id: string;
    name: string | null;
    class_code: string | null;
    class_name: string | null;
};

export type CoreAddressComponentDbRow = {
    id: bigint;
    component_type_code: string;
    component_value: string;
    language_code: string;
    sort_order: number | null;
    confidence_score: unknown;
    match_type: string | null;
    source_admin_area_id: bigint | null;
    boundary_status: string | null;
    address_usage: string | null;
};

const STREET_NAME_EN = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_street_names AS n
        WHERE n.street_id = s.id
          AND lower(trim(coalesce(n.language_code, ''))) IN ('en', 'und')
          AND btrim(coalesce(n.name, '')) <> ''
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS sn_en ON true
`;

const STREET_NAME_MY = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_street_names AS n
        WHERE n.street_id = s.id
          AND lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
          AND btrim(coalesce(n.name, '')) <> ''
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS sn_my ON true
`;

const ADMIN_NAME_EN = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_admin_area_names AS n
        WHERE n.admin_area_id = aa.id
          AND lower(trim(coalesce(n.language_code, ''))) = 'en'
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS an_en ON true
`;

const ADMIN_NAME_MY = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_admin_area_names AS n
        WHERE n.admin_area_id = aa.id
          AND lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS an_my ON true
`;

export class ReverseAddressRepository {
    constructor(private readonly prisma: PrismaClient) {}

    private clickSql(point: ClickPoint): Prisma.Sql {
        return Prisma.sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)`;
    }

    async tableExists(qualified: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
            SELECT to_regclass(${qualified}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    async findNearbyCoreAddresses(point: ClickPoint): Promise<NearbyCoreAddressRow[]> {
        if (!(await this.tableExists("core.core_addresses"))) {
            return [];
        }
        const click = this.clickSql(point);
        return this.prisma.$queryRaw<NearbyCoreAddressRow[]>`
            WITH click AS (SELECT ${click}::geometry(Point, 4326) AS geom)
            SELECT
                a.id,
                a.public_id::text AS public_id,
                ST_Distance(
                    COALESCE(a.entrance_geom, a.point_geom)::geography,
                    click.geom::geography
                ) AS distance_m,
                CASE
                    WHEN a.entrance_geom IS NOT NULL
                         AND ST_DWithin(a.entrance_geom::geography, click.geom::geography, ${REVERSE_EXACT_ADDRESS_MAX_M})
                        THEN 'entrance'
                    ELSE 'point'
                END AS match_geom
            FROM core.core_addresses AS a
            CROSS JOIN click
            WHERE a.deleted_at IS NULL
              AND (
                  (a.point_geom IS NOT NULL AND NOT ST_IsEmpty(a.point_geom)
                   AND ST_DWithin(a.point_geom::geography, click.geom::geography, ${REVERSE_EXACT_ADDRESS_MAX_M}))
                  OR (a.entrance_geom IS NOT NULL AND NOT ST_IsEmpty(a.entrance_geom)
                      AND ST_DWithin(a.entrance_geom::geography, click.geom::geography, ${REVERSE_EXACT_ADDRESS_MAX_M}))
              )
            ORDER BY distance_m ASC
            LIMIT ${REVERSE_CANDIDATE_LIMIT}
        `;
    }

    async findBuildingAtPoint(point: ClickPoint): Promise<BuildingAtPointRow | null> {
        if (!(await this.tableExists("core.core_map_buildings"))) {
            return null;
        }
        const click = this.clickSql(point);
        const hasPlaceBuildings = await this.tableExists("core.core_place_buildings");
        const hasPlaceAddresses = await this.tableExists("core.core_place_addresses");

        const linkJoin = hasPlaceBuildings && hasPlaceAddresses
            ? Prisma.sql`
                LEFT JOIN core.core_place_buildings AS pb ON pb.building_id = b.id
                LEFT JOIN LATERAL (
                    SELECT pa.address_id
                    FROM core.core_place_addresses AS pa
                    WHERE pa.place_id = pb.place_id
                    ORDER BY pa.is_primary DESC NULLS LAST, pa.place_id ASC
                    LIMIT 1
                ) AS pa ON true
                LEFT JOIN core.core_addresses AS a
                    ON a.id = pa.address_id AND a.deleted_at IS NULL
            `
            : Prisma.sql`
                LEFT JOIN LATERAL (SELECT NULL::bigint AS address_id) AS pa ON true
                LEFT JOIN core.core_addresses AS a ON false
            `;

        const rows = await this.prisma.$queryRaw<BuildingAtPointRow[]>`
            WITH click AS (SELECT ${click}::geometry(Point, 4326) AS geom)
            SELECT
                b.id,
                b.public_id::text AS public_id,
                b.name,
                a.id AS linked_address_id,
                a.public_id::text AS linked_address_public_id
            FROM core.core_map_buildings AS b
            CROSS JOIN click
            ${linkJoin}
            WHERE b.deleted_at IS NULL
              AND b.geom IS NOT NULL
              AND NOT ST_IsEmpty(b.geom)
              AND ST_Contains(b.geom, click.geom)
            ORDER BY ST_Area(b.geom::geography) ASC
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async findNearbyPlaces(point: ClickPoint): Promise<NearbyPlaceRow[]> {
        if (!(await this.tableExists("core.core_places"))) {
            return [];
        }
        const click = this.clickSql(point);
        const hasPlaceAddresses = await this.tableExists("core.core_place_addresses");
        const paJoin = hasPlaceAddresses
            ? Prisma.sql`
                LEFT JOIN LATERAL (
                    SELECT pa.address_id
                    FROM core.core_place_addresses AS pa
                    WHERE pa.place_id = p.id
                    ORDER BY pa.is_primary DESC NULLS LAST
                    LIMIT 1
                ) AS pa ON true
            `
            : Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::bigint AS address_id) AS pa ON true`;

        return this.prisma.$queryRaw<NearbyPlaceRow[]>`
            WITH click AS (SELECT ${click}::geometry(Point, 4326) AS geom)
            SELECT
                p.id,
                p.public_id::text AS public_id,
                p.display_name,
                p.primary_name,
                pa.address_id AS linked_address_id,
                ST_Distance(
                    COALESCE(
                        NULLIF(p.point_geom, ST_GeomFromText('POINT EMPTY', 4326)),
                        ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
                    )::geography,
                    click.geom::geography
                ) AS distance_m
            FROM core.core_places AS p
            CROSS JOIN click
            ${paJoin}
            WHERE p.deleted_at IS NULL
              AND p.lat IS NOT NULL
              AND p.lng IS NOT NULL
              AND ST_DWithin(
                  COALESCE(
                      NULLIF(p.point_geom, ST_GeomFromText('POINT EMPTY', 4326)),
                      ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
                  )::geography,
                  click.geom::geography,
                  ${REVERSE_PLACE_MAX_M}
              )
            ORDER BY distance_m ASC
            LIMIT ${REVERSE_CANDIDATE_LIMIT}
        `;
    }

    async findNearbyStreets(point: ClickPoint, maxDistanceM: number): Promise<NearbyStreetRow[]> {
        if (!(await this.tableExists("core.core_streets"))) {
            return [];
        }
        const click = this.clickSql(point);
        return this.prisma.$queryRaw<NearbyStreetRow[]>`
            WITH click AS (SELECT ${click}::geometry(Point, 4326) AS geom)
            SELECT
                s.id,
                s.public_id::text AS public_id,
                s.canonical_name,
                sn_en.name AS name_en,
                sn_my.name AS name_my,
                sn_und.name AS name_und,
                ST_Distance(s.geom::geography, click.geom::geography) AS distance_m
            FROM core.core_streets AS s
            CROSS JOIN click
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_street_names AS n
                WHERE n.street_id = s.id AND lower(trim(coalesce(n.language_code, ''))) = 'und'
                ORDER BY n.is_primary DESC NULLS LAST LIMIT 1
            ) AS sn_und ON true
            ${STREET_NAME_EN}
            ${STREET_NAME_MY}
            WHERE s.deleted_at IS NULL
              AND s.geom IS NOT NULL
              AND NOT ST_IsEmpty(s.geom)
              AND ST_DWithin(s.geom::geography, click.geom::geography, ${maxDistanceM})
            ORDER BY distance_m ASC
            LIMIT ${REVERSE_CANDIDATE_LIMIT}
        `;
    }

    async findAdminAreasAtPoint(point: ClickPoint): Promise<AdminAreaAtPointRow[]> {
        if (!(await this.tableExists("core.core_admin_areas"))) {
            return [];
        }
        const click = this.clickSql(point);
        return this.prisma.$queryRaw<AdminAreaAtPointRow[]>`
            WITH click AS (SELECT ${click}::geometry(Point, 4326) AS geom)
            SELECT
                aa.id,
                aa.canonical_name,
                an_en.name AS name_en,
                an_my.name AS name_my,
                al.code AS admin_level_code,
                al.rank AS admin_level_rank,
                aa.boundary_status,
                aa.address_usage,
                aa.boundary_confidence_score::float8 AS boundary_confidence_score,
                ST_Area(aa.geom::geography) AS area_m2,
                CASE
                    WHEN aa.address_usage = 'official'
                         AND aa.boundary_status IN ('official', 'surveyed')
                        THEN 'point_in_polygon_official'
                    WHEN aa.address_usage = 'locality_hint'
                         AND aa.boundary_status IN ('approximate', 'settlement_extent')
                        THEN 'point_in_polygon_locality_hint'
                    ELSE 'point_in_polygon_other'
                END AS match_type
            FROM core.core_admin_areas AS aa
            CROSS JOIN click
            INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
            ${ADMIN_NAME_EN}
            ${ADMIN_NAME_MY}
            WHERE aa.geom IS NOT NULL
              AND NOT ST_IsEmpty(aa.geom)
              AND aa.is_active IS TRUE
              AND aa.deleted_at IS NULL
              AND aa.address_usage NOT IN ('search_only', 'disabled')
              AND (ST_Covers(aa.geom, click.geom) OR ST_Intersects(aa.geom, click.geom))
            ORDER BY
                CASE
                    WHEN aa.address_usage = 'official'
                         AND aa.boundary_status IN ('official', 'surveyed') THEN 1
                    WHEN aa.address_usage = 'locality_hint' THEN 2
                    ELSE 3
                END,
                al.rank ASC,
                area_m2 ASC NULLS LAST
            LIMIT ${REVERSE_CANDIDATE_LIMIT}
        `;
    }

    async findNearestVillageHint(point: ClickPoint): Promise<AdminAreaAtPointRow | null> {
        if (!(await this.tableExists("core.core_admin_areas"))) {
            return null;
        }
        const click = this.clickSql(point);
        const rows = await this.prisma.$queryRaw<AdminAreaAtPointRow[]>`
            WITH click AS (SELECT ${click}::geometry(Point, 4326) AS geom)
            SELECT
                aa.id,
                aa.canonical_name,
                an_en.name AS name_en,
                an_my.name AS name_my,
                al.code AS admin_level_code,
                al.rank AS admin_level_rank,
                aa.boundary_status,
                aa.address_usage,
                aa.boundary_confidence_score::float8 AS boundary_confidence_score,
                NULL::double precision AS area_m2,
                'nearest_centroid_hint'::text AS match_type
            FROM core.core_admin_areas AS aa
            CROSS JOIN click
            INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
            ${ADMIN_NAME_EN}
            ${ADMIN_NAME_MY}
            WHERE al.code = 'village'
              AND aa.centroid IS NOT NULL
              AND NOT ST_IsEmpty(aa.centroid)
              AND aa.is_active IS TRUE
              AND aa.deleted_at IS NULL
              AND aa.address_usage = 'locality_hint'
              AND aa.boundary_status IN ('approximate', 'settlement_extent')
              AND ST_DWithin(aa.centroid::geography, click.geom::geography, ${REVERSE_VILLAGE_HINT_MAX_M})
            ORDER BY ST_Distance(aa.centroid::geography, click.geom::geography) ASC
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async findLanduseAtPoint(point: ClickPoint): Promise<LanduseAtPointRow | null> {
        if (!(await this.tableExists("core.core_map_landuse"))) {
            return null;
        }
        const click = this.clickSql(point);
        const rows = await this.prisma.$queryRaw<LanduseAtPointRow[]>`
            WITH click AS (SELECT ${click}::geometry(Point, 4326) AS geom)
            SELECT
                lu.id,
                lu.public_id::text AS public_id,
                lu.name,
                lc.code AS class_code,
                lc.name AS class_name
            FROM core.core_map_landuse AS lu
            CROSS JOIN click
            LEFT JOIN ref.ref_landuse_classes AS lc ON lc.id = lu.landuse_class_id
            WHERE lu.deleted_at IS NULL
              AND lu.geom IS NOT NULL
              AND NOT ST_IsEmpty(lu.geom)
              AND ST_Intersects(lu.geom, click.geom)
            ORDER BY ST_Area(lu.geom::geography) ASC
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async listAddressComponents(addressId: bigint): Promise<CoreAddressComponentDbRow[]> {
        if (!(await this.tableExists("core.core_address_components"))) {
            return [];
        }
        return this.prisma.$queryRaw<CoreAddressComponentDbRow[]>`
            SELECT
                c.id,
                coalesce(c.component_type_code, rt.code) AS component_type_code,
                c.component_value,
                coalesce(c.language_code, 'und') AS language_code,
                c.sort_order,
                c.confidence_score,
                c.match_type,
                c.source_admin_area_id,
                c.boundary_status,
                c.address_usage
            FROM core.core_address_components AS c
            LEFT JOIN ref.ref_address_component_types AS rt ON rt.id = c.component_type_id
            WHERE c.address_id = ${addressId}
            ORDER BY coalesce(c.sort_order, 100) ASC, c.id ASC
        `;
    }

    async loadAddressHeader(addressId: bigint): Promise<{ id: bigint; public_id: string } | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint; public_id: string }>>`
            SELECT id, public_id::text AS public_id
            FROM core.core_addresses
            WHERE id = ${addressId} AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0] ?? null;
    }
}
