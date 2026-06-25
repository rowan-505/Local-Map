import { z } from "zod";

/** Report category codes — must match the seeded ref.ref_report_types rows. */
export const REPORT_TYPE_CODES = [
    "wrong_info",
    "wrong_location",
    "missing_item",
    "closed_or_removed",
    "duplicate_item",
    "transport_issue",
    "community_info",
    "other_map_issue",
] as const;

/** Lifecycle status codes — must match the seeded ref.ref_report_statuses rows. */
export const REPORT_STATUS_CODES = [
    "submitted",
    "in_review",
    "needs_more_info",
    "accepted",
    "rejected",
    "duplicate",
] as const;

/**
 * Reason codes accepted by the report reward endpoint. Must be a subset of the
 * contrib.point_ledger reason_code CHECK (see migration 113). For a normal reward
 * from an accepted report, prefer `valid_report` or `useful_correction`.
 */
export const REPORT_REWARD_REASON_CODES = [
    "valid_report",
    "useful_correction",
    "useful_photo",
    "admin_adjustment",
    "reversal",
    "spam_penalty",
    "false_report_penalty",
] as const;

/** Target kinds supported by the MVP report flow. */
export const REPORT_TARGET_ENTITY_TYPES = [
    "place",
    "street",
    "building",
    "bus_stop",
    "bus_route",
    "map_point",
] as const;

export const reportCreateBodySchema = z
    .object({
        reportTypeCode: z.enum(REPORT_TYPE_CODES),
        reasonCode: z.string().trim().min(1).max(120).optional(),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().min(1).max(4000),
        targetEntityType: z.enum(REPORT_TARGET_ENTITY_TYPES),
        targetEntityId: z.number().int().positive().optional(),
        targetPublicId: z.string().trim().uuid().optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        // Required for anonymous reports (may also arrive via the x-anonymous-id header).
        anonymousId: z.string().trim().min(1).max(128).optional(),
    })
    .superRefine((value, ctx) => {
        if (value.targetEntityType === "map_point") {
            if (value.latitude === undefined || value.longitude === undefined) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["latitude"],
                    message: "latitude and longitude are required for map_point targets",
                });
            }
        } else if (value.targetEntityId === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["targetEntityId"],
                message: "targetEntityId is required for entity targets",
            });
        }
        // A coordinate pair must be complete when either side is present.
        const hasLat = value.latitude !== undefined;
        const hasLng = value.longitude !== undefined;
        if (hasLat !== hasLng) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["longitude"],
                message: "latitude and longitude must be provided together",
            });
        }
    });

export type ReportCreateBody = z.infer<typeof reportCreateBodySchema>;

export const followupBodySchema = z.object({
    message: z.string().trim().min(1).max(2000),
});

export type FollowupBody = z.infer<typeof followupBodySchema>;

export const adminStatusBodySchema = z.object({
    statusCode: z.enum(REPORT_STATUS_CODES),
    note: z.string().trim().max(1000).optional(),
});

export const adminRequestInfoBodySchema = z.object({
    message: z.string().trim().min(1).max(2000),
});

export const adminNoteBodySchema = z.object({
    adminNote: z.string().trim().max(2000).nullable(),
});

export const rewardPointsBodySchema = z.object({
    // Positive for a reward; negative is allowed for penalty/reversal reason codes.
    pointsDelta: z
        .number()
        .int()
        .gte(-1_000_000)
        .lte(1_000_000)
        .refine((value) => value !== 0, "pointsDelta must be non-zero"),
    reasonCode: z.enum(REPORT_REWARD_REASON_CODES),
    note: z.string().trim().max(1000).optional(),
});

export const reportPublicIdParamSchema = z.object({
    publicId: z.string().trim().uuid(),
});

/** Admin routes reference reports by their public_id (never the internal numeric id). */
export const adminReportIdParamSchema = z.object({
    id: z.string().trim().uuid(),
});

export const myReportsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminReportsQuerySchema = z.object({
    status: z.enum(REPORT_STATUS_CODES).optional(),
    type: z.enum(REPORT_TYPE_CODES).optional(),
    adminAreaId: z.coerce.number().int().positive().optional(),
    targetEntityType: z.enum(REPORT_TARGET_ENTITY_TYPES).optional(),
    // "true"/"false" query param → boolean (avoids z.coerce.boolean's "false" pitfall).
    anonymous: z
        .enum(["true", "false"])
        .optional()
        .transform((value) => (value === undefined ? undefined : value === "true")),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type AdminReportsQuery = z.infer<typeof adminReportsQuerySchema>;
