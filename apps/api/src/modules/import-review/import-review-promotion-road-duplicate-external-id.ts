import { Prisma, type PrismaClient, type Prisma as PrismaNamespace } from "@prisma/client";

type RoadDuplicateDb = PrismaClient | PrismaNamespace.TransactionClient;

export const ROAD_DUPLICATE_INSERT_TO_UPDATE_CODE = "duplicate_insert_converted_to_update";
export const ROAD_DUPLICATE_INSERT_TO_UPDATE_MESSAGE =
    "Existing core road found; action changed from insert to update.";

export type RoadDuplicateReconcileScope = {
    reviewBatchId?: bigint;
    candidateIds?: readonly bigint[];
    publishBatchId?: bigint;
};

export type RoadDuplicateReconcileSample = {
    candidate_id: bigint;
    external_id: string | null;
    action: "converted_to_update" | "blocked_duplicate" | "in_review_duplicate";
    message: string;
    core_street_id: bigint | null;
};

export type RoadDuplicateReconcileResult = {
    core_converted_count: number;
    core_blocked_count: number;
    in_review_duplicate_count: number;
    publish_items_synced_count: number;
    samples: RoadDuplicateReconcileSample[];
};

function buildCandidateScope(scope: RoadDuplicateReconcileScope): Prisma.Sql {
    if (scope.candidateIds && scope.candidateIds.length > 0) {
        const parts: Prisma.Sql[] = [Prisma.sql`rc.id IN (${Prisma.join(scope.candidateIds)})`];
        if (scope.reviewBatchId != null) {
            parts.push(Prisma.sql`rc.review_batch_id = ${scope.reviewBatchId}`);
        }
        return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
    }
    if (scope.publishBatchId != null) {
        return Prisma.sql`
            EXISTS (
                SELECT 1
                FROM system.system_publish_items AS spi
                WHERE spi.review_candidate_id = rc.id
                  AND spi.entity_family = 'roads'
                  AND spi.publish_batch_id = ${scope.publishBatchId}
            )
        `;
    }
    if (scope.reviewBatchId != null) {
        return Prisma.sql`rc.review_batch_id = ${scope.reviewBatchId}`;
    }
    return Prisma.sql`FALSE`;
}

function buildPublishItemScope(scope: RoadDuplicateReconcileScope): Prisma.Sql {
    if (scope.publishBatchId != null) {
        return Prisma.sql`spi.publish_batch_id = ${scope.publishBatchId}`;
    }
    if (scope.candidateIds && scope.candidateIds.length > 0) {
        return Prisma.sql`spi.review_candidate_id IN (${Prisma.join(scope.candidateIds)})`;
    }
    if (scope.reviewBatchId != null) {
        return Prisma.sql`
            EXISTS (
                SELECT 1
                FROM import_review.road_candidates AS rc
                WHERE rc.id = spi.review_candidate_id
                  AND rc.review_batch_id = ${scope.reviewBatchId}
            )
        `;
    }
    return Prisma.sql`FALSE`;
}

const ACTIVE_CORE_STREET_MATCH = Prisma.sql`
    coalesce(c.is_active, true)
    AND c.deleted_at IS NULL
    AND nullif(trim(coalesce(c.external_id, '')), '') IS NOT NULL
`;

const INSERT_CANDIDATE_PREDICATE = Prisma.sql`
    coalesce(rc.auto_action, '') = 'insert_candidate'
    AND coalesce(rc.match_status, '') = 'new_auto'
    AND rc.matched_core_id IS NULL
    AND nullif(trim(coalesce(rc.external_id, '')), '') IS NOT NULL
`;

/**
 * Detect active core.core_streets by external_id and reconcile road_candidates safely.
 */
