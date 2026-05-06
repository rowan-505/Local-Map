import { z } from "zod";

export const streetsSortBySchema = z.enum(["name", "admin_area", "created", "updated"]);
export const listSortOrderSchema = z.enum(["asc", "desc"]);

const optionalStreetsSearchQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    return value;
}, z.string().min(1).optional());

export const streetsQuerySchema = z.object({
    q: optionalStreetsSearchQuerySchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    sortBy: streetsSortBySchema.default("name"),
    sortOrder: listSortOrderSchema.default("asc"),
});

export type StreetsListQuery = z.infer<typeof streetsQuerySchema>;

export const streetIdParamsSchema = z.object({
    id: z.string().uuid(),
});

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

const lineStringGeometrySchema = z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
});

const multiLineStringGeometrySchema = z.object({
    type: z.literal("MultiLineString"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)).min(1),
});

export const createStreetBodySchema = z
    .object({
        myanmarName: optionalNameSchema,
        englishName: optionalNameSchema,
        canonical_name: z.string().trim().min(1).optional(),
        admin_area_id: nullableBigintBodySchema,
        adminAreaId: nullableBigintBodySchema,
        source_type_id: nullableBigintBodySchema,
        sourceTypeId: nullableBigintBodySchema,
        geometry: z.union([lineStringGeometrySchema, multiLineStringGeometrySchema]),
        is_active: z.boolean().optional(),
    })
    .strict();

export const updateStreetBodySchema = z
    .object({
        myanmarName: patchNameSchema,
        englishName: patchNameSchema,
        canonical_name: z.string().trim().min(1).optional(),
        admin_area_id: nullableBigintBodySchema,
        adminAreaId: nullableBigintBodySchema,
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "At least one editable field is required",
    });
