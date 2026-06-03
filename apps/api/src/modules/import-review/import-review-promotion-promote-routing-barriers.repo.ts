import type { PrismaClient } from "@prisma/client";

import type { PromotionDb } from "./import-review-promotion-db.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    ROUTING_BARRIER_CANDIDATE_TABLE,
    ROUTING_BARRIER_TARGET_TABLE,
} from "./import-review-promotion-routing-barrier-dry-run.repo.js";
import { ImportReviewSchemaCapabilityRegistry } from "./import-review-schema-capabilities.js";

type CandidateRow = {
    publish_item_id: bigint;
    id: bigint;
    review_batch_id: bigint;
    source_snapshot_version: string;
    local_staging_id: bigint;
    external_id: string | null;
    barrier_type: string | null;
    point_geom: unknown;
    source_refs: unknown;
    normalized_data: unknown;
    matched_core_id: bigint | null;
    promoted_core_id: bigint | null;
};

type TargetRow = {
    id: bigint;
    barrier_type: string;
    core_street_id: bigint | null;
};

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function typedBarrierType(row: CandidateRow): string | null {
    const value = row.barrier_type;
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return null;
}

function sourceRefs(row: CandidateRow, publishBatchId: bigint): Record<string, unknown> {
    return {
        ...asRecord(row.source_refs),
        review_candidate_id: row.id.toString(),
        review_batch_id: row.review_batch_id.toString(),
        publish_batch_id: publishBatchId.toString(),
        source_snapshot_version: row.source_snapshot_version,
        local_staging_id: row.local_staging_id.toString(),
        entity_family: "routing_barriers",
    };
}

function normalizedData(row: CandidateRow, dryRunResult: unknown): Record<string, unknown> {
    return {
        ...asRecord(row.normalized_data),
        promotion: {
            promoted_from: "import_review.routing_barrier_candidates",
            promoted_at: new Date().toISOString(),
        },
        routing_barrier_dry_run: dryRunResult ?? null,
    };
}

export class ImportReviewPromotionPromoteRoutingBarriersRepository {
    private readonly schemaRegistry: ImportReviewSchemaCapabilityRegistry;

    constructor(private readonly prisma: PromotionDb) {
        this.schemaRegistry = new ImportReviewSchemaCapabilityRegistry(prisma as PrismaClient);
    }

    async checkRoutingBarrierExists(targetId: bigint): Promise<boolean> {
        const caps = await this.schemaRegistry.getTargetColumnCapabilities(ROUTING_BARRIER_TARGET_TABLE);
        if (!caps.hasColumn("id")) return false;
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM routing.routing_barriers
            WHERE id = ${targetId}
              AND coalesce(is_active, true)
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async insertRoutingBarrier(batchId: bigint, publishItemId: bigint): Promise<PromoteItemResult> {
        return this.upsertRoutingBarrierTx(this.prisma, batchId, publishItemId, "insert");
    }

    async updateRoutingBarrier(batchId: bigint, publishItemId: bigint): Promise<PromoteItemResult> {
        return this.upsertRoutingBarrierTx(this.prisma, batchId, publishItemId, "update");
    }

    async insertRoutingBarrierTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        return this.upsertRoutingBarrierTx(tx, batchId, publishItemId, "insert");
    }