export async function reconcileRoadDuplicateExternalIds(
    prisma: RoadDuplicateDb,
    scope: RoadDuplicateReconcileScope
): Promise<RoadDuplicateReconcileResult> {
    const candidateScope = buildCandidateScope(scope);
    const samples: RoadDuplicateReconcileSample[] = [];

    const converted = await prisma.$queryRaw<
        { id: bigint; external_id: string | null; core_street_id: bigint }[]
    >`
        WITH core_matches AS (
            SELECT
                rc.id,
                rc.external_id,
                c.id AS core_street_id
            FROM import_review.road_candidates AS rc
            INNER JOIN core.core_streets AS c
                ON c.external_id = rc.external_id
            WHERE ${candidateScope}
              AND ${INSERT_CANDIDATE_PREDICATE}
              AND ${ACTIVE_CORE_STREET_MATCH}
              AND rc.review_status = 'approved'
              AND rc.review_decision = 'approved'
        )
        UPDATE import_review.road_candidates AS rc
        SET
            matched_core_id = m.core_street_id,
            auto_action = 'update_candidate',
            match_status = 'matched_auto_update',
            updated_at = now()
        FROM core_matches AS m
        WHERE rc.id = m.id
        RETURNING rc.id, rc.external_id, m.core_street_id
    `;

    for (const row of converted) {
        if (samples.length < 20) {
            samples.push({
                candidate_id: row.id,
                external_id: row.external_id,
                action: "converted_to_update",
                message: ROAD_DUPLICATE_INSERT_TO_UPDATE_MESSAGE,
                core_street_id: row.core_street_id,
            });
        }
    }

    const blocked = await prisma.$queryRaw<
        { id: bigint; external_id: string | null; core_street_id: bigint }[]
    >`
        WITH core_matches AS (
            SELECT
                rc.id,
                rc.external_id,
                c.id AS core_street_id
            FROM import_review.road_candidates AS rc
            INNER JOIN core.core_streets AS c
                ON c.external_id = rc.external_id
            WHERE ${candidateScope}
              AND ${INSERT_CANDIDATE_PREDICATE}
              AND ${ACTIVE_CORE_STREET_MATCH}
              AND NOT (
                  rc.review_status = 'approved'
                  AND rc.review_decision = 'approved'
              )
        )
        UPDATE import_review.road_candidates AS rc
        SET
            matched_core_id = m.core_street_id,
            match_status = 'duplicate_candidate',
            auto_action = 'skip_candidate',
            review_status = 'needs_review',
            updated_at = now()
        FROM core_matches AS m
        WHERE rc.id = m.id
        RETURNING rc.id, rc.external_id, m.core_street_id
    `;

    for (const row of blocked) {
        if (samples.length < 20) {
            samples.push({
                candidate_id: row.id,
                external_id: row.external_id,
                action: "blocked_duplicate",
                message:
                    "Active core road exists for external_id; candidate requires review before promotion.",
                core_street_id: row.core_street_id,
            });
        }
    }

    const inReviewDup = await prisma.$queryRaw<
        { id: bigint; external_id: string | null }[]
    >`
        WITH scoped AS (
            SELECT
                rc.id,
                rc.external_id,
                rc.review_batch_id,
                rc.review_status,
                rc.review_decision,
                rc.auto_action,
                rc.match_status
            FROM import_review.road_candidates AS rc
            WHERE ${candidateScope}
              AND nullif(trim(coalesce(rc.external_id, '')), '') IS NOT NULL
              AND coalesce(rc.auto_action, '') IS DISTINCT FROM 'skip_candidate'
              AND coalesce(rc.match_status, '') IS DISTINCT FROM 'duplicate_candidate'
              AND rc.promoted_core_id IS NULL
        ),
        ranked AS (
            SELECT
                s.*,
                row_number() OVER (
                    PARTITION BY s.review_batch_id, lower(trim(s.external_id))
                    ORDER BY
                        CASE
                            WHEN s.review_status = 'approved' AND s.review_decision = 'approved'
                                THEN 0
                            WHEN s.review_status = 'approved' THEN 1
                            ELSE 2
                        END,
                        s.id ASC
                ) AS rn
            FROM scoped AS s
        ),
        losers AS (
            SELECT id, external_id
            FROM ranked
            WHERE rn > 1
        )
        UPDATE import_review.road_candidates AS rc
        SET
            match_status = 'duplicate_candidate',
            auto_action = 'skip_candidate',
            review_status = 'needs_review',
            updated_at = now()
        FROM losers AS l
        WHERE rc.id = l.id
        RETURNING rc.id, rc.external_id
    `;

    for (const row of inReviewDup) {
        if (samples.length < 20) {
            samples.push({
                candidate_id: row.id,
                external_id: row.external_id,
                action: "in_review_duplicate",
                message:
                    "Duplicate external_id within import-review; another candidate is preferred for promotion.",
                core_street_id: null,
            });
        }
    }

    const publishItemScope = buildPublishItemScope(scope);
    const synced = await prisma.$executeRaw`
        UPDATE system.system_publish_items AS spi
        SET publish_action = CASE
            WHEN rc.auto_action = 'skip_candidate'
                OR rc.match_status = 'duplicate_candidate'
                THEN spi.publish_action
            WHEN rc.auto_action = 'update_candidate'
                OR rc.matched_core_id IS NOT NULL
                THEN 'update'
            WHEN rc.match_status = 'duplicate_candidate' AND rc.review_decision = 'merged'
                THEN 'merge'
            ELSE 'insert'
        END
        FROM import_review.road_candidates AS rc
        WHERE spi.entity_family = 'roads'
          AND spi.review_candidate_id = rc.id
          AND spi.publish_status = 'pending'
          AND ${publishItemScope}
    `;

    return {
        core_converted_count: converted.length,
        core_blocked_count: blocked.length,
        in_review_duplicate_count: inReviewDup.length,
        publish_items_synced_count: Number(synced),
        samples,
    };
}

/** Final promotion guard: never INSERT when core row exists for candidate external_id. */
export async function resolveRoadPromotionActionForPublishItem(
    prisma: PrismaClient,
    batchId: bigint,
    publishItemId: bigint
): Promise<"insert" | "update"> {
    const rows = await prisma.$queryRaw<
        { publish_action: string; auto_action: string | null; matched_core_id: bigint | null }[]
    >`
        SELECT
            spi.publish_action,
            r.auto_action,
            r.matched_core_id
        FROM system.system_publish_items AS spi
        INNER JOIN import_review.road_candidates AS r ON r.id = spi.review_candidate_id
        WHERE spi.id = ${publishItemId}
          AND spi.publish_batch_id = ${batchId}
          AND spi.entity_family = 'roads'
        LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
        return "insert";
    }
    if (
        row.auto_action === "update_candidate" ||
        row.matched_core_id != null ||
        row.publish_action === "update" ||
        row.publish_action === "merge"
    ) {
        return "update";
    }
    const dup = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.road_candidates AS r ON r.id = spi.review_candidate_id
            INNER JOIN core.core_streets AS c ON c.external_id = r.external_id
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
              AND nullif(trim(coalesce(r.external_id, '')), '') IS NOT NULL
              AND ${ACTIVE_CORE_STREET_MATCH}
        ) AS exists
    `;
    if (dup[0]?.exists === true) {
        return "update";
    }
    return row.publish_action === "update" ? "update" : "insert";
}
