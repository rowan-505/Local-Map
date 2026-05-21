import { z } from "zod";

export const streetsSortBySchema = z.enum(["name", "admin_area", "created", "updated", "updated_at"]);
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

const optionalBooleanQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return false;
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

    return Boolean(value);
}, z.boolean().default(false));

export const streetsQuerySchema = z.object({
    q: optionalStreetsSearchQuerySchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sortBy: streetsSortBySchema.default("updated_at"),
    sortOrder: listSortOrderSchema.default("desc"),
    /** When true, include soft-deleted rows (`deleted_at` set). */
    include_deleted: optionalBooleanQuerySchema,
});

export type StreetsListQuery = z.infer<typeof streetsQuerySchema>;

/** GET /streets/nearest-point — dashboard map snap helper (read-only, no routing). */
export const nearestStreetPointQuerySchema = z.object({
    lat: z.coerce.number().gte(-90).lte(90),
    lng: z.coerce.number().gte(-180).lte(180),
    radiusMeters: z.coerce.number().positive().max(500).default(50),
    /** Optional street to ignore (e.g. the feature being edited). */
    excludePublicId: z.string().uuid().optional(),
});

export type NearestStreetPointQuery = z.infer<typeof nearestStreetPointQuerySchema>;

export const streetIdParamsSchema = z.object({
    id: z.string().uuid(),
});

const streetIdentifySchema = z.union([
    /** `core.core_streets.public_id` */
    z.string().uuid(),
    /** `core.core_streets.id` — digits only (sent as JSON string or number). */
    z.string().regex(/^\d+$/, "Must be a UUID or numeric street id"),
    z.number().int().positive(),
]);

export type StreetIdentifierRef = { publicId: string } | { internalId: bigint };

function streetIdentifierToRef(rawId: string | number): StreetIdentifierRef {
    if (typeof rawId === "number") {
        return { internalId: BigInt(rawId) };
    }

    const trimmed = rawId.trim();
    return /^\d+$/.test(trimmed) ? { internalId: BigInt(trimmed) } : { publicId: trimmed };
}

export const splitStreetIdParamsSchema = z
    .object({
        id: streetIdentifySchema,
    })
    .transform((params) => ({
        id: streetIdentifierToRef(params.id),
    }));

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

const requiredBigintBodySchema = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return value;
    }

    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
        return BigInt(value);
    }

    return value;
}, z.bigint());

const optionalSurfaceSchema = z.preprocess((value) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (typeof value === "string") {
        const t = value.trim();
        return t === "" ? null : t;
    }

    return value;
}, z.string().nullable().optional());

const patchSurfaceSchema = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "string") {
        const t = value.trim();
        return t === "" ? null : t;
    }

    return value;
}, z.string().nullable().optional());

/** GeoJSON LineString only (dashboard / CRUD contract). */
export const lineStringGeometrySchema = z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
});

/** Resolved `streetId` / legacy `street_id` for exclude-only queries. */
export type ValidateStreetGeometryExcludeRef = StreetIdentifierRef;

export const validateStreetGeometryBodySchema = z
    .object({
        geometry: lineStringGeometrySchema,
        /** Street being edited: `public_id` (UUID) or internal `id` (digits). Excluded from topology comparisons. */
        streetId: streetIdentifySchema.optional(),
        toleranceMeters: z.coerce.number().positive().max(500).optional().default(10),
        /** @deprecated Prefer `streetId`; kept for older dashboard clients. */
        street_id: z.string().uuid().optional(),
    })
    .strict()
    .transform((body) => {
        const rawId = body.streetId ?? body.street_id;
        let excludeStreetRef: ValidateStreetGeometryExcludeRef | undefined;

        if (rawId === undefined) {
            excludeStreetRef = undefined;
        } else if (typeof rawId === "number") {
            excludeStreetRef = { internalId: BigInt(rawId) };
        } else {
            const trimmed = rawId.trim();
            excludeStreetRef = /^\d+$/.test(trimmed) ? { internalId: BigInt(trimmed) } : { publicId: trimmed };
        }

        return {
            geometry: body.geometry,
            toleranceMeters: body.toleranceMeters,
            excludeStreetRef,
        };
    });

