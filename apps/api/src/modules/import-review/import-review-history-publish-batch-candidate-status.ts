import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { getImportReviewPromotionCandidateTable } from "./import-review-promotion-config.js";

/**
 * @deprecated Do not use for History after candidate cleanup.
 * Prefer durable fields on system.system_publish_items (before_data /
 * validation_result / after_data, and migration 139 columns).
 */

export type PublishBatchItemCandidateStatusRow = {
    review_candidate_id: bigint;
    entity_family: string;
    promotion_status: string | null;
};

export async function fetchCandidatePromotionStatusByFamily(
    prisma: PrismaClient,
    entityFamily: string,
    candidateIds: readonly bigint[]
): Promise<Map<string, string | null>> {
    if (candidateIds.length === 0) {
        return new Map();
    }
    const candidateTable = getImportReviewPromotionCandidateTable(
        entityFamily as ImportReviewEntityFamilySlug
    );
    const rows = await prisma.$queryRaw<{ id: bigint; promotion_status: string | null }[]>`
        SELECT id, promotion_status
        FROM ${Prisma.raw(candidateTable)}
        WHERE id IN (${Prisma.join(candidateIds)})
    `;
    const out = new Map<string, string | null>();
    for (const row of rows) {
        out.set(row.id.toString(), row.promotion_status);
    }
    return out;
}

export async function enrichPublishBatchItemsWithCandidatePromotionStatus<
    T extends { entity_family: string; review_candidate_id: bigint | null },
>(
    prisma: PrismaClient,
    rows: readonly T[]
): Promise<(T & { candidate_promotion_status: string | null })[]> {
    const idsByFamily = new Map<string, bigint[]>();
    for (const row of rows) {
        if (row.review_candidate_id == null) {
            continue;
        }
        const family = row.entity_family.trim();
        if (!family) {
            continue;
        }
        const list = idsByFamily.get(family) ?? [];
        list.push(row.review_candidate_id);
        idsByFamily.set(family, list);
    }

    const statusByFamilyAndId = new Map<string, Map<string, string | null>>();
    for (const [family, ids] of idsByFamily) {
        const unique = [...new Set(ids.map((id) => id.toString()))].map((s) => BigInt(s));
        statusByFamilyAndId.set(family, await fetchCandidatePromotionStatusByFamily(prisma, family, unique));
    }

    return rows.map((row) => {
        const candidateId = row.review_candidate_id?.toString() ?? null;
        const familyStatuses = statusByFamilyAndId.get(row.entity_family);
        const candidate_promotion_status =
            candidateId && familyStatuses ? (familyStatuses.get(candidateId) ?? null) : null;
        return { ...row, candidate_promotion_status };
    });
}
