import { z } from "zod";

export const postImportReviewPromotionRoadDryRunBodySchema = z.object({
    confirm_routing_warnings: z.boolean().optional().default(false),
    use_review_overrides: z.boolean().optional().default(true),
    connectivity_threshold_m: z.coerce.number().finite().min(5).max(250).optional().default(35),
    duplicate_threshold_m: z.coerce.number().finite().min(1).max(100).optional().default(15),
});

export type PostImportReviewPromotionRoadDryRunBody = z.infer<
    typeof postImportReviewPromotionRoadDryRunBodySchema
>;
