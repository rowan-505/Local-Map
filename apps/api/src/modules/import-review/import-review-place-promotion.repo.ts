import { Prisma, type PrismaClient } from "@prisma/client";

import type { AddressValidationIssue } from "./import-review-address-validation.types.js";
import { placeResolvedCategoryIdExprForPromotion } from "./import-review-promotion-place-category.js";

export type ImportReviewPlacePromotionDb = PrismaClient | Prisma.TransactionClient;

export type PlacePromotionCandidateRowDb = {
    id: bigint;
    review_batch_id: bigint;
    external_id: string | null;
    review_status: string | null;
    promotion_status: string | null;
    promoted_core_id: bigint | null;
    matched_core_id: bigint | null;
    matched_core_table: string | null;
    validation_status: string;
    validation_errors: unknown;
    validation_warnings: unknown;
    has_core_duplicate: boolean;
};

export class ImportReviewPlacePromotionRepository {
    constructor(private readonly prisma: ImportReviewPlacePromotionDb) {}

    async reviewBatchExists(reviewBatchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
                SELECT 1 FROM import_review.review_batches WHERE id = ${reviewBatchId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async listCandidates(args: {
        reviewBatchId?: bigint | undefined;
        candidateIds?: readonly bigint[] | undefined;
    }): Promise<PlacePromotionCandidateRowDb[]> {
        if (args.candidateIds && args.candidateIds.length > 0) {
            return this.listCandidatesByWhere(Prisma.sql`p.id = ANY(${args.candidateIds}::bigint[])`);
        }
        if (args.reviewBatchId === undefined) {
            return [];
        }
        return this.listCandidatesByWhere(Prisma.sql`p.review_batch_id = ${args.reviewBatchId}`);
    }

    async insertCorePlace(candidateId: bigint): Promise<bigint> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            WITH ready AS (
                SELECT
                    p.*,
                    ${placeResolvedCategoryIdExprForPromotion("p")} AS category_id_ready,
                    coalesce(
                        (
                            SELECT st.id
                            FROM ref.ref_source_types AS st
                            WHERE st.code = coalesce(
                                nullif(trim(p.source_refs->>'source_type_code'), ''),
                                nullif(trim(p.source_refs->>'source'), ''),
                                nullif(trim(p.normalized_data->>'source_type_code'), ''),
                                nullif(trim(p.normalized_data->>'source'), ''),
                                'osm'
                            )
                            LIMIT 1
                        ),
                        (SELECT st.id FROM ref.ref_source_types AS st WHERE st.code = 'osm' LIMIT 1)
                    ) AS source_type_id_ready,
                    coalesce(
                        p.point_geom,
                        CASE
                            WHEN p.lat IS NOT NULL AND p.lng IS NOT NULL
                                THEN ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
                            ELSE NULL::geometry(Point, 4326)
                        END
                    ) AS point_geom_ready,
                    coalesce(
                        p.admin_area_id,
                        (
                            SELECT aa.id
                            FROM core.core_admin_areas AS aa
                            WHERE aa.deleted_at IS NULL
                              AND aa.is_active IS TRUE
                              AND aa.geom IS NOT NULL
                              AND NOT ST_IsEmpty(aa.geom)
                              AND p.point_geom IS NOT NULL
                              AND NOT ST_IsEmpty(p.point_geom)
                              AND ST_Covers(aa.geom, p.point_geom)
                            ORDER BY ST_Area(aa.geom::geography) ASC
                            LIMIT 1
                        )
                    ) AS admin_area_id_ready,
                    nullif(trim(coalesce(p.primary_name, p.display_name, p.canonical_name, p.normalized_data->>'name', '')), '') AS primary_name_ready,
                    nullif(trim(coalesce(p.display_name, p.primary_name, p.canonical_name, p.normalized_data->>'name', '')), '') AS display_name_ready
                FROM import_review.place_candidates AS p
                WHERE p.id = ${candidateId}
            ),
            guard AS (
                SELECT *
                FROM ready
                WHERE point_geom_ready IS NOT NULL
                  AND NOT ST_IsEmpty(point_geom_ready)
                  AND ST_IsValid(point_geom_ready)
                  AND primary_name_ready IS NOT NULL
                  AND display_name_ready IS NOT NULL
                  AND category_id_ready IS NOT NULL
                  AND source_type_id_ready IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM core.core_places AS existing
                      WHERE existing.deleted_at IS NULL
                        AND ready.external_id IS NOT NULL
                        AND btrim(ready.external_id) <> ''
                        AND existing.external_id = ready.external_id
                  )
            )
            INSERT INTO core.core_places (
                primary_name,
                display_name,
                category_id,
                admin_area_id,
                point_geom,
                lat,
                lng,
                plus_code,
                importance_score,
                popularity_score,
                confidence_score,
                is_public,
                source_type_id,
                external_id,
                source_refs,
                normalized_data,
                created_at,
                updated_at,
                deleted_at
            )
            SELECT
                g.primary_name_ready,
                g.display_name_ready,
                g.category_id_ready,
                g.admin_area_id_ready,
                g.point_geom_ready,
                ST_Y(g.point_geom_ready),
                ST_X(g.point_geom_ready),
                nullif(trim(coalesce(g.plus_code, g.normalized_data->>'plus_code', '')), ''),
                least(100, greatest(0, coalesce(g.importance_score, 0))),
                least(100, greatest(0, coalesce(g.popularity_score, 0))),
                least(100, greatest(0, coalesce(g.confidence_score, 80))),
                true,
                g.source_type_id_ready,
                nullif(trim(g.external_id), ''),
                coalesce(g.source_refs, '{}'::jsonb)
                    || jsonb_build_object(
                        'promoted_from', 'import_review.place_candidates',
                        'import_review_candidate_id', g.id::text,
                        'review_batch_id', g.review_batch_id::text
                    ),
                coalesce(g.normalized_data, '{}'::jsonb),
                now(),
                now(),
                NULL::timestamptz
            FROM guard AS g
            RETURNING id
        `;
        const id = rows[0]?.id;
        if (id === undefined) {
            throw new Error("Place insert blocked by promotion guard.");
        }
        return id;
    }

    async syncPlaceNames(candidateId: bigint, corePlaceId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            WITH src AS (
                SELECT
                    p.normalized_data,
                    p.source_refs,
                    nullif(trim(coalesce(p.primary_name, p.display_name, p.canonical_name, p.normalized_data->>'name', '')), '') AS primary_name_ready
                FROM import_review.place_candidates AS p
                WHERE p.id = ${candidateId}
            ),
            child_names AS (
                SELECT
                    nullif(trim(elem->>'name'), '') AS name,
                    nullif(trim(elem->>'language_code'), '') AS language_code,
                    nullif(trim(elem->>'script_code'), '') AS script_code,
                    coalesce(nullif(trim(elem->>'name_type'), ''), 'official') AS name_type,
                    coalesce((elem->>'is_primary')::boolean, false) AS is_primary,
                    coalesce((elem->>'search_weight')::integer, 80) AS search_weight
                FROM src AS s,
                LATERAL jsonb_array_elements(
                    CASE
                        WHEN jsonb_typeof(s.normalized_data->'place_name_candidates') = 'array'
                            THEN s.normalized_data->'place_name_candidates'
                        WHEN jsonb_typeof(s.source_refs->'place_name_candidates') = 'array'
                            THEN s.source_refs->'place_name_candidates'
                        ELSE '[]'::jsonb
                    END
                ) AS elem
                WHERE nullif(trim(elem->>'name'), '') IS NOT NULL
                  AND coalesce(elem->>'name_type', '') <> 'generated'
            ),
            primary_row AS (
                SELECT
                    s.primary_name_ready AS name,
                    NULL::text AS language_code,
                    NULL::text AS script_code,
                    'primary'::text AS name_type,
                    true AS is_primary,
                    100 AS search_weight
                FROM src AS s
                WHERE s.primary_name_ready IS NOT NULL
            ),
            all_names AS (
                SELECT * FROM child_names
                UNION ALL
                SELECT * FROM primary_row
            )
            INSERT INTO core.core_place_names (
                place_id, name, language_code, script_code, name_type, is_primary, search_weight
            )
            SELECT
                ${corePlaceId},
                an.name,
                an.language_code,
                an.script_code,
                an.name_type,
                an.is_primary,
                least(100, greatest(0, an.search_weight))
            FROM all_names AS an
            WHERE an.name IS NOT NULL
            ON CONFLICT DO NOTHING
        `;
    }