/** Normalized validate-geometry payload (after Zod transform). */
export type ValidateStreetGeometryBody = z.infer<typeof validateStreetGeometryBodySchema>;

export const createStreetBodySchema = z
    .object({
        myanmarName: optionalNameSchema,
        englishName: optionalNameSchema,
        road_class_id: requiredBigintBodySchema,
        is_oneway: z.boolean().optional().default(false),
        surface: optionalSurfaceSchema,
        admin_area_id: nullableBigintBodySchema,
        adminAreaId: nullableBigintBodySchema,
        source_type_id: nullableBigintBodySchema,
        sourceTypeId: nullableBigintBodySchema,
        geometry: lineStringGeometrySchema,
        is_active: z.boolean().optional(),
        bridge: z.boolean().optional().default(false),
        tunnel: z.boolean().optional().default(false),
    })
    .strict()
    .refine(
        (body) =>
            Boolean((body.myanmarName ?? "").trim().length > 0) ||
            Boolean((body.englishName ?? "").trim().length > 0),
        {
            message: "myanmarName or englishName must be non-empty",
            path: ["myanmarName"],
        },
    );

export const updateStreetBodySchema = z
    .object({
        myanmarName: patchNameSchema,
        englishName: patchNameSchema,
        geometry: lineStringGeometrySchema.optional(),
        road_class_id: nullableBigintBodySchema,
        roadClassId: nullableBigintBodySchema,
        is_oneway: z.boolean().optional(),
        isOneway: z.boolean().optional(),
        surface: patchSurfaceSchema,
        admin_area_id: nullableBigintBodySchema,
        adminAreaId: nullableBigintBodySchema,
        edit_reason: z.string().max(500).optional(),
        bridge: z.boolean().optional(),
        tunnel: z.boolean().optional(),
    })
    .strict()
    .refine(
        (value) => {
            const { edit_reason: _editReason, ...rest } = value;
            return Object.keys(rest).length > 0;
        },
        {
            message: "At least one editable field is required",
        },
    );

export type CreateStreetBody = z.infer<typeof createStreetBodySchema>;
export type UpdateStreetBody = z.infer<typeof updateStreetBodySchema>;

const splitPointBodySchema = z
    .object({
        lat: z.coerce.number().gte(-90).lte(90),
        lng: z.coerce.number().gte(-180).lte(180),
    })
    .strict();

const legacySplitGeoJsonPointSchema = z
    .object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)]),
    })
    .strict();

/** POST /streets/:id/split — split an active LineString street into two successor streets. */
export const splitStreetBodySchema = z
    .object({
        point: splitPointBodySchema.optional(),
        editReason: z.string().max(500).optional(),
        /** @deprecated Prefer `point`. Kept for older dashboard clients. */
        split_point: legacySplitGeoJsonPointSchema.optional(),
        /** @deprecated Prefer `editReason`. */
        edit_reason: z.string().max(500).optional(),
    })
    .strict()
    .superRefine((body, ctx) => {
        if (!body.point && !body.split_point) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["point"],
                message: "point is required",
            });
        }
    })
    .transform((body) => {
        const point =
            body.point ??
            (body.split_point
                ? {
                      lng: body.split_point.coordinates[0],
                      lat: body.split_point.coordinates[1],
                  }
                : undefined);

        if (!point) {
            throw new Error("point is required");
        }

        return {
            point,
            editReason: body.editReason ?? body.edit_reason,
        };
    });

export type SplitStreetBody = z.infer<typeof splitStreetBodySchema>;

export const deleteStreetBodySchema = z
    .object({
        edit_reason: z.string().max(500).optional(),
    })
    .strict();
