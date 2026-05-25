import { z } from "zod";

import { CORE_VERIFICATION_STATUSES } from "./core-verification.config.js";

export const coreVerificationFamilyParamSchema = z.object({
    family: z.string().min(1),
});

export const coreVerificationEntityIdParamSchema = z.object({
    family: z.string().min(1),
    id: z.string().min(1),
});

export const coreVerificationListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
    q: z.string().trim().optional(),
    is_verified: z
        .enum(["true", "false"])
        .optional()
        .transform((value) => (value == null ? undefined : value === "true")),
    verification_status: z.enum(CORE_VERIFICATION_STATUSES).optional(),
    review_batch_id: z.string().trim().optional(),
    publish_batch_id: z.string().trim().optional(),
    source_snapshot_version: z.string().trim().optional(),
    admin_area_id: z.coerce.bigint().optional(),
    created_from: z.string().datetime().optional(),
    created_to: z.string().datetime().optional(),
    updated_from: z.string().datetime().optional(),
    updated_to: z.string().datetime().optional(),
});

export const coreVerificationStatusPatchSchema = z.object({
    verification_status: z.enum(CORE_VERIFICATION_STATUSES),
    verification_note: z.string().trim().optional(),
    deactivate: z.boolean().optional(),
    deactivate_confirmation: z.literal("DEACTIVATE").optional(),
});

export const coreVerificationEditPatchSchema = z.object({
    changes: z.record(z.string(), z.unknown()),
});

export type CoreVerificationListQuery = z.infer<typeof coreVerificationListQuerySchema>;
export type CoreVerificationStatusPatch = z.infer<typeof coreVerificationStatusPatchSchema>;
export type CoreVerificationEditPatch = z.infer<typeof coreVerificationEditPatchSchema>;
