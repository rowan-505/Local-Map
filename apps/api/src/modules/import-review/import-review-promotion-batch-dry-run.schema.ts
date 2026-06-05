import { z } from "zod";

export const postImportReviewPromotionBatchDryRunBodySchema = z
    .object({
        confirm_large_batch: z.boolean().optional(),
    })
    .strict()
    .optional()
    .default({});

export type PostImportReviewPromotionBatchDryRunBody = z.infer<
    typeof postImportReviewPromotionBatchDryRunBodySchema
>;
