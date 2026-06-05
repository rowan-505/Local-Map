/**
 * Simplified publish batch creation: selected candidates or all-ready scope.
 *
 * @see import-review-promotion-simple-config.ts
 * @see docs/import-review/direct-edit-promotion-contract.md
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import {
    buildSelectCreateBatchEligibleCandidateIdsSql,
    CREATE_BATCH_NO_ELIGIBLE_MESSAGE,
} from "./import-review-promotion-create-batch-eligibility.js";
import {
    isBlockedInSelectedPromotionRetrySql,
    isSelectedCandidatePromotedSql,
    selectedCandidatePromotionStatusEligibleSql,
    selectedCandidateReviewStatusEligibleSql,
    type PublishEligibilityOptions,
} from "./import-review-promotion-eligibility.js";
import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { parsePromotionEligibilityFamiliesParam } from "./import-review-promotion-eligibility-api.js";
import {
    assertPromotableFamily,
    isImportReviewSimplePromotionFamily,
    listPromotableFamilies,
} from "./import-review-promotion-simple-config.js";
import {
    ImportReviewPromotionNoEligibleCandidatesError,
    ImportReviewPromotionSelectedCandidateError,
} from "./import-review-promotion.errors.js";
import { defaultCreateBatchName } from "./import-review-promotion-create-batch-api.js";
import { diagnoseUnresolvedSelectedCandidate } from "./import-review-promotion-selected-candidate-diagnosis.js";

export type CreatePublishBatchMode = "selected" | "all_ready";

export type CreatePublishBatchFilters = {
    review_decision: "approved";
    include_warnings: boolean;
};

export type ResolveCreateBatchCandidateIdsInput = {
    reviewBatchId: bigint;
    mode: CreatePublishBatchMode;
    families: readonly string[];
    candidateIdsByFamily?: Readonly<Record<string, readonly bigint[]>>;
    filters: CreatePublishBatchFilters;
    /** Max eligible candidates per family (applies to all_ready mode). */
    maxItems?: number;
    limitPerFamily?: Readonly<Record<string, number>>;
};

export const PROMOTION_CREATE_BATCH_NO_LIMIT_ELIGIBLE_MESSAGE =
    "No eligible candidates found for selected family and limit.";

function resolveFamilyItemLimit(
    family: string,
    input: Pick<ResolveCreateBatchCandidateIdsInput, "maxItems" | "limitPerFamily">
): number | undefined {
    const perFamily = input.limitPerFamily?.[family];
    if (perFamily !== undefined && perFamily > 0) {
        return perFamily;
    }
    if (input.maxItems !== undefined && input.maxItems > 0) {
        return input.maxItems;
    }
    return undefined;
}

export type CreateBatchCandidateResolution = {
    familyConfigs: ImportReviewPublishFamilyConfig[];
    candidateIdsByFamily: Record<string, bigint[]>;
    countByFamily: Record<string, number>;
    totalItems: number;
};

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function duplicateGuardSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "match_status")} IS DISTINCT FROM 'duplicate_candidate'
        AND ${col(alias, "match_status")} IS DISTINCT FROM 'possible_duplicate'
        OR (
            ${col(alias, "match_status")} IN ('duplicate_candidate', 'possible_duplicate')
            AND trim(coalesce(${col(alias, "review_note")}, '')) <> ''
        )
    )`;
}

/** Scope checks for explicitly selected candidate ids (no candidate validation_errors gate). */
function buildSelectedCandidateIdsSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    candidateIds: readonly bigint[],
    filters: CreatePublishBatchFilters
): Prisma.Sql {
    const a = config.tableAlias;
    const reviewDecision = filters.review_decision;
    return Prisma.sql`
        SELECT ${col(a, "id")} AS id
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${col(a, "review_batch_id")} = ${reviewBatchId}
          AND ${col(a, "id")} IN (${Prisma.join(candidateIds)})
          AND ${selectedCandidateReviewStatusEligibleSql(a)}
          AND ${col(a, "review_decision")} = ${reviewDecision}
          AND NOT ${isSelectedCandidatePromotedSql(a)}
          AND ${col(a, "match_status")} IS DISTINCT FROM 'manual_protected'
          AND ${col(a, "auto_action")} IS DISTINCT FROM 'protect_manual'
          AND ${duplicateGuardSql(a)}
          AND NOT ${isBlockedInSelectedPromotionRetrySql(config, a)}
          AND ${selectedCandidatePromotionStatusEligibleSql(a)}
        ORDER BY ${col(a, "id")} ASC
    `;
}

export function resolveCreateBatchFamiliesFromSimpleRegistry(
    families: readonly string[]
): ImportReviewPublishFamilyConfig[] {
    const configs = parsePromotionEligibilityFamiliesParam([...families]);
    for (const cfg of configs) {
        assertPromotableFamily(cfg.entityFamily);
        if (!isImportReviewSimplePromotionFamily(cfg.entityFamily)) {
            throw new Error(`Entity family ${cfg.entityFamily} is not in the simple promotion registry.`);
        }
    }
    return configs;
}

export function normalizeCandidateIdsByFamilyInput(
    families: readonly string[],
    raw: Readonly<Record<string, readonly (bigint | number | string)[]>> | undefined
): Record<string, bigint[]> {
    const out: Record<string, bigint[]> = {};
    for (const family of families) {
        const ids = raw?.[family] ?? [];
        const normalized: bigint[] = [];
        for (const id of ids) {
            if (typeof id === "bigint") {
                normalized.push(id);
            } else if (typeof id === "number" && Number.isInteger(id) && id > 0) {
                normalized.push(BigInt(id));
            } else if (typeof id === "string" && /^\d+$/.test(id.trim())) {
                normalized.push(BigInt(id.trim()));
            }
        }
        out[family] = [...new Set(normalized)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }
    return out;
}

type SelectedCandidateRow = {
    id: bigint;
    review_batch_id: bigint;
};

async function loadCandidateRowInFamily(
    prisma: PrismaClient,
    config: ImportReviewPublishFamilyConfig,
    candidateId: bigint
): Promise<SelectedCandidateRow | null> {
    const a = config.tableAlias;
    const rows = await prisma.$queryRaw<SelectedCandidateRow[]>`
        SELECT ${col(a, "id")} AS id, ${col(a, "review_batch_id")} AS review_batch_id
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${col(a, "id")} = ${candidateId}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

