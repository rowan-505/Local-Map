import { Prisma, type PrismaClient } from "@prisma/client";

type ListPublicPlacesParams = {
    q?: string;
    category?: string;
    categoryId?: bigint;
    limit: number;
};

type SearchPublicMapParams = {
    q: string;
    limit: number;
};

/** Kyauktan operational bbox (4326); keep aligned with apps/web REGION_SCOPE. */
const PUBLIC_MAP_BOUNDS_ENVELOPE_SQL = Prisma.sql`ST_MakeEnvelope(96.12, 16.48, 96.52, 16.78, 4326)`;

export type PublicMapGeoLabelRow = {
    id: string;
    canonical_name: string | null;
    /** Optional richer fallbacks — bus routes may omit and rely only on multilingual + canonical fields. */
    display_name?: string | null;
    primary_name?: string | null;
    name_mm: string | null;
    name_en: string | null;
    /** Parsed GeoJSON Geometry from Postgres json */
    geom: unknown;
    /** Hint for symbol-spacing: denser repeats on corridors / bus routes (`true`), looser on small streets (`false`). */
    label_dense?: boolean | null;
};

export type PublicPlaceRow = {
    id: bigint;
    public_id: string;
    display_name: string | null;
    primary_name: string | null;
    name_mm: string | null;
    name_en: string | null;
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
    name_mm: string | null;
    name_en: string | null;
    display_name: string | null;
    primary_name: string | null;
    canonical_name: string | null;
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
                name_mm.name AS name_mm,
                name_en.name AS name_en,
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
            LEFT JOIN LATERAL (
                SELECT pn.name
                FROM core.core_place_names AS pn
                WHERE pn.place_id = p.id
                  AND (
                      pn.language_code IN ('my', 'mm')
                      OR upper(trim(coalesce(pn.script_code, ''))) = 'MYMR'
                  )
                ORDER BY
                    CASE
                        WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
                        WHEN pn.is_primary = true THEN 2
                        WHEN pn.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    pn.search_weight DESC NULLS LAST,
                    pn.name ASC
                LIMIT 1
            ) AS name_mm ON true
            LEFT JOIN LATERAL (
                SELECT pn.name
                FROM core.core_place_names AS pn
                WHERE pn.place_id = p.id
                  AND (
                      pn.language_code = 'en'
                      OR upper(trim(coalesce(pn.script_code, ''))) = 'LATN'
                  )
                ORDER BY
                    CASE
                        WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
                        WHEN pn.is_primary = true THEN 2
                        WHEN pn.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    pn.search_weight DESC NULLS LAST,
                    pn.name ASC
                LIMIT 1
            ) AS name_en ON true
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
                name_mm.name AS name_mm,
                name_en.name AS name_en,
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
            LEFT JOIN LATERAL (
                SELECT pn.name
                FROM core.core_place_names AS pn
                WHERE pn.place_id = p.id
                  AND (
                      pn.language_code IN ('my', 'mm')
                      OR upper(trim(coalesce(pn.script_code, ''))) = 'MYMR'
                  )
                ORDER BY
                    CASE
                        WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
                        WHEN pn.is_primary = true THEN 2
                        WHEN pn.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    pn.search_weight DESC NULLS LAST,
                    pn.name ASC
                LIMIT 1
            ) AS name_mm ON true
            LEFT JOIN LATERAL (
                SELECT pn.name
                FROM core.core_place_names AS pn
                WHERE pn.place_id = p.id
                  AND (
                      pn.language_code = 'en'
                      OR upper(trim(coalesce(pn.script_code, ''))) = 'LATN'
                  )
                ORDER BY
                    CASE
                        WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
                        WHEN pn.is_primary = true THEN 2
                        WHEN pn.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    pn.search_weight DESC NULLS LAST,
                    pn.name ASC
                LIMIT 1
            ) AS name_en ON true
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
                parentId: null,
                isPublic: true,
                isSearchable: true,
            },
            select: {
                id: true,
                code: true,
                name: true,
                sortOrder: true,
            },
            orderBy: [
                { sortOrder: "asc" },
                { name: "asc" },
            ],
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

    async listStreetGeoLabels(): Promise<PublicMapGeoLabelRow[]> {
        return this.prisma.$queryRaw<PublicMapGeoLabelRow[]>(Prisma.sql`
            SELECT
                s.public_id::text AS id,
                s.canonical_name AS canonical_name,
                NULL::text AS display_name,
                NULL::text AS primary_name,
                sn_mm.name AS name_mm,
                sn_en.name AS name_en,
                (
                    COALESCE(ST_Length(s.geom::geography), 0)::double precision >= 380
                ) AS label_dense,
                ST_AsGeoJSON(s.geom)::json AS geom
            FROM core.core_streets AS s
            LEFT JOIN LATERAL (
                SELECT sn.name
                FROM core.core_street_names AS sn
                WHERE sn.street_id = s.id
                  AND (
                      sn.language_code IN ('my', 'mm')
                      OR upper(trim(coalesce(sn.script_code, ''))) = 'MYMR'
                  )
                ORDER BY
                    CASE
                        WHEN sn.name_type = 'official' AND sn.is_primary = true THEN 1
                        WHEN sn.is_primary = true THEN 2
                        WHEN sn.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    sn.name ASC
                LIMIT 1
            ) AS sn_mm ON true
            LEFT JOIN LATERAL (
                SELECT sn.name
                FROM core.core_street_names AS sn
                WHERE sn.street_id = s.id
                  AND (
                      sn.language_code = 'en'
                      OR upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
                  )
                ORDER BY
                    CASE
                        WHEN sn.name_type = 'official' AND sn.is_primary = true THEN 1
                        WHEN sn.is_primary = true THEN 2
                        WHEN sn.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    sn.name ASC
                LIMIT 1
            ) AS sn_en ON true
            WHERE s.is_active = true
              AND ST_Intersects(s.geom, ${PUBLIC_MAP_BOUNDS_ENVELOPE_SQL})
            ORDER BY s.canonical_name ASC
            LIMIT 3000
        `);
    }

    async listAdminAreaGeoLabels(): Promise<PublicMapGeoLabelRow[]> {
        return this.prisma.$queryRaw<PublicMapGeoLabelRow[]>(Prisma.sql`
            SELECT
                a.public_id::text AS id,
                a.canonical_name AS canonical_name,
                NULL::text AS display_name,
                NULL::text AS primary_name,
                an_mm.name AS name_mm,
                an_en.name AS name_en,
                ST_AsGeoJSON(a.centroid)::json AS geom
            FROM core.core_admin_areas AS a
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      n.language_code IN ('my', 'mm')
                      OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                  )
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.search_weight DESC NULLS LAST,
                    n.name ASC
                LIMIT 1
            ) AS an_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      n.language_code = 'en'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
                  )
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.search_weight DESC NULLS LAST,
                    n.name ASC
                LIMIT 1
            ) AS an_en ON true
            WHERE a.is_active = true
              AND ST_Intersects(a.geom, ${PUBLIC_MAP_BOUNDS_ENVELOPE_SQL})
            ORDER BY a.canonical_name ASC
            LIMIT 500
        `);
    }

    async listBusStopGeoLabels(): Promise<PublicMapGeoLabelRow[]> {
        return this.prisma.$queryRaw<PublicMapGeoLabelRow[]>(Prisma.sql`
            SELECT
                b.public_id::text AS id,
                b.name AS canonical_name,
                NULL::text AS display_name,
                NULL::text AS primary_name,
                bn_mm.name AS name_mm,
                bn_en.name AS name_en,
                ST_AsGeoJSON(b.geom)::json AS geom
            FROM core.core_bus_stops AS b
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_bus_stop_names AS n
                WHERE n.stop_id = b.id
                  AND lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.name ASC
                LIMIT 1
            ) AS bn_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_bus_stop_names AS n
                WHERE n.stop_id = b.id
                  AND lower(trim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.name ASC
                LIMIT 1
            ) AS bn_en ON true
            WHERE b.is_active = true
              AND ST_Intersects(b.geom, ${PUBLIC_MAP_BOUNDS_ENVELOPE_SQL})
            ORDER BY b.name ASC
            LIMIT 2000
        `);
    }

    async listBusRouteGeoLabels(): Promise<PublicMapGeoLabelRow[]> {
        return this.prisma.$queryRaw<PublicMapGeoLabelRow[]>(Prisma.sql`
            SELECT
                v.id::text AS id,
                COALESCE(
                    CASE WHEN trim(r.public_name) = '' THEN NULL ELSE trim(r.public_name) END,
                    r.route_code
                ) AS canonical_name,
                NULL::text AS display_name,
                NULL::text AS primary_name,
                rn_mm.name AS name_mm,
                rn_en.name AS name_en,
                true AS label_dense,
                ST_AsGeoJSON(v.geom)::json AS geom
            FROM core.core_bus_route_variants AS v
            INNER JOIN core.core_bus_routes AS r ON r.id = v.route_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_bus_route_names AS n
                WHERE n.route_id = r.id
                  AND lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.name ASC
                LIMIT 1
            ) AS rn_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_bus_route_names AS n
                WHERE n.route_id = r.id
                  AND lower(trim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.name ASC
                LIMIT 1
            ) AS rn_en ON true
            WHERE v.is_active = true
              AND r.is_active = true
              AND ST_Intersects(v.geom, ${PUBLIC_MAP_BOUNDS_ENVELOPE_SQL})
            ORDER BY r.route_code ASC, v.variant_code ASC
            LIMIT 500
        `);
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

    const categoryCode = params.category?.trim();

    if (categoryCode && categoryCode !== "all") {
        conditions.push(Prisma.sql`p.category_id IN (
            WITH RECURSIVE category_tree AS (
                SELECT id
                FROM ref.ref_poi_categories
                WHERE code = ${categoryCode}

                UNION ALL

                SELECT child.id
                FROM ref.ref_poi_categories AS child
                INNER JOIN category_tree AS parent
                    ON child.parent_id = parent.id
            )
            SELECT id FROM category_tree
        )`);
    } else if (params.categoryId !== undefined) {
        conditions.push(Prisma.sql`p.category_id = ${params.categoryId}`);
    }

    return conditions;
}

