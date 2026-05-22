import { Prisma, type PrismaClient } from "@prisma/client";

export type AddressComponentRowDb = {
    id: bigint;
    address_candidate_id: bigint;
    component_type_id: bigint | null;
    component_type_code: string;
    component_value: string;
    language_code: string;
    source_tag: string | null;
    sort_order: number | null;
    confidence_score: unknown;
    match_type: string | null;
    is_inferred: boolean;
    is_reviewed: boolean;
    is_deleted: boolean;
    source_refs: unknown;
    normalized_data: unknown;
    review_note: string | null;
    source_admin_area_id: bigint | null;
    boundary_status: string | null;
    address_usage: string | null;
    created_at: Date;
    updated_at: Date;
};

export class ImportReviewAddressComponentsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async tableExists(): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass('import_review.address_components') IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    async listByCandidateIds(candidateIds: readonly bigint[]): Promise<AddressComponentRowDb[]> {
        if (candidateIds.length === 0) {
            return [];
        }
        if (!(await this.tableExists())) {
            return [];
        }

        return this.prisma.$queryRaw<AddressComponentRowDb[]>`
            SELECT
                ac.id,
                ac.address_candidate_id,
                ac.component_type_id,
                ac.component_type_code,
                ac.component_value,
                ac.language_code,
                ac.source_tag,
                ac.sort_order,
                ac.confidence_score,
                ac.match_type,
                ac.is_inferred,
                ac.is_reviewed,
                ac.is_deleted,
                ac.source_refs,
                ac.normalized_data,
                ac.review_note,
                ac.source_admin_area_id,
                ac.boundary_status,
                ac.address_usage,
                ac.created_at,
                ac.updated_at
            FROM import_review.address_components AS ac
            WHERE ac.address_candidate_id = ANY(${candidateIds}::bigint[])
              AND ac.is_deleted = false
            ORDER BY
                ac.address_candidate_id ASC,
                ac.sort_order ASC NULLS LAST,
                ac.component_type_code ASC,
                ac.language_code ASC,
                ac.id ASC
        `;
    }
}
