import { Prisma, type PrismaClient } from "@prisma/client";

import { ImportReviewCandidateColumnRegistry } from "./import-review-candidate-column-registry.js";
import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    buildPromotionEligibilityBucketWhereSql,
    type PromotionEligibilityBucket,
    type PublishEligibilityOptions,
} from "./import-review-promotion-eligibility.js";
import {
    buildEligibilityDetailsOrderSql,
    buildEligibilityDetailsReasonCodeSql,
    buildEligibilityDetailsSearchSql,
    type PromotionEligibilityDetailsListFilters,
} from "./import-review-promotion-eligibility-details-filters.js";
import {
    duplicateCoreExternalIdSql,
    missingRequiredGeometrySql,
    missingRequiredTypeCategoryClassSql,
} from "./import-review-promotion-eligibility-family-guards.js";
import {
    buildEligibilityDetailsDisplayNameExpr,
    optionalCandidateColumn,
} from "./import-review-promotion-eligibility-sql-helpers.js";
import { roadClassMissingWithoutFallbackSql } from "./import-review-road-promotion-policy.js";
import { IMPORT_REVIEW_PUBLISH_ACTIVE_BATCH_STATUSES } from "./import-review-promotion.types.js";

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

export type PromotionEligibilityDetailRowDb = {
    id: bigint;
    external_id: string | null;
    display_name: string | null;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    confidence_score: number | null;
    validation_errors: unknown;
    validation_warnings: unknown;
    review_note: string | null;
    matched_core_id: bigint | null;
    road_class_id: bigint | null;
    class_code: string | null;
    normalized_data: unknown;
    promoted_core_id: bigint | null;
    duplicate_core_external_id: boolean;
    road_class_missing_no_fallback: boolean;
    geometry_missing: boolean;
    required_type_missing: boolean;
    warning_reason: string | null;
    promoted_target_id: bigint | null;
    publish_batch_id: bigint | null;
    publish_batch_status: string | null;
    created_at: Date | null;
    updated_at: Date | null;
};

export class ImportReviewPromotionEligibilityDetailsRepository {
    private readonly columnRegistry: ImportReviewCandidateColumnRegistry;

    constructor(private readonly prisma: PrismaClient) {
        this.columnRegistry = new ImportReviewCandidateColumnRegistry(prisma);
    }

