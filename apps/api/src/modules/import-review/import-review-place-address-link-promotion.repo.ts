import { Prisma, type PrismaClient } from "@prisma/client";

export type ImportReviewPlaceAddressLinkPromotionDb = PrismaClient | Prisma.TransactionClient;

export type PlaceAddressLinkPromotionRowDb = {
    id: bigint;
    review_batch_id: bigint;
    external_id: string | null;
    review_status: string | null;
    validation_status: string | null;
    validation_errors: unknown;
    validation_warnings: unknown;
    promotion_status: string | null;
    resolved_core_place_id: bigint | null;
    resolved_core_address_id: bigint | null;
    relation_type: string | null;
    is_primary: boolean | null;
    place_exists_in_core: boolean;
    address_exists_in_core: boolean;
    duplicate_core_link: boolean;
};

export class ImportReviewPlaceAddressLinkPromotionRepository {
    constructor(private readonly prisma: ImportReviewPlaceAddressLinkPromotionDb) {}

    async reviewBatchExists(reviewBatchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
                SELECT 1 FROM import_review.review_batches WHERE id = ${reviewBatchId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async listLinks(args: {
        reviewBatchId?: bigint | undefined;
        linkIds?: readonly bigint[] | undefined;
    }): Promise<PlaceAddressLinkPromotionRowDb[]> {
        if (args.linkIds && args.linkIds.length > 0) {
            return this.listLinksByWhere(Prisma.sql`pal.id = ANY(${args.linkIds}::bigint[])`);
        }
        if (args.reviewBatchId === undefined) {
            return [];
        }
        return this.listLinksByWhere(Prisma.sql`pal.review_batch_id = ${args.reviewBatchId}`);
    }

    async insertCorePlaceAddress(args: {
        placeId: bigint;
        addressId: bigint;
        relationType: string;
        isPrimary: boolean;
    }): Promise<boolean> {
        const result = await this.prisma.$executeRaw`
            INSERT INTO core.core_place_addresses (place_id, address_id, relation_type, is_primary)
            VALUES (${args.placeId}, ${args.addressId}, ${args.relationType}, ${args.isPrimary})
            ON CONFLICT (place_id, address_id) DO NOTHING
        `;
        return result > 0;
    }

    async markPromoted(linkId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_review.place_address_links
            SET
                promotion_status = 'promoted',
                review_status = 'promoted',
                updated_at = now()
            WHERE id = ${linkId}
        `;
    }

    private listLinksByWhere(where: Prisma.Sql): Promise<PlaceAddressLinkPromotionRowDb[]> {
        return this.prisma.$queryRaw<PlaceAddressLinkPromotionRowDb[]>`
            WITH resolved AS (
                SELECT
                    pal.id,
                    pal.review_batch_id,
                    pal.external_id,
                    pal.review_status,
                    pal.validation_status,
                    COALESCE(to_jsonb(pal.validation_errors), '[]'::jsonb) AS validation_errors,
                    COALESCE(to_jsonb(pal.validation_warnings), '[]'::jsonb) AS validation_warnings,
                    pal.promotion_status,
                    COALESCE(
                        pal.matched_core_place_id,
                        p.promoted_core_id,
                        CASE
                            WHEN p.matched_core_table IN ('core_places', 'core.core_places') THEN p.matched_core_id
                            ELSE NULL
                        END
                    ) AS resolved_core_place_id,
                    COALESCE(
                        pal.matched_core_address_id,
                        a.promoted_core_address_id,
                        a.promoted_core_id
                    ) AS resolved_core_address_id,
                    pal.relation_type,
                    pal.is_primary
                FROM import_review.place_address_links AS pal
                LEFT JOIN import_review.place_candidates AS p ON p.id = pal.place_candidate_id
                LEFT JOIN import_review.address_candidates AS a ON a.id = pal.address_candidate_id
                WHERE ${where}
            )
            SELECT
                r.*,
                (cp.id IS NOT NULL) AS place_exists_in_core,
                (ca.id IS NOT NULL) AS address_exists_in_core,
                EXISTS (
                    SELECT 1
                    FROM core.core_place_addresses AS cpa
                    WHERE cpa.place_id = r.resolved_core_place_id
                      AND cpa.address_id = r.resolved_core_address_id
                ) AS duplicate_core_link
            FROM resolved AS r
            LEFT JOIN core.core_places AS cp
                ON cp.id = r.resolved_core_place_id
               AND cp.deleted_at IS NULL
            LEFT JOIN core.core_addresses AS ca
                ON ca.id = r.resolved_core_address_id
               AND ca.deleted_at IS NULL
            ORDER BY r.id ASC
        `;
    }
}
