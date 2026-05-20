import { z } from "zod";

import {
    mergeImportReviewSnapshotAliases,
    refineImportReviewSnapshotBatchScope,
} from "./import-review.schema.js";
import { IMPORT_REVIEW_ENTITY_FAMILIES } from "./import-review-config.js";

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

function coerceBooleanQuery(value: unknown): boolean {
    return value === true || value === "true" || value === "1" || value === 1;
}

function coerceOptionalReviewBatchId(value: unknown): bigint | undefined {
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

const publishEntityFamilySchema = z.enum(IMPORT_REVIEW_ENTITY_FAMILIES);

/** Shared scope fields — plain shape, no refinements. */
const importReviewPromotionScopeQueryShape = {
    source_snapshot_version: z.string().trim().min(1).optional(),
    review_batch_id: z
        .preprocess(coerceOptionalReviewBatchId, z.bigint().optional())
        .optional(),
    include_merged: z
        .preprocess(coerceBooleanQuery, z.boolean())
        .optional()
        .default(false),
    latest: z
        .preprocess(coerceBooleanQuery, z.boolean())
        .optional()
        .default(false),
} as const;

// Do not call .omit/.pick/.extend on refined schemas. Apply refinements after object composition.
const importReviewPromotionScopeQueryObjectSchema = z.object(importReviewPromotionScopeQueryShape);

export const importReviewPromotionScopeQuerySchema = importReviewPromotionScopeQueryObjectSchema.superRefine(
    refineImportReviewSnapshotBatchScope
);

export const importReviewPromotionReadyQuerySchema = importReviewPromotionScopeQuerySchema;

export const importReviewPromotionBatchesListQuerySchema = importReviewPromotionScopeQueryObjectSchema
    .extend({
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        offset: z.coerce.number().int().min(0).optional().default(0),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const importReviewPromotionReadyCandidatesSortSchema = z.enum([
    "updated_at_desc",
    "updated_at_asc",
    "confidence_score_desc",
    "name_asc",
]);

export const importReviewPromotionReadyCandidatesQuerySchema = importReviewPromotionScopeQueryObjectSchema
    .extend({
        entity_family: z.enum(["buildings"]).optional().default("buildings"),
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        offset: z.coerce.number().int().min(0).optional().default(0),
        sort: importReviewPromotionReadyCandidatesSortSchema.optional().default("updated_at_desc"),
        include_geometry: z
            .preprocess(coerceBooleanQuery, z.boolean())
            .optional()
            .default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const importReviewPromotionBatchIdParamsSchema = z.object({
    id: z.string().trim().min(1),
});

export const importReviewPromotionBatchEligibilityQuerySchema = importReviewPromotionScopeQueryObjectSchema
    .omit({ include_merged: true })
    .extend({
        entity_families: z
            .preprocess(coerceStringArray, z.array(publishEntityFamilySchema).optional()),
        include_warnings: z
            .preprocess(coerceBooleanQuery, z.boolean())
            .optional()
            .default(false),
        mode: z.enum(["approved_only"]).optional().default("approved_only"),
        include_merged: z
            .preprocess(coerceBooleanQuery, z.boolean())
            .optional()
            .default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

const postImportReviewPromotionBatchBodyObjectSchema = z.object({
    source_snapshot_version: z.string().trim().min(1).optional(),
    review_batch_id: z
        .preprocess(coerceOptionalReviewBatchId, z.bigint().optional())
        .optional(),
    batch_name: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().max(4000).optional(),
    entity_families: z.array(publishEntityFamilySchema).optional(),
    mode: z.enum(["approved_only"]).optional().default("approved_only"),
    include_warnings: z.boolean().optional().default(false),
    warning_confirmation_note: z.string().trim().max(4000).optional(),
    dry_run: z.boolean().optional().default(false),
    allow_high_risk_families: z.boolean().optional().default(false),
    include_merged: z.boolean().optional().default(false),
});

// Do not call .omit/.pick/.extend on refined schemas. Apply refinements after object composition.
export const postImportReviewPromotionBatchBodySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    postImportReviewPromotionBatchBodyObjectSchema
        .superRefine(refineImportReviewSnapshotBatchScope)
        .superRefine((data, ctx) => {
            if (data.include_warnings && !data.warning_confirmation_note?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "warning_confirmation_note is required when include_warnings is true",
                    path: ["warning_confirmation_note"],
                });
            }
            if (!data.dry_run && !data.batch_name?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "batch_name is required when dry_run is false",
                    path: ["batch_name"],
                });
            }
        })
);

export type ImportReviewPromotionScopeQuery = z.infer<typeof importReviewPromotionScopeQuerySchema>;
export type ImportReviewPromotionReadyQuery = z.infer<typeof importReviewPromotionReadyQuerySchema>;
export type ImportReviewPromotionBatchesListQuery = z.infer<typeof importReviewPromotionBatchesListQuerySchema>;
export type ImportReviewPromotionBatchEligibilityQuery = z.infer<
    typeof importReviewPromotionBatchEligibilityQuerySchema
>;
export type PostImportReviewPromotionBatchBody = z.infer<typeof postImportReviewPromotionBatchBodySchema>;
export type ImportReviewPromotionReadyCandidatesQuery = z.infer<
    typeof importReviewPromotionReadyCandidatesQuerySchema
>;

export const postImportReviewPromotionBatchPromoteBodySchema = z.object({
    confirmation_text: z.literal("PROMOTE"),
    chunk_size: z.coerce.number().int().min(1).max(500).optional().default(100),
    confirm_warnings: z.boolean().optional().default(false),
    warning_confirmation_note: z.string().trim().max(4000).optional(),
});

export type PostImportReviewPromotionBatchPromoteBody = z.infer<
    typeof postImportReviewPromotionBatchPromoteBodySchema
>;
