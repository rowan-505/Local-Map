import { z } from "zod";

const paginationSchema = {
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
};

export const importReviewHistoryReviewBatchIdParamsSchema = z.object({
    id: z.string().regex(/^\d+$/),
});

export const importReviewHistoryPublishBatchIdParamsSchema = z.object({
    id: z.string().regex(/^\d+$/),
});

export const importReviewHistoryReviewBatchesListQuerySchema = z.object({
    status: z.string().trim().min(1).optional(),
    source_snapshot_version: z.string().trim().min(1).optional(),
    entity_family: z.string().trim().min(1).optional(),
    uploaded_after: z.string().datetime().optional(),
    uploaded_before: z.string().datetime().optional(),
    ...paginationSchema,
});

export const importReviewHistoryPublishBatchesListQuerySchema = z.object({
    status: z.string().trim().min(1).optional(),
    source_review_batch_id: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .transform((v) => (v ? BigInt(v) : undefined)),
    source_snapshot_version: z.string().trim().min(1).optional(),
    entity_family: z.string().trim().min(1).optional(),
    created_after: z.string().datetime().optional(),
    created_before: z.string().datetime().optional(),
    ...paginationSchema,
});

export const importReviewHistoryPublishBatchItemsQuerySchema = z.object({
    publish_status: z.string().trim().min(1).optional(),
    entity_family: z.string().trim().min(1).optional(),
    ...paginationSchema,
});

export type ImportReviewHistoryReviewBatchesListQuery = z.infer<
    typeof importReviewHistoryReviewBatchesListQuerySchema
>;
export type ImportReviewHistoryPublishBatchesListQuery = z.infer<
    typeof importReviewHistoryPublishBatchesListQuerySchema
>;
export type ImportReviewHistoryPublishBatchItemsQuery = z.infer<
    typeof importReviewHistoryPublishBatchItemsQuerySchema
>;
