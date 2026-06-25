import { z } from "zod";

export const POINT_REASON_CODES = [
    "admin_adjustment",
    "valid_contribution",
    "reversal",
    "spam_penalty",
] as const;

export const adminPointBodySchema = z.object({
    pointsDelta: z
        .number()
        .int()
        .gte(-1_000_000)
        .lte(1_000_000)
        .refine((value) => value !== 0, "pointsDelta must be non-zero"),
    reasonCode: z.enum(POINT_REASON_CODES),
    note: z.string().trim().max(1000).optional(),
    relatedEntityType: z.string().trim().max(120).optional(),
    relatedEntityId: z.number().int().positive().optional(),
});

export const userPublicIdParamSchema = z.object({
    id: z.string().trim().uuid(),
});

export const pointHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminLedgerQuerySchema = z.object({
    userId: z.string().trim().uuid().optional(),
    reasonCode: z.enum(POINT_REASON_CODES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const topPointUsersQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const pointSummaryResponseSchema = z.object({
    total_points: z.number().int(),
    lifetime_points_earned: z.number().int(),
    lifetime_points_removed: z.number().int(),
    updated_at: z.string().nullable(),
});

export const pointLedgerItemResponseSchema = z.object({
    id: z.string(),
    points_delta: z.number().int(),
    reason_code: z.string(),
    note: z.string().nullable(),
    related_entity_type: z.string().nullable(),
    related_entity_id: z.string().nullable(),
    created_at: z.string(),
});