    async updateRoutingBarrierTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        return this.upsertRoutingBarrierTx(tx, batchId, publishItemId, "update");
    }

    async upsertRoutingBarrierTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        mode: "insert" | "update"
    ): Promise<PromoteItemResult> {
        try {
            const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(ROUTING_BARRIER_TARGET_TABLE);
            if (!targetCaps.hasColumn("id") || !targetCaps.hasBarrierType || !targetCaps.hasGeom) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: "routing.routing_barriers target table or required columns are missing.",
                    before_data: null,
                    after_data: null,
                };
            }

            const candidates = await tx.$queryRaw<CandidateRow[]>`
                SELECT
                    spi.id AS publish_item_id,
                    rb.id,
                    rb.review_batch_id,
                    rb.source_snapshot_version,
                    rb.local_staging_id,
                    rb.external_id,
                    rb.barrier_type,
                    rb.point_geom,
                    rb.source_refs,
                    rb.normalized_data,
                    rb.matched_core_id,
                    rb.promoted_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.routing_barrier_candidates AS rb
                    ON rb.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ROUTING_BARRIER_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'routing_barriers'
                LIMIT 1
            `;
            const candidate = candidates[0];
            if (!candidate) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: "Routing barrier candidate not found.",
                    before_data: null,
                    after_data: null,
                };
            }

            const barrierType = typedBarrierType(candidate);
            if (!barrierType) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: "Routing barrier promotion blocked: barrier_type is missing.",
                    before_data: null,
                    after_data: null,
                };
            }

            const dryRun = await this.readDryRunItem(tx, batchId, candidate.id);
            const sourceRefsJson = JSON.stringify(sourceRefs(candidate, batchId));
            const normalizedJson = JSON.stringify(normalizedData(candidate, dryRun));

            const targetId =
                mode === "update"
                    ? (candidate.matched_core_id ?? candidate.promoted_core_id)
                    : await this.findExistingPromotedId(tx, candidate.id);
            const before = targetId ? await this.fetchTargetRow(tx, targetId) : null;

            if (targetId) {
                const updated = await tx.$queryRaw<TargetRow[]>`
                    UPDATE routing.routing_barriers
                    SET barrier_type = ${barrierType},
                        geom = ${candidate.point_geom}::geometry(Point, 4326),
                        source_refs = ${sourceRefsJson}::jsonb,
                        normalized_data = ${normalizedJson}::jsonb,
                        is_active = true,
                        is_verified = false,
                        verification_status = 'unverified',
                        verified_at = NULL,
                        verified_by = NULL,
                        verification_note = NULL,
                        updated_at = now()
                    WHERE id = ${targetId}
                      AND coalesce(is_verified, false) IS FALSE
                    RETURNING id, barrier_type, core_street_id
                `;
                const row = updated[0];
                if (!row) {
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Routing barrier update blocked: target missing or already verified.",
                        before_data: before,
                        after_data: null,
                    };
                }
                return {
                    publish_item_id: publishItemId,
                    outcome: "updated",
                    target_id: row.id,
                    error_message: null,
                    before_data: before,
                    after_data: { id: row.id.toString(), barrier_type: row.barrier_type },
                    verification_metadata_applied: true,
                };
            }

            const inserted = await tx.$queryRaw<TargetRow[]>`
                INSERT INTO routing.routing_barriers (
                    barrier_type,
                    core_street_id,
                    geom,
                    is_active,
                    source_refs,
                    normalized_data,
                    is_verified,
                    verification_status,
                    verified_at,
                    verified_by,
                    verification_note,
                    created_at,
                    updated_at
                )
                SELECT
                    ${barrierType},
                    nearest.core_street_id,
                    ${candidate.point_geom}::geometry(Point, 4326),
                    true,
                    ${sourceRefsJson}::jsonb,
                    ${normalizedJson}::jsonb,
                    false,
                    'unverified',
                    NULL,
                    NULL,
                    NULL,
                    now(),
                    now()
                FROM (
                    SELECT ${candidate.point_geom}::geometry(Point, 4326) AS geom
                ) src
                LEFT JOIN LATERAL (
                    SELECT s.id AS core_street_id
                    FROM core.core_streets AS s
                    WHERE s.geom IS NOT NULL
                      AND coalesce(s.is_active, true)
                      AND s.deleted_at IS NULL
                      AND s.geom && ST_Expand(src.geom, ${30 / 111320.0})
                    ORDER BY s.geom <-> src.geom
                    LIMIT 1
                ) nearest ON true
                WHERE src.geom IS NOT NULL
                  AND ST_IsValid(src.geom)
                  AND ST_SRID(src.geom) = 4326
                  AND ST_GeometryType(src.geom) = 'ST_Point'
                RETURNING id, barrier_type, core_street_id
            `;
            const row = inserted[0];
            if (!row) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: "Routing barrier insert blocked: invalid/missing point geometry.",
                    before_data: null,
                    after_data: null,
                };
            }
            return {
                publish_item_id: publishItemId,
                outcome: "inserted",
                target_id: row.id,
                error_message: null,
                before_data: null,
                after_data: {
                    id: row.id.toString(),
                    barrier_type: row.barrier_type,
                    core_street_id: row.core_street_id?.toString() ?? null,
                },
                verification_metadata_applied: true,
            };
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Routing barrier promotion failed.",
                before_data: null,
                after_data: null,
            };
        }
    }

    private async fetchTargetRow(
        tx: PromotionDb,
        targetId: bigint
    ): Promise<Record<string, unknown> | null> {
        const rows = await tx.$queryRaw<{ data: unknown }[]>`
            SELECT to_jsonb(rb.*) AS data
            FROM routing.routing_barriers AS rb
            WHERE rb.id = ${targetId}
            LIMIT 1
        `;
        return asRecord(rows[0]?.data);
    }

    private async findExistingPromotedId(tx: PromotionDb, candidateId: bigint): Promise<bigint | null> {
        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM routing.routing_barriers
            WHERE source_refs->>'entity_family' = 'routing_barriers'
              AND source_refs->>'review_candidate_id' = ${candidateId.toString()}
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    private async readDryRunItem(tx: PromotionDb, batchId: bigint, candidateId: bigint): Promise<unknown> {
        const rows = await tx.$queryRaw<{ item: unknown }[]>`
            SELECT item
            FROM system.system_publish_batches AS pb,
                 jsonb_array_elements(coalesce(pb.summary->'routing_barrier_dry_run_result'->'items', '[]'::jsonb)) AS item
            WHERE pb.id = ${batchId}
              AND item->>'review_candidate_id' = ${candidateId.toString()}
            LIMIT 1
        `;
        return rows[0]?.item ?? null;
    }
}
