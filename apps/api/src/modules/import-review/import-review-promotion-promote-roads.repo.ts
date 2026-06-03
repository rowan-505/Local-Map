import { Prisma } from "@prisma/client";

import type { PromotionDb } from "./import-review-promotion-db.js";

import { deriveImportReviewNames, type ImportReviewNameCandidate } from "./import-review-name-fields.js";
import {
    buildVerificationMetadataTracking,
    coreVerificationInsertColumnsSql,
    coreVerificationInsertValuesSql,
    coreVerificationUpdateSetClauseSql,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    ImportReviewPromotionRoadDryRunRepository,
    ROAD_CANDIDATE_TABLE,
} from "./import-review-promotion-road-dry-run.repo.js";
import type {
    ImportReviewPromotionRoadDryRunResult,
    RoadDryRunItemResult,
    RoadDryRunItemStatus,
} from "./import-review-promotion-road-dry-run.types.js";
import {
    PROMOTE_ROAD_SRC_COLUMNS,
    ROAD_CANDIDATE_SQL_ALIAS,
    roadReadyFieldExprs,
} from "./import-review-promotion-promote-roads-sql.js";
import {
    isPublishItemValidationBlocked,
    parsePublishItemValidationResult,
} from "./import-review-promotion-publish-item-validation.js";

export const CORE_STREETS_TABLE = "core.core_streets";

const ROAD_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("roads");
const PROMOTABLE_DRY_RUN_STATUSES = new Set<RoadDryRunItemStatus>([
    "safe_to_promote",
    "promote_with_warning",
]);

type RoadCandidateNameRow = {
    canonical_name: string | null;
    name_mm: string | null;
    name_en: string | null;
    normalized_data: unknown;
    external_id: string | null;
    class_code: string | null;
    road_class: string | null;
};

function isManualProtected(matchStatus: string | null, autoAction: string | null): boolean {
    const ms = (matchStatus ?? "").toLowerCase();
    const aa = (autoAction ?? "").toLowerCase();
    return ms === "manual_protected" || aa === "protect_manual" || aa === "manual_protected";
}

function dryRunItemForCandidate(
    dryRun: ImportReviewPromotionRoadDryRunResult | null,
    candidateId: bigint
): RoadDryRunItemResult | null {
    if (!dryRun) {
        return null;
    }
    return dryRun.items.find((item) => item.review_candidate_id === candidateId.toString()) ?? null;
}

function dryRunSummaryForItem(item: RoadDryRunItemResult | null): Record<string, unknown> {
    if (!item) {
        return {};
    }
    return {
        dry_run_status: item.dry_run_status,
        blocking_reasons: item.blocking_reasons,
        warning_codes: item.warning_codes,
        info_codes: item.info_codes,
        geometry_summary: item.geometry_summary,
        connectivity_summary: item.connectivity_summary,
        duplicate_summary: item.duplicate_summary,
        routing_summary: item.routing_summary,
    };
}

export class ImportReviewPromotionPromoteRoadsRepository {
    private readonly dryRunRepo: ImportReviewPromotionRoadDryRunRepository;

    constructor(private readonly prisma: PromotionDb) {
        this.dryRunRepo = new ImportReviewPromotionRoadDryRunRepository(prisma as import("@prisma/client").PrismaClient);
    }

