import { z } from "zod";

export const ACCOUNT_STATUSES = ["active", "disabled", "deleted"] as const;
export const ANALYTICS_BUCKETS = ["day", "week", "month"] as const;

const roleCodeSchema = z
    .string()
    .trim()
    .regex(/^[a-z_]+$/, "Invalid role code");

export const userPublicIdParamSchema = z.object({
    id: z.string().trim().uuid(),
});

export const userRoleParamSchema = z.object({
    id: z.string().trim().uuid(),
    roleCode: roleCodeSchema,
});

export const listUsersQuerySchema = z.object({
    search: z.string().trim().min(1).max(200).optional(),
    role: roleCodeSchema.optional(),
    emailVerified: z.coerce.boolean().optional(),
    accountStatus: z.enum(ACCOUNT_STATUSES).optional(),
    primaryRegionId: z.coerce.number().int().positive().optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateStatusBodySchema = z.object({
    accountStatus: z.enum(ACCOUNT_STATUSES),
});

export const updateAdminNoteBodySchema = z.object({
    adminNote: z.string().max(2000).nullable(),
});

export const assignRoleBodySchema = z.object({
    roleCode: roleCodeSchema,
});

export const growthQuerySchema = z.object({
    bucket: z.enum(ANALYTICS_BUCKETS).default("day"),
    days: z.coerce.number().int().min(1).max(365).default(30),
});

export const auditQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