    async markPromoted(candidateId: bigint, corePlaceId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_review.place_candidates
            SET
                promotion_status = 'promoted',
                review_status = 'promoted',
                promoted_at = now(),
                promoted_core_id = ${corePlaceId},
                updated_at = now()
            WHERE id = ${candidateId}
        `;
    }

    private listCandidatesByWhere(where: Prisma.Sql): Promise<PlacePromotionCandidateRowDb[]> {
        return this.prisma.$queryRaw<PlacePromotionCandidateRowDb[]>`
            SELECT
                p.id,
                p.review_batch_id,
                p.external_id,
                p.review_status,
                p.promotion_status,
                p.promoted_core_id,
                p.matched_core_id,
                p.matched_core_table,
                CASE
                    WHEN jsonb_array_length(COALESCE(to_jsonb(p.validation_errors), '[]'::jsonb)) > 0 THEN 'blocked'
                    WHEN jsonb_array_length(COALESCE(to_jsonb(p.validation_warnings), '[]'::jsonb)) > 0 THEN 'valid_with_warnings'
                    ELSE 'valid'
                END AS validation_status,
                COALESCE(to_jsonb(p.validation_errors), '[]'::jsonb) AS validation_errors,
                COALESCE(to_jsonb(p.validation_warnings), '[]'::jsonb) AS validation_warnings,
                EXISTS (
                    SELECT 1
                    FROM core.core_places AS cp
                    WHERE cp.deleted_at IS NULL
                      AND p.external_id IS NOT NULL
                      AND btrim(p.external_id) <> ''
                      AND cp.external_id = p.external_id
                ) AS has_core_duplicate
            FROM import_review.place_candidates AS p
            WHERE ${where}
            ORDER BY p.id ASC
        `;
    }
}