function buildSearchWithStreetNamesQuery(params: SearchPublicMapParams) {
    return buildSearchQuery(
        params,
        Prisma.sql`
            ${localizedNameJoin("core.core_street_names", "sn", "sn.street_id = s.id", "sn_mm", "my", {
                hasSearchWeight: false,
            })}
            ${localizedNameJoin("core.core_street_names", "sn", "sn.street_id = s.id", "sn_en", "en", {
                hasSearchWeight: false,
            })}
        `,
        Prisma.sql`
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
        `,
        Prisma.sql`
            OR sn.name IS NOT NULL
        `,
        Prisma.sql`
            WHEN lower(sn.name) = ${normalizedSearchTerm(params.q)} THEN 1
            WHEN lower(sn.name) LIKE ${prefixSearchTerm(params.q)} THEN 2
        `
    );
}

function buildSearchWithoutStreetNamesQuery(params: SearchPublicMapParams) {
    return buildSearchQuery(
        params,
        Prisma.sql`
            LEFT JOIN LATERAL (SELECT NULL::text AS name) AS sn_mm ON true
            LEFT JOIN LATERAL (SELECT NULL::text AS name) AS sn_en ON true
        `,
        Prisma.empty,
        Prisma.empty,
        Prisma.empty
    );
}

function buildSearchQuery(
    params: SearchPublicMapParams,
    streetLocalizedNamesJoin: Prisma.Sql,
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
                COALESCE(NULLIF(p.display_name, ''), p.primary_name, 'Unnamed') AS name,
                place_name_mm.name AS name_mm,
                place_name_en.name AS name_en,
                p.display_name,
                p.primary_name,
                NULL::text AS canonical_name,
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
            ${localizedNameJoin("core.core_place_names", "pn", "pn.place_id = p.id", "place_name_mm", "my")}
            ${localizedNameJoin("core.core_place_names", "pn", "pn.place_id = p.id", "place_name_en", "en")}
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
                COALESCE(s.canonical_name, 'Unnamed') AS name,
                sn_mm.name AS name_mm,
                sn_en.name AS name_en,
                NULL::text AS display_name,
                NULL::text AS primary_name,
                s.canonical_name,
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
            ${streetLocalizedNamesJoin}
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

function localizedNameJoin(
    tableName: string,
    tableAlias: string,
    ownerCondition: string,
    joinAlias: string,
    lang: "my" | "en",
    options: { hasSearchWeight?: boolean } = {}
) {
    const languageCondition =
        lang === "my"
            ? Prisma.sql`(${Prisma.raw(tableAlias)}.language_code IN ('my', 'mm') OR upper(trim(coalesce(${Prisma.raw(tableAlias)}.script_code, ''))) = 'MYMR')`
            : Prisma.sql`(${Prisma.raw(tableAlias)}.language_code = 'en' OR upper(trim(coalesce(${Prisma.raw(tableAlias)}.script_code, ''))) = 'LATN')`;

    return Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT ${Prisma.raw(tableAlias)}.name
            FROM ${Prisma.raw(tableName)} AS ${Prisma.raw(tableAlias)}
            WHERE ${Prisma.raw(ownerCondition)}
              AND ${languageCondition}
            ORDER BY
                CASE
                    WHEN ${Prisma.raw(tableAlias)}.name_type = 'official'
                      AND ${Prisma.raw(tableAlias)}.is_primary = true THEN 1
                    WHEN ${Prisma.raw(tableAlias)}.is_primary = true THEN 2
                    WHEN ${Prisma.raw(tableAlias)}.name_type = 'official' THEN 3
                    ELSE 4
                END,
                ${localizedNameWeightOrder(tableAlias, options)}
                ${Prisma.raw(tableAlias)}.name ASC
            LIMIT 1
        ) AS ${Prisma.raw(joinAlias)} ON true
    `;
}

function localizedNameWeightOrder(tableAlias: string, options: { hasSearchWeight?: boolean }) {
    return options.hasSearchWeight === false
        ? Prisma.empty
        : Prisma.sql`${Prisma.raw(tableAlias)}.search_weight DESC NULLS LAST,`;
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