    async pgRegclassExists(fullyQualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass(${fullyQualifiedName}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    private async loadCandidateColumns(
        config: ImportReviewPublishFamilyConfig
    ): Promise<ReadonlySet<string>> {
        return this.columnRegistry.getColumnsForSql(config.candidateTable);
    }

    private async buildSelectSql(
        config: ImportReviewPublishFamilyConfig,
        bucket: PromotionEligibilityBucket,
        columns: ReadonlySet<string>
    ): Promise<Prisma.Sql> {
        const a = config.tableAlias;
        const displayName = buildEligibilityDetailsDisplayNameExpr(a, config.entityFamily, columns);
        const validationErrors = optionalCandidateColumn(a, columns, "validation_errors", "jsonb");
        const validationWarnings = optionalCandidateColumn(a, columns, "validation_warnings", "jsonb");
        const promotedCoreId = optionalCandidateColumn(a, columns, "promoted_core_id", "bigint");
        const roadClassId = optionalCandidateColumn(a, columns, "road_class_id", "bigint");
        const classCode = optionalCandidateColumn(a, columns, "class_code", "text");
        const normalizedData = optionalCandidateColumn(a, columns, "normalized_data", "jsonb");
        const reviewNote = optionalCandidateColumn(a, columns, "review_note", "text");
        const warningReason = optionalCandidateColumn(a, columns, "warning_reason", "text");
        const matchedCoreId = optionalCandidateColumn(a, columns, "matched_core_id", "bigint");
        const promotedTargetId = optionalCandidateColumn(a, columns, "promoted_target_id", "bigint");
        const createdAt = optionalCandidateColumn(a, columns, "created_at", "timestamptz");
        const updatedAt = optionalCandidateColumn(a, columns, "updated_at", "timestamptz");

        const roadClassMissing =
            config.entityFamily === "roads"
                ? roadClassMissingWithoutFallbackSql(a)
                : missingRequiredTypeCategoryClassSql(config, a, columns);

        const activeStatuses = IMPORT_REVIEW_PUBLISH_ACTIVE_BATCH_STATUSES.map((s) => Prisma.sql`${s}`);
        const publishJoin =
            bucket === "batched"
                ? Prisma.sql`
                    LEFT JOIN LATERAL (
                        SELECT spi.publish_batch_id, spb.status AS publish_batch_status
                        FROM system.system_publish_items AS spi
                        INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
                        WHERE spi.review_candidate_table = ${config.candidateTable}
                          AND spi.review_candidate_id = ${col(a, "id")}
                          AND spb.status IN (${Prisma.join(activeStatuses)})
                        ORDER BY spi.created_at DESC
                        LIMIT 1
                    ) AS pb ON true
                `
                : Prisma.sql`
                    LEFT JOIN LATERAL (
                        SELECT spi.publish_batch_id, spb.status AS publish_batch_status
                        FROM system.system_publish_items AS spi
                        INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
                        WHERE spi.review_candidate_table = ${config.candidateTable}
                          AND spi.review_candidate_id = ${col(a, "id")}
                        ORDER BY spi.created_at DESC
                        LIMIT 1
                    ) AS pb ON true
                `;

        return Prisma.sql`
            SELECT
                ${col(a, "id")} AS id,
                ${col(a, "external_id")} AS external_id,
                ${displayName} AS display_name,
                ${col(a, "match_status")} AS match_status,
                ${col(a, "auto_action")} AS auto_action,
                ${col(a, "review_status")} AS review_status,
                ${col(a, "review_decision")} AS review_decision,
                ${col(a, "promotion_status")} AS promotion_status,
                ${optionalCandidateColumn(a, columns, "confidence_score", "float8")}::float8 AS confidence_score,
                COALESCE(${validationErrors}, '[]'::jsonb) AS validation_errors,
                COALESCE(${validationWarnings}, '[]'::jsonb) AS validation_warnings,
                ${reviewNote} AS review_note,
                ${warningReason} AS warning_reason,
                ${matchedCoreId} AS matched_core_id,
                ${roadClassId} AS road_class_id,
                ${classCode} AS class_code,
                ${normalizedData} AS normalized_data,
                ${promotedCoreId} AS promoted_core_id,
                ${promotedTargetId} AS promoted_target_id,
                ${duplicateCoreExternalIdSql(config, a, columns)} AS duplicate_core_external_id,
                ${missingRequiredTypeCategoryClassSql(config, a, columns)} AS required_type_missing,
                ${roadClassMissing} AS road_class_missing_no_fallback,
                ${missingRequiredGeometrySql(config, a, columns)} AS geometry_missing,
                pb.publish_batch_id,
                pb.publish_batch_status,
                ${createdAt} AS created_at,
                ${updatedAt} AS updated_at
            FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
            ${publishJoin}
        `;
    }

    private async buildBucketWhereSql(args: {
        config: ImportReviewPublishFamilyConfig;
        reviewBatchId: bigint;
        bucket: PromotionEligibilityBucket;
        options: PublishEligibilityOptions;
        filters: PromotionEligibilityDetailsListFilters;
        columns: ReadonlySet<string>;
    }): Promise<Prisma.Sql> {
        const a = args.config.tableAlias;
        const parts: Prisma.Sql[] = [
            buildPromotionEligibilityBucketWhereSql(
                args.config,
                args.reviewBatchId,
                args.bucket,
                args.options
            ),
        ];
        if (args.filters.search) {
            const displayName = buildEligibilityDetailsDisplayNameExpr(
                a,
                args.config.entityFamily,
                args.columns
            );
            parts.push(
                buildEligibilityDetailsSearchSql(a, displayName, args.filters.search, args.columns)
            );
        }
        if (args.filters.reasonCode) {
            parts.push(
                buildEligibilityDetailsReasonCodeSql(
                    args.config,
                    a,
                    args.bucket,
                    args.filters.reasonCode,
                    args.columns
                )
            );
        }
        return Prisma.join(parts, " AND ");
    }

    async countBucket(args: {
        config: ImportReviewPublishFamilyConfig;
        reviewBatchId: bigint;
        bucket: PromotionEligibilityBucket;
        options: PublishEligibilityOptions;
        filters: PromotionEligibilityDetailsListFilters;
    }): Promise<number> {
        const columns = await this.loadCandidateColumns(args.config);
        const a = args.config.tableAlias;
        const where = await this.buildBucketWhereSql({ ...args, columns });
        const rows = await this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT count(*)::bigint AS count
            FROM ${Prisma.raw(args.config.candidateTable)} AS ${Prisma.raw(a)}
            WHERE ${where}
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async listBucket(args: {
        config: ImportReviewPublishFamilyConfig;
        reviewBatchId: bigint;
        bucket: PromotionEligibilityBucket;
        options: PublishEligibilityOptions;
        filters: PromotionEligibilityDetailsListFilters;
        limit: number;
        offset: number;
    }): Promise<PromotionEligibilityDetailRowDb[]> {
        const columns = await this.loadCandidateColumns(args.config);
        const a = args.config.tableAlias;
        const where = await this.buildBucketWhereSql({ ...args, columns });
        const select = await this.buildSelectSql(args.config, args.bucket, columns);
        const orderBy = buildEligibilityDetailsOrderSql(a, args.filters, columns);
        return this.prisma.$queryRaw<PromotionEligibilityDetailRowDb[]>`
            ${select}
            WHERE ${where}
            ORDER BY ${orderBy}
            LIMIT ${args.limit}
            OFFSET ${args.offset}
        `;
    }
}
