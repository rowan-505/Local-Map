import { Prisma } from "@prisma/client";

import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import type { PromotionEligibilityBucket } from "./import-review-promotion-eligibility.js";
import { optionalCandidateColumn } from "./import-review-promotion-eligibility-sql-helpers.js";

export type PromotionEligibilityDetailsSortBy = "id" | "updated_at" | "confidence_score";

export type PromotionEligibilityDetailsListFilters = {
    search?: string;
    reasonCode?: string;
    sortBy: PromotionEligibilityDetailsSortBy;
    sortOrder: "asc" | "desc";
};

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function jsonArrayContainsCodeExpr(column: Prisma.Sql, code: string): Prisma.Sql {
    const upper = code.trim().toUpperCase();
    return Prisma.sql`(
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(${column}, '[]'::jsonb)) AS issue
            WHERE upper(
                CASE
                    WHEN jsonb_typeof(issue) = 'string' THEN trim(both '"' from issue::text)
                    ELSE coalesce(issue->>'code', '')
                END
            ) = ${upper}
        )
    )`;
}

/** SQL filter for a normalized reason code (best-effort parity with API reason resolver). */
export function buildEligibilityDetailsReasonCodeSql(
    config: ImportReviewPublishFamilyConfig,
    alias: string,
    bucket: PromotionEligibilityBucket,
    reasonCode: string,
    columns: ReadonlySet<string>
): Prisma.Sql {
    const a = alias;
    const code = reasonCode.trim().toUpperCase();
    if (!code) {
        return Prisma.sql`TRUE`;
    }

    if (code === "READY") {
        return bucket === "ready" ? Prisma.sql`TRUE` : Prisma.sql`FALSE`;
    }
    if (code === "DUPLICATE_UNCONFIRMED") {
        const emptyReviewNote = columns.has("review_note")
            ? Prisma.sql`trim(coalesce(${col(a, "review_note")}, '')) = ''`
            : Prisma.sql`TRUE`;
        return Prisma.sql`(
            ${col(a, "match_status")} IN ('duplicate_candidate', 'possible_duplicate')
            AND ${col(a, "review_decision")} IS DISTINCT FROM 'merged'
            AND ${emptyReviewNote}
        )`;
    }
    if (code === "MANUAL_PROTECTED") {
        return Prisma.sql`(
            ${col(a, "match_status")} = 'manual_protected'
            OR ${col(a, "auto_action")} IN ('protect_manual', 'manual_protected')
        )`;
    }
    if (code === "REJECTED_DECISION") {
        return Prisma.sql`(
            ${col(a, "review_decision")} IN ('rejected', 'ignored', 'needs_more_review')
            OR ${col(a, "review_status")} = 'needs_more_review'
        )`;
    }
    if (code === "ACTIVE_PUBLISH_BATCH" || code.startsWith("PUBLISH_BATCH_")) {
        return bucket === "batched"
            ? Prisma.sql`TRUE`
            : Prisma.sql`EXISTS (
                SELECT 1
                FROM system.system_publish_items AS spi
                WHERE spi.review_candidate_table = ${config.candidateTable}
                  AND spi.review_candidate_id = ${col(a, "id")}
            )`;
    }
    if (code === "ALREADY_PROMOTED" || code.startsWith("PROMOTED_")) {
        return Prisma.sql`(
            ${col(a, "promotion_status")} = 'promoted'
            OR ${col(a, "review_status")} = 'promoted'
        )`;
    }

    const errors = optionalCandidateColumn(a, columns, "validation_errors", "jsonb");
    const warnings = optionalCandidateColumn(a, columns, "validation_warnings", "jsonb");
    return Prisma.sql`(
        ${jsonArrayContainsCodeExpr(errors, code)}
        OR ${jsonArrayContainsCodeExpr(warnings, code)}
    )`;
}

export function buildEligibilityDetailsSearchSql(
    alias: string,
    displayNameSql: Prisma.Sql,
    search: string,
    columns: ReadonlySet<string>
): Prisma.Sql {
    const term = search.trim();
    if (!term) {
        return Prisma.sql`TRUE`;
    }
    const pattern = `%${term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const idMatch =
        /^\d+$/.test(term) ? Prisma.sql`${col(alias, "id")} = ${BigInt(term)}` : Prisma.sql`FALSE`;

    const errors = optionalCandidateColumn(alias, columns, "validation_errors", "jsonb");
    const warnings = optionalCandidateColumn(alias, columns, "validation_warnings", "jsonb");
    const reviewNoteMatch = columns.has("review_note")
        ? Prisma.sql`coalesce(${col(alias, "review_note")}, '') ILIKE ${pattern}`
        : Prisma.sql`FALSE`;

    return Prisma.sql`(
        ${idMatch}
        OR ${col(alias, "external_id")} ILIKE ${pattern}
        OR ${displayNameSql} ILIKE ${pattern}
        OR ${errors}::text ILIKE ${pattern}
        OR ${warnings}::text ILIKE ${pattern}
        OR ${reviewNoteMatch}
    )`;
}

export function buildEligibilityDetailsOrderSql(
    alias: string,
    filters: PromotionEligibilityDetailsListFilters,
    columns: ReadonlySet<string>
): Prisma.Sql {
    const direction = filters.sortOrder === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    switch (filters.sortBy) {
        case "updated_at":
            if (!columns.has("updated_at")) {
                return Prisma.sql`${col(alias, "id")} ${direction}`;
            }
            return Prisma.sql`${col(alias, "updated_at")} ${direction}, ${col(alias, "id")} ASC`;
        case "confidence_score":
            if (!columns.has("confidence_score")) {
                return Prisma.sql`${col(alias, "id")} ${direction}`;
            }
            return Prisma.sql`${col(alias, "confidence_score")} ${direction} NULLS LAST, ${col(alias, "id")} ASC`;
        case "id":
        default:
            return Prisma.sql`${col(alias, "id")} ${direction}`;
    }
}

export function parseEligibilityDetailsListFilters(query: {
    search?: string;
    reason_code?: string;
    sort_by?: string;
    sort_order?: string;
}): PromotionEligibilityDetailsListFilters {
    const sortByRaw = (query.sort_by ?? "id").trim().toLowerCase();
    const sortBy: PromotionEligibilityDetailsSortBy =
        sortByRaw === "updated_at" || sortByRaw === "confidence_score" ? sortByRaw : "id";

    const sortOrderRaw = (query.sort_order ?? "asc").trim().toLowerCase();
    const sortOrder = sortOrderRaw === "desc" ? "desc" : "asc";

    const search = query.search?.trim() || undefined;
    const reasonCode = query.reason_code?.trim() || undefined;

    return { search, reasonCode, sortBy, sortOrder };
}
