import { Prisma, type PrismaClient } from "@prisma/client";

import {
    buildBulkClassifyCaseSql,
    buildBulkJoinedClassifyCaseSql,
    buildBulkModeBWhere,
    buildBulkUpdateSetClause,
    buildCandidateCommonSelect,
    buildCandidateFromClause,
    buildCandidateListQueryParts,
    buildCandidateOrderBy,
    buildCandidateRowQueryParts,
    buildCandidateScopeWhere,
    buildCandidateWhereClause,
    colRef,
    buildFilterOptionsColumnSql,
    buildSummaryAggregationSql,
    type CandidateListFilters,
    sqlBigintArray,
} from "./import-review-candidate-sql.js";
import {
    getImportReviewEntityConfig,
    type ImportReviewEntityFamilySlug,
} from "./import-review-config.js";
import type {
    BuildingListRowDb,
    CandidateReviewGuardContext,
    ReviewActor,
} from "./import-review-data-repository.js";
import type { ImportReviewBulkFilters } from "./import-review.schema.js";
import { buildReviewOverridesMergeExpr } from "./import-review-overrides-merge.js";
import type { ImportReviewBulkDecisionRepoResult, ImportReviewBulkSkippedReason } from "./import-review.types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

function bucketsToSkippedReasons(buckets: Map<string, bigint>): ImportReviewBulkSkippedReason[] {
    const out: ImportReviewBulkSkippedReason[] = [];

    for (const [reason, count] of buckets) {
        if (reason === "eligible") {
            continue;
        }
        const n = Number(count);
        if (n > 0) {
            out.push({ reason, count: n });
        }
    }

    out.sort((a, b) => a.reason.localeCompare(b.reason));
    return out;
}

export class GenericImportReviewCandidateRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async pgRegclassExists(fullyQualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass(${fullyQualifiedName}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    async countCandidates(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        filters: CandidateListFilters
    ): Promise<bigint> {
        const config = getImportReviewEntityConfig(family);
        if (!(await this.pgRegclassExists(`import_review.${config.importReviewTable}`))) {
            return 0n;
        }

        const where = buildCandidateWhereClause(config, reviewBatchId, filters);
        const rows = await this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT count(*)::bigint AS count
            FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(config.tableAlias)}
            WHERE ${where}
        `;
        return rows[0]?.count ?? 0n;
    }

    async listCandidates(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        filters: CandidateListFilters
    ): Promise<BuildingListRowDb[]> {
        const config = getImportReviewEntityConfig(family);
        if (!(await this.pgRegclassExists(`import_review.${config.importReviewTable}`))) {
            return [];
        }

        const parts = buildCandidateListQueryParts(config, reviewBatchId, filters);
        const limit = filters.limit ?? 50;
        const offset = filters.offset ?? 0;

        return this.prisma.$queryRaw<BuildingListRowDb[]>`
            SELECT ${parts.select}
            FROM ${parts.from}
            WHERE ${parts.where}
            ORDER BY ${parts.orderBy}
            LIMIT ${limit} OFFSET ${offset}
        `;
    }

    async getCandidateById(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        id: bigint,
        includeGeometry: boolean
    ): Promise<BuildingListRowDb | null> {
        const config = getImportReviewEntityConfig(family);
        if (!(await this.pgRegclassExists(`import_review.${config.importReviewTable}`))) {
            return null;
        }

        const where = buildCandidateScopeWhere(config, reviewBatchId, id);
        const select = buildCandidateCommonSelect(config, includeGeometry);
        const from = buildCandidateFromClause(config);

        const rows = await this.prisma.$queryRaw<BuildingListRowDb[]>`
            SELECT ${select}
            FROM ${from}
            WHERE ${where}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async fetchCandidateFilterOptions(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint
    ): Promise<Record<string, string[]>> {
        const config = getImportReviewEntityConfig(family);
        const out: Record<string, string[]> = {};

        if (!(await this.pgRegclassExists(`import_review.${config.importReviewTable}`))) {
            for (const field of config.filterFields) {
                out[field] = [];
            }
            return out;
        }

        const distinctStrings = async (field: (typeof config.filterFields)[number]): Promise<string[]> => {
            const columnSql = buildFilterOptionsColumnSql(config, field);
            const rows = await this.prisma.$queryRaw<{ v: string }[]>`
                SELECT DISTINCT ${columnSql} AS v
                FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(config.tableAlias)}
                WHERE ${Prisma.raw(`${config.tableAlias}.review_batch_id`)} = ${reviewBatchId}
                  AND ${Prisma.raw(`${config.tableAlias}.entity_family`)} = ${config.entityFamily}
                  AND ${columnSql} IS NOT NULL
                  AND trim(${columnSql}) <> ''
                ORDER BY 1
            `;
            return rows.map((r) => r.v);
        };

        const values = await Promise.all(config.filterFields.map((field) => distinctStrings(field)));
        config.filterFields.forEach((field, index) => {
            out[field] = values[index] ?? [];
        });

        return out;
    }

    async findCandidateReviewContext(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        id: bigint
    ): Promise<
        | (CandidateReviewGuardContext & {
              validation_warnings?: unknown;
              validation_errors?: unknown;
          })
        | null
    > {
        const config = getImportReviewEntityConfig(family);
        const where = buildCandidateScopeWhere(config, reviewBatchId, id);

        const rows = await this.prisma.$queryRaw<
            {
                match_status: string | null;
                auto_action: string | null;
                promotion_status: string | null;
                review_overrides: unknown;
                validation_warnings: unknown;
                validation_errors: unknown;
            }[]
        >`
            SELECT
                ${Prisma.raw(`${config.tableAlias}.match_status`)},
                ${Prisma.raw(`${config.tableAlias}.auto_action`)},
                ${Prisma.raw(`${config.tableAlias}.promotion_status`)},
                COALESCE(to_jsonb(${colRef(config, "review_overrides")}), '{}'::jsonb) AS review_overrides,
                ${Prisma.raw(`${config.tableAlias}.validation_warnings`)},
                ${Prisma.raw(`${config.tableAlias}.validation_errors`)}
            FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(config.tableAlias)}
            WHERE ${where}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async patchCandidateReviewOverrides(args: {
        family: ImportReviewEntityFamilySlug;
        reviewBatchId: bigint;
        id: bigint;
        overridesPatch: Record<string, unknown>;
        editedByUserId: bigint | null;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        const config = getImportReviewEntityConfig(args.family);
        if (!(await this.pgRegclassExists(`import_review.${config.importReviewTable}`))) {
            return null;
        }

        const auditSupported = await this.pgRegclassExists("import_review.review_candidate_edits");
        const alias = config.tableAlias;
        const overridesMerge = buildReviewOverridesMergeExpr(config, args.overridesPatch);

        const setParts: Prisma.Sql[] = [
            Prisma.sql`review_overrides = ${overridesMerge}`,
            Prisma.sql`updated_at = now()`,
        ];
        if (args.reviewNote !== undefined) {
            setParts.push(Prisma.sql`review_note = ${args.reviewNote}`);
        }
        const updateSetClause = Prisma.join(setParts, ", ");
        const rowParts = buildCandidateRowQueryParts(config, true);
        const where = buildCandidateScopeWhere(config, args.reviewBatchId, args.id);

        return this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<{ review_overrides: unknown }[]>`
                SELECT COALESCE(to_jsonb(${colRef(config, "review_overrides")}), '{}'::jsonb) AS review_overrides
                  FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
                 WHERE ${where}
                 FOR UPDATE
            `;
            const before = locked[0];
            if (before === undefined) {
                return null;
            }

            const rows = await tx.$queryRaw<BuildingListRowDb[]>`
                WITH updated AS (
                    UPDATE ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
                       SET ${updateSetClause}
                     WHERE ${where}
                    RETURNING ${colRef(config, "id")} AS id
                )
                SELECT ${rowParts.select}
                FROM ${rowParts.from}
                INNER JOIN updated AS u ON ${colRef(config, "id")} = u.id
            `;

            const updated = rows[0];
            if (updated === undefined) {
                return null;
            }

            if (auditSupported) {
                const beforeJson = JSON.stringify({ review_overrides: before.review_overrides ?? {} });
                const afterJson = JSON.stringify({ review_overrides: updated.review_overrides ?? {} });
                await tx.$executeRaw`
                    INSERT INTO import_review.review_candidate_edits (
                        review_batch_id,
                        entity_family,
                        candidate_table,
                        candidate_id,
                        edited_by,
                        edit_type,
                        before_data,
                        after_data
                    )
                    VALUES (
                        ${args.reviewBatchId},
                        ${config.entityFamily},
                        ${config.importReviewTable},
                        ${args.id},
                        ${args.editedByUserId},
                        'override_update',
                        ${beforeJson}::jsonb,
                        ${afterJson}::jsonb
                    )
                `;
            }

            return updated;
        });
    }

    async updateCandidateReviewDecision(args: {
        family: ImportReviewEntityFamilySlug;
        id: bigint;
        reviewBatchId: bigint;
        reviewDecision: string;
        reviewStatus: string;
        actor: ReviewActor;
        reviewNote: string | null | undefined;
    }): Promise<BuildingListRowDb | null> {
        const config = getImportReviewEntityConfig(args.family);
        const sets: Prisma.Sql[] = [
            Prisma.sql`review_decision = ${args.reviewDecision}`,
            Prisma.sql`review_status = ${args.reviewStatus}`,
            Prisma.sql`reviewed_at = now()`,
            Prisma.sql`updated_at = now()`,
        ];

        if (args.actor.reviewedByUserId !== null) {
            sets.push(Prisma.sql`reviewed_by = ${args.actor.reviewedByUserId}`);
        } else {
            sets.push(Prisma.sql`reviewed_by = NULL`);
        }

        if (args.reviewNote !== undefined) {
            sets.push(Prisma.sql`review_note = ${args.reviewNote}`);
        }

        const setClause = Prisma.join(sets, ", ");
        const rowParts = buildCandidateRowQueryParts(config, true);
        const where = buildCandidateScopeWhere(config, args.reviewBatchId, args.id);
        const alias = config.tableAlias;

        const rows = await this.prisma.$queryRaw<BuildingListRowDb[]>`
            WITH updated AS (
                UPDATE ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
                SET ${setClause}
                WHERE ${where}
                RETURNING ${colRef(config, "id")} AS id
            )
            SELECT ${rowParts.select}
            FROM ${rowParts.from}
            INNER JOIN updated AS u ON ${colRef(config, "id")} = u.id
        `;

        return rows[0] ?? null;
    }

    async bulkCandidateDecisions(args: {
        family: ImportReviewEntityFamilySlug;
        reviewBatchId: bigint;
        mode: "ids" | "filters";
        ids?: bigint[];
        filters?: ImportReviewBulkFilters;
        reviewDecision: string;
        reviewStatus: string;
        reviewedByUserId: bigint | null;
        reviewNote: string | null | undefined;
        force: boolean;
        dryRun: boolean;
    }): Promise<ImportReviewBulkDecisionRepoResult> {
        const config = getImportReviewEntityConfig(args.family);

        return this.prisma.$transaction(async (tx) => {
            const buckets =
                args.mode === "ids"
                    ? await this.bulkClassifyByIds(
                          tx,
                          config,
                          args.reviewBatchId,
                          args.ids!,
                          args.reviewDecision,
                          args.force
                      )
                    : await this.bulkClassifyByFilters(
                          tx,
                          config,
                          args.reviewBatchId,
                          args.filters!,
                          args.reviewDecision,
                          args.force
                      );

            const eligible = buckets.get("eligible") ?? 0n;
            const skippedReasons = bucketsToSkippedReasons(buckets);
            const skippedCount = skippedReasons.reduce((sum, r) => sum + r.count, 0);

            if (args.dryRun) {
                return {
                    updated_count: Number(eligible),
                    skipped_count: skippedCount,
                    skipped_reasons: skippedReasons,
                    dry_run: true,
                };
            }

            const updated =
                args.mode === "ids"
                    ? await this.bulkApplyByIds(
                          tx,
                          config,
                          args.reviewBatchId,
                          args.ids!,
                          args.reviewDecision,
                          args.reviewStatus,
                          args.reviewedByUserId,
                          args.reviewNote,
                          args.force
                      )
                    : await this.bulkApplyByFilters(
                          tx,
                          config,
                          args.reviewBatchId,
                          args.filters!,
                          args.reviewDecision,
                          args.reviewStatus,
                          args.reviewedByUserId,
                          args.reviewNote,
                          args.force
                      );

            return {
                updated_count: updated,
                skipped_count: skippedCount,
                skipped_reasons: skippedReasons,
                dry_run: false,
            };
        });
    }

    private async bulkClassifyByIds(
        tx: DbClient,
        config: ReturnType<typeof getImportReviewEntityConfig>,
        reviewBatchId: bigint,
        ids: bigint[],
        reviewDecision: string,
        force: boolean
    ): Promise<Map<string, bigint>> {
        const idArray = sqlBigintArray(ids);
        const alias = config.tableAlias;
        const classify = buildBulkJoinedClassifyCaseSql(alias, force, reviewDecision);

        const rows = await tx.$queryRaw<{ bucket: string; c: bigint }[]>`
            WITH requested AS (
                SELECT DISTINCT x.id
                FROM unnest(${idArray}) AS x(id)
            ),
            joined AS (
                SELECT
                    req.id,
                    ${classify} AS bucket
                FROM requested AS req
                LEFT JOIN ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
                    ON ${Prisma.raw(alias)}.id = req.id
                    AND (${Prisma.raw(`${alias}.review_batch_id`)} = ${reviewBatchId}
                         AND ${Prisma.raw(`${alias}.entity_family`)} = ${config.entityFamily})
            )
            SELECT bucket, count(*)::bigint AS c
            FROM joined
            GROUP BY bucket
        `;

        return new Map(rows.map((r) => [r.bucket, r.c]));
    }

    private async bulkClassifyByFilters(
        tx: DbClient,
        config: ReturnType<typeof getImportReviewEntityConfig>,
        reviewBatchId: bigint,
        filters: ImportReviewBulkFilters,
        reviewDecision: string,
        force: boolean
    ): Promise<Map<string, bigint>> {
        const whereFiltered = buildBulkModeBWhere(config, reviewBatchId, filters);
        const alias = config.tableAlias;
        const classify = buildBulkClassifyCaseSql(force, reviewDecision);

        const rows = await tx.$queryRaw<{ bucket: string; c: bigint }[]>`
            WITH candidates AS (
                SELECT ${Prisma.raw(`${alias}.id`)},
                       ${Prisma.raw(`${alias}.match_status`)},
                       ${Prisma.raw(`${alias}.auto_action`)},
                       ${Prisma.raw(`${alias}.promotion_status`)}
                FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
                WHERE ${whereFiltered}
            ),
            classified AS (
                SELECT
                    id,
                    ${classify} AS bucket
                FROM candidates
            )
            SELECT bucket, count(*)::bigint AS c
            FROM classified
            GROUP BY bucket
        `;

        return new Map(rows.map((r) => [r.bucket, r.c]));
    }

    private async bulkApplyByIds(
        tx: DbClient,
        config: ReturnType<typeof getImportReviewEntityConfig>,
        reviewBatchId: bigint,
        ids: bigint[],
        reviewDecision: string,
        reviewStatus: string,
        reviewedByUserId: bigint | null,
        reviewNote: string | null | undefined,
        force: boolean
    ): Promise<number> {
        const setClause = buildBulkUpdateSetClause({
            reviewDecision,
            reviewStatus,
            reviewedByUserId,
            reviewNote,
        });
        const idArray = sqlBigintArray(ids);
        const alias = config.tableAlias;
        const classify = buildBulkJoinedClassifyCaseSql(alias, force, reviewDecision);

        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            WITH requested AS (
                SELECT DISTINCT x.id
                FROM unnest(${idArray}) AS x(id)
            ),
            joined AS (
                SELECT
                    req.id,
                    ${classify} AS bucket
                FROM requested AS req
                LEFT JOIN ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
                    ON ${Prisma.raw(alias)}.id = req.id
                    AND (${Prisma.raw(`${alias}.review_batch_id`)} = ${reviewBatchId}
                         AND ${Prisma.raw(`${alias}.entity_family`)} = ${config.entityFamily})
            ),
            eligible AS (SELECT id FROM joined WHERE bucket = 'eligible')
            UPDATE ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
            SET ${setClause}
            FROM eligible AS e
            WHERE ${Prisma.raw(alias)}.id = e.id
              AND (${Prisma.raw(`${alias}.review_batch_id`)} = ${reviewBatchId}
                   AND ${Prisma.raw(`${alias}.entity_family`)} = ${config.entityFamily})
            RETURNING ${Prisma.raw(`${alias}.id`)}
        `;

        return rows.length;
    }

    private async bulkApplyByFilters(
        tx: DbClient,
        config: ReturnType<typeof getImportReviewEntityConfig>,
        reviewBatchId: bigint,
        filters: ImportReviewBulkFilters,
        reviewDecision: string,
        reviewStatus: string,
        reviewedByUserId: bigint | null,
        reviewNote: string | null | undefined,
        force: boolean
    ): Promise<number> {
        const setClause = buildBulkUpdateSetClause({
            reviewDecision,
            reviewStatus,
            reviewedByUserId,
            reviewNote,
        });
        const whereFiltered = buildBulkModeBWhere(config, reviewBatchId, filters);
        const alias = config.tableAlias;
        const classify = buildBulkClassifyCaseSql(force, reviewDecision);

        const rows = await tx.$queryRaw<{ id: bigint }[]>`
            WITH candidates AS (
                SELECT ${Prisma.raw(`${alias}.id`)},
                       ${Prisma.raw(`${alias}.match_status`)},
                       ${Prisma.raw(`${alias}.auto_action`)},
                       ${Prisma.raw(`${alias}.promotion_status`)}
                FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
                WHERE ${whereFiltered}
            ),
            classified AS (
                SELECT
                    id,
                    ${classify} AS bucket
                FROM candidates
            ),
            eligible AS (SELECT id FROM classified WHERE bucket = 'eligible')
            UPDATE ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
            SET ${setClause}
            FROM eligible AS e
            WHERE ${Prisma.raw(alias)}.id = e.id
              AND (${Prisma.raw(`${alias}.review_batch_id`)} = ${reviewBatchId}
                   AND ${Prisma.raw(`${alias}.entity_family`)} = ${config.entityFamily})
            RETURNING ${Prisma.raw(`${alias}.id`)}
        `;

        return rows.length;
    }
}

export { buildSummaryAggregationSql };
