import type { PrismaClient } from "@prisma/client";

export type AddressComponentUpsertRow = {
    id?: bigint | undefined;
    component_type_code: string;
    component_value: string;
    language_code: string;
    confidence_score?: number | null | undefined;
    match_type?: string | null | undefined;
    is_reviewed?: boolean | undefined;
};

export class ImportReviewAddressComponentsMutationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async candidateExists(candidateId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
                SELECT 1 FROM import_review.address_candidates WHERE id = ${candidateId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async isComponentTypeValid(code: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
            SELECT EXISTS (
                SELECT 1 FROM ref.ref_address_component_types WHERE code = ${code}
            ) AS ok
        `;
        return rows[0]?.ok === true;
    }

    async softDeleteComponents(candidateId: bigint, ids: readonly bigint[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }
        await this.prisma.$executeRaw`
            UPDATE import_review.address_components
            SET is_deleted = true, updated_at = now()
            WHERE address_candidate_id = ${candidateId}
              AND id = ANY(${ids}::bigint[])
              AND is_deleted = false
        `;
    }

    async upsertComponent(candidateId: bigint, row: AddressComponentUpsertRow): Promise<bigint> {
        const value = row.component_value.trim();
        if (value === "") {
            throw new Error("component_value cannot be empty");
        }

        if (row.id !== undefined) {
            const updated = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
                UPDATE import_review.address_components AS ac
                SET
                    component_type_code = ${row.component_type_code},
                    component_value = ${value},
                    language_code = ${row.language_code},
                    confidence_score = ${row.confidence_score ?? null},
                    match_type = ${row.match_type ?? null},
                    is_reviewed = coalesce(${row.is_reviewed ?? null}::boolean, ac.is_reviewed),
                    is_inferred = false,
                    sort_order = coalesce(ac.sort_order, rt.rank),
                    component_type_id = coalesce(ac.component_type_id, rt.id),
                    updated_at = now()
                FROM ref.ref_address_component_types AS rt
                WHERE ac.id = ${row.id}
                  AND ac.address_candidate_id = ${candidateId}
                  AND ac.is_deleted = false
                  AND rt.code = ${row.component_type_code}
                RETURNING ac.id
            `;
            const id = updated[0]?.id;
            if (id === undefined) {
                throw new Error(`Component id=${row.id.toString()} not found on candidate`);
            }
            return id;
        }

        const inserted = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            INSERT INTO import_review.address_components (
                address_candidate_id,
                component_type_id,
                component_type_code,
                component_value,
                language_code,
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
                ${candidateId},
                rt.id,
                ${row.component_type_code},
                ${value},
                ${row.language_code},
                rt.rank,
                ${row.confidence_score ?? null},
                ${row.match_type ?? null},
                false,
                coalesce(${row.is_reviewed ?? false}::boolean, false),
                false,
                jsonb_build_object('source', 'dashboard_edit'),
                jsonb_build_object('source', 'dashboard_edit')
            FROM ref.ref_address_component_types AS rt
            WHERE rt.code = ${row.component_type_code}
              AND NOT EXISTS (
                  SELECT 1
                  FROM import_review.address_components AS ac
                  WHERE ac.address_candidate_id = ${candidateId}
                    AND ac.component_type_code = ${row.component_type_code}
                    AND ac.language_code = ${row.language_code}
                    AND ac.component_value = ${value}
                    AND ac.is_deleted = false
              )
            RETURNING id
        `;
        const id = inserted[0]?.id;
        if (id === undefined) {
            const existing = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
                SELECT id
                FROM import_review.address_components
                WHERE address_candidate_id = ${candidateId}
                  AND component_type_code = ${row.component_type_code}
                  AND language_code = ${row.language_code}
                  AND component_value = ${value}
                  AND is_deleted = false
                LIMIT 1
            `;
            if (existing[0]) {
                return existing[0].id;
            }
            throw new Error("Failed to insert address component");
        }
        return id;
    }
}
