import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import {
    buildCandidateCommonSelect,
    buildCandidateFromClause,
} from "./import-review-candidate-sql.js";

/**
 * Full candidate row for drawer/detail: includes normalized_data, source_refs,
 * validation JSON, matched_core_data — never geometry (use geometry SQL separately).
 */
export function buildCandidateDetailSelect(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    return buildCandidateCommonSelect(config, false, reviewBatchId);
}

export function buildCandidateDetailFromClause(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return buildCandidateFromClause(config);
}
