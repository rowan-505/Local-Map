import { z } from "zod";

import { coreReviewVerificationStatusWriteSchema } from "../core-review/core-review-verification-write.js";

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

const optionalBuildingTypeIdSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value === "bigint") {
        return value;
    }

    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return BigInt(value);
    }

    if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        return BigInt(value);
    }

    return undefined;
}, z.bigint().optional());

/** PATCH: allow explicit null to clear the taxonomy FK. */
const optionalBuildingTypeIdPatchSchema = z.preprocess((value) => {
    if (value === null) {
        return null;
    }

    if (value === undefined || value === "") {
        return undefined;
    }

    if (typeof value === "bigint") {
        return value;
    }

    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return BigInt(value);
    }

    if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        return BigInt(value);
    }

    return undefined;
}, z.union([z.bigint(), z.null()]).optional());

/** PATCH: explicit null clears admin_area_id. */
const optionalAdminAreaIdPatchSchema = z.preprocess((value) => {
    if (value === null) {
        return null;
    }

    if (value === undefined || value === "") {
        return undefined;
    }

    if (typeof value === "bigint") {
        return value;
    }

    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return BigInt(value);
    }

    if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        return BigInt(value);
    }

    return undefined;
}, z.union([z.bigint(), z.null()]).optional());

const optionalAdminAreaIdCreateSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value === "bigint") {
        return value;
    }

    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return BigInt(value);
    }

    if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        return BigInt(value);
    }

    return undefined;
}, z.bigint().optional());

export const createBuildingBodySchema = z
    .object({
        geometry: buildingGeometrySchema,
        /**
         * Deprecated write field. Not stored on core_buildings.name.
         * Prefer name_mm / name_en (synced to core_building_names).
         */
        name: optionalNameSchema,
        name_mm: optionalNameSchema,
        name_en: optionalNameSchema,
        building_type: optionalTrimmedStringSchema,
        building_type_id: optionalBuildingTypeIdSchema,
        admin_area_id: optionalAdminAreaIdCreateSchema,
        levels: optionalLevelsCreateSchema,
        height_m: optionalHeightCreateSchema,
        confidence_score: finiteConfidenceSchema,
        verification_status: coreReviewVerificationStatusWriteSchema,
    })
    .strict();

export const updateBuildingBodySchema = z
    .object({
        geometry: buildingGeometrySchema.optional(),
        name: optionalNameSchema,
        name_mm: optionalNameSchema,
        name_en: optionalNameSchema,
        building_type: optionalTrimmedStringSchema,
        building_type_id: optionalBuildingTypeIdPatchSchema,
        admin_area_id: optionalAdminAreaIdPatchSchema,
        explicitClearAdminArea: z.boolean().optional(),
        explicit_clear_admin_area: z.boolean().optional(),
        levels: optionalLevelsPatchSchema,
        height_m: optionalHeightPatchSchema,
        confidence_score: finiteConfidenceSchema,
        verification_status: coreReviewVerificationStatusWriteSchema,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field is required",
        path: ["geometry"],
    });

export const buildingIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export const buildingsSortBySchema = z.enum(["name", "building_type", "admin_area", "created", "updated", "updated_at"]);

const listSortOrderSchema = z.enum(["asc", "desc"]);

const optionalBuildingSearchQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    return value;
}, z.string().min(1).optional());

export const buildingsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    q: optionalBuildingSearchQuerySchema,
    sortBy: buildingsSortBySchema.default("updated_at"),
    sortOrder: listSortOrderSchema.default("desc"),
});

export type BuildingsListQuery = z.infer<typeof buildingsQuerySchema>;

export type BuildingValidationIssue = {
    path: string;
    message: string;
};

/** Canonical building name row from core.core_building_names. */
export const buildingNameEntrySchema = z
    .object({
        id: z.number().int().optional(),
        name: z.string().min(1),
        languageCode: z.enum(["my", "en", "und"]),
        scriptCode: z.string().nullable().optional(),
        nameType: z.enum(["official", "alternate", "short", "local", "old", "imported"]),
        isPrimary: z.boolean(),
        searchWeight: z.number().int(),
    })
    .strict();

export type BuildingNameEntry = z.infer<typeof buildingNameEntrySchema>;

/**
 * Response name contract:
 * - `names` = canonical rows from core_building_names
 * - `name_mm` / `name_en` = derived primary labels (dashboard compat)
 * - `name` = derived display name (priority coalesce)
 */
export const buildingNamesResponseFieldsSchema = z.object({
    names: z.array(buildingNameEntrySchema).default([]),
    name_mm: z.string().nullable(),
    name_en: z.string().nullable(),
    fallback_name: z.string().nullable(),
    /** Derived display name from names priority / name_mm → name_en → fallback. */
    name: z.string().nullable(),
});
