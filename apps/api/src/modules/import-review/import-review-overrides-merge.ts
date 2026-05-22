import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import { colRef } from "./import-review-candidate-sql.js";

/** Keys with null values are removed; non-null values are shallow-merged. Empty patch clears all overrides. */
export function applyReviewOverridesPatch(
    existing: Record<string, unknown>,
    patch: Record<string, unknown>
): Record<string, unknown> {
    if (Object.keys(patch).length === 0) {
        return {};
    }

    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) {
            delete merged[key];
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

/** SQL expression for SET review_overrides = … (null patch values delete keys; {} replaces entire object). */
export function buildReviewOverridesMergeExpr(
    config: ImportReviewEntityFamilyConfig,
    overridesPatch: Record<string, unknown>
): Prisma.Sql {
    if (Object.keys(overridesPatch).length === 0) {
        return Prisma.sql`'{}'::jsonb`;
    }

    const merge = JSON.stringify(overridesPatch);
    const overridesCol = colRef(config, "review_overrides");
    return Prisma.sql`(
        (
            COALESCE(to_jsonb(${overridesCol}), '{}'::jsonb)
            || COALESCE(
                (
                    SELECT jsonb_object_agg(e.key, e.value)
                    FROM jsonb_each(${merge}::jsonb) AS e(key, value)
                    WHERE jsonb_typeof(e.value) <> 'null'
                ),
                '{}'::jsonb
            )
        )
        - COALESCE(
            (
                SELECT array_agg(e.key)
                FROM jsonb_each(${merge}::jsonb) AS e(key, value)
                WHERE jsonb_typeof(e.value) = 'null'
            ),
            ARRAY[]::text[]
        )
    )`;
}
