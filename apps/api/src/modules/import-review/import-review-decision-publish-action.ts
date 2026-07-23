/**
 * Map Import Review conflict decisions → publish_action for Apply.
 * Places-first; other families keep calling buildPublishActionExpr which embeds this SQL.
 */

import { Prisma } from "@prisma/client";

export type ConflictPublishAction =
    | "insert"
    | "update"
    | "merge"
    | "skip"
    | "soft_delete";

/** Decisions that close without core write (or soft-delete when supported). */
export const IMPORT_REVIEW_SKIP_APPLY_DECISIONS = [
    "keep_existing",
    "ignore_import",
    "mark_duplicate",
] as const;

/** Decisions that write/update core (excluding soft-delete until controlled). */
export const IMPORT_REVIEW_CORE_WRITE_DECISIONS = [
    "replace_existing",
    "merge_fields",
    "insert_separate",
    "approved",
] as const;

/** All decisions eligible for an Apply batch (skip + write). Soft-delete excluded from pilot. */
export const IMPORT_REVIEW_APPLY_BATCH_DECISION_SQL_IN = `(
    'approved',
    'replace_existing',
    'merge_fields',
    'insert_separate',
    'keep_existing',
    'ignore_import',
    'mark_duplicate',
    'merged'
)`;

export function reviewDecisionToPublishAction(
    decision: string | null | undefined,
    matchedCoreId: bigint | number | string | null | undefined
): ConflictPublishAction {
    const d = (decision ?? "").trim().toLowerCase();
    const hasMatch = matchedCoreId != null && String(matchedCoreId).trim() !== "";

    switch (d) {
        case "keep_existing":
        case "ignore_import":
        case "ignored":
        case "rejected":
        case "mark_duplicate":
        case "merged":
            return "skip";
        case "insert_separate":
            return "insert";
        case "replace_existing":
        case "approved":
            return hasMatch ? "update" : "insert";
        case "merge_fields":
            return hasMatch ? "merge" : "insert";
        case "confirm_soft_delete":
            return "soft_delete";
        default:
            return hasMatch ? "update" : "insert";
    }
}

/** SQL expression for publish_action from candidate alias columns. */
export function buildDecisionPublishActionExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN lower(btrim(coalesce(${a}.review_decision, ''))) IN (
                'keep_existing', 'ignore_import', 'ignored', 'rejected',
                'mark_duplicate', 'merged'
            ) THEN 'skip'
            WHEN lower(btrim(coalesce(${a}.review_decision, ''))) = 'insert_separate'
                THEN 'insert'
            WHEN lower(btrim(coalesce(${a}.review_decision, ''))) = 'confirm_soft_delete'
                THEN 'soft_delete'
            WHEN lower(btrim(coalesce(${a}.review_decision, ''))) = 'merge_fields'
                THEN CASE
                    WHEN ${a}.matched_core_id IS NOT NULL THEN 'merge'
                    ELSE 'insert'
                END
            WHEN lower(btrim(coalesce(${a}.review_decision, ''))) IN (
                'replace_existing', 'approved'
            ) THEN CASE
                WHEN ${a}.matched_core_id IS NOT NULL THEN 'update'
                ELSE 'insert'
            END
            -- Legacy fallback (pre-decision batches)
            WHEN ${a}.match_status = 'duplicate_candidate'
                 AND ${a}.review_decision IN ('merged', 'mark_duplicate') THEN 'skip'
            WHEN ${a}.auto_action = 'update_candidate'
                 OR ${a}.matched_core_id IS NOT NULL THEN 'update'
            ELSE 'insert'
        END
    `;
}

export type FieldChoice = "existing" | "imported" | "custom";

export type ParsedFieldChoices = Record<
    string,
    { choice: FieldChoice; custom?: string }
>;

/** Parse field_choices:{...} from review_note (dashboard merge UI). */
export function parseFieldChoicesFromReviewNote(
    note: string | null | undefined
): ParsedFieldChoices {
    if (!note) return {};
    const match = note.match(/field_choices:(\{[\s\S]*\})\s*$/m);
    if (!match?.[1]) return {};
    try {
        const raw = JSON.parse(match[1]) as Record<string, unknown>;
        const out: ParsedFieldChoices = {};
        for (const [field, value] of Object.entries(raw)) {
            if (typeof value === "string") {
                if (value === "existing" || value === "imported" || value === "custom") {
                    out[field] = { choice: value };
                } else if (value === "unset") {
                    continue;
                } else {
                    out[field] = { choice: "custom", custom: value };
                }
            } else if (value && typeof value === "object" && !Array.isArray(value)) {
                const obj = value as Record<string, unknown>;
                const choice = String(obj.choice ?? "").toLowerCase();
                if (choice === "existing" || choice === "imported" || choice === "custom") {
                    out[field] = {
                        choice,
                        custom: obj.custom != null ? String(obj.custom) : undefined,
                    };
                }
            }
        }
        return out;
    } catch {
        return {};
    }
}

export function fieldChoicesFromOverridesArchive(
    archive: unknown
): ParsedFieldChoices {
    if (!archive || typeof archive !== "object" || Array.isArray(archive)) return {};
    const fc = (archive as Record<string, unknown>).field_choices;
    if (!fc || typeof fc !== "object" || Array.isArray(fc)) return {};
    const out: ParsedFieldChoices = {};
    for (const [field, value] of Object.entries(fc as Record<string, unknown>)) {
        if (typeof value === "string") {
            if (value === "existing" || value === "imported" || value === "custom") {
                out[field] = { choice: value };
            }
        } else if (value && typeof value === "object") {
            const obj = value as Record<string, unknown>;
            const choice = String(obj.choice ?? value).toLowerCase();
            if (choice === "existing" || choice === "imported" || choice === "custom") {
                out[field] = {
                    choice,
                    custom: obj.custom != null ? String(obj.custom) : undefined,
                };
            }
        }
    }
    return out;
}
