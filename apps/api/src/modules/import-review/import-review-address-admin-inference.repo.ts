import type { PrismaClient } from "@prisma/client";

export type AddressAdminInferenceRunRow = {
    candidates_with_point: bigint;
    candidates_matched: bigint;
    components_inserted: bigint;
    candidates_updated: bigint;
};

export type AddressAdminInferenceVerification = {
    matched_admin_area_count: bigint;
    candidates_with_point: bigint;
    components_by_type_language: Array<{
        component_type_code: string;
        language_code: string;
        row_count: bigint;
    }>;
    sample_components: Array<{
        address_candidate_id: bigint;
        component_type_code: string;
        language_code: string;
        component_value: string;
        match_type: string | null;
        confidence_score: unknown;
        boundary_status: string | null;
        address_usage: string | null;
        source_admin_area_id: bigint | null;
    }>;
};

export class ImportReviewAddressAdminInferenceRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async runInference(args: {
        reviewBatchId: bigint;
        nearestVillageMeters?: number | undefined;
    }): Promise<AddressAdminInferenceRunRow> {
        const meters = args.nearestVillageMeters ?? 3000;
        const rows = await this.prisma.$queryRaw<AddressAdminInferenceRunRow[]>`
            SELECT *
            FROM import_review.infer_address_admin_components(
                ${args.reviewBatchId},
                ${meters}::double precision
            )
        `;
        const row = rows[0];
        if (!row) {
            return {
                candidates_with_point: 0n,
                candidates_matched: 0n,
                components_inserted: 0n,
                candidates_updated: 0n,
            };
        }
        return row;
    }

    async getVerification(reviewBatchId: bigint): Promise<AddressAdminInferenceVerification> {
        const [counts, byType, samples] = await Promise.all([
            this.prisma.$queryRaw<
                Array<{
                    matched_admin_area_count: bigint;
                    candidates_with_point: bigint;
                }>
            >`
                SELECT
                    count(*) FILTER (WHERE matched_admin_area_id IS NOT NULL)::bigint
                        AS matched_admin_area_count,
                    count(*)::bigint AS candidates_with_point
                FROM import_review.address_candidates
                WHERE review_batch_id = ${reviewBatchId}
                  AND point_geom IS NOT NULL
                  AND NOT ST_IsEmpty(point_geom)
            `,
            this.prisma.$queryRaw<
                Array<{
                    component_type_code: string;
                    language_code: string;
                    row_count: bigint;
                }>
            >`
                SELECT
                    ac.component_type_code,
                    ac.language_code,
                    count(*)::bigint AS row_count
                FROM import_review.address_components AS ac
                INNER JOIN import_review.address_candidates AS c
                    ON c.id = ac.address_candidate_id
                WHERE c.review_batch_id = ${reviewBatchId}
                  AND ac.is_deleted = false
                  AND ac.source_admin_area_id IS NOT NULL
                GROUP BY ac.component_type_code, ac.language_code
                ORDER BY ac.component_type_code, ac.language_code
            `,
            this.prisma.$queryRaw<
                AddressAdminInferenceVerification["sample_components"]
            >`
                SELECT
                    ac.address_candidate_id,
                    ac.component_type_code,
                    ac.language_code,
                    ac.component_value,
                    ac.match_type,
                    ac.confidence_score,
                    ac.boundary_status,
                    ac.address_usage,
                    ac.source_admin_area_id
                FROM import_review.address_components AS ac
                INNER JOIN import_review.address_candidates AS c
                    ON c.id = ac.address_candidate_id
                WHERE c.review_batch_id = ${reviewBatchId}
                  AND ac.source_admin_area_id IS NOT NULL
                  AND ac.is_deleted = false
                ORDER BY
                    ac.address_candidate_id,
                    ac.component_type_code,
                    ac.language_code
                LIMIT 30
            `,
        ]);

        const countRow = counts[0] ?? {
            matched_admin_area_count: 0n,
            candidates_with_point: 0n,
        };

        return {
            matched_admin_area_count: countRow.matched_admin_area_count,
            candidates_with_point: countRow.candidates_with_point,
            components_by_type_language: byType,
            sample_components: samples,
        };
    }

    async reviewBatchExists(reviewBatchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
                SELECT 1
                FROM import_review.review_batches AS rb
                WHERE rb.id = ${reviewBatchId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async inferenceFunctionExists(): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
                SELECT 1
                FROM pg_proc AS p
                INNER JOIN pg_namespace AS n ON n.oid = p.pronamespace
                WHERE n.nspname = 'import_review'
                  AND p.proname = 'infer_address_admin_components'
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }
}
