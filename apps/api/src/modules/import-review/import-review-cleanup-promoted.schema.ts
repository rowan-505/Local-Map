import { z } from "zod";

import { IMPORT_REVIEW_ENTITY_FAMILIES } from "./import-review-config.js";

function coerceOptionalBigIntId(value: unknown): bigint | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string") {
        const t = value.trim();
        if (t === "") {
            return undefined;
        }
        return BigInt(t);
    }
    return undefined;
}

function coerceRequiredBigIntId(value: unknown): bigint {
    const parsed = coerceOptionalBigIntId(value);
    if (parsed === undefined) {
        throw new Error("Invalid id");
    }
    return parsed;
}

function coerceStringArray(value: unknown): string[] | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
    }
    const s = String(value).trim();
    return s.length > 0 ? [s] : undefined;
}

const cleanupEntityFamilySchema = z.enum(IMPORT_REVIEW_ENTITY_FAMILIES);

const cleanupScopeBodyShape = {
    review_batch_id: z.preprocess(coerceRequiredBigIntId, z.bigint()),
    entity_families: z
        .preprocess(coerceStringArray, z.array(cleanupEntityFamilySchema).optional())
        .optional(),
    publish_batch_id: z.preprocess(coerceOptionalBigIntId, z.bigint().optional()).optional(),
    older_than_days: z.coerce.number().int().min(0).optional(),
} as const;

export const postImportReviewCleanupPromotedDryRunBodySchema = z.object(cleanupScopeBodyShape);

export const postImportReviewCleanupPromotedExecuteBodySchema = z.object({
    ...cleanupScopeBodyShape,
    confirmation_text: z.literal("DELETE PROMOTED REVIEW DATA"),
});

export type PostImportReviewCleanupPromotedDryRunBody = z.infer<
    typeof postImportReviewCleanupPromotedDryRunBodySchema
>;

export type PostImportReviewCleanupPromotedExecuteBody = z.infer<
    typeof postImportReviewCleanupPromotedExecuteBodySchema
>;
