import { z } from "zod";

const paginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const listRoutingBuildsQuerySchema = paginationQuerySchema.extend({
    engine_code: z.string().trim().min(1).max(32).optional(),
    status: z.string().trim().min(1).max(32).optional(),
    is_active: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === "true")),
});

export type ListRoutingBuildsQuery = z.infer<typeof listRoutingBuildsQuerySchema>;

export const routingBuildIdParamSchema = z.object({
    id: z.string().trim().min(1).max(64),
});

export const listRoutingFeedbackQuerySchema = paginationQuerySchema.extend({
    status: z.enum(["open", "triaged", "resolved", "dismissed"]).optional(),
    problem_type: z.string().trim().min(1).max(64).optional(),
});

export type ListRoutingFeedbackQuery = z.infer<typeof listRoutingFeedbackQuerySchema>;

export const routingFeedbackIdParamSchema = z.object({
    id: z.string().trim().min(1).max(64),
});

export const patchRoutingFeedbackStatusBodySchema = z.object({
    status: z.enum(["open", "triaged", "resolved", "dismissed"]),
});

export type PatchRoutingFeedbackStatusBody = z.infer<typeof patchRoutingFeedbackStatusBodySchema>;

export const listRoutingValidationReportsQuerySchema = paginationQuerySchema.extend({
    routing_build_id: z.string().regex(/^\d+$/).optional(),
    severity: z.enum(["info", "warning", "error"]).optional(),
    report_scope: z
        .enum(["graph_build", "engine_build", "smoke_test", "publish", "request"])
        .optional(),
});

export type ListRoutingValidationReportsQuery = z.infer<
    typeof listRoutingValidationReportsQuerySchema
>;
