import { z } from "zod";

const booleanQueryValueSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();

        if (normalized === "true" || normalized === "1") {
            return true;
        }

        if (normalized === "false" || normalized === "0") {
            return false;
        }
    }

    return value;
}, z.boolean().optional());

const nullableBigintBodySchema = z.preprocess((value) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
        return BigInt(value);
    }

    return value;
}, z.bigint().nullable().optional());

const nullableTrimmedStringSchema = z.preprocess((value) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (typeof value === "string") {
        return value.trim();
    }

    return value;
}, z.string().min(1).nullable().optional());

const optionalNameSchema = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    return value;
}, z.string().optional());

const patchNameSchema = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "string") {
        return value.trim();
    }

    return value;
}, z.string().optional());

const nullableNumberBodySchema = z.preprocess((value) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    return value;
}, z.number().nullable().optional());

const bigintBodySchema = z.preprocess((value) => {
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
        return BigInt(value);
    }

    return value;
}, z.bigint());

export const placeIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export const placesQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    is_public: booleanQueryValueSchema,
    is_verified: booleanQueryValueSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

export const createPlaceBodySchema = z
    .object({
        myanmarName: optionalNameSchema,
        englishName: optionalNameSchema,
        primary_name: z.string().trim().min(1).optional(),
        display_name: z.string().trim().min(1).optional(),
        category_id: bigintBodySchema.optional(),
        categoryId: bigintBodySchema.optional(),
        admin_area_id: nullableBigintBodySchema,
        adminAreaId: nullableBigintBodySchema,
        plus_code: nullableTrimmedStringSchema,
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        importance_score: nullableNumberBodySchema,
        popularity_score: nullableNumberBodySchema,
        confidence_score: nullableNumberBodySchema,
        is_public: z.boolean().optional(),
        isPublic: z.boolean().optional(),
        is_verified: z.boolean().optional(),
        isVerified: z.boolean().optional(),
        source_type_id: nullableBigintBodySchema,
        publish_status_id: nullableBigintBodySchema,
    })
    .strict()
    .refine((value) => value.category_id !== undefined || value.categoryId !== undefined, {
        message: "Category is required",
        path: ["categoryId"],
    });

export const updatePlaceBodySchema = z
    .object({
        myanmarName: patchNameSchema,
        englishName: patchNameSchema,
        primary_name: z.string().trim().min(1).optional(),
        display_name: z.string().trim().min(1).optional(),
        category_id: nullableBigintBodySchema,
        categoryId: nullableBigintBodySchema,
        admin_area_id: nullableBigintBodySchema,
        adminAreaId: nullableBigintBodySchema,
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        plus_code: nullableTrimmedStringSchema,
        importance_score: nullableNumberBodySchema,
        popularity_score: nullableNumberBodySchema,
        confidence_score: nullableNumberBodySchema,
        is_public: z.boolean().optional(),
        isPublic: z.boolean().optional(),
        is_verified: z.boolean().optional(),
        isVerified: z.boolean().optional(),
        source_type_id: nullableBigintBodySchema,
        publish_status_id: nullableBigintBodySchema,
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "At least one editable field is required",
    });
