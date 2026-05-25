import { Prisma, type PrismaClient } from "@prisma/client";

import type { AddressValidationIssue } from "./import-review-address-validation.types.js";

export type PlaceAddressLinkValidationRowDb = {
    id: bigint;
    review_batch_id: bigint;
    place_candidate_id: bigint | null;
    address_candidate_id: bigint | null;
    matched_core_place_id: bigint | null;
    matched_core_address_id: bigint | null;
    relation_type: string | null;
    place_candidate_exists: boolean;
    address_candidate_exists: boolean;
    core_place_exists: boolean;
    core_address_exists: boolean;
    place_promotion_ready: boolean;
    address_promotion_ready: boolean;
    duplicate_count: bigint;
};

export class ImportReviewPlaceAddressLinkValidationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async reviewBatchExists(reviewBatchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
                SELECT 1 FROM import_review.review_batches WHERE id = ${reviewBatchId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async listLinksForValidation(args: {
        reviewBatchId?: bigint | undefined;
        linkIds?: readonly bigint[] | undefined;
    }): Promise<PlaceAddressLinkValidationRowDb[]> {
        if (args.linkIds && args.linkIds.length > 0) {
            return this.listLinksByWhere(Prisma.sql`pal.id = ANY(${args.linkIds}::bigint[])`);
        }
        if (args.reviewBatchId === undefined) {
            return [];
        }
        return this.listLinksByWhere(Prisma.sql`pal.review_batch_id = ${args.reviewBatchId}`);
    }

    async persistValidationResult(args: {
        linkId: bigint;
        validationStatus: string;
        validationErrors: AddressValidationIssue[];
        validationWarnings: AddressValidationIssue[];
    }): Promise<void> {
        const errorsJson = JSON.stringify(args.validationErrors);
        const warningsJson = JSON.stringify(args.validationWarnings);
        await this.prisma.$executeRaw`
            UPDATE import_review.place_address_links
            SET
                validation_status = ${args.validationStatus},
                validation_errors = ${errorsJson}::jsonb,
                validation_warnings = ${warningsJson}::jsonb,
                updated_at = now()
            WHERE id = ${args.linkId}
        `;
    }

    private listLinksByWhere(where: Prisma.Sql): Promise<PlaceAddressLinkValidationRowDb[]> {
        return this.prisma.$queryRaw<PlaceAddressLinkValidationRowDb[]>`
            SELECT
                pal.id,
                pal.review_batch_id,
                pal.place_candidate_id,
                pal.address_candidate_id,
                pal.matched_core_place_id,
                pal.matched_core_address_id,
                pal.relation_type,
                (p.id IS NOT NULL) AS place_candidate_exists,
                (a.id IS NOT NULL) AS address_candidate_exists,
                (cp.id IS NOT NULL) AS core_place_exists,
                (ca.id IS NOT NULL) AS core_address_exists,
                (
                    cp.id IS NOT NULL
                    OR p.promotion_status IN ('ready', 'batched', 'promoted')
                    OR (
                        p.review_status = 'approved'
                        AND jsonb_array_length(COALESCE(to_jsonb(p.validation_errors), '[]'::jsonb)) = 0
                    )
                ) AS place_promotion_ready,
                (
                    ca.id IS NOT NULL
                    OR a.promotion_status IN ('ready', 'batched', 'promoted')
                    OR a.validation_status IN ('valid', 'valid_with_warnings', 'passed', 'warnings')
                ) AS address_promotion_ready,
                (
                    SELECT count(*)::bigint
                    FROM import_review.place_address_links AS dup
                    WHERE dup.id <> pal.id
                      AND dup.review_batch_id = pal.review_batch_id
                      AND COALESCE(dup.place_candidate_id, -1) = COALESCE(pal.place_candidate_id, -1)
                      AND COALESCE(dup.address_candidate_id, -1) = COALESCE(pal.address_candidate_id, -1)
                      AND COALESCE(dup.matched_core_place_id, -1) = COALESCE(pal.matched_core_place_id, -1)
                      AND COALESCE(dup.matched_core_address_id, -1) = COALESCE(pal.matched_core_address_id, -1)
                      AND dup.relation_type = pal.relation_type
                ) AS duplicate_count
            FROM import_review.place_address_links AS pal
            LEFT JOIN import_review.place_candidates AS p ON p.id = pal.place_candidate_id
            LEFT JOIN import_review.address_candidates AS a ON a.id = pal.address_candidate_id
            LEFT JOIN core.core_places AS cp
                ON cp.id = pal.matched_core_place_id
               AND cp.deleted_at IS NULL
            LEFT JOIN core.core_addresses AS ca
                ON ca.id = pal.matched_core_address_id
               AND ca.deleted_at IS NULL
            WHERE ${where}
            ORDER BY pal.id ASC
        `;
    }
}