async function findCandidateInOtherFamilies(
    prisma: PrismaClient,
    reviewBatchId: bigint,
    excludeFamily: string,
    candidateId: bigint,
    familyConfigs: ImportReviewPublishFamilyConfig[]
): Promise<string | null> {
    for (const other of familyConfigs) {
        if (other.entityFamily === excludeFamily) {
            continue;
        }
        const row = await loadCandidateRowInFamily(prisma, other, candidateId);
        if (row && row.review_batch_id === reviewBatchId) {
            return other.entityFamily;
        }
    }
    return null;
}

export async function assertSelectedCandidatesResolvedStrict(
    prisma: PrismaClient,
    reviewBatchId: bigint,
    familyConfigs: ImportReviewPublishFamilyConfig[],
    requested: Record<string, bigint[]>,
    resolved: Record<string, bigint[]>,
    filters: CreatePublishBatchFilters
): Promise<void> {
    for (const config of familyConfigs) {
        const family = config.entityFamily;
        const requestedIds = requested[family] ?? [];
        if (requestedIds.length === 0) {
            continue;
        }
        const resolvedSet = new Set((resolved[family] ?? []).map((id) => id.toString()));
        for (const candidateId of requestedIds) {
            if (resolvedSet.has(candidateId.toString())) {
                continue;
            }
            const row = await loadCandidateRowInFamily(prisma, config, candidateId);
            if (!row) {
                const allFamilyConfigs = resolveCreateBatchFamiliesFromSimpleRegistry(
                    listPromotableFamilies()
                );
                const otherFamily = await findCandidateInOtherFamilies(
                    prisma,
                    reviewBatchId,
                    family,
                    candidateId,
                    allFamilyConfigs
                );
                if (otherFamily) {
                    throw new ImportReviewPromotionSelectedCandidateError(
                        "wrong_family",
                        `Candidate ${candidateId.toString()} belongs to family "${otherFamily}", not "${family}".`,
                        family,
                        candidateId,
                        {
                            actual_family: otherFamily,
                            expected_family: family,
                            target_table: config.coreTargetTable,
                        }
                    );
                }
                const diagnosis = await diagnoseUnresolvedSelectedCandidate(
                    prisma,
                    config,
                    reviewBatchId,
                    candidateId,
                    filters
                );
                throw new ImportReviewPromotionSelectedCandidateError(
                    diagnosis.reason,
                    diagnosis.message,
                    family,
                    candidateId,
                    diagnosis.details
                );
            }
            if (row.review_batch_id !== reviewBatchId) {
                throw new ImportReviewPromotionSelectedCandidateError(
                    "wrong_review_batch",
                    `Candidate ${candidateId.toString()} belongs to review batch ${row.review_batch_id.toString()}, not ${reviewBatchId.toString()}.`,
                    family,
                    candidateId,
                    {
                        expected_review_batch_id: reviewBatchId.toString(),
                        actual_review_batch_id: row.review_batch_id.toString(),
                        target_table: config.coreTargetTable,
                    }
                );
            }
            const diagnosis = await diagnoseUnresolvedSelectedCandidate(
                prisma,
                config,
                reviewBatchId,
                candidateId,
                filters
            );
            throw new ImportReviewPromotionSelectedCandidateError(
                diagnosis.reason,
                diagnosis.message,
                family,
                candidateId,
                diagnosis.details
            );
        }
    }
}

