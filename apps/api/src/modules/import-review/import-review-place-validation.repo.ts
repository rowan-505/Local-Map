import { Prisma, type PrismaClient } from "@prisma/client";

import type { AddressValidationIssue } from "./import-review-address-validation.types.js";

export type PlaceCandidateValidationRowDb = {
    id: bigint;
    review_batch_id: bigint;
    display_name: string | null;
    primary_name: string | null;
    canonical_name: string | null;
    class_code: string | null;
    category_id: bigint | null;
    place_class_id: bigint | null;
    admin_area_id: bigint | null;
    has_usable_geometry: boolean;
    can_infer_admin_area: boolean;
    has_core_duplicate: boolean;
    has_linked_address: boolean;
    weakest_linked_address_strength: string | null;
    has_english_name: boolean;
    has_myanmar_name: boolean;
    has_contact_info: boolean;
};

export class ImportReviewPlaceValidationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async reviewBatchExists(reviewBatchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
                SELECT 1 FROM import_review.review_batches WHERE id = ${reviewBatchId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async listCandidatesForValidation(args: {
        reviewBatchId?: bigint | undefined;
        candidateIds?: readonly bigint[] | undefined;
    }): Promise<PlaceCandidateValidationRowDb[]> {
        if (args.candidateIds && args.candidateIds.length > 0) {
            return this.listCandidatesByWhere(Prisma.sql`p.id = ANY(${args.candidateIds}::bigint[])`);
        }
        if (args.reviewBatchId === undefined) {
            return [];
        }
        return this.listCandidatesByWhere(Prisma.sql`p.review_batch_id = ${args.reviewBatchId}`);
    }

    async persistValidationResult(args: {
        candidateId: bigint;
        validationErrors: AddressValidationIssue[];
        validationWarnings: AddressValidationIssue[];
    }): Promise<void> {
        const errorsJson = JSON.stringify(args.validationErrors);
        const warningsJson = JSON.stringify(args.validationWarnings);
        await this.prisma.$executeRaw`
            UPDATE import_review.place_candidates
            SET
                validation_errors = ${errorsJson}::jsonb,
                validation_warnings = ${warningsJson}::jsonb,
                updated_at = now()
            WHERE id = ${args.candidateId}
        `;
    }

    private listCandidatesByWhere(where: Prisma.Sql): Promise<PlaceCandidateValidationRowDb[]> {
        return this.prisma.$queryRaw<PlaceCandidateValidationRowDb[]>`
            SELECT
                p.id,
                p.review_batch_id,
                p.display_name,
                p.primary_name,
                p.canonical_name,
                p.class_code,
                p.category_id,
                p.place_class_id,
                p.admin_area_id,
                (
                    (p.point_geom IS NOT NULL AND NOT ST_IsEmpty(p.point_geom))
                    OR (p.entry_geom IS NOT NULL AND NOT ST_IsEmpty(p.entry_geom))
                    OR (p.footprint_geom IS NOT NULL AND NOT ST_IsEmpty(p.footprint_geom))
                ) AS has_usable_geometry,
                (
                    p.admin_area_id IS NOT NULL
                    OR EXISTS (
                        SELECT 1
                        FROM core.core_admin_areas AS aa
                        WHERE aa.deleted_at IS NULL
                          AND aa.is_active IS TRUE
                          AND aa.geom IS NOT NULL
                          AND NOT ST_IsEmpty(aa.geom)
                          AND p.point_geom IS NOT NULL
                          AND NOT ST_IsEmpty(p.point_geom)
                          AND ST_Covers(aa.geom, p.point_geom)
                    )
                ) AS can_infer_admin_area,
                EXISTS (
                    SELECT 1
                    FROM core.core_places AS cp
                    WHERE cp.deleted_at IS NULL
                      AND (
                          (
                              p.external_id IS NOT NULL
                              AND btrim(p.external_id) <> ''
                              AND cp.external_id = p.external_id
                          )
                          OR (
                              p.point_geom IS NOT NULL
                              AND NOT ST_IsEmpty(p.point_geom)
                              AND cp.point_geom IS NOT NULL
                              AND NOT ST_IsEmpty(cp.point_geom)
                              AND ST_DWithin(cp.point_geom::geography, p.point_geom::geography, 30)
                              AND lower(btrim(coalesce(cp.display_name, cp.primary_name, ''))) =
                                  lower(btrim(coalesce(p.display_name, p.primary_name, p.canonical_name, '')))
                              AND btrim(coalesce(p.display_name, p.primary_name, p.canonical_name, '')) <> ''
                          )
                      )
                ) AS has_core_duplicate,
                EXISTS (
                    SELECT 1
                    FROM import_review.place_address_links AS pal
                    WHERE pal.place_candidate_id = p.id
                ) AS has_linked_address,
                (
                    SELECT a.address_strength
                    FROM import_review.place_address_links AS pal
                    INNER JOIN import_review.address_candidates AS a ON a.id = pal.address_candidate_id
                    WHERE pal.place_candidate_id = p.id
                    ORDER BY CASE a.address_strength
                        WHEN 'none' THEN 0
                        WHEN 'weak' THEN 1
                        WHEN 'partial' THEN 2
                        WHEN 'strong' THEN 3
                        WHEN 'full' THEN 4
                        ELSE 5
                    END ASC
                    LIMIT 1
                ) AS weakest_linked_address_strength,
                (
                    NULLIF(btrim(p.normalized_data->>'name_en'), '') IS NOT NULL
                    OR NULLIF(btrim(p.source_refs->'tags'->>'name:en'), '') IS NOT NULL
                    OR EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements(
                            CASE
                                WHEN jsonb_typeof(p.normalized_data->'place_name_candidates') = 'array'
                                    THEN p.normalized_data->'place_name_candidates'
                                ELSE '[]'::jsonb
                            END
                        ) AS n(item)
                        WHERE lower(n.item->>'language_code') = 'en'
                          AND NULLIF(btrim(n.item->>'name'), '') IS NOT NULL
                    )
                ) AS has_english_name,
                (
                    NULLIF(btrim(p.normalized_data->>'name_my'), '') IS NOT NULL
                    OR NULLIF(btrim(p.source_refs->'tags'->>'name:my'), '') IS NOT NULL
                    OR NULLIF(btrim(p.source_refs->'tags'->>'name:mm'), '') IS NOT NULL
                    OR EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements(
                            CASE
                                WHEN jsonb_typeof(p.normalized_data->'place_name_candidates') = 'array'
                                    THEN p.normalized_data->'place_name_candidates'
                                ELSE '[]'::jsonb
                            END
                        ) AS n(item)
                        WHERE lower(n.item->>'language_code') = 'my'
                          AND NULLIF(btrim(n.item->>'name'), '') IS NOT NULL
                    )
                ) AS has_myanmar_name,
                (
                    NULLIF(btrim(p.normalized_data->>'phone'), '') IS NOT NULL
                    OR NULLIF(btrim(p.normalized_data->>'email'), '') IS NOT NULL
                    OR NULLIF(btrim(p.normalized_data->>'website'), '') IS NOT NULL
                    OR NULLIF(btrim(p.normalized_data->>'opening_hours'), '') IS NOT NULL
                    OR NULLIF(btrim(p.source_refs->'tags'->>'phone'), '') IS NOT NULL
                    OR NULLIF(btrim(p.source_refs->'tags'->>'email'), '') IS NOT NULL
                    OR NULLIF(btrim(p.source_refs->'tags'->>'website'), '') IS NOT NULL
                    OR NULLIF(btrim(p.source_refs->'tags'->>'opening_hours'), '') IS NOT NULL
                ) AS has_contact_info
            FROM import_review.place_candidates AS p
            WHERE ${where}
            ORDER BY p.id ASC
        `;
    }
}
