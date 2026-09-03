import { z } from "zod";

import { REPORT_TYPE_CODES } from "../reports/reports.schema.js";

export const FIELD_REPORT_TARGET_TYPES = ["stop", "route", "variant", "path"] as const;
export const FIELD_VARIANT_CODES = ["D0", "D1"] as const;

/** Fastify abuse limit for POST /field/reports. Not the public 3/5/15 daily caps. */
export const FIELD_REPORT_CREATE_RATE_LIMIT = {
    max: 60,
    timeWindow: "1 minute",
} as const;

const MAX_CANONICAL_SNAPSHOT_BYTES = 8_192;

export const fieldReportLocationSchema = z.object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    accuracyM: z.number().gte(0).lte(50_000).nullable().optional(),
});

export const fieldReportTargetSchema = z.object({
    entityType: z.enum(FIELD_REPORT_TARGET_TYPES),
    publicId: z.string().uuid().optional(),
});

export const fieldReportContextSchema = z
    .object({
        snapshotRevision: z.string().trim().min(1).max(80),
        routePublicId: z.string().uuid().optional(),
        variantPublicId: z.string().uuid().optional(),
        variantCode: z.enum(FIELD_VARIANT_CODES),
        stopPublicId: z.string().uuid().optional(),
        stopSequence: z.number().int().positive().max(10_000).optional(),
        canonicalSnapshot: z.unknown().optional(),
    })
    .superRefine((value, ctx) => {
        if (value.canonicalSnapshot === undefined) {
            return;
        }
        let encoded: string;
        try {
            encoded = JSON.stringify(value.canonicalSnapshot);
        } catch {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["canonicalSnapshot"],
                message: "canonicalSnapshot must be JSON-serializable",
            });
            return;
        }
        if (encoded.length > MAX_CANONICAL_SNAPSHOT_BYTES) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["canonicalSnapshot"],
                message: "canonicalSnapshot is too large",
            });
        }
        if (value.canonicalSnapshot === null || typeof value.canonicalSnapshot !== "object") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["canonicalSnapshot"],
                message: "canonicalSnapshot must be an object",
            });
        }
    });

export const fieldReportCreateBodySchema = z
    .object({
        clientPublicId: z.string().uuid(),
        reportTypeCode: z.enum(REPORT_TYPE_CODES),
        observedAt: z.coerce.date(),
        location: fieldReportLocationSchema,
        target: fieldReportTargetSchema,
        context: fieldReportContextSchema,
        description: z.string().trim().max(4000).optional(),
        note: z.string().trim().max(4000).optional(),
    })
    .superRefine((value, ctx) => {
        assertObservedAt(value.observedAt, ctx);
        assertTargetContext(value.target, value.context, ctx);
    });

export const fieldReportPatchBodySchema = z
    .object({
        observedAt: z.coerce.date().optional(),
        location: fieldReportLocationSchema.optional(),
        reportTypeCode: z.enum(REPORT_TYPE_CODES).optional(),
        target: fieldReportTargetSchema.optional(),
        context: fieldReportContextSchema.optional(),
        description: z.string().trim().max(4000).optional(),
        note: z.string().trim().max(4000).optional(),
    })
    .superRefine((value, ctx) => {
        if (
            value.observedAt === undefined &&
            value.location === undefined &&
            value.reportTypeCode === undefined &&
            value.target === undefined &&
            value.context === undefined &&
            value.description === undefined &&
            value.note === undefined
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "At least one field is required",
            });
        }
        if (value.observedAt) {
            assertObservedAt(value.observedAt, ctx);
        }
        if (value.target && value.context) {
            assertTargetContext(value.target, value.context, ctx);
        }
    });

export const fieldReportFollowupBodySchema = z.object({
    message: z.string().trim().min(1).max(2000),
});

export const fieldReportPublicIdParamSchema = z.object({
    publicId: z.string().uuid(),
});

export type FieldReportCreateBody = z.infer<typeof fieldReportCreateBodySchema>;
export type FieldReportPatchBody = z.infer<typeof fieldReportPatchBodySchema>;

function assertObservedAt(observedAt: Date, ctx: z.RefinementCtx): void {
    if (Number.isNaN(observedAt.getTime())) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["observedAt"],
            message: "observedAt must be a valid timestamp",
        });
        return;
    }
    const now = Date.now();
    if (observedAt.getTime() > now + 10 * 60 * 1000) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["observedAt"],
            message: "observedAt cannot be in the future",
        });
    }
    if (observedAt.getTime() < now - 366 * 24 * 60 * 60 * 1000) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["observedAt"],
            message: "observedAt is too old",
        });
    }
}

function assertTargetContext(
    target: z.infer<typeof fieldReportTargetSchema>,
    context: z.infer<typeof fieldReportContextSchema>,
    ctx: z.RefinementCtx
): void {
    if (target.entityType === "path") {
        if (!context.variantPublicId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["context", "variantPublicId"],
                message: "variantPublicId is required for path issues",
            });
        }
        return;
    }
    if (!target.publicId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["target", "publicId"],
            message: "target.publicId is required for this entity type",
        });
        return;
    }
    if (target.entityType === "stop") {
        if (context.stopPublicId && context.stopPublicId !== target.publicId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["context", "stopPublicId"],
                message: "stopPublicId must match target.publicId",
            });
        }
    }
    if (target.entityType === "route") {
        if (context.routePublicId && context.routePublicId !== target.publicId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["context", "routePublicId"],
                message: "routePublicId must match target.publicId",
            });
        }
    }
    if (target.entityType === "variant") {
        if (context.variantPublicId && context.variantPublicId !== target.publicId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["context", "variantPublicId"],
                message: "variantPublicId must match target.publicId",
            });
        }
    }
}

export function fieldReportDescription(body: { description?: string; note?: string }): string {
    return (body.description ?? body.note ?? "").trim();
}
