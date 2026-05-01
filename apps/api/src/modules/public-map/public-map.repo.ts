import { Prisma, type PrismaClient } from "@prisma/client";

type ListPublicPlacesParams = {
    q?: string;
    categoryId?: bigint;
    limit: number;
};

type SearchPublicMapParams = {
    q: string;
    limit: number;
};

export type PublicPlaceRow = {
    id: bigint;
    public_id: string;
    display_name: string;
    primary_name: string;
    category_id: bigint;
    category_code: string | null;
    category_name: string | null;
    lat: number;
    lng: number;
    importance_score: number | null;
    is_verified: boolean;
};

export type PublicCategoryRow = {
    id: bigint;
    code: string;
    name: string;
    sortOrder: number;
};

export type PublicSearchRow = {
    id: string;
    result_type: "place" | "street";
    name: string;
    subtitle: string | null;
    category_name: string | null;
    lat: number;
    lng: number;
    importance_score: number | null;
    rank: number;
    min_lng: number | null;
    min_lat: number | null;
    max_lng: number | null;
    max_lat: number | null;
};

export class PublicMapRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listPlaces(params: ListPublicPlacesParams): Promise<PublicPlaceRow[]> {
        const conditions = buildPublicPlaceConditions(params);

        return this.prisma.$queryRaw<PublicPlaceRow[]>(Prisma.sql`
            SELECT
                p.id,
                p.public_id,
                p.display_name,
                p.primary_name,
                p.category_id,
                c.code AS category_code,
                c.name AS category_name,
                p.lat,
                p.lng,
                p.importance_score::double precision AS importance_score,
                p.is_verified
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            WHERE ${Prisma.join(conditions, " AND ")}
            ORDER BY p.importance_score DESC, p.display_name ASC, p.public_id ASC
            LIMIT ${params.limit}
        `);
    }

    async getPlaceByPublicId(publicId: string): Promise<PublicPlaceRow | null> {
        const rows = await this.prisma.$queryRaw<PublicPlaceRow[]>(Prisma.sql`
            SELECT
                p.id,
                p.public_id,
                p.display_name,
                p.primary_name,
                p.category_id,
                c.code AS category_code,
                c.name AS category_name,
                p.lat,
                p.lng,
                p.importance_score::double precision AS importance_score,
                p.is_verified
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            WHERE p.public_id = CAST(${publicId} AS uuid)
              AND p.deleted_at IS NULL
              AND p.is_public = true
              AND p.lat IS NOT NULL
              AND p.lng IS NOT NULL
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async listCategories(): Promise<PublicCategoryRow[]> {
        return this.prisma.refPoiCategory.findMany({
            where: {
                isPublic: true,
                isSearchable: true,
            },
            select: {
                id: true,
                code: true,
                name: true,
                sortOrder: true,
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });
    }

    async search(params: SearchPublicMapParams): Promise<PublicSearchRow[]> {
        const streetNamesAvailable = await this.hasStreetNamesTable();
        const query = streetNamesAvailable
            ? buildSearchWithStreetNamesQuery(params)
            : buildSearchWithoutStreetNamesQuery(params);

        return this.prisma.$queryRaw<PublicSearchRow[]>(query);
    }

    private async hasStreetNamesTable() {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
            SELECT to_regclass('core.core_street_names') IS NOT NULL AS "exists"
        `);

        return rows[0]?.exists ?? false;
    }
}

function buildPublicPlaceConditions(params: ListPublicPlacesParams) {
    const conditions: Prisma.Sql[] = [
        Prisma.sql`p.deleted_at IS NULL`,
        Prisma.sql`p.is_public = true`,
        Prisma.sql`p.lat IS NOT NULL`,
        Prisma.sql`p.lng IS NOT NULL`,
    ];

    if (params.q) {
        const searchTerm = `%${params.q}%`;
        conditions.push(Prisma.sql`(
            p.display_name ILIKE ${searchTerm}
            OR p.primary_name ILIKE ${searchTerm}
            OR EXISTS (
                SELECT 1
                FROM core.core_place_names AS pn
                WHERE pn.place_id = p.id
                  AND pn.name ILIKE ${searchTerm}
            )
        )`);
    }

    if (params.categoryId !== undefined) {
        conditions.push(Prisma.sql`p.category_id = ${params.categoryId}`);
    }

    return conditions;
}

