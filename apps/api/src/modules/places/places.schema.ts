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

const optionalTrimmedNameSchema = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    return value;
}, z.string().min(1).optional());

const bigintBodySchema = z.preprocess((value) => {
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
        return BigInt(value.trim());
    }

    return value;
}, z.bigint());

const optionalBigintBodySchema = z.preprocess((value) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null || value === "") {
        return null;
    }

    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
        return BigInt(value.trim());
    }

    return value;
}, z.bigint().nullable().optional());

const optionalPlusCodeSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
    }

    return value;
}, z.string().nullable().optional());

const finiteLatSchema = z.number().finite().min(-90).max(90);

const finiteLngSchema = z.number().finite().min(-180).max(180);

const finiteScoreSchema = z.number().finite();

const patchTrimmedNameSchema = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "string") {
        return value.trim();
    }

    return value;
}, z.string().optional());

const placeWriteFieldsSchema = z
    .object({
        myanmarName: optionalTrimmedNameSchema,
        englishName: optionalTrimmedNameSchema,
        categoryId: bigintBodySchema,
        adminAreaId: optionalBigintBodySchema,
        lat: finiteLatSchema,
        lng: finiteLngSchema,
        plusCode: optionalPlusCodeSchema,
        importanceScore: finiteScoreSchema.optional(),
        popularityScore: finiteScoreSchema.optional(),
        confidenceScore: finiteScoreSchema.optional(),
        isPublic: z.boolean().optional(),
        isVerified: z.boolean().optional(),
        sourceTypeId: optionalBigintBodySchema,
        publishStatusId: optionalBigintBodySchema,
    })
    .strict();

export const createPlaceBodySchema = placeWriteFieldsSchema.refine(
    (body) => Boolean(body.myanmarName?.trim()) || Boolean(body.englishName?.trim()),
    {
        message: "myanmarName or englishName is required",
        path: ["myanmarName"],
    }
);

export const updatePlaceBodySchema = z
    .object({
        myanmarName: patchTrimmedNameSchema.optional(),
        englishName: patchTrimmedNameSchema.optional(),
        categoryId: bigintBodySchema.optional(),
        adminAreaId: optionalBigintBodySchema,
        lat: finiteLatSchema.optional(),
        lng: finiteLngSchema.optional(),
        plusCode: optionalPlusCodeSchema,
        importanceScore: finiteScoreSchema.optional(),
        popularityScore: finiteScoreSchema.optional(),
        confidenceScore: finiteScoreSchema.optional(),
        isPublic: z.boolean().optional(),
        isVerified: z.boolean().optional(),
        sourceTypeId: optionalBigintBodySchema,
        publishStatusId: optionalBigintBodySchema,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field is required",
        path: ["categoryId"],
    });

export const placeIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export const placesSortBySchema = z.enum(["name", "category", "admin_area", "created", "updated"]);
export const listSortOrderSchema = z.enum(["asc", "desc"]);

const optionalPlacesSearchQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    return value;
}, z.string().min(1).optional());

export const placesQuerySchema = z.object({
    q: optionalPlacesSearchQuerySchema,
    category: z.string().trim().min(1).optional(),
    is_public: booleanQueryValueSchema,
    is_verified: booleanQueryValueSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sortBy: placesSortBySchema.default("name"),
    sortOrder: listSortOrderSchema.default("asc"),
});
