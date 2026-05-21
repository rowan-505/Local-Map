import { z } from "zod";

import {
    buildingGeometrySchema,
} from "../buildings/buildings.schema.js";
import {
    lineStringGeometrySchema,
} from "../../lib/geo/core-geometry.schema.js";
import {
    lineStringOrMultiLineStringSchema,
    optionalEntranceFieldSchema,
    pointFieldSchema,
    polygonOrMultiPolygonSchema,
} from "../../lib/geo/core-geometry.schema.js";
import type { CoreReviewEntitySlug } from "./core-review.types.js";

export const EDIT_CORE_REVIEW_ROLES = new Set(["admin", "editor"]);

const optionalTrimmedString = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "string") {
        const t = value.trim();
        return t === "" ? undefined : t;
    }
    return value;
}, z.string().optional());

const nullableTrimmedString = z.preprocess((value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value === "string") {
        const t = value.trim();
        return t === "" ? null : t;
    }
    return value;
}, z.string().nullable().optional());

const optionalBigintId = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "bigint") return value;
    const raw = String(value).trim();
    if (!/^\d+$/.test(raw)) return value;
    return BigInt(raw);
}, z.bigint().optional());

const nullableBigintId = z.preprocess((value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value === "bigint") return value;
    const raw = String(value).trim();
    if (!/^\d+$/.test(raw)) return value;
    return BigInt(raw);
}, z.bigint().nullable().optional());

const requiredBigintId = z.preprocess((value) => {
    if (typeof value === "bigint") return value;
    const raw = String(value ?? "").trim();
    return BigInt(raw);
}, z.bigint());

function aliasField<T extends z.ZodType>(camel: string, snake: string, schema: T) {
    return z.union([
        z.object({ [camel]: schema }),
        z.object({ [snake]: schema }),
    ]).transform((v) => (camel in v ? v[camel as keyof typeof v] : v[snake as keyof typeof v]));
}

const optionalBoolean = z.boolean().optional();
const optionalNumber = z.number().finite().optional();
const optionalInt = z.number().int().optional();

const geometryAlias = z.union([
    z.object({ geometry: z.unknown() }),
    z.object({ geom: z.unknown() }),
]).transform((v) => ("geometry" in v ? v.geometry : v.geom));

// ── Buildings ───────────────────────────────────────────────────────────────

export const coreReviewCreateBuildingSchema = z.object({
    geometry: buildingGeometrySchema,
    name: nullableTrimmedString,
    nameMm: nullableTrimmedString,
    name_mm: nullableTrimmedString,
    nameEn: nullableTrimmedString,
    name_en: nullableTrimmedString,
    buildingTypeId: optionalBigintId,
    building_type_id: optionalBigintId,
    adminAreaId: nullableBigintId,
    admin_area_id: nullableBigintId,
    levels: optionalInt,
    heightM: optionalNumber,
    height_m: optionalNumber,
    confidenceScore: optionalNumber,
    confidence_score: optionalNumber,
    isVerified: optionalBoolean,
    is_verified: optionalBoolean,
});

export const coreReviewPatchBuildingSchema = coreReviewCreateBuildingSchema
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

// ── Places ──────────────────────────────────────────────────────────────────

export const coreReviewCreatePlaceSchema = z
    .object({
        myanmarName: optionalTrimmedString,
        englishName: optionalTrimmedString,
        categoryId: requiredBigintId,
        adminAreaId: nullableBigintId,
        admin_area_id: nullableBigintId,
        lat: z.number().finite().gte(-90).lte(90).optional(),
        lng: z.number().finite().gte(-180).lte(180).optional(),
        geometry: pointFieldSchema().optional(),
        pointGeom: pointFieldSchema().optional(),
        point_geom: pointFieldSchema().optional(),
        plusCode: nullableTrimmedString,
        plus_code: nullableTrimmedString,
        importanceScore: optionalNumber,
        importance_score: optionalNumber,
        popularityScore: optionalNumber,
        popularity_score: optionalNumber,
        confidenceScore: optionalNumber,
        confidence_score: optionalNumber,
        isPublic: optionalBoolean,
        is_public: optionalBoolean,
        isVerified: optionalBoolean,
        is_verified: optionalBoolean,
        sourceTypeId: nullableBigintId,
        source_type_id: nullableBigintId,
        publishStatusId: nullableBigintId,
        publish_status_id: nullableBigintId,
    })
    .refine(
        (v) => Boolean(v.myanmarName?.trim()) || Boolean(v.englishName?.trim()),
        { message: "myanmarName or englishName is required", path: ["myanmarName"] },
    );

