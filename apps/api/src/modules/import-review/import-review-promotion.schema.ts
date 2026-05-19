import { z } from "zod";

import {
    mergeImportReviewSnapshotAliases,
    refineImportReviewSnapshotBatchScope,
} from "./import-review.schema.js";

export const importReviewPromotionScopeQuerySchema = z
    .object({
        source_snapshot_version: z.string().trim().min(1).optional(),
        review_batch_id: z
            .preprocess((value): bigint | undefined => {
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
            }, z.bigint().optional())
            .optional(),
        include_merged: z
            .preprocess((v) => v === true || v === "true" || v === "1" || v === 1, z.boolean())
            .optional()
            .default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const importReviewPromotionReadyQuerySchema = importReviewPromotionScopeQuerySchema;

export const importReviewPromotionBatchesListQuerySchema = importReviewPromotionScopeQuerySchema.extend({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export const importReviewPromotionReadyCandidatesSortSchema = z.enum([
    "updated_at_desc",
    "updated_at_asc",
    "confidence_score_desc",
    "name_asc",
]);

export const importReviewPromotionReadyCandidatesQuerySchema = importReviewPromotionScopeQuerySchema.extend({
    entity_family: z.enum(["buildings"]).optional().default("buildings"),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    sort: importReviewPromotionReadyCandidatesSortSchema.optional().default("updated_at_desc"),
    include_geometry: z
        .preprocess((v) => v === true || v === "true" || v === "1" || v === 1, z.boolean())
        .optional()
        .default(false),
});

export const importReviewPromotionBatchIdParamsSchema = z.object({
    id: z.string().trim().min(1),
});

export const postImportReviewPromotionBatchBodySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    z
        .object({
            source_snapshot_version: z.string().trim().min(1).optional(),
            review_batch_id: z
                .preprocess((value): bigint | undefined => {
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
                }, z.bigint().optional())
                .optional(),
            batch_name: z.string().trim().min(1).max(200),
            note: z.string().trim().max(4000).optional(),
            include_merged: z.boolean().optional().default(false),
        })
        .superRefine(refineImportReviewSnapshotBatchScope)
);

export type ImportReviewPromotionScopeQuery = z.infer<typeof importReviewPromotionScopeQuerySchema>;
export type ImportReviewPromotionReadyQuery = z.infer<typeof importReviewPromotionReadyQuerySchema>;
export type ImportReviewPromotionBatchesListQuery = z.infer<typeof importReviewPromotionBatchesListQuerySchema>;
export type PostImportReviewPromotionBatchBody = z.infer<typeof postImportReviewPromotionBatchBodySchema>;
export type ImportReviewPromotionReadyCandidatesQuery = z.infer<
    typeof importReviewPromotionReadyCandidatesQuerySchema
>;

export const postImportReviewPromotionBatchPromoteBodySchema = z.object({
    confirmation_text: z.literal("PROMOTE"),
    chunk_size: z.coerce.number().int().min(1).max(500).optional().default(100),
});

export type PostImportReviewPromotionBatchPromoteBody = z.infer<
    typeof postImportReviewPromotionBatchPromoteBodySchema
>;
