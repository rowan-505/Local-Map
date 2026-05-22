import { Prisma, type PrismaClient } from "@prisma/client";

export type AddressCandidateMatchContextRow = {
    id: bigint;
    has_point_geom: boolean;
    point_wkt: string | null;
    lat: number | null;
    lng: number | null;
    source_tags: unknown;
    normalized_data: unknown;
    source_refs: unknown;
    matched_admin_area_id: bigint | null;
    matched_street_id: bigint | null;
    matched_building_id: bigint | null;
    matched_place_id: bigint | null;
};

export type BuildingOptionRowDb = {
    id: bigint;
    label: string;
    building_type: string | null;
    distance_m: number;
    match_method: string;
};

export type PlaceOptionRowDb = {
    id: bigint;
    display_name: string;
    name_en: string | null;
    name_my: string | null;
    category: string | null;
    distance_m: number;
};

export type NearbyStreetRowDb = {
    id: bigint;
    canonical_name: string;
    name_en: string | null;
    name_my: string | null;
    name_und: string | null;
    admin_area_id: bigint | null;
    distance_m: number;
};

export type AdminAreaOptionRowDb = {
    id: bigint;
    canonical_name: string;
    name_en: string | null;
    name_my: string | null;
    admin_level_code: string;
    boundary_status: string | null;
    address_usage: string | null;
    distance_m: number | null;
    match_score: number;
    match_method: string;
};

export type PostcodeOptionRowDb = {
    value: string;
    language_code: string | null;
    source: string;
};

const streetNameEnLateral = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_street_names AS n
        WHERE n.street_id = s.id
          AND lower(trim(coalesce(n.name_type, ''))) <> 'generated'
          AND (
              lower(trim(coalesce(n.language_code, ''))) = 'en'
              OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
          )
          AND btrim(coalesce(n.name, '')) <> ''
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                WHEN n.is_primary = true THEN 2
                WHEN n.name_type = 'official' THEN 3
                ELSE 4
            END,
            n.name ASC
        LIMIT 1
    ) AS sn_en ON true
`;

const streetNameMyLateral = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_street_names AS n
        WHERE n.street_id = s.id
          AND lower(trim(coalesce(n.name_type, ''))) <> 'generated'
          AND (
              lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
              OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
          )
          AND btrim(coalesce(n.name, '')) <> ''
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                WHEN n.is_primary = true THEN 2
                WHEN n.name_type = 'official' THEN 3
                ELSE 4
            END,
            n.name ASC
        LIMIT 1
    ) AS sn_my ON true
`;