function buildSearchWithStreetNamesQuery(params: SearchPublicMapParams) {
    return buildSearchQuery(params, Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT n.name
            FROM core.core_street_names AS n
            WHERE n.street_id = s.id
              AND n.name ILIKE ${partialSearchTerm(params.q)}
            ORDER BY
                CASE
                    WHEN lower(n.name) = ${normalizedSearchTerm(params.q)} THEN 1
                    WHEN lower(n.name) LIKE ${prefixSearchTerm(params.q)} THEN 2
                    ELSE 3
                END,
                n.is_primary DESC,
                n.name ASC
            LIMIT 1
        ) AS sn ON true
    `, Prisma.sql`
        OR sn.name IS NOT NULL
    `, Prisma.sql`
        WHEN lower(sn.name) = ${normalizedSearchTerm(params.q)} THEN 1
        WHEN lower(sn.name) LIKE ${prefixSearchTerm(params.q)} THEN 2
    `);
}

function buildSearchWithoutStreetNamesQuery(params: SearchPublicMapParams) {
    return buildSearchQuery(params, Prisma.empty, Prisma.empty, Prisma.empty);
}

function buildSearchQuery(
    params: SearchPublicMapParams,
    streetNamesJoin: Prisma.Sql,
    streetNamesWhere: Prisma.Sql,
    streetNamesRank: Prisma.Sql
) {
    const normalizedTerm = normalizedSearchTerm(params.q);
    const prefixTerm = prefixSearchTerm(params.q);
    const partialTerm = partialSearchTerm(params.q);

    return Prisma.sql`
        WITH place_results AS (
            SELECT
                p.public_id::text AS id,
                'place'::text AS result_type,
                COALESCE(NULLIF(p.display_name, ''), p.primary_name) AS name,
                c.name AS subtitle,
                c.name AS category_name,
                p.lat,
                p.lng,
                p.importance_score::double precision AS importance_score,
                CASE
                    WHEN lower(p.display_name) = ${normalizedTerm}
                      OR lower(p.primary_name) = ${normalizedTerm}
                      OR lower(COALESCE(place_name_match.name, '')) = ${normalizedTerm}
                    THEN 1
                    WHEN lower(p.display_name) LIKE ${prefixTerm}
                      OR lower(p.primary_name) LIKE ${prefixTerm}
                      OR lower(COALESCE(place_name_match.name, '')) LIKE ${prefixTerm}
                    THEN 2
                    ELSE 3
                END AS rank,
                NULL::double precision AS min_lng,
                NULL::double precision AS min_lat,
                NULL::double precision AS max_lng,
                NULL::double precision AS max_lat
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            LEFT JOIN LATERAL (
                SELECT pn.name
                FROM core.core_place_names AS pn
                WHERE pn.place_id = p.id
                  AND pn.name ILIKE ${partialTerm}
                ORDER BY
                    CASE
                        WHEN lower(pn.name) = ${normalizedTerm} THEN 1
                        WHEN lower(pn.name) LIKE ${prefixTerm} THEN 2
                        ELSE 3
                    END,
                    pn.is_primary DESC,
                    pn.search_weight DESC,
                    pn.name ASC
                LIMIT 1
            ) AS place_name_match ON true
            WHERE p.deleted_at IS NULL
              AND p.is_public = true
              AND p.lat IS NOT NULL
              AND p.lng IS NOT NULL
              AND (
                  p.display_name ILIKE ${partialTerm}
                  OR p.primary_name ILIKE ${partialTerm}
                  OR place_name_match.name IS NOT NULL
              )
        ),
        street_results AS (
            SELECT
                s.public_id::text AS id,
                'street'::text AS result_type,
                s.canonical_name AS name,
                'Street'::text AS subtitle,
                NULL::text AS category_name,
                ST_Y(ST_PointOnSurface(ST_Transform(s.geom, 4326))) AS lat,
                ST_X(ST_PointOnSurface(ST_Transform(s.geom, 4326))) AS lng,
                NULL::double precision AS importance_score,
                CASE
                    WHEN lower(s.canonical_name) = ${normalizedTerm} THEN 1
                    ${streetNamesRank}
                    WHEN lower(s.canonical_name) LIKE ${prefixTerm} THEN 2
                    ELSE 3
                END AS rank,
                ST_XMin(Box2D(ST_Transform(s.geom, 4326)))::double precision AS min_lng,
                ST_YMin(Box2D(ST_Transform(s.geom, 4326)))::double precision AS min_lat,
                ST_XMax(Box2D(ST_Transform(s.geom, 4326)))::double precision AS max_lng,
                ST_YMax(Box2D(ST_Transform(s.geom, 4326)))::double precision AS max_lat
            FROM core.core_streets AS s
            ${streetNamesJoin}
            WHERE s.geom IS NOT NULL
              AND s.is_active = true
              AND (
                  s.canonical_name ILIKE ${partialTerm}
                  ${streetNamesWhere}
              )
        )
        SELECT *
        FROM (
            SELECT * FROM place_results
            UNION ALL
            SELECT * FROM street_results
        ) AS results
        ORDER BY
            rank ASC,
            CASE WHEN result_type = 'place' THEN 0 ELSE 1 END ASC,
            importance_score DESC NULLS LAST,
            name ASC
        LIMIT ${params.limit}
    `;
}

function normalizedSearchTerm(term: string) {
    return term.trim().toLowerCase();
}

function prefixSearchTerm(term: string) {
    return `${normalizedSearchTerm(term)}%`;
}

function partialSearchTerm(term: string) {
    return `%${term.trim()}%`;
}
