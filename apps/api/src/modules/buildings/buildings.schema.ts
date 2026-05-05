import { z } from "zod";

const coord2Schema = z.tuple([z.number().finite(), z.number().finite()]);

const polygonGeometrySchema = z
    .object({
        type: z.literal("Polygon"),
        coordinates: z.array(z.array(coord2Schema)).min(1),
    })
    .strict();

const multiPolygonGeometrySchema = z
    .object({
        type: z.literal("MultiPolygon"),
        coordinates: z.array(z.array(z.array(coord2Schema))).min(1),
    })
    .strict();

export const buildingGeometrySchema = z.discriminatedUnion("type", [
    polygonGeometrySchema,
    multiPolygonGeometrySchema,
]);

const optionalTrimmedStringSchema = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    return value;
}, z.string().min(1).optional());

const optionalNameSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
    }

    return value;
}, z.string().nullable().optional());

const finiteConfidenceSchema = z.number().finite().optional();

const optionalLevelsPatchSchema = z
    .union([
        z.number().int().min(0),
        z.literal(null),
    ])
    .optional();

const optionalHeightPatchSchema = z
    .union([
        z.number().finite().min(0),
        z.literal(null),
    ])
    .optional();

const optionalLevelsCreateSchema = z.number().int().min(0).optional();

const optionalHeightCreateSchema = z.number().finite().min(0).optional();

export const createBuildingBodySchema = z
    .object({
        geometry: buildingGeometrySchema,
        name: optionalNameSchema,
        building_type: optionalTrimmedStringSchema,
        levels: optionalLevelsCreateSchema,
        height_m: optionalHeightCreateSchema,
        confidence_score: finiteConfidenceSchema,
        is_verified: z.boolean().optional(),
    })
    .strict();

export const updateBuildingBodySchema = z
    .object({
        geometry: buildingGeometrySchema.optional(),
        name: optionalNameSchema,
        building_type: optionalTrimmedStringSchema,
        levels: optionalLevelsPatchSchema,
        height_m: optionalHeightPatchSchema,
        confidence_score: finiteConfidenceSchema,
        is_verified: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field is required",
        path: ["geometry"],
    });

export const buildingIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export const buildingsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    q: z.string().trim().min(1).optional(),
});

export type BuildingValidationIssue = {
    path: string;
    message: string;
};