const streetNameUndLateral = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_street_names AS n
        WHERE n.street_id = s.id
          AND lower(trim(coalesce(n.name_type, ''))) <> 'generated'
          AND lower(trim(coalesce(n.language_code, ''))) = 'und'
          AND btrim(coalesce(n.name, '')) <> ''
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS sn_und ON true
`;

export class ImportReviewAddressMatchesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async getCandidateContext(candidateId: bigint): Promise<AddressCandidateMatchContextRow | null> {
        const rows = await this.prisma.$queryRaw<AddressCandidateMatchContextRow[]>`
            SELECT
                c.id,
                (
                    c.point_geom IS NOT NULL
                    AND NOT ST_IsEmpty(c.point_geom)
                ) AS has_point_geom,
                CASE
                    WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                        THEN ST_AsText(c.point_geom)
                    ELSE NULL
                END AS point_wkt,
                CASE
                    WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                        THEN ST_Y(c.point_geom)::float8
                    ELSE NULL
                END AS lat,
                CASE
                    WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                        THEN ST_X(c.point_geom)::float8
                    ELSE NULL
                END AS lng,
                COALESCE(to_jsonb(c.source_tags), '{}'::jsonb) AS source_tags,
                COALESCE(to_jsonb(c.normalized_data), '{}'::jsonb) AS normalized_data,
                COALESCE(to_jsonb(c.source_refs), '{}'::jsonb) AS source_refs,
                c.matched_admin_area_id,
                c.matched_street_id,
                c.matched_building_id,
                c.matched_place_id
            FROM import_review.address_candidates AS c
            WHERE c.id = ${candidateId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async listStreetSourceTexts(candidateId: bigint): Promise<string[]> {
        const rows = await this.prisma.$queryRaw<Array<{ component_value: string }>>`
            SELECT DISTINCT btrim(ac.component_value) AS component_value
            FROM import_review.address_components AS ac
            WHERE ac.address_candidate_id = ${candidateId}
              AND ac.is_deleted = false
              AND ac.component_type_code IN ('street', 'road')
              AND ac.language_code IN ('en', 'my', 'und')
              AND btrim(ac.component_value) <> ''
        `;
        return rows.map((r) => r.component_value);
    }

    async listNearbyStreets(args: {
        candidateId: bigint;
        radiusM: number;
        limit: number;
    }): Promise<NearbyStreetRowDb[]> {
        return this.prisma.$queryRaw<NearbyStreetRowDb[]>`
            WITH candidate AS (
                SELECT c.point_geom
                FROM import_review.address_candidates AS c
                WHERE c.id = ${args.candidateId}
                  AND c.point_geom IS NOT NULL
                  AND NOT ST_IsEmpty(c.point_geom)
            )
            SELECT
                s.id,
                s.canonical_name,
                sn_en.name AS name_en,
                sn_my.name AS name_my,
                sn_und.name AS name_und,
                s.admin_area_id,
                ST_Distance(s.geom::geography, candidate.point_geom::geography)::float8 AS distance_m
            FROM core.core_streets AS s
            CROSS JOIN candidate
            ${streetNameEnLateral}
            ${streetNameMyLateral}
            ${streetNameUndLateral}
            WHERE s.deleted_at IS NULL
              AND s.is_active IS TRUE
              AND s.geom IS NOT NULL
              AND NOT ST_IsEmpty(s.geom)
              AND ST_DWithin(
                  s.geom::geography,
                  candidate.point_geom::geography,
                  ${args.radiusM}
              )
            ORDER BY distance_m ASC
            LIMIT ${args.limit}
        `;
    }

    async listAdminAreaOptions(args: {
        candidateId: bigint;
        matchedAdminAreaId: bigint | null;
        limit: number;
    }): Promise<AdminAreaOptionRowDb[]> {
        return this.prisma.$queryRaw<AdminAreaOptionRowDb[]>`
            WITH candidate AS (
                SELECT c.point_geom
                FROM import_review.address_candidates AS c
                WHERE c.id = ${args.candidateId}
                  AND c.point_geom IS NOT NULL
                  AND NOT ST_IsEmpty(c.point_geom)
            ),
            point_input AS (
                SELECT candidate.point_geom AS geom
                FROM candidate
            ),
            containing AS (
                SELECT
                    aa.id,
                    aa.canonical_name,
                    al.code AS admin_level_code,
                    aa.boundary_status,
                    aa.address_usage,
                    ST_Area(aa.geom::geography) AS area_m2,
                    CASE
                        WHEN aa.address_usage = 'official'
                             AND aa.boundary_status IN ('official', 'surveyed')
                            THEN 'point_in_polygon_official'
                        WHEN aa.address_usage = 'locality_hint'
                             AND aa.boundary_status IN ('approximate', 'settlement_extent')
                            THEN 'point_in_polygon_locality_hint'
                        ELSE 'point_in_polygon'
                    END AS match_method,
                    90 AS match_score
                FROM core.core_admin_areas AS aa
                INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                CROSS JOIN point_input AS p
                WHERE aa.geom IS NOT NULL
                  AND NOT ST_IsEmpty(aa.geom)
                  AND aa.is_active IS TRUE
                  AND aa.deleted_at IS NULL
                  AND aa.address_usage NOT IN ('search_only', 'disabled')
                  AND (
                      ST_Covers(aa.geom, p.geom)
                      OR ST_Intersects(aa.geom, p.geom)
                  )
            ),
            ranked AS (
                SELECT
                    c.*,
                    row_number() OVER (
                        ORDER BY
                            c.match_score DESC,
                            c.area_m2 ASC NULLS LAST,
                            c.id ASC
                    ) AS rn
                FROM containing AS c
            ),
            matched_row AS (
                SELECT
                    aa.id,
                    aa.canonical_name,
                    al.code AS admin_level_code,
                    aa.boundary_status,
                    aa.address_usage,
                    NULL::float8 AS area_m2,
                    'matched_current'::text AS match_method,
                    100 AS match_score
                FROM core.core_admin_areas AS aa
                INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                WHERE ${args.matchedAdminAreaId}::bigint IS NOT NULL
                  AND aa.id = ${args.matchedAdminAreaId}
                  AND aa.is_active IS TRUE
                  AND aa.deleted_at IS NULL
            ),
            combined AS (
                SELECT * FROM matched_row
                UNION ALL
                SELECT
                    r.id,
                    r.canonical_name,
                    r.admin_level_code,
                    r.boundary_status,
                    r.address_usage,
                    r.area_m2,
                    r.match_method,
                    r.match_score
                FROM ranked AS r
                WHERE r.rn <= ${args.limit}
                  AND (
                      ${args.matchedAdminAreaId}::bigint IS NULL
                      OR r.id <> ${args.matchedAdminAreaId}
                  )
            )
            SELECT DISTINCT ON (c.id)
                c.id,
                c.canonical_name,
                an_en.name AS name_en,
                an_mm.name AS name_my,
                c.admin_level_code,
                c.boundary_status,
                c.address_usage,
                NULL::double precision AS distance_m,
                c.match_score,
                c.match_method
            FROM combined AS c
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = c.id
                  AND lower(trim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
                LIMIT 1
            ) AS an_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = c.id
                  AND lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
                ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
                LIMIT 1
            ) AS an_mm ON true
            ORDER BY c.id, c.match_score DESC
            LIMIT ${args.limit}
        `;
    }

    async listPostcodeOptions(candidateId: bigint): Promise<PostcodeOptionRowDb[]> {
        return this.prisma.$queryRaw<PostcodeOptionRowDb[]>`
            SELECT DISTINCT ON (btrim(ac.component_value))
                btrim(ac.component_value) AS value,
                ac.language_code,
                'address_component'::text AS source
            FROM import_review.address_components AS ac
            WHERE ac.address_candidate_id = ${candidateId}
              AND ac.is_deleted = false
              AND ac.component_type_code = 'postcode'
              AND btrim(ac.component_value) <> ''
            ORDER BY btrim(ac.component_value), ac.language_code ASC
        `;
    }

    async getActiveStreetById(streetId: bigint): Promise<{ id: bigint } | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id
            FROM core.core_streets
            WHERE id = ${streetId}
              AND deleted_at IS NULL
              AND is_active IS TRUE
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async getActiveAdminAreaById(adminAreaId: bigint): Promise<{ id: bigint } | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id
            FROM core.core_admin_areas
            WHERE id = ${adminAreaId}
              AND is_active IS TRUE
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async getActiveBuildingById(buildingId: bigint): Promise<{ id: bigint } | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id
            FROM core.core_map_buildings
            WHERE id = ${buildingId}
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async getActivePlaceById(placeId: bigint): Promise<{ id: bigint } | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id
            FROM core.core_places
            WHERE id = ${placeId}
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async listStreetNamesForSync(streetId: bigint): Promise<{
        canonical_name: string;
        name_en: string | null;
        name_my: string | null;
        name_und: string | null;
    } | null> {
        const rows = await this.prisma.$queryRaw<
            Array<{
                canonical_name: string;
                name_en: string | null;
                name_my: string | null;
                name_und: string | null;
            }>
        >`
            SELECT
                s.canonical_name,
                sn_en.name AS name_en,
                sn_my.name AS name_my,
                sn_und.name AS name_und
            FROM core.core_streets AS s
            ${streetNameEnLateral}
            ${streetNameMyLateral}
            ${streetNameUndLateral}
            WHERE s.id = ${streetId}
              AND s.deleted_at IS NULL
              AND s.is_active IS TRUE
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async listBuildingOptions(candidateId: bigint): Promise<BuildingOptionRowDb[]> {
        return this.prisma.$queryRaw<BuildingOptionRowDb[]>`
            WITH candidate AS (
                SELECT c.point_geom
                FROM import_review.address_candidates AS c
                WHERE c.id = ${candidateId}
                  AND c.point_geom IS NOT NULL
                  AND NOT ST_IsEmpty(c.point_geom)
            ),
            containing AS (
                SELECT
                    b.id,
                    COALESCE(
                        NULLIF(btrim(b.name), ''),
                        'Building #' || b.id::text
                    ) AS label,
                    bt.code AS building_type,
                    0::float8 AS distance_m,
                    'point_contains'::text AS match_method
                FROM core.core_map_buildings AS b
                CROSS JOIN candidate
                LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
                WHERE b.deleted_at IS NULL
                  AND b.geom IS NOT NULL
                  AND NOT ST_IsEmpty(b.geom)
                  AND ST_Contains(b.geom, candidate.point_geom)
            ),
            nearby AS (
                SELECT
                    b.id,
                    COALESCE(
                        NULLIF(btrim(b.name), ''),
                        'Building #' || b.id::text
                    ) AS label,
                    bt.code AS building_type,
                    ST_Distance(b.geom::geography, candidate.point_geom::geography)::float8 AS distance_m,
                    'distance_50m'::text AS match_method
                FROM core.core_map_buildings AS b
                CROSS JOIN candidate
                LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
                WHERE b.deleted_at IS NULL
                  AND b.geom IS NOT NULL
                  AND NOT ST_IsEmpty(b.geom)
                  AND ST_DWithin(
                      b.geom::geography,
                      candidate.point_geom::geography,
                      50
                  )
                  AND NOT EXISTS (SELECT 1 FROM containing AS c WHERE c.id = b.id)
            )
            SELECT * FROM containing
            UNION ALL
            SELECT * FROM nearby
            ORDER BY distance_m ASC, id ASC
            LIMIT 25
        `;
    }

    async listPlaceOptions(candidateId: bigint, radiusM: number, limit: number): Promise<PlaceOptionRowDb[]> {
        return this.prisma.$queryRaw<PlaceOptionRowDb[]>`
            WITH candidate AS (
                SELECT c.point_geom
                FROM import_review.address_candidates AS c
                WHERE c.id = ${candidateId}
                  AND c.point_geom IS NOT NULL
                  AND NOT ST_IsEmpty(c.point_geom)
            )
            SELECT
                p.id,
                p.display_name,
                pn_en.name AS name_en,
                pn_my.name AS name_my,
                pc.code AS category,
                ST_Distance(
                    COALESCE(
                        NULLIF(p.point_geom, ST_GeomFromText('POINT EMPTY', 4326)),
                        ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
                    )::geography,
                    candidate.point_geom::geography
                )::float8 AS distance_m
            FROM core.core_places AS p
            CROSS JOIN candidate
            LEFT JOIN ref.ref_poi_categories AS pc ON pc.id = p.category_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_place_names AS n
                WHERE n.place_id = p.id
                  AND lower(trim(coalesce(n.language_code, ''))) = 'en'
                  AND btrim(coalesce(n.name, '')) <> ''
                ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
                LIMIT 1
            ) AS pn_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_place_names AS n
                WHERE n.place_id = p.id
                  AND lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
                  AND btrim(coalesce(n.name, '')) <> ''
                ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
                LIMIT 1
            ) AS pn_my ON true
            WHERE p.deleted_at IS NULL
              AND p.lat IS NOT NULL
              AND p.lng IS NOT NULL
              AND ST_DWithin(
                  COALESCE(
                      NULLIF(p.point_geom, ST_GeomFromText('POINT EMPTY', 4326)),
                      ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
                  )::geography,
                  candidate.point_geom::geography,
                  ${radiusM}
              )
            ORDER BY distance_m ASC
            LIMIT ${limit}
        `;
    }

    async getCandidateMatchMeta(candidateId: bigint): Promise<{
        street_match_type: string | null;
        street_match_confidence: number | null;
    } | null> {
        const rows = await this.prisma.$queryRaw<
            Array<{ street_match_type: string | null; street_match_confidence: unknown }>
        >`
            SELECT street_match_type, street_match_confidence
            FROM import_review.address_candidates
            WHERE id = ${candidateId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return null;
        }
        const conf =
            row.street_match_confidence === null || row.street_match_confidence === undefined
                ? null
                : Number(row.street_match_confidence);
        return {
            street_match_type: row.street_match_type,
            street_match_confidence: Number.isFinite(conf) ? conf : null,
        };
    }

    async updateCandidateMatches(
        candidateId: bigint,
        patch: {
            matched_street_id?: bigint | null;
            matched_admin_area_id?: bigint | null;
            matched_building_id?: bigint | null;
            matched_place_id?: bigint | null;
            street_match_type?: string | null;
            street_match_confidence?: number | null;
        }
    ): Promise<void> {
        const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];

        if ("matched_street_id" in patch) {
            sets.push(Prisma.sql`matched_street_id = ${patch.matched_street_id ?? null}`);
        }
        if ("matched_admin_area_id" in patch) {
            sets.push(Prisma.sql`matched_admin_area_id = ${patch.matched_admin_area_id ?? null}`);
        }
        if ("matched_building_id" in patch) {
            sets.push(Prisma.sql`matched_building_id = ${patch.matched_building_id ?? null}`);
        }
        if ("matched_place_id" in patch) {
            sets.push(Prisma.sql`matched_place_id = ${patch.matched_place_id ?? null}`);
        }
        if ("street_match_type" in patch) {
            sets.push(Prisma.sql`street_match_type = ${patch.street_match_type ?? null}`);
        }
        if ("street_match_confidence" in patch) {
            sets.push(Prisma.sql`street_match_confidence = ${patch.street_match_confidence ?? null}`);
        }

        await this.prisma.$executeRaw`
            UPDATE import_review.address_candidates
            SET ${Prisma.join(sets, ", ")}
            WHERE id = ${candidateId}
        `;
    }

    async upsertInferredStreetComponent(args: {
        candidateId: bigint;
        languageCode: string;
        componentValue: string;
        matchType: string;
        confidenceScore: number;
        streetId: bigint;
        replaceReviewed: boolean;
    }): Promise<"inserted" | "updated" | "skipped"> {
        const existing = await this.prisma.$queryRaw<
            Array<{ id: bigint; is_reviewed: boolean; is_inferred: boolean; component_value: string }>
        >`
            SELECT id, is_reviewed, is_inferred, component_value
            FROM import_review.address_components
            WHERE address_candidate_id = ${args.candidateId}
              AND component_type_code = 'street'
              AND language_code = ${args.languageCode}
              AND is_deleted = false
            ORDER BY is_reviewed DESC, id ASC
            LIMIT 1
        `;

        const row = existing[0];
        if (row?.is_reviewed && !args.replaceReviewed) {
            return "skipped";
        }

        if (row) {
            await this.prisma.$executeRaw`
                UPDATE import_review.address_components
                SET
                    component_value = ${args.componentValue},
                    match_type = ${args.matchType},
                    confidence_score = ${args.confidenceScore},
                    is_inferred = true,
                    source_refs = jsonb_build_object(
                        'matched_street_id', ${args.streetId}::text,
                        'sync', 'address_matches'
                    ),
                    updated_at = now()
                WHERE id = ${row.id}
            `;
            return "updated";
        }

        await this.prisma.$executeRaw`
            INSERT INTO import_review.address_components (
                address_candidate_id,
                component_type_id,
                component_type_code,
                component_value,
                language_code,
                source_tag,
                sort_order,
                confidence_score,
                match_type,
                is_inferred,
                is_reviewed,
                is_deleted,
                source_refs,
                normalized_data
            )
            SELECT
                ${args.candidateId},
                rt.id,
                'street',
                ${args.componentValue},
                ${args.languageCode},
                'street_match:api',
                rt.rank,
                ${args.confidenceScore},
                ${args.matchType},
                true,
                false,
                false,
                jsonb_build_object('matched_street_id', ${args.streetId}::text),
                jsonb_build_object('sync', 'address_matches')
            FROM ref.ref_address_component_types AS rt
            WHERE rt.code = 'street'
              AND NOT EXISTS (
                  SELECT 1
                  FROM import_review.address_components AS ac
                  WHERE ac.address_candidate_id = ${args.candidateId}
                    AND ac.component_type_code = 'street'
                    AND ac.language_code = ${args.languageCode}
                    AND ac.component_value = ${args.componentValue}
                    AND ac.is_deleted = false
              )
        `;
        return "inserted";
    }
}