export const coreReviewPatchPlaceSchema = z
    .object({
        myanmarName: optionalTrimmedString,
        englishName: optionalTrimmedString,
        categoryId: optionalBigintId,
        adminAreaId: nullableBigintId,
        admin_area_id: nullableBigintId,
        lat: z.number().finite().gte(-90).lte(90).optional(),
        lng: z.number().finite().gte(-180).lte(180).optional(),
        geometry: pointFieldSchema().optional(),
        pointGeom: pointFieldSchema().optional(),
        point_geom: pointFieldSchema().optional(),
        plusCode: nullableTrimmedString,
        plus_code: nullableTrimmedString,
        importanceScore: optionalNumber,
        importance_score: optionalNumber,
        popularityScore: optionalNumber,
        popularity_score: optionalNumber,
        confidenceScore: optionalNumber,
        confidence_score: optionalNumber,
        isPublic: optionalBoolean,
        is_public: optionalBoolean,
        isVerified: optionalBoolean,
        is_verified: optionalBoolean,
        sourceTypeId: nullableBigintId,
        source_type_id: nullableBigintId,
        publishStatusId: nullableBigintId,
        publish_status_id: nullableBigintId,
    })
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

// ── Streets ─────────────────────────────────────────────────────────────────

export const coreReviewCreateStreetSchema = z
    .object({
        geometry: lineStringGeometrySchema,
        myanmarName: optionalTrimmedString,
        englishName: optionalTrimmedString,
        roadClassId: requiredBigintId,
        road_class_id: requiredBigintId,
        adminAreaId: nullableBigintId,
        admin_area_id: nullableBigintId,
        isOneway: optionalBoolean,
        is_oneway: optionalBoolean,
        surface: nullableTrimmedString,
        bridge: optionalBoolean,
        tunnel: optionalBoolean,
    })
    .refine(
        (v) => Boolean(v.myanmarName?.trim()) || Boolean(v.englishName?.trim()),
        { message: "myanmarName or englishName is required", path: ["myanmarName"] },
    );

export const coreReviewPatchStreetSchema = z
    .object({
        geometry: lineStringGeometrySchema.optional(),
        myanmarName: optionalTrimmedString,
        englishName: optionalTrimmedString,
        roadClassId: nullableBigintId,
        road_class_id: nullableBigintId,
        adminAreaId: nullableBigintId,
        admin_area_id: nullableBigintId,
        isOneway: optionalBoolean,
        is_oneway: optionalBoolean,
        surface: nullableTrimmedString,
        bridge: optionalBoolean,
        tunnel: optionalBoolean,
        editReason: optionalTrimmedString,
        edit_reason: optionalTrimmedString,
    })
    .refine(
        (v) => {
            const keys = Object.keys(v).filter((k) => k !== "editReason" && k !== "edit_reason");
            return keys.length > 0;
        },
        { message: "At least one field is required" },
    );

// ── Bus stops ───────────────────────────────────────────────────────────────

const busStopFields = {
    name: nullableTrimmedString,
    nameLocal: nullableTrimmedString,
    name_local: nullableTrimmedString,
    stopCode: nullableTrimmedString,
    stop_code: nullableTrimmedString,
    adminAreaId: nullableBigintId,
    admin_area_id: nullableBigintId,
    sourceTypeId: nullableBigintId,
    source_type_id: nullableBigintId,
    isActive: optionalBoolean,
    is_active: optionalBoolean,
    isVerified: optionalBoolean,
    is_verified: optionalBoolean,
    geometry: pointFieldSchema(),
    geom: pointFieldSchema(),
};

export const coreReviewCreateBusStopSchema = z.object(busStopFields);
export const coreReviewPatchBusStopSchema = z
    .object({ ...busStopFields, geometry: pointFieldSchema().optional(), geom: pointFieldSchema().optional() })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

// ── Bus routes ──────────────────────────────────────────────────────────────

const busRouteFields = {
    routeCode: nullableTrimmedString,
    route_code: nullableTrimmedString,
    publicName: nullableTrimmedString,
    public_name: nullableTrimmedString,
    operatorName: nullableTrimmedString,
    operator_name: nullableTrimmedString,
    routeType: nullableTrimmedString,
    route_type: nullableTrimmedString,
    directionality: nullableTrimmedString,
    sourceTypeId: nullableBigintId,
    source_type_id: nullableBigintId,
    isActive: optionalBoolean,
    is_active: optionalBoolean,
    isVerified: optionalBoolean,
    is_verified: optionalBoolean,
};

export const coreReviewCreateBusRouteSchema = z.object(busRouteFields);
export const coreReviewPatchBusRouteSchema = z
    .object(busRouteFields)
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

// ── Bus route variants ──────────────────────────────────────────────────────