    async checkRoadCoreExists(targetId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM core.core_streets
            WHERE id = ${targetId}
              AND coalesce(is_active, true)
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async insertRoad(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        return this.insertRoadForTx(this.prisma, batchId, publishItemId, promotedBy);
    }

    async insertRoadForTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const dryRunRepo = new ImportReviewPromotionRoadDryRunRepository(tx as import("@prisma/client").PrismaClient);
        const dryRun = await dryRunRepo.readRoadDryRunResult(batchId);
        if (!dryRun) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Road dry-run result missing. Run road dry-run before promotion.",
                before_data: null,
                after_data: null,
            };
        }

        const preflight = await this.loadPreflightRowTx(tx, batchId, publishItemId, dryRun);
        if (!preflight.ok) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: preflight.reason,
                before_data: null,
                after_data: null,
            };
        }

        const dryRunItem = dryRunItemForCandidate(dryRun, preflight.candidateId);
        const dryRunStatus = dryRunItem?.dry_run_status ?? null;
        const dryRunSummaryJson = JSON.stringify(dryRunSummaryForItem(dryRunItem));

        try {
            return await this.insertRoadTx(tx, batchId, publishItemId, promotedBy, {
                dryRun,
                preflight,
                dryRunStatus,
                dryRunSummaryJson,
            });
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Road insert failed.",
                before_data: null,
                after_data: null,
            };
        }
    }

    async insertRoadTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null,
        ctx: {
            dryRun: ImportReviewPromotionRoadDryRunResult;
            preflight: { ok: true; candidateId: bigint } | { ok: false; reason: string };
            dryRunStatus: RoadDryRunItemStatus | null;
            dryRunSummaryJson: string;
        }
    ): Promise<PromoteItemResult> {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        canonical_name: string;
                        road_class_id: bigint | null;
                        road_class: string | null;
                        candidate_id: bigint;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_ROAD_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.road_candidates AS r
                            ON r.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                    ),
                    ready AS (
                        SELECT
                            s.*,
                            ${roadReadyFieldExprs(batchId, ROAD_CANDIDATE_SQL_ALIAS, ctx.dryRunStatus, ctx.dryRunSummaryJson)}
                        FROM src AS s
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.geom_ready IS NOT NULL
                          AND ST_IsValid(r.geom_ready)
                          AND NOT ST_IsEmpty(r.geom_ready)
                          AND ST_SRID(r.geom_ready) = 4326
                          AND upper(ST_GeometryType(r.geom_ready)) = 'ST_LINESTRING'
                          AND r.external_id_ready IS NOT NULL
                          AND r.road_class_id_ready IS NOT NULL
                          AND r.source_type_id_ready IS NOT NULL
                          AND r.confidence_score_ready >= 0
                          AND r.confidence_score_ready <= 100
                    ),
                    guard AS (
                        SELECT v.*
                        FROM valid AS v
                        WHERE NOT EXISTS (
                            SELECT 1 FROM core.core_streets AS c
                            WHERE coalesce(c.is_active, true)
                              AND c.deleted_at IS NULL
                              AND (
                                  c.external_id = v.external_id_ready
                                  OR (
                                      v.local_staging_id IS NOT NULL
                                      AND c.source_refs->>'local_staging_id' = v.local_staging_id::text
                                  )
                              )
                        )
                    )
                    INSERT INTO core.core_streets (
                        external_id,
                        canonical_name,
                        geom,
                        admin_area_id,
                        source_type_id,
                        road_class_id,
                        road_class,
                        surface,
                        is_oneway,
                        bridge,
                        tunnel,
                        layer,
                        source_refs,
                        normalized_data,
                        is_active,
                        manual_override,
                        edit_status,
                        routing_status,
                        deleted_at,
                        last_edited_at${coreVerificationInsertColumnsSql(ROAD_VERIFICATION_COLUMNS)},
                        created_at,
                        updated_at
                    )
                    SELECT
                        g.external_id_ready,
                        g.canonical_name_ready,
                        g.geom_ready,
                        g.admin_area_id_ready,
                        g.source_type_id_ready,
                        g.road_class_id_ready,
                        g.road_class_code_ready,
                        g.surface_ready,
                        g.is_oneway_ready,
                        g.bridge_ready,
                        g.tunnel_ready,
                        g.layer_ready,
                        g.merged_source_refs,
                        g.merged_normalized_data,
                        true,
                        false,
                        'published',
                        'needs_rebuild',
                        NULL::timestamptz,
                        now()${coreVerificationInsertValuesSql(ROAD_VERIFICATION_COLUMNS)},
                        now(),
                        now()
                    FROM guard AS g
                    RETURNING id, external_id, canonical_name, road_class_id, road_class
                `;

                if (rows.length === 0) {
                    const reason = await this.explainInsertBlocked(tx, batchId, publishItemId);
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: reason,
                        before_data: null,
                        after_data: null,
                    };
                }

                const row = rows[0]!;
                const namesSynced = await this.syncStreetNames(tx, row.id, publishItemId);

                return {
                    publish_item_id: publishItemId,
                    outcome: "inserted",
                    target_id: row.id,
                    error_message: null,
                    before_data: null,
                    after_data: {
                        id: row.id.toString(),
                        external_id: row.external_id,
                        canonical_name: row.canonical_name,
                        road_class_id: row.road_class_id?.toString() ?? null,
                        road_class: row.road_class,
                        entity_family: "roads",
                        names_synced: namesSynced,
                        promoted_by: promotedBy?.toString() ?? null,
                        road_dry_run_status: ctx.dryRunStatus,
                    },
                    ...buildVerificationMetadataTracking({
                        outcome: "inserted",
                        beforeData: null,
                        entityKey: "roads",
                    }),
                };
    }

    async updateRoad(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        return this.updateRoadForTx(this.prisma, batchId, publishItemId, promotedBy);
    }

    async updateRoadForTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const dryRunRepo = new ImportReviewPromotionRoadDryRunRepository(tx as import("@prisma/client").PrismaClient);
        const dryRun = await dryRunRepo.readRoadDryRunResult(batchId);
        if (!dryRun) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Road dry-run result missing. Run road dry-run before promotion.",
                before_data: null,
                after_data: null,
            };
        }

        const preflight = await this.loadPreflightRowTx(tx, batchId, publishItemId, dryRun);
        if (!preflight.ok) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: preflight.reason,
                before_data: null,
                after_data: null,
            };
        }

        const beforeRows = await tx.$queryRaw<{ row_json: unknown }[]>`
            SELECT to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.road_candidates AS r
                ON r.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
            INNER JOIN core.core_streets AS c ON c.id = r.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND r.matched_core_id IS NOT NULL
              AND coalesce(c.is_active, true)
              AND c.deleted_at IS NULL
              AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
              AND NOT (
                  coalesce(c.is_verified, false) = true
                  OR c.verification_status = 'verified'
                  OR coalesce(c.manual_override, false) = true
              )
            LIMIT 1
        `;
        const beforeData = beforeRows[0]?.row_json ?? null;
        if (!beforeData) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message:
                    "Update blocked: matched_core_id missing, core row inactive, dashboard-protected, verified, or manual_override.",
                before_data: null,
                after_data: null,
            };
        }

        const dryRunItem = dryRunItemForCandidate(dryRun, preflight.candidateId);
        const dryRunStatus = dryRunItem?.dry_run_status ?? null;
        const dryRunSummaryJson = JSON.stringify(dryRunSummaryForItem(dryRunItem));

        try {
            return await this.updateRoadTx(tx, batchId, publishItemId, promotedBy, beforeData, {
                dryRunStatus,
                dryRunSummaryJson,
            });
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Road update failed.",
                before_data: beforeData,
                after_data: null,
            };
        }
    }

    async updateRoadTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null,
        beforeData: unknown,
        ctx: { dryRunStatus: RoadDryRunItemStatus | null; dryRunSummaryJson: string }
    ): Promise<PromoteItemResult> {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        canonical_name: string;
                        road_class_id: bigint | null;
                        road_class: string | null;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_ROAD_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.road_candidates AS r
                            ON r.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                          AND r.matched_core_id IS NOT NULL
                    ),
                    ready AS (
                        SELECT
                            s.*,
                            ${roadReadyFieldExprs(batchId, ROAD_CANDIDATE_SQL_ALIAS, ctx.dryRunStatus, ctx.dryRunSummaryJson)}
                        FROM src AS s
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.geom_ready IS NOT NULL
                          AND ST_IsValid(r.geom_ready)
                          AND NOT ST_IsEmpty(r.geom_ready)
                          AND r.external_id_ready IS NOT NULL
                          AND r.road_class_id_ready IS NOT NULL
                          AND r.source_type_id_ready IS NOT NULL
                    )
                    UPDATE core.core_streets AS c
                    SET
                        external_id = v.external_id_ready,
                        canonical_name = v.canonical_name_ready,
                        geom = v.geom_ready,
                        admin_area_id = v.admin_area_id_ready,
                        road_class_id = v.road_class_id_ready,
                        road_class = v.road_class_code_ready,
                        surface = v.surface_ready,
                        is_oneway = v.is_oneway_ready,
                        bridge = v.bridge_ready,
                        tunnel = v.tunnel_ready,
                        layer = v.layer_ready,
                        source_refs = v.merged_source_refs,
                        normalized_data = v.merged_normalized_data,
                        routing_status = 'needs_rebuild',
                        updated_at = now(),
                        last_edited_at = now(),
                        deleted_at = NULL::timestamptz,
                        is_active = true${coreVerificationUpdateSetClauseSql("c", ROAD_VERIFICATION_COLUMNS)}
                    FROM valid AS v
                    WHERE c.id = v.matched_core_id
                      AND coalesce(c.is_active, true)
                      AND c.deleted_at IS NULL
                      AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
                      AND NOT (
                          coalesce(c.is_verified, false) = true
                          OR c.verification_status = 'verified'
                          OR coalesce(c.manual_override, false) = true
                      )
                    RETURNING c.id, c.external_id, c.canonical_name, c.road_class_id, c.road_class
                `;

                if (rows.length === 0) {
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Road update blocked: invalid geometry, references, or protected core row.",
                        before_data: beforeData,
                        after_data: null,
                    };
                }

                const row = rows[0]!;
                const namesSynced = await this.syncStreetNames(tx, row.id, publishItemId);
                const verificationMeta = buildVerificationMetadataTracking({
                    outcome: "updated",
                    beforeData,
                    entityKey: "roads",
                });

                return {
                    publish_item_id: publishItemId,
                    outcome: "updated",
                    target_id: row.id,
                    error_message: null,
                    before_data: beforeData,
                    after_data: {
                        id: row.id.toString(),
                        external_id: row.external_id,
                        canonical_name: row.canonical_name,
                        road_class_id: row.road_class_id?.toString() ?? null,
                        road_class: row.road_class,
                        entity_family: "roads",
                        names_synced: namesSynced,
                        promoted_by: promotedBy?.toString() ?? null,
                        road_dry_run_status: ctx.dryRunStatus,
                    },
                    ...verificationMeta,
                };
    }

    private async loadPreflightRow(
        batchId: bigint,
        publishItemId: bigint
    ): Promise<
        | { ok: true; candidateId: bigint }
        | { ok: false; reason: string }
    > {
        const dryRun = await this.dryRunRepo.readRoadDryRunResult(batchId);
        return this.loadPreflightRowTx(this.prisma, batchId, publishItemId, dryRun);
    }

    private async loadPreflightRowTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        dryRun: ImportReviewPromotionRoadDryRunResult | null
    ): Promise<
        | { ok: true; candidateId: bigint }
        | { ok: false; reason: string }
    > {
        const rows = await tx.$queryRaw<
            {
                candidate_id: bigint;
                review_decision: string | null;
                review_status: string | null;
                promotion_status: string | null;
                promoted_core_id: bigint | null;
                match_status: string | null;
                auto_action: string | null;
                publish_action: string;
                validation_result: unknown;
            }[]
        >`
            SELECT
                r.id AS candidate_id,
                r.review_decision,
                r.review_status,
                r.promotion_status,
                r.promoted_core_id,
                r.match_status,
                r.auto_action,
                spi.validation_result,
                spi.publish_action
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.road_candidates AS r
                ON r.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return { ok: false, reason: "Road publish item not found." };
        }

        const dryRunItem = dryRunItemForCandidate(dryRun, row.candidate_id);
        if (!dryRunItem) {
            return { ok: false, reason: "Road dry-run item missing for candidate." };
        }
        if (!PROMOTABLE_DRY_RUN_STATUSES.has(dryRunItem.dry_run_status)) {
            return {
                ok: false,
                reason: `Road dry-run status ${dryRunItem.dry_run_status} is not promotable.`,
            };
        }

        if (row.publish_action === "protect_manual" || isManualProtected(row.match_status, row.auto_action)) {
            return { ok: false, reason: "Road candidate is manual_protected." };
        }
        if (row.review_decision !== "approved") {
            return { ok: false, reason: "Road candidate is not approved." };
        }
        const publishValidation = parsePublishItemValidationResult(row.validation_result);
        if (publishValidation.status === null) {
            return { ok: false, reason: "Publish item has no validation_result; run batch validation first." };
        }
        if (isPublishItemValidationBlocked(publishValidation.status)) {
            return { ok: false, reason: "Publish item validation_result is blocked." };
        }
        if (row.promotion_status === "promoted" || row.promoted_core_id != null) {
            return { ok: false, reason: "Road candidate is already promoted." };
        }

        return { ok: true, candidateId: row.candidate_id };
    }

    private async explainInsertBlocked(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await tx.$queryRaw<
            {
                duplicate_core: boolean;
                invalid_geom: boolean;
                missing_class: boolean;
                missing_external: boolean;
            }[]
        >`
            WITH src AS (
                SELECT ${PROMOTE_ROAD_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.road_candidates AS r
                    ON r.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            ready AS (
                SELECT
                    s.*,
                    ${roadReadyFieldExprs(batchId, ROAD_CANDIDATE_SQL_ALIAS, null, "{}")}
                FROM src AS s
            )
            SELECT
                EXISTS (
                    SELECT 1 FROM core.core_streets AS c
                    INNER JOIN ready AS r ON TRUE
                    WHERE coalesce(c.is_active, true)
                      AND c.deleted_at IS NULL
                      AND c.external_id = r.external_id_ready
                ) AS duplicate_core,
                NOT EXISTS (
                    SELECT 1 FROM ready AS r
                    WHERE r.geom_ready IS NOT NULL
                      AND ST_IsValid(r.geom_ready)
                      AND NOT ST_IsEmpty(r.geom_ready)
                      AND upper(ST_GeometryType(r.geom_ready)) = 'ST_LINESTRING'
                ) AS invalid_geom,
                EXISTS (
                    SELECT 1 FROM ready AS r WHERE r.road_class_id_ready IS NULL
                ) AS missing_class,
                EXISTS (
                    SELECT 1 FROM ready AS r WHERE r.external_id_ready IS NULL
                ) AS missing_external
        `;
        const r = rows[0];
        if (r?.duplicate_core) {
            return "Insert blocked: duplicate core.core_streets external_id.";
        }
        if (r?.invalid_geom) {
            return "Insert blocked: invalid or unsupported road geometry.";
        }
        if (r?.missing_class) {
            return "Insert blocked: road_class_id missing or invalid.";
        }
        if (r?.missing_external) {
            return "Insert blocked: external_id missing.";
        }
        return "Insert blocked: duplicate core row, invalid geometry, or missing required fields.";
    }

    private toNameCandidate(row: RoadCandidateNameRow): ImportReviewNameCandidate {
        return {
            canonical_name: row.canonical_name,
            normalized_data: row.normalized_data,
            external_id: row.external_id,
            class_code: row.class_code,
            name: null,
            name_mm: row.name_mm,
            name_en: row.name_en,
        };
    }

    private async loadCandidateNames(
        tx: PromotionDb,
        publishItemId: bigint
    ): Promise<RoadCandidateNameRow | null> {
        const rows = await tx.$queryRaw<RoadCandidateNameRow[]>`
            SELECT
                r.canonical_name,
                r.name_mm,
                r.name_en,
                r.normalized_data,
                r.external_id,
                r.class_code,
                r.road_class
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.road_candidates AS r
                ON r.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
            WHERE spi.id = ${publishItemId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    private looksLikeExternalIdName(name: string, externalId: string | null): boolean {
        const trimmed = name.trim();
        if (!trimmed) {
            return true;
        }
        if (externalId && trimmed === externalId.trim()) {
            return true;
        }
        if (/^(node|way|relation)\/\d+$/i.test(trimmed)) {
            return true;
        }
        return false;
    }

    private async syncStreetNames(
        tx: PromotionDb,
        streetId: bigint,
        publishItemId: bigint
    ): Promise<number> {
        const namesRow = await this.loadCandidateNames(tx, publishItemId);
        if (!namesRow) {
            return 0;
        }
        const derived = deriveImportReviewNames(this.toNameCandidate(namesRow));
        let synced = 0;

        const candidates: { name: string | null; language: string; script: string | null }[] = [
            { name: derived.name_mm, language: "my", script: "Mymr" },
            { name: derived.name_en, language: "en", script: "Latn" },
            { name: derived.name_und, language: "und", script: null },
        ];

        for (const entry of candidates) {
            const name = entry.name?.trim() ?? "";
            if (!name || this.looksLikeExternalIdName(name, namesRow.external_id)) {
                continue;
            }
            const existing = await tx.$queryRaw<{ id: bigint }[]>`
                SELECT id
                FROM core.core_street_names
                WHERE street_id = ${streetId}
                  AND name = ${name}
                  AND name_type = 'primary'
                LIMIT 1
            `;
            if (existing.length > 0) {
                continue;
            }
            await tx.$executeRaw`
                INSERT INTO core.core_street_names (
                    street_id, name, language_code, script_code, name_type, is_primary
                )
                VALUES (
                    ${streetId},
                    ${name},
                    ${entry.language},
                    ${entry.script},
                    'primary',
                    true
                )
            `;
            synced += 1;
        }

        return synced;
    }
}
