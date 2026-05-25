import { z } from "zod";

export const postImportReviewPromotionRoutingBarrierDryRunBodySchema = z.object({
    include_warnings: z.boolean().optional().default(false),
    revalidate: z.boolean().optional().default(true),
    use_review_overrides: z.boolean().optional().default(true),
    nearby_core_road_threshold_m: z.coerce.number().finite().min(1).max(250).optional().default(30),
    nearby_review_road_threshold_m: z.coerce.number().finite().min(1).max(250).optional().default(30),
    duplicate_threshold_m: z.coerce.number().finite().min(1).max(100).optional().default(10),
});

export type PostImportReviewPromotionRoutingBarrierDryRunBody = z.infer<
    typeof postImportReviewPromotionRoutingBarrierDryRunBodySchema
>;