export function assertSelectedModeHasCandidates(
    mode: CreatePublishBatchMode,
    candidateIdsByFamily: Record<string, bigint[]>
): void {
    if (mode !== "selected") {
        return;
    }
    const total = Object.values(candidateIdsByFamily).reduce((sum, ids) => sum + ids.length, 0);
    if (total === 0) {
        throw new ImportReviewPromotionNoEligibleCandidatesError(
            0,
            CREATE_BATCH_NO_ELIGIBLE_MESSAGE,
            []
        );
    }
}

export class ImportReviewPromotionCreateBatchResolver {
    constructor(private readonly prisma: PrismaClient) {}

    async resolveCandidateIds(
        input: ResolveCreateBatchCandidateIdsInput
    ): Promise<CreateBatchCandidateResolution> {
        const familyConfigs = resolveCreateBatchFamiliesFromSimpleRegistry(input.families);
        const eligibilityOptions: PublishEligibilityOptions = {
            includeWarnings: input.filters.include_warnings,
            includeMerged: false,
        };

        const candidateIdsByFamily: Record<string, bigint[]> = {};
        const countByFamily: Record<string, number> = {};

        if (input.mode === "selected") {
            const requested = normalizeCandidateIdsByFamilyInput(
                input.families,
                input.candidateIdsByFamily
            );
            assertSelectedModeHasCandidates("selected", requested);

            for (const config of familyConfigs) {
                const requestedIds = requested[config.entityFamily] ?? [];
                if (requestedIds.length === 0) {
                    candidateIdsByFamily[config.entityFamily] = [];
                    countByFamily[config.entityFamily] = 0;
                    continue;
                }
                const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
                    ${buildSelectCreateBatchEligibleCandidateIdsSql(
                        config,
                        input.reviewBatchId,
                        eligibilityOptions,
                        { candidateIds: requestedIds }
                    )}
                `;
                const ids = rows.map((r) => r.id);
                candidateIdsByFamily[config.entityFamily] = ids;
                countByFamily[config.entityFamily] = ids.length;
            }

            await assertSelectedCandidatesResolvedStrict(
                this.prisma,
                input.reviewBatchId,
                familyConfigs,
                requested,
                candidateIdsByFamily,
                input.filters
            );
        } else {
            const hasItemLimit =
                (input.maxItems !== undefined && input.maxItems > 0) ||
                Object.values(input.limitPerFamily ?? {}).some((n) => n > 0);

            for (const config of familyConfigs) {
                const familyLimit = resolveFamilyItemLimit(config.entityFamily, input);
                const sql = buildSelectCreateBatchEligibleCandidateIdsSql(
                    config,
                    input.reviewBatchId,
                    eligibilityOptions,
                    { limit: familyLimit }
                );
                const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`${sql}`;
                const ids = rows.map((r) => r.id);
                candidateIdsByFamily[config.entityFamily] = ids;
                countByFamily[config.entityFamily] = ids.length;
            }

            const totalItems = Object.values(countByFamily).reduce((sum, n) => sum + n, 0);
            if (totalItems === 0 && hasItemLimit) {
                throw new ImportReviewPromotionNoEligibleCandidatesError(
                    0,
                    PROMOTION_CREATE_BATCH_NO_LIMIT_ELIGIBLE_MESSAGE,
                    familyConfigs.map((cfg) => ({
                        entity_family: cfg.entityFamily,
                        included: countByFamily[cfg.entityFamily] ?? 0,
                        skipped_reasons: [],
                    }))
                );
            }
        }

        const totalItems = Object.values(countByFamily).reduce((sum, n) => sum + n, 0);
        if (totalItems === 0) {
            const modeLabel = input.mode === "selected" ? "selected" : "all_ready";
            throw new ImportReviewPromotionNoEligibleCandidatesError(
                0,
                CREATE_BATCH_NO_ELIGIBLE_MESSAGE,
                familyConfigs.map((cfg) => ({
                    entity_family: cfg.entityFamily,
                    included: countByFamily[cfg.entityFamily] ?? 0,
                    skipped_reasons: [],
                }))
            );
        }

        return {
            familyConfigs,
            candidateIdsByFamily,
            countByFamily,
            totalItems,
        };
    }
}

export function resolveCreateBatchName(
    reviewBatchId: bigint,
    familySlugs: readonly string[],
    provided?: string | null
): string {
    const trimmed = provided?.trim();
    if (trimmed) {
        return trimmed;
    }
    return defaultCreateBatchName(reviewBatchId, familySlugs);
}
