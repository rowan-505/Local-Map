import { z } from "zod";

import { coreReviewVerificationStatusQuerySchema } from "./core-review-verification-filter.js";

const optionalSearchSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }
    return value;
}, z.string().min(1).optional());

const optionalBooleanSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (v === "true" || v === "1") {
            return true;
        }
        if (v === "false" || v === "0") {
            return false;
        }
    }
    return undefined;
}, z.boolean().optional());

const optionalBigintIdSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    const raw = String(value).trim();
    if (!/^\d+$/.test(raw)) {
        return undefined;
    }
    return raw;
}, z.string().regex(/^\d+$/).optional());

export const coreReviewEntityParamSchema = z.object({
    entity: z.string().trim().min(1),
});

export const coreReviewEntityIdParamSchema = z.object({
    entity: z.string().trim().min(1),
    id: z.string().trim().min(1),
});

export const coreReviewListStatusSchema = z.enum(["active", "deleted", "all"]);

export const coreReviewListQuerySchema = z
    .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
        search: optionalSearchSchema,
        sortBy: z.string().trim().min(1).optional(),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        status: coreReviewListStatusSchema.optional(),
        verificationStatus: coreReviewVerificationStatusQuerySchema,
        verification_status: coreReviewVerificationStatusQuerySchema,
        /** @deprecated Legacy alias — mapped to verificationStatus when status is omitted */
        isVerified: optionalBooleanSchema,
        adminAreaId: optionalBigintIdSchema,
        categoryId: optionalBigintIdSchema,
        buildingTypeId: optionalBigintIdSchema,
        roadClassId: optionalBigintIdSchema,
        isPublic: optionalBooleanSchema,
        includeDeleted: optionalBooleanSchema,
        routeId: optionalBigintIdSchema,
        landuseClassId: optionalBigintIdSchema,
        detailLevel: z.enum(["zone", "parcel"]).optional(),
        cropCode: optionalSearchSchema,
        boundaryStatus: optionalSearchSchema,
        addressUsage: optionalSearchSchema,
        isOfficialBoundary: optionalBooleanSchema,
    })
    .transform((query) => {
        let verificationStatus = query.verificationStatus ?? query.verification_status;
        if (!verificationStatus && query.isVerified !== undefined) {
            verificationStatus = query.isVerified ? "verified" : "unverified";
        }
        const {
            verification_status: _verification_status,
            isVerified: _isVerified,
            ...rest
        } = query;
        return { ...rest, verificationStatus };
    });

export type CoreReviewListQueryParsed = z.infer<typeof coreReviewListQuerySchema>;