const variantFields = {
    routeId: requiredBigintId,
    route_id: requiredBigintId,
    variantCode: nullableTrimmedString,
    variant_code: nullableTrimmedString,
    directionName: nullableTrimmedString,
    direction_name: nullableTrimmedString,
    originName: nullableTrimmedString,
    origin_name: nullableTrimmedString,
    destinationName: nullableTrimmedString,
    destination_name: nullableTrimmedString,
    distanceM: optionalNumber,
    distance_m: optionalNumber,
    isActive: optionalBoolean,
    is_active: optionalBoolean,
    isVerified: optionalBoolean,
    is_verified: optionalBoolean,
    geometry: lineStringGeometrySchema,
    geom: lineStringGeometrySchema,
};

export const coreReviewCreateBusRouteVariantSchema = z.object(variantFields);
export const coreReviewPatchBusRouteVariantSchema = z
    .object({
        ...variantFields,
        routeId: optionalBigintId,
        route_id: optionalBigintId,
        geometry: lineStringGeometrySchema.optional(),
        geom: lineStringGeometrySchema.optional(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

// ── Map features (landuse / water) ──────────────────────────────────────────

const mapFeatureFields = {
    name: nullableTrimmedString,
    classCode: nullableTrimmedString,
    class_code: nullableTrimmedString,
    isActive: optionalBoolean,
    is_active: optionalBoolean,
    isVerified: optionalBoolean,
    is_verified: optionalBoolean,
};

export const coreReviewCreateLanduseSchema = z.object({
    ...mapFeatureFields,
    geometry: polygonOrMultiPolygonSchema,
    geom: polygonOrMultiPolygonSchema,
});

export const coreReviewPatchLanduseSchema = z
    .object({
        ...mapFeatureFields,
        geometry: polygonOrMultiPolygonSchema.optional(),
        geom: polygonOrMultiPolygonSchema.optional(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

export const coreReviewCreateWaterLineSchema = z.object({
    ...mapFeatureFields,
    geometry: lineStringOrMultiLineStringSchema,
    geom: lineStringOrMultiLineStringSchema,
});

export const coreReviewPatchWaterLineSchema = z
    .object({
        ...mapFeatureFields,
        geometry: lineStringOrMultiLineStringSchema.optional(),
        geom: lineStringOrMultiLineStringSchema.optional(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

export const coreReviewCreateWaterPolygonSchema = coreReviewCreateLanduseSchema;
export const coreReviewPatchWaterPolygonSchema = coreReviewPatchLanduseSchema;

// ── Addresses ───────────────────────────────────────────────────────────────

export const coreReviewCreateAddressSchema = z.object({
    fullAddress: nullableTrimmedString,
    full_address: nullableTrimmedString,
    houseNumber: nullableTrimmedString,
    house_number: nullableTrimmedString,
    unitNumber: nullableTrimmedString,
    unit_number: nullableTrimmedString,
    postalCode: nullableTrimmedString,
    postal_code: nullableTrimmedString,
    streetId: nullableTrimmedString,
    street_id: nullableTrimmedString,
    adminAreaId: nullableBigintId,
    admin_area_id: nullableBigintId,
    sourceTypeId: nullableBigintId,
    source_type_id: nullableBigintId,
    isPublic: optionalBoolean,
    is_public: optionalBoolean,
    isVerified: optionalBoolean,
    is_verified: optionalBoolean,
    pointGeom: pointFieldSchema(),
    point_geom: pointFieldSchema(),
    geometry: pointFieldSchema(),
    entranceGeom: optionalEntranceFieldSchema(),
    entrance_geom: optionalEntranceFieldSchema(),
});

export const coreReviewPatchAddressSchema = z
    .object({
        fullAddress: nullableTrimmedString,
        full_address: nullableTrimmedString,
        houseNumber: nullableTrimmedString,
        house_number: nullableTrimmedString,
        unitNumber: nullableTrimmedString,
        unit_number: nullableTrimmedString,
        postalCode: nullableTrimmedString,
        postal_code: nullableTrimmedString,
        streetId: nullableTrimmedString,
        street_id: nullableTrimmedString,
        adminAreaId: nullableBigintId,
        admin_area_id: nullableBigintId,
        sourceTypeId: nullableBigintId,
        source_type_id: nullableBigintId,
        isPublic: optionalBoolean,
        is_public: optionalBoolean,
        isVerified: optionalBoolean,
        is_verified: optionalBoolean,
        pointGeom: pointFieldSchema().optional(),
        point_geom: pointFieldSchema().optional(),
        geometry: pointFieldSchema().optional(),
        entranceGeom: optionalEntranceFieldSchema(),
        entrance_geom: optionalEntranceFieldSchema(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

// ── Admin areas ─────────────────────────────────────────────────────────────

export const coreReviewCreateAdminAreaSchema = z.object({
    canonicalName: optionalTrimmedString,
    canonical_name: optionalTrimmedString,
    slug: nullableTrimmedString,
    parentId: nullableBigintId,
    parent_id: nullableBigintId,
    adminLevelId: requiredBigintId,
    admin_level_id: requiredBigintId,
    sourceTypeId: nullableBigintId,
    source_type_id: nullableBigintId,
    isActive: optionalBoolean,
    is_active: optionalBoolean,
    isVerified: optionalBoolean,
    is_verified: optionalBoolean,
    geometry: polygonOrMultiPolygonSchema,
    geom: polygonOrMultiPolygonSchema,
});

export const coreReviewPatchAdminAreaSchema = z
    .object({
        canonicalName: optionalTrimmedString,
        canonical_name: optionalTrimmedString,
        slug: nullableTrimmedString,
        parentId: nullableBigintId,
        parent_id: nullableBigintId,
        adminLevelId: optionalBigintId,
        admin_level_id: optionalBigintId,
        sourceTypeId: nullableBigintId,
        source_type_id: nullableBigintId,
        isActive: optionalBoolean,
        is_active: optionalBoolean,
        isVerified: optionalBoolean,
        is_verified: optionalBoolean,
        geometry: polygonOrMultiPolygonSchema.optional(),
        geom: polygonOrMultiPolygonSchema.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

const CREATE_SCHEMAS: Record<CoreReviewEntitySlug, z.ZodType> = {
    buildings: coreReviewCreateBuildingSchema,
    places: coreReviewCreatePlaceSchema,
    streets: coreReviewCreateStreetSchema,
    "bus-stops": coreReviewCreateBusStopSchema,
    "bus-routes": coreReviewCreateBusRouteSchema,
    "bus-route-variants": coreReviewCreateBusRouteVariantSchema,
    landuse: coreReviewCreateLanduseSchema,
    "water-lines": coreReviewCreateWaterLineSchema,
    "water-polygons": coreReviewCreateWaterPolygonSchema,
    addresses: coreReviewCreateAddressSchema,
    "admin-areas": coreReviewCreateAdminAreaSchema,
};

const PATCH_SCHEMAS: Record<CoreReviewEntitySlug, z.ZodType> = {
    buildings: coreReviewPatchBuildingSchema,
    places: coreReviewPatchPlaceSchema,
    streets: coreReviewPatchStreetSchema,
    "bus-stops": coreReviewPatchBusStopSchema,
    "bus-routes": coreReviewPatchBusRouteSchema,
    "bus-route-variants": coreReviewPatchBusRouteVariantSchema,
    landuse: coreReviewPatchLanduseSchema,
    "water-lines": coreReviewPatchWaterLineSchema,
    "water-polygons": coreReviewPatchWaterPolygonSchema,
    addresses: coreReviewPatchAddressSchema,
    "admin-areas": coreReviewPatchAdminAreaSchema,
};

export function getCoreReviewCreateSchema(slug: CoreReviewEntitySlug): z.ZodType {
    return CREATE_SCHEMAS[slug];
}

export function getCoreReviewPatchSchema(slug: CoreReviewEntitySlug): z.ZodType {
    return PATCH_SCHEMAS[slug];
}

/** Strip server-controlled fields from write bodies. */
export function sanitizeCoreReviewWriteBody(body: unknown): unknown {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }
    const blocked = new Set([
        "id",
        "publicId",
        "public_id",
        "createdAt",
        "created_at",
        "updatedAt",
        "updated_at",
        "deletedAt",
        "deleted_at",
        "centroid",
        "areaM2",
        "area_m2",
        "normalizedData",
        "normalized_data",
        "sourceRefs",
        "source_refs",
        "sourceStagingId",
        "source_staging_id",
    ]);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (!blocked.has(key)) {
            out[key] = value;
        }
    }
    return out;
}

/** Pick first defined value from camel/snake aliases. */
export function pickAlias<T>(body: Record<string, unknown>, camel: string, snake: string): T | undefined {
    if (body[camel] !== undefined) return body[camel] as T;
    if (body[snake] !== undefined) return body[snake] as T;
    return undefined;
}

/** Normalize dashboard geometry field aliases before Zod parse. */
export function normalizeGeometryAliases(body: unknown): unknown {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }
    const out = { ...(body as Record<string, unknown>) };
    if (out.geom !== undefined && out.geometry === undefined) {
        out.geometry = out.geom;
    }
    if (out.point_geom !== undefined && out.pointGeom === undefined && out.geometry === undefined) {
        out.pointGeom = out.point_geom;
    }
    if (out.entrance_geom !== undefined && out.entranceGeom === undefined) {
        out.entranceGeom = out.entrance_geom;
    }
    return out;
}

export function pickGeometry(body: Record<string, unknown>): unknown {
    return pickAlias(body, "geometry", "geom") ?? body.pointGeom ?? body.point_geom;
}
