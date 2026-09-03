import { Prisma, type PrismaClient } from "@prisma/client";

import { expandSearchEntityTypeFilters } from "../search/transport-search-entity.js";
import {
    searchOverlayActiveCondition,
    sqlSearchOverlayVisible,
} from "../transport/transport-search-overlay-visibility.js";
import type { PublicSearchCursorAfter } from "./public-search-cursor.js";
import {
    buildPublicSearchFilterSql,
    type ResolvedPublicSearchFilters,
} from "./public-search-filters.js";
import {
    buildNumericTransportRouteExactSql,
    buildUnifiedSearchScoreSql,
    resolveFuzzySimilarityThreshold,
} from "./public-search-ranking.js";
import { isNumericTransportQuery } from "./fold-search-code.js";
import {
    buildPublicSearchMatchedNameLanguageOrderSql,
    normalizePublicSearchLang,
    type PublicSearchLang,
} from "./public-search-language.js";

type ListPublicPlacesParams = {
    q?: string;
    category?: string;
    categoryId?: bigint;
    limit: number;
};

/**
 * `prefix` mode matches `q%` only (index-friendly, no `%q%` trigram scan) and is
 * used for short (2-char) queries. `full` mode uses `%q%` contains matching.
 */
export type SearchPublicMapMode = "prefix" | "full";

type SearchPublicMapParams = {
    q: string;
    limit: number;
    mode?: SearchPublicMapMode;
};

/**
 * Statement timeout (ms) for the public text search query. Keeps a pathological
 * query (or missing index) from holding a connection; on timeout the service
 * returns a typed retryable 503 instead of a false zero-result response.
 */
export const PUBLIC_SEARCH_STATEMENT_TIMEOUT_MS = 2000;

/**
 * Bound the rows that reach expensive ranking (similarity, distance and lateral
 * name selection). Each candidate branch is independently index-backed and
 * capped, so broad admin-context terms cannot force ranking over the full index.
 */
export const PUBLIC_SEARCH_CANDIDATE_BRANCH_LIMIT = 200;
export const PUBLIC_SEARCH_FUZZY_CANDIDATE_LIMIT = 250;

export type ViewportPublicPlacesParams = {
    bbox: [number, number, number, number];
    zoom: number;
    category?: string;
    limit: number;
    offset: number;
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
    admin_level_code?: string | null;
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

export type PublicMapViewportPlaceRow = PublicPlaceRow & {
    effective_importance_score: number;
    geom: unknown;
    updated_at: Date;
};

export type PublicCategoryRow = {
    id: bigint;
    code: string;
    name: string;
    sortOrder: number;
};

export type PublicSearchRow = {
    id: string;
    result_type: "place" | "street" | "admin_area";
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

export type UnifiedSearchParams = {
    q: string;
    lat?: number | undefined;
    lng?: number | undefined;
    lang?: "my" | "en" | "und" | undefined;
    types?: string[] | undefined;
    filters?: ResolvedPublicSearchFilters | undefined;
    /**
     * Match strategy from the query planner:
     * - "prefix" (q length 2): exact code + name prefix only; no trigram fuzzy / FTS.
     * - "full" (q length >= 3): exact + prefix + full-text + trigram fuzzy.
     * Defaults to "full" for backward compatibility.
     */
    mode?: SearchPublicMapMode | undefined;
    limit: number;
    /** Keyset continuation — rows strictly after this position in sort order. */
    after?: PublicSearchCursorAfter | undefined;
};

/**
 * Split a normalized query into non-empty whitespace tokens. Used to drive the
 * multi-token AND match (each token must appear in trigram_text), which fixes
 * multi-word Myanmar queries that Postgres FTS misses because Myanmar terms are
 * glued together in stored strings (e.g. "ဘုရင့်နောင်လမ်း", "အင်းစိန်ခရိုင်").
 */
export function splitSearchTokens(qNorm: string): string[] {
    return qNorm.trim().split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Route variants are implementation/detail rows for normal public searches.
 * Only expose them when the user explicitly asks for a canonical D0/D1
 * direction token, including compact codes such as `YBS-13-D1`.
 */
export function allowsTransportRouteVariantResults(query: string): boolean {
    return /(?:^|[^a-z0-9])d[01](?:$|[^a-z0-9])/i.test(query.trim());
}

/** Escape LIKE/ILIKE metacharacters so query tokens can't inject wildcards. */
export function escapeLikeToken(token: string): string {
    return token.replace(/([\\%_])/g, "\\$1");
}

/** Keyset filter for unified search continuation (no OFFSET). */
export function buildUnifiedSearchKeysetClause(after: PublicSearchCursorAfter): Prisma.Sql {
    const entityId = BigInt(after.entityId);
    return Prisma.sql`(
        COALESCE(scored.score, 0) < ${after.score}
        OR (
            COALESCE(scored.score, 0) = ${after.score}
            AND scored.importance_score < ${after.importanceScore}
        )
        OR (
            COALESCE(scored.score, 0) = ${after.score}
            AND scored.importance_score = ${after.importanceScore}
            AND COALESCE(scored.display_name, '') > ${after.displayName}
        )
        OR (
            COALESCE(scored.score, 0) = ${after.score}
            AND scored.importance_score = ${after.importanceScore}
            AND COALESCE(scored.display_name, '') = ${after.displayName}
            AND scored.entity_type > ${after.entityType}
        )
        OR (
            COALESCE(scored.score, 0) = ${after.score}
            AND scored.importance_score = ${after.importanceScore}
            AND COALESCE(scored.display_name, '') = ${after.displayName}
            AND scored.entity_type = ${after.entityType}
            AND scored.entity_id::bigint > ${entityId}
        )
    )`;
}

/** Raw row from search.search_documents (no heavy core joins, no full geometry). */
export type UnifiedSearchRow = {
    entity_type: string;
    entity_id: string;
    public_id: string | null;
    display_name: string | null;
    subtitle: string | null;
    primary_name_my: string | null;
    primary_name_en: string | null;
    primary_name_und: string | null;
    matched_name: string | null;
    geometry_type: string | null;
    lng: number | null;
    lat: number | null;
    min_lng: number | null;
    min_lat: number | null;
    max_lng: number | null;
    max_lat: number | null;
    has_geometry: boolean;
    category_code: string | null;
    category_name_my: string | null;
    category_name_en: string | null;
    admin_area_name_my: string | null;
    admin_area_name_en: string | null;
    score: number | null;
    importance_score: number;
    is_verified: boolean;
    confidence_score: number;
    boundary_confidence_score: number;
    address_parts: unknown;
};

export type FailedSearchLogInput = {
    q: string;
    normalizedQuery: string;
    lang?: string | null;
    category: string;
    transportType: string;
    transportMode: string;
    entityTypesKey: string;
    areaContextKey: string;
    dedupeKey: string;
    types?: string[] | null;
    resultCount: number;
};

export type SearchRequestAnalyticsInsert = {
    correlationId: string;
    normalizedQuery: string;
    lang: string | null;
    category: string;
    transportType: string;
    transportMode: string;
    resultCount: number;
    latencyMs: number;
    sessionKey: string | null;
};

export type SearchResultClickAnalyticsInsert = {
    searchCorrelationId: string;
    entityType: string;
    entityId: string;
    clickedRank: number;
    timeToClickMs: number | null;
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
                      pn.language_code = 'my'
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

    async listViewportPlaces(params: ViewportPublicPlacesParams): Promise<PublicMapViewportPlaceRow[]> {
        const conditions = buildViewportPlaceConditions(params);
        const [minLng, minLat, maxLng, maxLat] = params.bbox;
        const resultLimit = params.limit + 1;

        return this.prisma.$queryRaw<PublicMapViewportPlaceRow[]>(Prisma.sql`
            WITH viewport AS (
                SELECT ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326) AS geom
            )
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
                score.effective_importance_score,
                p.is_verified,
                p.updated_at,
                ST_AsGeoJSON(p.point_geom)::json AS geom
            FROM core.core_places AS p
            CROSS JOIN viewport
            CROSS JOIN LATERAL (
                SELECT GREATEST(
                    COALESCE(p.importance_score, 0),
                    CASE
                        WHEN p.is_verified = true THEN 60
                        ELSE 30
                    END
                )::double precision AS effective_importance_score
            ) AS score
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            LEFT JOIN LATERAL (
                SELECT pn.name
                FROM core.core_place_names AS pn
                WHERE pn.place_id = p.id
                  AND (
                      pn.language_code = 'my'
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
            ORDER BY
                score.effective_importance_score DESC,
                p.is_verified DESC,
                p.updated_at DESC,
                p.id ASC
            LIMIT ${resultLimit}
            OFFSET ${params.offset}
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
                      pn.language_code = 'my'
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

        // Run inside a transaction so SET LOCAL statement_timeout applies only to
        // this query and the connection is reset afterwards.
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
                `SET LOCAL statement_timeout = ${PUBLIC_SEARCH_STATEMENT_TIMEOUT_MS}`,
            );
            return tx.$queryRaw<PublicSearchRow[]>(query);
        });
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
                  AND lower(trim(coalesce(sn.name_type, ''))) <> 'generated'
                  AND (
                      sn.language_code = 'my'
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
                  AND lower(trim(coalesce(sn.name_type, ''))) <> 'generated'
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
                al.code AS admin_level_code,
                ST_AsGeoJSON(
                    ST_SetSRID(
                        COALESCE(
                            CASE
                                WHEN a.centroid IS NOT NULL
                                     AND NOT ST_IsEmpty(a.centroid)
                                     AND ST_IsValid(a.centroid)
                                    THEN a.centroid
                                ELSE NULL
                            END,
                            CASE
                                WHEN a.geom IS NOT NULL
                                     AND NOT ST_IsEmpty(a.geom)
                                     AND ST_IsValid(a.geom)
                                    THEN ST_PointOnSurface(
                                        ST_MakeValid(ST_SetSRID(a.geom, 4326))
                                    )
                                ELSE NULL
                            END
                        ),
                        4326
                    )
                )::json AS geom
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al
                ON al.id = a.admin_level_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      n.language_code = 'my'
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
              AND a.deleted_at IS NULL
              AND a.address_usage <> 'disabled'
              AND (
                  al.code <> 'village'
                  OR a.boundary_status IN (
                      'official',
                      'surveyed',
                      'approximate',
                      'settlement_extent'
                  )
              )
              AND COALESCE(
                    CASE
                        WHEN a.centroid IS NOT NULL
                             AND NOT ST_IsEmpty(a.centroid)
                             AND ST_IsValid(a.centroid)
                            THEN a.centroid
                        ELSE NULL
                    END,
                    CASE
                        WHEN a.geom IS NOT NULL
                             AND NOT ST_IsEmpty(a.geom)
                             AND ST_IsValid(a.geom)
                            THEN ST_PointOnSurface(
                                ST_MakeValid(ST_SetSRID(a.geom, 4326))
                            )
                        ELSE NULL
                    END
                ) IS NOT NULL
              AND ST_Intersects(
                    COALESCE(
                        CASE
                            WHEN a.centroid IS NOT NULL
                                 AND NOT ST_IsEmpty(a.centroid)
                                 AND ST_IsValid(a.centroid)
                                THEN a.centroid
                            ELSE NULL
                        END,
                        CASE
                            WHEN a.geom IS NOT NULL
                                 AND NOT ST_IsEmpty(a.geom)
                                 AND ST_IsValid(a.geom)
                                THEN ST_PointOnSurface(
                                    ST_MakeValid(ST_SetSRID(a.geom, 4326))
                                )
                            ELSE NULL
                        END
                    ),
                    ${PUBLIC_MAP_BOUNDS_ENVELOPE_SQL}
                )
            ORDER BY al.code ASC, a.canonical_name ASC
            LIMIT 2500
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
            FROM transport.stops AS b
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.stop_names AS n
                WHERE n.stop_id = b.id
                  AND lower(trim(coalesce(n.language_code, ''))) = 'my'
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
                FROM transport.stop_names AS n
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
              AND b.deleted_at IS NULL
              AND b.review_status IN ('reviewed', 'verified')
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
                ST_AsGeoJSON(rp.geom)::json AS geom
            FROM transport.route_variants AS v
            INNER JOIN transport.routes AS r ON r.id = v.route_id
            LEFT JOIN LATERAL (
                SELECT p.geom
                FROM transport.route_paths AS p
                WHERE p.route_variant_id = v.id
                  AND p.is_active = true
                  AND p.deleted_at IS NULL
                  AND p.review_status IN ('reviewed', 'verified')
                ORDER BY
                    CASE WHEN p.path_kind = 'primary' THEN 0 ELSE 1 END,
                    p.id ASC
                LIMIT 1
            ) AS rp ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(trim(coalesce(n.language_code, ''))) = 'my'
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
                FROM transport.route_names AS n
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
              AND v.deleted_at IS NULL
              AND v.review_status IN ('reviewed', 'verified')
              AND r.is_active = true
              AND r.deleted_at IS NULL
              AND r.review_status IN ('reviewed', 'verified')
              AND rp.geom IS NOT NULL
              AND ST_Intersects(rp.geom, ${PUBLIC_MAP_BOUNDS_ENVELOPE_SQL})
            ORDER BY r.route_code ASC, v.variant_code ASC
            LIMIT 500
        `);
    }

    /**
     * Unified runtime search over search.search_documents only.
     * No heavy core joins, no full geometry: center comes from ST_X/ST_Y(centroid)
     * and bbox from the stored envelope. Scoring blends exact code/name, prefix,
     * full-text, trigram similarity, an optional nearby bonus, and quality boosts.
     */
    async searchUnifiedDocuments(params: UnifiedSearchParams): Promise<UnifiedSearchRow[]> {
        const qNorm = params.q.trim().toLowerCase();
        const prefix = `${qNorm}%`;
        const isPrefixMode = params.mode === "prefix";
        const routeVariantVisibilityFilter = allowsTransportRouteVariantResults(qNorm)
            ? Prisma.empty
            : Prisma.sql`AND d.entity_type NOT IN ('transport_route_variant', 'bus_route_variant')`;
        const hasRef =
            params.lat !== undefined &&
            params.lng !== undefined &&
            Number.isFinite(params.lat) &&
            Number.isFinite(params.lng);

        const resolvedFilters =
            params.filters ??
            (params.types && params.types.length > 0
                ? {
                      entityTypes: params.types,
                      expandedEntityTypes: expandSearchEntityTypeFilters(params.types),
                      transportMode: "all",
                      transportModeFilter: null,
                      transportStopTypes: null,
                      category: "all" as const,
                      transportType: "all" as const,
                  }
                : undefined);

        const sqlFilters = resolvedFilters
            ? buildPublicSearchFilterSql(resolvedFilters)
            : {
                  entityTypeFilter: Prisma.empty,
                  transportModeFilter: Prisma.empty,
                  transportStopTypeFilter: Prisma.empty,
              };

        const langPref: PublicSearchLang | null = normalizePublicSearchLang(params.lang ?? null);
        const matchedNameLanguageOrder = buildPublicSearchMatchedNameLanguageOrderSql(langPref);

        // Multi-token AND match (full mode only). Myanmar terms are glued in stored
        // strings (e.g. "ဘုရင့်နောင်လမ်း", "အင်းစိန်ခရိုင်"), so Postgres FTS, which
        // needs exact lexeme tokens, fails on multi-word queries like
        // "အင်းစိန် ဘုရင့်နောင်". Instead we split the query on whitespace and require
        // EVERY token to appear somewhere in trigram_text via ILIKE '%token%'
        // (ANDed). trigram_text is already lowercased + includes admin hierarchy.
        const tokens = isPrefixMode ? [] : splitSearchTokens(qNorm);
        const isMultiToken = tokens.length >= 2;
        const multiTokenMatch = isMultiToken
            ? Prisma.join(
                  tokens.map(
                      (t) => Prisma.sql`d.trigram_text ILIKE ${`%${escapeLikeToken(t)}%`}`,
                  ),
                  " AND ",
              )
            : null;

        const fuzzyThreshold = resolveFuzzySimilarityThreshold(qNorm, isPrefixMode ? "prefix" : "full");
        const numericTransportIntent = isNumericTransportQuery(qNorm);

        const scoreSql = buildUnifiedSearchScoreSql({
            qNorm,
            prefix,
            isPrefixMode,
            multiTokenMatch,
            fuzzyThreshold,
            hasRef,
            lat: params.lat,
            lng: params.lng,
        });

        // Matched-name lateral: skip the `%` trigram operator in prefix mode.
        const nameMatch = isPrefixMode
            ? Prisma.sql`(
                  n.normalized_name = ${qNorm}
                  OR n.normalized_name LIKE ${prefix}
              )`
            : Prisma.sql`(
                  n.normalized_name = ${qNorm}
                  OR n.normalized_name LIKE ${prefix}
                  OR n.normalized_name % ${qNorm}
              )`;

        const candidateFilters = Prisma.sql`
            d.is_public = true
            AND d.is_active = true
            ${sqlFilters.entityTypeFilter}
            ${sqlFilters.transportModeFilter}
            ${sqlFilters.transportStopTypeFilter}
            ${routeVariantVisibilityFilter}
        `;

        const aliasCandidateMatch = isPrefixMode
            ? Prisma.sql`(
                  n.normalized_name = ${qNorm}
                  OR n.normalized_name LIKE ${prefix}
              )`
            : Prisma.sql`(
                  n.normalized_name = ${qNorm}
                  OR n.normalized_name LIKE ${prefix}
                  OR n.normalized_name % ${qNorm}
              )`;

        const numericTransportCandidateBranch = numericTransportIntent
            ? Prisma.sql`
                  (
                      SELECT d.id
                      FROM search.search_documents d
                      WHERE ${candidateFilters}
                        AND ${buildNumericTransportRouteExactSql(qNorm)}
                      ORDER BY COALESCE(d.importance_score, 0) DESC, d.id ASC
                      LIMIT 50
                  )
                  UNION ALL
              `
            : Prisma.empty;

        // Keep candidate generation as separate index-backed branches. A single
        // large OR (especially `similarity(...) >= threshold`) made Postgres
        // choose a sequential scan once settlements expanded the index.
        const candidatePoolSql = multiTokenMatch
            ? Prisma.sql`
                  SELECT d.id
                  FROM search.search_documents d
                  WHERE ${candidateFilters}
                    AND (${multiTokenMatch})
                  ORDER BY COALESCE(d.importance_score, 0) DESC, d.id ASC
                  LIMIT ${PUBLIC_SEARCH_FUZZY_CANDIDATE_LIMIT}
              `
            : Prisma.sql`
                  ${numericTransportCandidateBranch}
                  (
                      SELECT d.id
                      FROM search.search_documents d
                      WHERE ${candidateFilters}
                        AND d.code IS NOT NULL
                        AND lower(d.code) = ${qNorm}
                      ORDER BY COALESCE(d.importance_score, 0) DESC, d.id ASC
                      LIMIT 50
                  )
                  UNION ALL
                  (
                      SELECT d.id
                      FROM search.search_documents d
                      WHERE ${candidateFilters}
                        AND d.trigram_text LIKE ${prefix}
                      ORDER BY COALESCE(d.importance_score, 0) DESC, d.id ASC
                      LIMIT ${PUBLIC_SEARCH_CANDIDATE_BRANCH_LIMIT}
                  )
                  ${
                      isPrefixMode
                          ? Prisma.empty
                          : Prisma.sql`
                                UNION ALL
                                (
                                    SELECT d.id
                                    FROM search.search_documents d
                                    WHERE ${candidateFilters}
                                      AND d.search_vector @@ plainto_tsquery('simple', ${qNorm})
                                    ORDER BY
                                        ts_rank_cd(d.search_vector, plainto_tsquery('simple', ${qNorm})) DESC,
                                        COALESCE(d.importance_score, 0) DESC,
                                        d.id ASC
                                    LIMIT ${PUBLIC_SEARCH_CANDIDATE_BRANCH_LIMIT}
                                )
                                UNION ALL
                                (
                                    SELECT d.id
                                    FROM search.search_documents d
                                    WHERE ${candidateFilters}
                                      AND d.trigram_text % ${qNorm}
                                    ORDER BY
                                        similarity(d.trigram_text, ${qNorm}) DESC,
                                        COALESCE(d.importance_score, 0) DESC,
                                        d.id ASC
                                    LIMIT ${PUBLIC_SEARCH_FUZZY_CANDIDATE_LIMIT}
                                )
                            `
                  }
                  UNION ALL
                  (
                      SELECT d.id
                      FROM search.search_document_names n
                      INNER JOIN search.search_documents d ON d.id = n.search_document_id
                      WHERE ${candidateFilters}
                        AND ${aliasCandidateMatch}
                      ORDER BY
                          CASE
                              WHEN n.normalized_name = ${qNorm} THEN 1
                              WHEN n.normalized_name LIKE ${prefix} THEN 2
                              ELSE 3
                          END,
                          ${
                              isPrefixMode
                                  ? Prisma.sql`n.search_weight DESC`
                                  : Prisma.sql`similarity(coalesce(n.normalized_name, ''), ${qNorm}) DESC`
                          },
                          n.search_weight DESC,
                          d.id ASC
                      LIMIT ${PUBLIC_SEARCH_CANDIDATE_BRANCH_LIMIT}
                  )
              `;

        const keysetFilter = params.after
            ? Prisma.sql`AND ${buildUnifiedSearchKeysetClause(params.after)}`
            : Prisma.empty;

        const query = Prisma.sql`
            WITH candidate_pool AS MATERIALIZED (
                ${candidatePoolSql}
            ),
            candidate_ids AS MATERIALIZED (
                SELECT id
                FROM candidate_pool
                GROUP BY id
            ),
            scored AS (
                SELECT
                    d.entity_type,
                    d.entity_id::text AS entity_id,
                    d.public_id,
                    d.display_name,
                    d.subtitle,
                    d.primary_name_my,
                    d.primary_name_en,
                    d.primary_name_und,
                    mn.name AS matched_name,
                    d.geometry_type,
                    ST_X(d.centroid)::double precision AS lng,
                    ST_Y(d.centroid)::double precision AS lat,
                    ST_XMin(d.bbox)::double precision AS min_lng,
                    ST_YMin(d.bbox)::double precision AS min_lat,
                    ST_XMax(d.bbox)::double precision AS max_lng,
                    ST_YMax(d.bbox)::double precision AS max_lat,
                    d.has_geometry,
                    d.category_code,
                    d.category_name_my,
                    d.category_name_en,
                    d.admin_area_name_my,
                    d.admin_area_name_en,
                    d.is_verified,
                    d.confidence_score::double precision AS confidence_score,
                    d.boundary_confidence_score::double precision AS boundary_confidence_score,
                    d.address_parts,
                    COALESCE(d.importance_score, 0)::double precision AS importance_score,
                    COALESCE(${scoreSql}, 0)::double precision AS score
                FROM candidate_ids c
                INNER JOIN search.search_documents d ON d.id = c.id
                LEFT JOIN LATERAL (
                    SELECT n.name
                    FROM search.search_document_names n
                    WHERE n.search_document_id = d.id
                      AND ${nameMatch}
                    ORDER BY
                        CASE WHEN n.normalized_name = ${qNorm} THEN 1
                             WHEN n.normalized_name LIKE ${prefix} THEN 2
                             ELSE 3 END,
                        ${matchedNameLanguageOrder},
                        n.is_primary DESC,
                        similarity(coalesce(n.normalized_name, ''), ${qNorm}) DESC
                    LIMIT 1
                ) mn ON true
            )
            SELECT
                scored.entity_type,
                scored.entity_id,
                scored.public_id,
                scored.display_name,
                scored.subtitle,
                scored.primary_name_my,
                scored.primary_name_en,
                scored.primary_name_und,
                scored.matched_name,
                scored.geometry_type,
                scored.lng,
                scored.lat,
                scored.min_lng,
                scored.min_lat,
                scored.max_lng,
                scored.max_lat,
                scored.has_geometry,
                scored.category_code,
                scored.category_name_my,
                scored.category_name_en,
                scored.admin_area_name_my,
                scored.admin_area_name_en,
                scored.is_verified,
                scored.confidence_score,
                scored.boundary_confidence_score,
                scored.address_parts,
                scored.importance_score,
                scored.score
            FROM scored
            WHERE true
              ${keysetFilter}
            ORDER BY
                COALESCE(scored.score, 0) DESC,
                scored.importance_score DESC,
                COALESCE(scored.display_name, '') ASC,
                scored.entity_type ASC,
                scored.entity_id::bigint ASC
            LIMIT ${params.limit}
        `;

        // SET LOCAL bounds runtime. Full search also aligns pg_trgm's `%`
        // operator with the same query-length threshold used by ranking.
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
                `SET LOCAL statement_timeout = ${PUBLIC_SEARCH_STATEMENT_TIMEOUT_MS}`,
            );
            if (!isPrefixMode) {
                await tx.$queryRaw(Prisma.sql`
                    SELECT set_config(
                        'pg_trgm.similarity_threshold',
                        ${String(fuzzyThreshold)},
                        true
                    )
                `);
            }
            return tx.$queryRaw<UnifiedSearchRow[]>(query);
        });
    }

    /**
     * Upsert a zero-result search into telemetry. Repeated unresolved queries
     * increment occurrence_count instead of inserting a new row each time.
     */
    async logFailedSearch(input: FailedSearchLogInput): Promise<void> {
        const typesSql =
            input.types && input.types.length > 0
                ? Prisma.sql`ARRAY[${Prisma.join(input.types)}]::text[]`
                : Prisma.sql`NULL::text[]`;

        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO search.failed_search_logs (
                query,
                normalized_query,
                lang,
                lat,
                lng,
                types,
                result_count,
                first_seen_at,
                last_seen_at,
                occurrence_count,
                category,
                transport_type,
                transport_mode,
                entity_types_key,
                area_context_key,
                dedupe_key
            )
            VALUES (
                ${input.q},
                ${input.normalizedQuery},
                ${input.lang ?? null},
                NULL,
                NULL,
                ${typesSql},
                ${input.resultCount},
                now(),
                now(),
                1,
                ${input.category},
                ${input.transportType},
                ${input.transportMode},
                ${input.entityTypesKey},
                ${input.areaContextKey},
                ${input.dedupeKey}
            )
            ON CONFLICT (dedupe_key)
            WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL
            DO UPDATE SET
                query = EXCLUDED.query,
                normalized_query = EXCLUDED.normalized_query,
                lang = EXCLUDED.lang,
                types = EXCLUDED.types,
                result_count = EXCLUDED.result_count,
                category = EXCLUDED.category,
                transport_type = EXCLUDED.transport_type,
                transport_mode = EXCLUDED.transport_mode,
                entity_types_key = EXCLUDED.entity_types_key,
                area_context_key = EXCLUDED.area_context_key,
                last_seen_at = now(),
                occurrence_count = search.failed_search_logs.occurrence_count + 1
        `);
    }

    /** Best-effort search request analytics insert (single row, no location). */
    async insertSearchRequestEvent(input: SearchRequestAnalyticsInsert): Promise<void> {
        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO search.search_request_events (
                correlation_id,
                normalized_query,
                lang,
                category,
                transport_type,
                transport_mode,
                result_count,
                latency_ms,
                session_key
            )
            VALUES (
                ${input.correlationId}::uuid,
                ${input.normalizedQuery},
                ${input.lang},
                ${input.category},
                ${input.transportType},
                ${input.transportMode},
                ${input.resultCount},
                ${input.latencyMs},
                ${input.sessionKey}
            )
        `);
    }

    /** Best-effort search result click analytics insert. */
    async insertSearchResultClickEvent(input: SearchResultClickAnalyticsInsert): Promise<void> {
        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO search.search_result_click_events (
                search_correlation_id,
                entity_type,
                entity_id,
                clicked_rank,
                time_to_click_ms
            )
            VALUES (
                ${input.searchCorrelationId}::uuid,
                ${input.entityType},
                ${BigInt(input.entityId)},
                ${input.clickedRank},
                ${input.timeToClickMs}
            )
        `);
    }

    /**
     * Full GeoJSON geometry for a single entity, looked up on search-result click.
     * Returns null when the entity is missing, not public/active, soft-deleted,
     * or has no usable geometry (caller maps null -> 404).
     */
    async getEntityGeometry(
        entityType: GeometryEntityType,
        entityId: string,
        simplifyToleranceDeg: number,
    ): Promise<EntityGeometryRow | null> {
        // Grouped streets span many rows -> dedicated collect+cap path.
        if (entityType === "street_group") {
            return this.getStreetGroupGeometry(entityId, simplifyToleranceDeg);
        }
        // A parent transport route's geometry lives in its variants' paths -> collect+cap.
        if (entityType === "bus_route" || entityType === "transport_route") {
            return this.getBusRouteGeometry(entityId, simplifyToleranceDeg);
        }

        const source = GEOMETRY_SOURCES[entityType as keyof typeof GEOMETRY_SOURCES];
        if (!source) {
            return null;
        }
        const isNumericId = /^\d+$/.test(entityId);

        let idCondition: Prisma.Sql;
        if (isNumericId) {
            idCondition = Prisma.sql`${Prisma.raw(source.idColumn)} = ${BigInt(entityId)}`;
        } else if (source.publicIdColumn) {
            idCondition = Prisma.sql`${Prisma.raw(source.publicIdColumn)} = ${entityId}::uuid`;
        } else {
            // uuid requested for an entity that only has a numeric id.
            return null;
        }

        // Points are never simplified; for everything else use the resolved tolerance.
        const tolerance = source.pointLike ? 0 : simplifyToleranceDeg;

        const rows = await this.prisma.$queryRaw<EntityGeometryRow[]>(Prisma.sql`
            WITH src AS (
                SELECT ${Prisma.raw(source.geomExpr)} AS g
                FROM ${Prisma.raw(source.from)}
                WHERE ${idCondition}
                  AND ${Prisma.raw(source.activeCondition)}
                LIMIT 1
            )
            SELECT
                ST_AsGeoJSON(
                    CASE
                        WHEN ${tolerance}::double precision > 0
                            THEN ST_SimplifyPreserveTopology(g, ${tolerance}::double precision)
                        ELSE g
                    END
                )::json AS geometry,
                ST_XMin(g)::double precision AS min_lng,
                ST_YMin(g)::double precision AS min_lat,
                ST_XMax(g)::double precision AS max_lng,
                ST_YMax(g)::double precision AS max_lat
            FROM src
            WHERE g IS NOT NULL
              AND NOT ST_IsEmpty(g)
        `);

        return rows[0] ?? null;
    }

    /**
     * Full geometry for a clicked grouped street (entity_type = 'street_group').
     * Resolves the clicked representative segment to its group key
     * (search.norm_street_name(name) + admin_area_id + road_class) -- the SAME key
     * the search index groups by -- then ST_Collects the members into one
     * MultiLineString. ST_Collect (not ST_Union): we only need a highlight + bbox.
     *
     * Safety: if a group has more than STREET_GROUP_SEGMENT_CAP segments, only the
     * longest CAP segments are collected (the bbox still covers ALL members), and
     * `capped` is set so the caller can log a warning. Large geometries are further
     * thinned by the ?zoom= simplification tolerance.
     */
    async getStreetGroupGeometry(
        entityId: string,
        simplifyToleranceDeg: number,
    ): Promise<StreetGroupGeometryRow | null> {
        const isNumericId = /^\d+$/.test(entityId);
        const idCondition = isNumericId
            ? Prisma.sql`s.id = ${BigInt(entityId)}`
            : Prisma.sql`s.public_id = ${entityId}::uuid`;
        const tolerance = simplifyToleranceDeg;

        const rows = await this.prisma.$queryRaw<StreetGroupGeometryRow[]>(Prisma.sql`
            WITH rep AS (
                SELECT search.norm_street_name(s.canonical_name) AS nn,
                       s.admin_area_id,
                       s.road_class
                FROM core.core_streets s
                WHERE ${idCondition}
                  AND s.is_active = true
                  AND s.deleted_at IS NULL
                LIMIT 1
            ),
            members AS (
                SELECT m.geom
                FROM core.core_streets m
                JOIN rep ON true
                WHERE m.is_active = true
                  AND m.deleted_at IS NULL
                  AND m.geom IS NOT NULL
                  AND NOT ST_IsEmpty(m.geom)
                  AND search.norm_street_name(m.canonical_name) = rep.nn
                  AND m.admin_area_id IS NOT DISTINCT FROM rep.admin_area_id
                  AND COALESCE(m.road_class, '') = COALESCE(rep.road_class, '')
            ),
            counted AS (SELECT count(*)::int AS n FROM members),
            capped AS (
                SELECT geom FROM members
                ORDER BY ST_Length(geom) DESC
                LIMIT ${STREET_GROUP_SEGMENT_CAP}
            ),
            collected AS (SELECT ST_Multi(ST_Collect(geom)) AS g FROM capped),
            bounds AS (SELECT ST_Extent(geom) AS e FROM members)
            SELECT
                ST_AsGeoJSON(
                    CASE
                        WHEN ${tolerance}::double precision > 0
                            THEN ST_SimplifyPreserveTopology(c.g, ${tolerance}::double precision)
                        ELSE c.g
                    END
                )::json AS geometry,
                ST_XMin(b.e)::double precision AS min_lng,
                ST_YMin(b.e)::double precision AS min_lat,
                ST_XMax(b.e)::double precision AS max_lng,
                ST_YMax(b.e)::double precision AS max_lat,
                (SELECT n FROM counted) AS segment_count,
                ((SELECT n FROM counted) > ${STREET_GROUP_SEGMENT_CAP}) AS capped
            FROM collected c, bounds b
            WHERE c.g IS NOT NULL
              AND NOT ST_IsEmpty(c.g)
        `);

        return rows[0] ?? null;
    }

    /**
     * Full geometry for a clicked parent bus route (entity_type = 'bus_route').
     * The route itself has no geometry; its shape lives in the active route_paths
     * of its active route_variants (both directions). We ST_Collect them into one
     * MultiLineString + bbox for highlighting.
     *
     * Accepts the route's numeric id (as returned by unified search) or its uuid
     * public_id. Returns null when the route has no usable path geometry (many
     * YBS routes have no digitized path yet).
     *
     * Safety: caps at BUS_ROUTE_PATH_CAP longest paths (bbox still covers all);
     * `capped` lets the caller log a warning. ?zoom= further thins large geometry.
     */
    async getBusRouteGeometry(
        entityId: string,
        simplifyToleranceDeg: number,
    ): Promise<CollectedGeometryRow | null> {
        const isNumericId = /^\d+$/.test(entityId);
        const routeMatch = isNumericId
            ? Prisma.sql`v.route_id = ${BigInt(entityId)}
                AND EXISTS (
                    SELECT 1 FROM transport.routes r
                    WHERE r.id = ${BigInt(entityId)}
                      AND ${sqlSearchOverlayVisible("r")}
                )`
            : Prisma.sql`v.route_id = (
                  SELECT r.id FROM transport.routes r
                  WHERE r.public_id = ${entityId}::uuid
                    AND ${sqlSearchOverlayVisible("r")}
              )`;
        const tolerance = simplifyToleranceDeg;

        const rows = await this.prisma.$queryRaw<CollectedGeometryRow[]>(Prisma.sql`
            WITH paths AS (
                SELECT rp.geom
                FROM transport.route_variants v
                JOIN transport.route_paths rp
                  ON rp.route_variant_id = v.id
                 AND ${sqlSearchOverlayVisible("rp")}
                WHERE ${routeMatch}
                  AND ${sqlSearchOverlayVisible("v")}
                  AND rp.geom IS NOT NULL
                  AND NOT ST_IsEmpty(rp.geom)
            ),
            counted AS (SELECT count(*)::int AS n FROM paths),
            capped AS (
                SELECT geom FROM paths
                ORDER BY ST_Length(geom) DESC
                LIMIT ${BUS_ROUTE_PATH_CAP}
            ),
            collected AS (SELECT ST_Multi(ST_Collect(geom)) AS g FROM capped),
            bounds AS (SELECT ST_Extent(geom) AS e FROM paths)
            SELECT
                ST_AsGeoJSON(
                    CASE
                        WHEN ${tolerance}::double precision > 0
                            THEN ST_SimplifyPreserveTopology(c.g, ${tolerance}::double precision)
                        ELSE c.g
                    END
                )::json AS geometry,
                ST_XMin(b.e)::double precision AS min_lng,
                ST_YMin(b.e)::double precision AS min_lat,
                ST_XMax(b.e)::double precision AS max_lng,
                ST_YMax(b.e)::double precision AS max_lat,
                (SELECT n FROM counted) AS segment_count,
                ((SELECT n FROM counted) > ${BUS_ROUTE_PATH_CAP}) AS capped
            FROM collected c, bounds b
            WHERE c.g IS NOT NULL
              AND NOT ST_IsEmpty(c.g)
        `);

        return rows[0] ?? null;
    }

    /**
     * Lightweight route preview for map overlays: one simplified path (primary/focus
     * variant), variant summaries, and optional first/last stops only.
     */
    async getTransportRouteMapPreview(
        entityType:
            | "transport_route"
            | "transport_route_variant"
            | "bus_route"
            | "bus_route_variant",
        entityId: string,
        simplifyToleranceDeg: number,
    ): Promise<TransportRouteMapPreviewRow | null> {
        const isVariantEntity =
            entityType === "transport_route_variant" || entityType === "bus_route_variant";
        const isNumericId = /^\d+$/.test(entityId);
        const tolerance = simplifyToleranceDeg;

        const ctxCte = isVariantEntity
            ? Prisma.sql`
                SELECT
                    v.route_id,
                    v.id AS focus_variant_id
                FROM transport.route_variants v
                JOIN transport.routes r ON r.id = v.route_id
                WHERE ${
                    isNumericId
                        ? Prisma.sql`v.id = ${BigInt(entityId)}`
                        : Prisma.sql`v.public_id = ${entityId}::uuid`
                }
                  AND ${sqlSearchOverlayVisible("v")}
                  AND ${sqlSearchOverlayVisible("r")}
                LIMIT 1
            `
            : Prisma.sql`
                SELECT
                    r.id AS route_id,
                    NULL::bigint AS focus_variant_id
                FROM transport.routes r
                WHERE ${
                    isNumericId
                        ? Prisma.sql`r.id = ${BigInt(entityId)}`
                        : Prisma.sql`r.public_id = ${entityId}::uuid`
                }
                  AND ${sqlSearchOverlayVisible("r")}
                LIMIT 1
            `;

        const rows = await this.prisma.$queryRaw<TransportRouteMapPreviewRow[]>(Prisma.sql`
            WITH ctx AS (
                ${ctxCte}
            ),
            active_variants AS (
                SELECT
                    v.id,
                    v.public_id,
                    v.variant_code,
                    v.headsign,
                    v.direction_name,
                    (
                        v.id = COALESCE(
                            ctx.focus_variant_id,
                            (
                                SELECT v2.id
                                FROM transport.route_variants v2
                                WHERE v2.route_id = ctx.route_id
                                  AND ${sqlSearchOverlayVisible("v2")}
                                ORDER BY v2.variant_code, v2.id
                                LIMIT 1
                            )
                        )
                    ) AS is_focus
                FROM transport.route_variants v
                CROSS JOIN ctx
                WHERE v.route_id = ctx.route_id
                  AND ${sqlSearchOverlayVisible("v")}
            ),
            focus_variant AS (
                SELECT *
                FROM active_variants
                ORDER BY is_focus DESC, variant_code, id
                LIMIT 1
            ),
            focus_path AS (
                SELECT rp.geom
                FROM focus_variant fv
                JOIN transport.route_paths rp
                  ON rp.route_variant_id = fv.id
                 AND ${sqlSearchOverlayVisible("rp")}
                 AND rp.geom IS NOT NULL
                 AND NOT ST_IsEmpty(rp.geom)
                ORDER BY CASE WHEN rp.path_kind = 'primary' THEN 0 ELSE 1 END, rp.id
                LIMIT 1
            ),
            simplified AS (
                SELECT
                    CASE
                        WHEN ${tolerance}::double precision > 0
                            THEN ST_SimplifyPreserveTopology(geom, ${tolerance}::double precision)
                        ELSE geom
                    END AS g
                FROM focus_path
            ),
            endpoint_stops AS (
                SELECT
                    s.public_id::text AS public_id,
                    COALESCE(NULLIF(BTRIM(s.name_mm), ''), s.name) AS display_name,
                    rs.stop_sequence,
                    ST_Y(s.geom)::double precision AS lat,
                    ST_X(s.geom)::double precision AS lng,
                    ROW_NUMBER() OVER (ORDER BY rs.stop_sequence ASC) AS fwd_rn,
                    ROW_NUMBER() OVER (ORDER BY rs.stop_sequence DESC) AS rev_rn
                FROM focus_variant fv
                JOIN transport.route_stops rs
                  ON rs.route_variant_id = fv.id
                JOIN transport.stops s
                  ON s.id = rs.stop_id
                 AND ${sqlSearchOverlayVisible("s")}
                 AND s.geom IS NOT NULL
            )
            SELECT
                ST_AsGeoJSON(s.g)::json AS path_geometry,
                ST_XMin(s.g)::double precision AS min_lng,
                ST_YMin(s.g)::double precision AS min_lat,
                ST_XMax(s.g)::double precision AS max_lng,
                ST_YMax(s.g)::double precision AS max_lat,
                COALESCE(
                    (
                        SELECT json_agg(
                            json_build_object(
                                'entityId', av.id::text,
                                'publicId', av.public_id::text,
                                'variantCode', av.variant_code,
                                'headsign', av.headsign,
                                'directionName', av.direction_name,
                                'isPrimary', av.is_focus
                            )
                            ORDER BY av.variant_code, av.id
                        )
                        FROM active_variants av
                    ),
                    '[]'::json
                ) AS variants_json,
                COALESCE(
                    (
                        SELECT json_agg(
                            json_build_object(
                                'publicId', es.public_id,
                                'displayName', es.display_name,
                                'sequence', es.stop_sequence,
                                'lat', es.lat,
                                'lng', es.lng
                            )
                            ORDER BY es.stop_sequence
                        )
                        FROM endpoint_stops es
                        WHERE es.fwd_rn = 1 OR es.rev_rn = 1
                    ),
                    '[]'::json
                ) AS stops_json
            FROM simplified s
            WHERE s.g IS NOT NULL
              AND NOT ST_IsEmpty(s.g)
        `);

        return rows[0] ?? null;
    }
}

/** Max segments collected into one street_group highlight before capping + warning. */
export const STREET_GROUP_SEGMENT_CAP = 2000;

/** Max route paths collected into one bus_route highlight before capping + warning. */
export const BUS_ROUTE_PATH_CAP = 500;

export type TransportRouteMapPreviewRow = {
    path_geometry: { type: string; coordinates: unknown } | null;
    min_lng: number;
    min_lat: number;
    max_lng: number;
    max_lat: number;
    variants_json: unknown;
    stops_json: unknown;
};

export type GeometryEntityType =
    | "place"
    | "settlement"
    | "address"
    | "transport_stop"
    | "transport_terminal"
    | "transport_route"
    | "transport_route_variant"
    | "bus_stop"
    | "admin_area"
    | "street"
    | "street_group"
    | "bus_route"
    | "bus_route_variant"
    | "building"
    | "water_line"
    | "water_polygon"
    | "land_area"
    | "landuse";

/**
 * Geometry of an entity assembled by collecting many underlying rows (a grouped
 * street's segments, or a bus route's variant paths) into one MultiLine + bbox.
 */
export type CollectedGeometryRow = EntityGeometryRow & {
    /** Total matching members (before any cap). */
    segment_count: number;
    /** True when segment_count exceeded the cap (geometry capped, bbox still full). */
    capped: boolean;
};

/** @deprecated Use {@link CollectedGeometryRow}. Kept for existing imports. */
export type StreetGroupGeometryRow = CollectedGeometryRow;

export type EntityGeometryRow = {
    geometry: { type: string; coordinates: unknown } | null;
    min_lng: number;
    min_lat: number;
    max_lng: number;
    max_lat: number;
};

type GeometrySource = {
    /** FROM clause incl. alias, e.g. "core.core_places p". Static (not user input). */
    from: string;
    /** Geometry expression (4326) referencing the alias. */
    geomExpr: string;
    /** Public/active/not-deleted filter referencing the alias. */
    activeCondition: string;
    /** Internal id column for numeric lookups. */
    idColumn: string;
    /** Public uuid column, or null if the table has none (water lines/polygons). */
    publicIdColumn: string | null;
    /** Point-like entities are never simplified. */
    pointLike: boolean;
};

/**
 * Per-entity geometry sources. Bus stops/route variants live in the transport
 * schema; route-variant geometry comes from the primary route_path. Water
 * lines/polygons have no public_id, so only numeric ids resolve them.
 */
const GEOMETRY_SOURCES: Record<
    Exclude<GeometryEntityType, "street_group" | "bus_route" | "transport_route">,
    GeometrySource
> = {
    place: {
        from: "core.core_places p",
        geomExpr: "COALESCE(p.point_geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))",
        activeCondition: "p.is_public = true AND p.deleted_at IS NULL",
        idColumn: "p.id",
        publicIdColumn: "p.public_id",
        pointLike: true,
    },
    settlement: {
        from: "core.core_settlements s",
        geomExpr: "s.point_geom",
        activeCondition: "s.is_public = true AND s.deleted_at IS NULL",
        idColumn: "s.id",
        publicIdColumn: "s.public_id",
        pointLike: true,
    },
    address: {
        from: "core.core_addresses a",
        geomExpr: "COALESCE(a.entrance_geom, a.point_geom, a.geom)",
        activeCondition: "a.is_public = true AND a.deleted_at IS NULL",
        idColumn: "a.id",
        publicIdColumn: "a.public_id",
        pointLike: true,
    },
    bus_stop: {
        from: "transport.stops s",
        geomExpr: "s.geom",
        activeCondition: searchOverlayActiveCondition("s"),
        idColumn: "s.id",
        publicIdColumn: "s.public_id",
        pointLike: true,
    },
    transport_stop: {
        from: "transport.stops s",
        geomExpr: "s.geom",
        activeCondition: searchOverlayActiveCondition("s"),
        idColumn: "s.id",
        publicIdColumn: "s.public_id",
        pointLike: true,
    },
    transport_terminal: {
        from: "transport.terminals t",
        geomExpr: "t.geom",
        activeCondition: searchOverlayActiveCondition("t"),
        idColumn: "t.id",
        publicIdColumn: "t.public_id",
        pointLike: true,
    },
    admin_area: {
        from: "core.core_admin_areas a",
        geomExpr: "a.geom",
        activeCondition: "a.is_active = true AND a.deleted_at IS NULL",
        idColumn: "a.id",
        publicIdColumn: "a.public_id",
        pointLike: false,
    },
    street: {
        from: "core.core_streets s",
        geomExpr: "s.geom",
        activeCondition: "s.is_active = true AND s.deleted_at IS NULL",
        idColumn: "s.id",
        publicIdColumn: "s.public_id",
        pointLike: false,
    },
    // NOTE: street_group and bus_route are intentionally NOT in this static map.
    // Each spans many rows (street segments / route-variant paths), so their
    // geometry is resolved by dedicated collect+cap helpers (getStreetGroupGeometry,
    // getBusRouteGeometry), not this single-row template. bus_route_variant (one
    // variant = one path) stays here.
    bus_route_variant: {
        from: "transport.route_variants v",
        geomExpr:
            "(SELECT rp.geom FROM transport.route_paths rp " +
            "WHERE rp.route_variant_id = v.id AND " +
            searchOverlayActiveCondition("rp") +
            " ORDER BY CASE WHEN rp.path_kind = 'primary' THEN 0 ELSE 1 END, rp.id ASC LIMIT 1)",
        activeCondition: searchOverlayActiveCondition("v"),
        idColumn: "v.id",
        publicIdColumn: "v.public_id",
        pointLike: false,
    },
    transport_route_variant: {
        from: "transport.route_variants v",
        geomExpr:
            "(SELECT rp.geom FROM transport.route_paths rp " +
            "WHERE rp.route_variant_id = v.id AND " +
            searchOverlayActiveCondition("rp") +
            " ORDER BY CASE WHEN rp.path_kind = 'primary' THEN 0 ELSE 1 END, rp.id ASC LIMIT 1)",
        activeCondition: searchOverlayActiveCondition("v"),
        idColumn: "v.id",
        publicIdColumn: "v.public_id",
        pointLike: false,
    },
    building: {
        from: "core.core_buildings b",
        geomExpr: "b.geom",
        activeCondition: "b.is_active = true AND b.deleted_at IS NULL",
        idColumn: "b.id",
        publicIdColumn: "b.public_id",
        pointLike: false,
    },
    water_line: {
        from: "core.core_water_lines w",
        geomExpr: "w.geom",
        activeCondition: "w.is_active = true AND w.deleted_at IS NULL",
        idColumn: "w.id",
        publicIdColumn: null,
        pointLike: false,
    },
    water_polygon: {
        from: "core.core_water_polygons w",
        geomExpr: "w.geom",
        activeCondition: "w.is_active = true AND w.deleted_at IS NULL",
        idColumn: "w.id",
        publicIdColumn: null,
        pointLike: false,
    },
    land_area: {
        from: "core.core_land_areas lu",
        geomExpr: "lu.geom",
        activeCondition: "lu.is_active = true AND lu.deleted_at IS NULL",
        idColumn: "lu.id",
        publicIdColumn: "lu.public_id",
        pointLike: false,
    },
    landuse: {
        from: "core.core_land_areas lu",
        geomExpr: "lu.geom",
        activeCondition: "lu.is_active = true AND lu.deleted_at IS NULL",
        idColumn: "lu.id",
        publicIdColumn: "lu.public_id",
        pointLike: false,
    },
};

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

    if (categoryCode && categoryCode.toLowerCase() !== "all") {
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

function buildViewportPlaceConditions(params: ViewportPublicPlacesParams) {
    const conditions: Prisma.Sql[] = [
        Prisma.sql`p.deleted_at IS NULL`,
        Prisma.sql`p.is_public = true`,
        Prisma.sql`p.point_geom IS NOT NULL`,
        Prisma.sql`p.point_geom && viewport.geom`,
        Prisma.sql`ST_Intersects(p.point_geom, viewport.geom)`,
    ];

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
    }

    const minImportanceScore = effectiveImportanceThresholdForZoom(params.zoom);
    if (minImportanceScore !== null) {
        conditions.push(Prisma.sql`score.effective_importance_score >= ${minImportanceScore}`);
    }

    return conditions;
}

export function effectiveImportanceThresholdForZoom(zoom: number): number | null {
    // Public map density tuning uses effective importance on a 0-100 scale:
    // max(raw importance, verified=60, unverified=30). This keeps verified places
    // visible at mid zoom even before raw importance scoring is fully populated.
    if (zoom < 11) return 75;
    if (zoom < 13) return 60;
    if (zoom < 15) return 45;
    if (zoom < 17) return 30;
    return null;
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
                  AND lower(trim(coalesce(n.name_type, ''))) <> 'generated'
                  AND n.name ILIKE ${matchSearchTerm(params)}
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
    // `prefix` mode (short queries) restricts matching to `q%`; `full` keeps `%q%`.
    const partialTerm = matchSearchTerm(params);

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
        ),
        admin_area_results AS (
            SELECT
                a.public_id::text AS id,
                'admin_area'::text AS result_type,
                COALESCE(
                    NULLIF(trim(an_mm.name), ''),
                    NULLIF(trim(an_en.name), ''),
                    NULLIF(trim(a.canonical_name), ''),
                    'Unnamed'
                ) AS name,
                an_mm.name AS name_mm,
                an_en.name AS name_en,
                NULL::text AS display_name,
                NULL::text AS primary_name,
                a.canonical_name,
                CASE
                    WHEN al.code = 'village' AND COALESCE(
                        NULLIF(trim(parent_mm.name), ''),
                        NULLIF(trim(parent_en.name), ''),
                        NULLIF(trim(parent.canonical_name), '')
                    ) IS NOT NULL
                        THEN 'Village · ' || COALESCE(
                            NULLIF(trim(parent_mm.name), ''),
                            NULLIF(trim(parent_en.name), ''),
                            NULLIF(trim(parent.canonical_name), '')
                        )
                    WHEN al.code = 'village'
                        THEN 'Village'
                    ELSE COALESCE(al.name, al.code)
                END AS subtitle,
                NULL::text AS category_name,
                ST_Y(admin_label_point.geom)::double precision AS lat,
                ST_X(admin_label_point.geom)::double precision AS lng,
                NULL::double precision AS importance_score,
                CASE
                    WHEN lower(a.canonical_name) = ${normalizedTerm}
                      OR lower(COALESCE(an_mm.name, '')) = ${normalizedTerm}
                      OR lower(COALESCE(an_en.name, '')) = ${normalizedTerm}
                      OR lower(COALESCE(admin_name_match.name, '')) = ${normalizedTerm}
                    THEN 1
                    WHEN lower(a.canonical_name) LIKE ${prefixTerm}
                      OR lower(COALESCE(an_mm.name, '')) LIKE ${prefixTerm}
                      OR lower(COALESCE(an_en.name, '')) LIKE ${prefixTerm}
                      OR lower(COALESCE(admin_name_match.name, '')) LIKE ${prefixTerm}
                    THEN 2
                    ELSE 3
                END AS rank,
                CASE
                    WHEN a.geom IS NOT NULL
                         AND NOT ST_IsEmpty(a.geom)
                         AND ST_IsValid(a.geom)
                        THEN ST_XMin(Box2D(ST_Transform(a.geom, 4326)))::double precision
                    ELSE NULL::double precision
                END AS min_lng,
                CASE
                    WHEN a.geom IS NOT NULL
                         AND NOT ST_IsEmpty(a.geom)
                         AND ST_IsValid(a.geom)
                        THEN ST_YMin(Box2D(ST_Transform(a.geom, 4326)))::double precision
                    ELSE NULL::double precision
                END AS min_lat,
                CASE
                    WHEN a.geom IS NOT NULL
                         AND NOT ST_IsEmpty(a.geom)
                         AND ST_IsValid(a.geom)
                        THEN ST_XMax(Box2D(ST_Transform(a.geom, 4326)))::double precision
                    ELSE NULL::double precision
                END AS max_lng,
                CASE
                    WHEN a.geom IS NOT NULL
                         AND NOT ST_IsEmpty(a.geom)
                         AND ST_IsValid(a.geom)
                        THEN ST_YMax(Box2D(ST_Transform(a.geom, 4326)))::double precision
                    ELSE NULL::double precision
                END AS max_lat
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al
                ON al.id = a.admin_level_id
            CROSS JOIN LATERAL (
                SELECT ST_SetSRID(
                    COALESCE(
                        CASE
                            WHEN a.centroid IS NOT NULL
                                 AND NOT ST_IsEmpty(a.centroid)
                                 AND ST_IsValid(a.centroid)
                                THEN a.centroid
                            ELSE NULL
                        END,
                        CASE
                            WHEN a.geom IS NOT NULL
                                 AND NOT ST_IsEmpty(a.geom)
                                 AND ST_IsValid(a.geom)
                                THEN ST_PointOnSurface(
                                    ST_MakeValid(ST_SetSRID(a.geom, 4326))
                                )
                            ELSE NULL
                        END
                    ),
                    4326
                )::geometry(Point, 4326) AS geom
            ) AS admin_label_point
            LEFT JOIN core.core_admin_areas AS parent
                ON parent.id = a.parent_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = parent.id
                  AND (
                      n.language_code = 'my'
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
            ) AS parent_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = parent.id
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
            ) AS parent_en ON true
            ${localizedNameJoin("core.core_admin_area_names", "n", "n.admin_area_id = a.id", "an_mm", "my")}
            ${localizedNameJoin("core.core_admin_area_names", "n", "n.admin_area_id = a.id", "an_en", "en")}
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND n.name ILIKE ${partialTerm}
                ORDER BY
                    CASE
                        WHEN lower(n.name) = ${normalizedTerm} THEN 1
                        WHEN lower(n.name) LIKE ${prefixTerm} THEN 2
                        ELSE 3
                    END,
                    n.is_primary DESC,
                    n.search_weight DESC NULLS LAST,
                    n.name ASC
                LIMIT 1
            ) AS admin_name_match ON true
            WHERE a.is_active = true
              AND a.deleted_at IS NULL
              AND a.address_usage <> 'disabled'
              AND admin_label_point.geom IS NOT NULL
              AND ST_Intersects(admin_label_point.geom, ${PUBLIC_MAP_BOUNDS_ENVELOPE_SQL})
              AND (
                  al.code <> 'village'
                  OR a.boundary_status IN (
                      'official',
                      'surveyed',
                      'approximate',
                      'settlement_extent'
                  )
              )
              AND (
                  a.canonical_name ILIKE ${partialTerm}
                  OR an_mm.name ILIKE ${partialTerm}
                  OR an_en.name ILIKE ${partialTerm}
                  OR admin_name_match.name IS NOT NULL
              )
        )
        SELECT *
        FROM (
            SELECT * FROM place_results
            UNION ALL
            SELECT * FROM admin_area_results
            UNION ALL
            SELECT * FROM street_results
        ) AS results
        ORDER BY
            rank ASC,
            CASE
                WHEN result_type = 'place' THEN 0
                WHEN result_type = 'admin_area' THEN 1
                ELSE 2
            END ASC,
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
            ? Prisma.sql`(${Prisma.raw(tableAlias)}.language_code = 'my' OR upper(trim(coalesce(${Prisma.raw(tableAlias)}.script_code, ''))) = 'MYMR')`
            : Prisma.sql`(${Prisma.raw(tableAlias)}.language_code = 'en' OR upper(trim(coalesce(${Prisma.raw(tableAlias)}.script_code, ''))) = 'LATN')`;

    const excludeGeneratedStreetNames = tableName === "core.core_street_names";

    const generatedExcludeSql = excludeGeneratedStreetNames
        ? Prisma.sql`AND lower(trim(coalesce(${Prisma.raw(tableAlias)}.name_type, ''))) <> 'generated'`
        : Prisma.empty;

    return Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT ${Prisma.raw(tableAlias)}.name
            FROM ${Prisma.raw(tableName)} AS ${Prisma.raw(tableAlias)}
            WHERE ${Prisma.raw(ownerCondition)}
              AND ${languageCondition}
              ${generatedExcludeSql}
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

/**
 * Matching term for the WHERE/ILIKE filters. `prefix` mode (short queries) uses
 * `q%` to avoid the expensive `%q%` contains scan; `full` mode uses `%q%`.
 */
function matchSearchTerm(params: SearchPublicMapParams) {
    return params.mode === "prefix"
        ? prefixSearchTerm(params.q)
        : partialSearchTerm(params.q);
}
