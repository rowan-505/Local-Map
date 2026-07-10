import { z } from "zod";

import { validateCanonicalTime } from "./transport-timetable.js";

/**
 * Local pagination/list conventions for the transport dashboard module.
 * No shared API-wide pagination helper exists yet, so these stay local to
 * transport (re-promote to a shared lib later if other modules need them).
 */
export const TRANSPORT_LIST_MAX_LIMIT = 100;
export const TRANSPORT_LIST_DEFAULT_LIMIT = 25;

/** Query string booleans arrive as "true"/"false"; undefined means "no filter". */
const boolFromQuery = z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"));

/** review_status values mirror the live transport.* CHECK constraints. */
export const transportReviewStatusEnum = z.enum([
    "imported_unreviewed",
    "needs_review",
    "reviewed",
    "verified",
    "rejected",
    "manual_protected",
]);

/** mode values mirror the live transport.* CHECK constraints. */
export const transportModeEnum = z.enum([
    "bus",
    "express_bus",
    "train",
    "ferry",
    "air",
    "other",
]);

/**
 * Allowed `transport.infrastructure_lines.line_type` values. There is no DB CHECK
 * for this column, so this app-level allowlist is the only guard. The values cover
 * every line_type currently present in the live table, so existing rows stay valid.
 */
export const infrastructureLineTypeEnum = z.enum([
    "ferry",
    "rail",
    "abandoned",
    "disused",
    "construction",
    "narrow_gauge",
    "tram",
]);

/** limit (hard-capped at 100) + offset. */
export const transportPaginationQuerySchema = z.object({
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(TRANSPORT_LIST_MAX_LIMIT)
        .default(TRANSPORT_LIST_DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Shared base for transport list endpoints. Individual list endpoints extend
 * this and drop fields that do not apply (e.g. import batches have no `mode`).
 */
export const transportListQuerySchema = transportPaginationQuerySchema.extend({
    search: z.string().trim().min(1).max(120).optional(),
    mode: transportModeEnum.optional(),
    reviewStatus: transportReviewStatusEnum.optional(),
    isActive: boolFromQuery,
    includeDeleted: boolFromQuery,
});

export type TransportPaginationQuery = z.infer<typeof transportPaginationQuerySchema>;
export type TransportListQuery = z.infer<typeof transportListQuerySchema>;

/**
 * GET /transport/routes query. Extends the shared list base with route-specific
 * existence filters and an optional 1-based `page` (alternative to `offset`).
 */
export const listTransportRoutesQuerySchema = transportListQuerySchema.extend({
    hasStops: boolFromQuery,
    hasPath: boolFromQuery,
    hasSourceLink: boolFromQuery,
    geometryStatus: z.enum(["no_path", "estimate", "manual", "verified"]).optional(),
    publicVisibility: z.enum(["hidden", "visible"]).optional(),
    sourceName: z.string().trim().min(1).max(120).optional(),
    sourceKind: z.string().trim().min(1).max(120).optional(),
    page: z.coerce.number().int().min(1).optional(),
});

export type ListTransportRoutesQuery = z.infer<typeof listTransportRoutesQuerySchema>;

/**
 * GET /transport/routes (public). No review-status filters — public release rules are
 * always enforced server-side.
 */
export const listPublicTransportRoutesQuerySchema = transportListQuerySchema.extend({
    page: z.coerce.number().int().min(1).optional(),
});

export type ListPublicTransportRoutesQuery = z.infer<typeof listPublicTransportRoutesQuerySchema>;

/** GET /transport/routes/between-stops — direct variant route search by stop public_id. */
export const searchRoutesBetweenStopsQuerySchema = z
    .object({
        origin_stop_public_id: z.string().uuid(),
        destination_stop_public_id: z.string().uuid(),
    })
    .refine((value) => value.origin_stop_public_id !== value.destination_stop_public_id, {
        message: "origin_stop_public_id and destination_stop_public_id must differ",
    });

export type SearchRoutesBetweenStopsQuery = z.infer<typeof searchRoutesBetweenStopsQuerySchema>;

/** Path param for public route lookups by route_code (not uuid). */
export const transportRouteCodeParamSchema = z.object({
    routeCode: z.string().trim().min(1).max(50),
});

export type TransportRouteCodeParam = z.infer<typeof transportRouteCodeParamSchema>;

/**
 * GET /transport/stops query. Extends the shared list base with stop-specific
 * filters (stop_type, generated-name, has-routes, admin area) and an optional
 * 1-based `page` (alternative to `offset`).
 */
export const listTransportStopsQuerySchema = transportListQuerySchema.extend({
    stopType: z.string().trim().min(1).max(50).optional(),
    generatedName: boolFromQuery,
    hasRoutes: boolFromQuery,
    hasTerminal: boolFromQuery,
    hasSourceLink: boolFromQuery,
    geometryStatus: z.enum(["missing", "estimate", "manual", "verified"]).optional(),
    duplicateStatus: z.enum(["none", "nearby", "duplicate_name"]).optional(),
    adminAreaId: z.coerce.number().int().min(1).optional(),
    page: z.coerce.number().int().min(1).optional(),
});

export type ListTransportStopsQuery = z.infer<typeof listTransportStopsQuerySchema>;

/**
 * GET /transport/stops/search query — a lightweight stop picker for inserting an
 * existing stop into a route variant. Text search hits Myanmar/English/raw name
 * and stop_code; an optional near point (nearLng/nearLat, both-or-neither) adds a
 * PostGIS radius filter + distance ranking. Hard-capped at 50 results, no offset.
 * `excludeRouteVariantPublicId` drops stops already in that variant.
 */
export const STOP_SEARCH_MAX_LIMIT = 50;
export const STOP_SEARCH_DEFAULT_LIMIT = 20;
export const STOP_SEARCH_DEFAULT_RADIUS_M = 1000;
export const STOP_SEARCH_MAX_RADIUS_M = 50000;

export const searchTransportStopsQuerySchema = z
    .object({
        search: z.string().trim().min(1).max(120).optional(),
        mode: transportModeEnum.optional(),
        nearLng: z.coerce.number().min(-180).max(180).optional(),
        nearLat: z.coerce.number().min(-90).max(90).optional(),
        radiusMeters: z.coerce
            .number()
            .min(1)
            .max(STOP_SEARCH_MAX_RADIUS_M)
            .default(STOP_SEARCH_DEFAULT_RADIUS_M),
        limit: z.coerce.number().int().min(1).max(STOP_SEARCH_MAX_LIMIT).default(STOP_SEARCH_DEFAULT_LIMIT),
        excludeRouteVariantPublicId: z.string().uuid().optional(),
    })
    .refine((q) => (q.nearLng === undefined) === (q.nearLat === undefined), {
        message: "nearLng and nearLat must be provided together.",
    });

export type SearchTransportStopsQuery = z.infer<typeof searchTransportStopsQuerySchema>;

/**
 * GET /transport/stops/nearby-candidates query — reusable Review Map helper for
 * finding nearby stops around a selected stop or draft point. Radius is fixed to
 * a small allowlist so the PostGIS geography lookup stays predictable.
 */
export const nearbyTransportStopCandidatesQuerySchema = z
    .object({
        lng: z.coerce.number().min(-180).max(180),
        lat: z.coerce.number().min(-90).max(90),
        radiusMeters: z.coerce.number().int().refine((value) => [50, 100, 200, 500].includes(value), {
            message: "radiusMeters must be one of 50, 100, 200, or 500.",
        }).default(100),
        mode: transportModeEnum,
        selectedStopId: z.string().uuid(),
        selectedName: z.string().trim().min(1).max(255).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(30),
    })
    .strict();

export type NearbyTransportStopCandidatesQuery = z.infer<
    typeof nearbyTransportStopCandidatesQuerySchema
>;

/**
 * GET /transport/terminals query. Extends the shared list base with terminal-specific
 * filters (role, generated-name, linked-stop, admin area, confidence range) and an
 * optional 1-based `page` (alternative to `offset`).
 */
export const listTransportTerminalsQuerySchema = transportListQuerySchema.extend({
    terminalRole: z.string().trim().min(1).max(50).optional(),
    generatedName: boolFromQuery,
    linkedStop: boolFromQuery,
    adminAreaId: z.coerce.number().int().min(1).optional(),
    confidenceMin: z.coerce.number().min(0).max(100).optional(),
    confidenceMax: z.coerce.number().min(0).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
});

export type ListTransportTerminalsQuery = z.infer<typeof listTransportTerminalsQuerySchema>;

/**
 * GET /transport/infrastructure-lines query. Extends the shared list base with
 * line-specific filters (line_type, generated-name, admin area) and an optional
 * 1-based `page` (alternative to `offset`).
 */
export const listTransportInfrastructureLinesQuerySchema = transportListQuerySchema.extend({
    lineType: z.string().trim().min(1).max(50).optional(),
    generatedName: boolFromQuery,
    adminAreaId: z.coerce.number().int().min(1).optional(),
    page: z.coerce.number().int().min(1).optional(),
});

export type ListTransportInfrastructureLinesQuery = z.infer<
    typeof listTransportInfrastructureLinesQuerySchema
>;

/** GET /transport/import-batches query. Read-only import audit list. */
export const listImportBatchesQuerySchema = transportPaginationQuerySchema.extend({
    sourceName: z.string().trim().min(1).max(120).optional(),
    sourceKind: z.string().trim().min(1).max(120).optional(),
    status: z.string().trim().min(1).max(50).optional(),
    page: z.coerce.number().int().min(1).optional(),
});

export type ListImportBatchesQuery = z.infer<typeof listImportBatchesQuerySchema>;

/** GET /transport/import-errors query. Read-only import error list. */
export const listImportErrorsQuerySchema = transportPaginationQuerySchema.extend({
    importBatchId: z.coerce.number().int().min(1).optional(),
    entityType: z.string().trim().min(1).max(50).optional(),
    errorCode: z.string().trim().min(1).max(120).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    page: z.coerce.number().int().min(1).optional(),
});

export type ListImportErrorsQuery = z.infer<typeof listImportErrorsQuerySchema>;

/** GET /transport/source-links query. Read-only source provenance list. */
export const listSourceLinksQuerySchema = transportPaginationQuerySchema.extend({
    entityType: z.string().trim().min(1).max(50).optional(),
    entityId: z.coerce.number().int().min(1).optional(),
    sourceName: z.string().trim().min(1).max(120).optional(),
    sourceKind: z.string().trim().min(1).max(120).optional(),
    externalId: z.string().trim().min(1).max(200).optional(),
    page: z.coerce.number().int().min(1).optional(),
});

export type ListSourceLinksQuery = z.infer<typeof listSourceLinksQuerySchema>;

/** Path param for `:publicId` route/variant lookups. */
export const transportPublicIdParamSchema = z.object({
    publicId: z.string().uuid(),
});

export type TransportPublicIdParam = z.infer<typeof transportPublicIdParamSchema>;

/**
 * GET /transport/route-variants/:publicId/stops query.
 * Stops are variant-scoped (bounded), so the cap is higher than list endpoints.
 * `includePath` opts in to the variant's route-path geometry (kept out by default).
 */
export const STOPS_LIST_MAX_LIMIT = 1000;
export const STOPS_LIST_DEFAULT_LIMIT = 500;

export const listVariantStopsQuerySchema = z.object({
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(STOPS_LIST_MAX_LIMIT)
        .default(STOPS_LIST_DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
    includePath: boolFromQuery,
});

export type ListVariantStopsQuery = z.infer<typeof listVariantStopsQuerySchema>;

/**
 * Nullable, trimmed free-text field for edit forms. Empty string is normalized to
 * `null` so clearing a field in the UI clears the column. `undefined` (key absent)
 * means "leave unchanged".
 */
function nullableText(max: number) {
    // `.optional()` must come after `.transform()`: in Zod 4 a transform placed
    // after `.optional()` drops key-optionality from the inferred output type.
    return z
        .string()
        .trim()
        .max(max)
        .nullable()
        .transform((v) => (v === "" ? null : v))
        .optional();
}

/** Required, trimmed, non-empty text for edit forms. */
function requiredText(max: number) {
    return z.string().trim().min(1).max(max).optional();
}

/** confidence_score mirrors the live CHECK (0–100). Numeric column → number body. */
const confidenceScoreField = z.number().min(0).max(100).optional();

const operationDaysField = z
    .array(z.string().trim().min(1).max(100))
    .max(14)
    .optional();

function hasTrainMetadataInput(body: {
    train_type?: unknown;
    train_model?: unknown;
    operation_days?: unknown;
    is_yangon_urban_service?: unknown;
}): boolean {
    return (
        body.train_type !== undefined ||
        body.train_model !== undefined ||
        body.operation_days !== undefined ||
        body.is_yangon_urban_service !== undefined
    );
}

/**
 * PATCH /transport/routes/:publicId body. All fields optional (partial update);
 * `.strict()` rejects unknown keys — notably `source_refs`, `normalized_data`,
 * and `public_name` (the display cache is DERIVED from name_mm/name_en, never
 * edited directly). At least one field is required.
 *
 * Manual naming policy: editors set `name_mm` / `name_en` only. The repo derives
 * `routes.public_name` from name_mm (Myanmar first) else name_en, and writes the
 * `transport.route_names` rows for `language_code` my/en. A merge-aware "at least
 * one of name_mm/name_en" rule is enforced in the repo against the stored names;
 * the refine below only catches the obvious "clear both in one request" case.
 */
export const updateRouteBodySchema = z
    .object({
        route_code: requiredText(50).optional(),
        name_mm: nullableText(200),
        name_en: nullableText(200),
        mode: transportModeEnum.optional(),
        route_kind: requiredText(50).optional(),
        origin_name: nullableText(200),
        destination_name: nullableText(200),
        description: nullableText(2000),
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
        is_active: z.boolean().optional(),
        train_type: nullableText(50),
        train_model: nullableText(100),
        operation_days: operationDaysField,
        is_yangon_urban_service: z.boolean().optional(),
        display_headsign: nullableText(200),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field must be provided.",
    })
    .refine(
        (body) =>
            !(
                body.name_mm !== undefined &&
                body.name_en !== undefined &&
                body.name_mm === null &&
                body.name_en === null
            ),
        { message: "At least one of name_mm or name_en is required." }
    )
    .refine((body) => !hasTrainMetadataInput(body) || body.mode === undefined || body.mode === "train", {
        message: "Train metadata fields require mode=train.",
    });

export type UpdateRouteInput = z.infer<typeof updateRouteBodySchema>;

export { hasTrainMetadataInput };

const patchRouteMetadataRouteNamesSchema = z
    .object({
        my: nullableText(200),
        en: nullableText(200),
    })
    .strict();

const patchRouteMetadataRouteSchema = z
    .object({
        originName: nullableText(200),
        destinationName: nullableText(200),
        reviewStatus: transportReviewStatusEnum.optional(),
        confidenceScore: confidenceScoreField,
    })
    .strict();

const patchRouteMetadataNormalizedDataPatchSchema = z
    .object({
        train_type: nullableText(50),
        train_model: nullableText(100),
        operation_days: operationDaysField,
        display_headsign: nullableText(200),
        is_yangon_urban_service: z.boolean().optional(),
    })
    .strict();

function patchRouteMetadataHasAnyField(body: {
    routeNames?: { my?: unknown; en?: unknown };
    route?: Record<string, unknown>;
    normalizedDataPatch?: Record<string, unknown>;
}): boolean {
    if (body.routeNames) {
        if (body.routeNames.my !== undefined || body.routeNames.en !== undefined) {
            return true;
        }
    }
    if (body.route && Object.keys(body.route).length > 0) {
        return true;
    }
    if (
        body.normalizedDataPatch &&
        Object.values(body.normalizedDataPatch).some((value) => value !== undefined)
    ) {
        return true;
    }
    return false;
}

/**
 * PATCH /transport/routes/:publicId/metadata body. Structured metadata editor payload.
 * Merges normalized_data keys, upserts route_names my/en, and may update primary variant
 * headsign from normalizedDataPatch.display_headsign. Never edits route_stops.
 */
export const patchRouteMetadataBodySchema = z
    .object({
        routeNames: patchRouteMetadataRouteNamesSchema.optional(),
        route: patchRouteMetadataRouteSchema.optional(),
        normalizedDataPatch: patchRouteMetadataNormalizedDataPatchSchema.optional(),
    })
    .strict()
    .refine((body) => patchRouteMetadataHasAnyField(body), {
        message: "At least one metadata field must be provided.",
    })
    .refine(
        (body) =>
            !(
                body.routeNames?.my !== undefined &&
                body.routeNames?.en !== undefined &&
                body.routeNames.my === null &&
                body.routeNames.en === null
            ),
        { message: "At least one of routeNames.my or routeNames.en is required." },
    );

export type PatchRouteMetadataInput = z.infer<typeof patchRouteMetadataBodySchema>;

/** Maps the structured metadata PATCH body onto the flat route update input. */
export function mapPatchRouteMetadataToUpdateInput(
    input: PatchRouteMetadataInput,
): UpdateRouteInput {
    const body: UpdateRouteInput = {};

    if (input.routeNames?.my !== undefined) {
        body.name_mm = input.routeNames.my;
    }
    if (input.routeNames?.en !== undefined) {
        body.name_en = input.routeNames.en;
    }
    if (input.route?.originName !== undefined) {
        body.origin_name = input.route.originName;
    }
    if (input.route?.destinationName !== undefined) {
        body.destination_name = input.route.destinationName;
    }
    if (input.route?.reviewStatus !== undefined) {
        body.review_status = input.route.reviewStatus;
    }
    if (input.route?.confidenceScore !== undefined) {
        body.confidence_score = input.route.confidenceScore;
    }

    const patch = input.normalizedDataPatch;
    if (patch?.train_type !== undefined) {
        body.train_type = patch.train_type;
    }
    if (patch?.train_model !== undefined) {
        body.train_model = patch.train_model;
    }
    if (patch?.operation_days !== undefined) {
        body.operation_days = patch.operation_days;
    }
    if (patch?.is_yangon_urban_service !== undefined) {
        body.is_yangon_urban_service = patch.is_yangon_urban_service;
    }
    if (patch?.display_headsign !== undefined) {
        body.display_headsign = patch.display_headsign;
    }

    return body;
}

/**
 * Modes the create-route endpoint supports. The `transport.routes.mode` column
 * allows more values (express_bus/air/other), but route + auto-variant creation
 * is only defined for bus/train/ferry today (see transport-mode-config.ts).
 */
export const createRouteModeEnum = z.enum(["bus", "train", "ferry"]);

/**
 * POST /transport/routes body. Creates a route plus its default variants in one
 * transaction. `route_kind` is derived from the mode config (not accepted here),
 * `public_name` is the display cache, and origin/destination feed both the route
 * and the generated variants. `.strict()` rejects unknown keys — notably
 * `route_kind`, `review_status`, `confidence_score`, `source_refs`, and
 * `normalized_data`, which are all set by the server.
 */
export const createRouteBodySchema = z
    .object({
        mode: createRouteModeEnum,
        route_code: z.string().trim().min(1).max(50),
        public_name: z.string().trim().min(1).max(200),
        origin_name: nullableText(200),
        destination_name: nullableText(200),
        operator_id: z.number().int().min(1).nullable().optional(),
        create_return_variant: z.boolean().optional().default(false),
        is_loop: z.boolean().optional().default(false),
    })
    .strict();

export type CreateRouteInput = z.infer<typeof createRouteBodySchema>;

/**
 * PATCH /transport/route-variants/:publicId body. Same conventions as the route
 * update schema. `.strict()` blocks `source_refs` / `normalized_data`.
 */
export const updateVariantBodySchema = z
    .object({
        variant_code: requiredText(50),
        direction_name: nullableText(100),
        direction_id: z.number().int().min(0).max(32767).nullable().optional(),
        headsign: nullableText(200),
        origin_name: nullableText(200),
        destination_name: nullableText(200),
        estimated_duration_min: z.number().int().min(0).max(100000).nullable().optional(),
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
        is_active: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field must be provided.",
    });

/**
 * Variant `direction_id`: 0 = outbound, 1 = inbound, 2 = loop/branch/special,
 * null = unknown. Narrower than the column's smallint range on purpose so the
 * create/update endpoints only accept the meaningful values.
 */
const variantDirectionIdField = z.number().int().min(0).max(2).nullable().optional();

/** Optional endpoint pointer (origin/destination stop) by stop public_id; null clears it. */
const variantStopPublicIdField = z.string().uuid().nullable().optional();

/**
 * Repo-level variant write input. Extends the body-validated fields with the
 * optional origin/destination stop pointers (resolved from public_id → stops.id
 * in the repo). Both update body schemas produce values assignable to this.
 */
export type UpdateVariantInput = z.infer<typeof updateVariantBodySchema> & {
    origin_stop_public_id?: string | null;
    destination_stop_public_id?: string | null;
};

/**
 * POST /transport/routes/:routePublicId/variants body. `variant_code` is required
 * and unique per route (route_id + variant_code). `.strict()` rejects unknown
 * keys — notably `source_refs` / `normalized_data` / `is_active` (server-set).
 * review_status / confidence_score default in the repo when omitted.
 */
export const createVariantBodySchema = z
    .object({
        variant_code: z.string().trim().min(1).max(50),
        direction_id: variantDirectionIdField,
        direction_name: nullableText(100),
        headsign: nullableText(200),
        origin_name: nullableText(200),
        destination_name: nullableText(200),
        origin_stop_public_id: variantStopPublicIdField,
        destination_stop_public_id: variantStopPublicIdField,
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
    })
    .strict();

export type CreateVariantInput = z.infer<typeof createVariantBodySchema>;

/**
 * PATCH /transport/variants/:variantPublicId body. Same fields as create, all
 * optional, plus the endpoint stop pointers. `.strict()` blocks `source_refs` /
 * `normalized_data`. At least one field required.
 */
export const patchVariantBodySchema = z
    .object({
        variant_code: requiredText(50),
        direction_id: variantDirectionIdField,
        direction_name: nullableText(100),
        headsign: nullableText(200),
        origin_name: nullableText(200),
        destination_name: nullableText(200),
        origin_stop_public_id: variantStopPublicIdField,
        destination_stop_public_id: variantStopPublicIdField,
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field must be provided.",
    });

export type PatchVariantInput = z.infer<typeof patchVariantBodySchema>;

/** Path param for POST `/transport/routes/:routePublicId/variants`. */
export const routeVariantsParamSchema = z.object({
    routePublicId: z.string().uuid(),
});

/** Path param for `/transport/variants/:variantPublicId`. */
export const variantPublicIdParamSchema = z.object({
    variantPublicId: z.string().uuid(),
});

/** A single [lng, lat] position with WGS84 range checks. */
const pathCoordinateSchema = z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
]);

/**
 * PUT /transport/variants/:variantPublicId/path body. Upserts the variant's
 * single active manual route path from an ordered LineString (≥ 2 positions).
 * `path_kind` is restricted to manual variants of this endpoint.
 */
export const putVariantPathBodySchema = z
    .object({
        coordinates: z.array(pathCoordinateSchema).min(2),
        path_kind: z.enum(["manual", "manual_drawn"]).optional(),
        manually_adjusted: z.boolean().optional(),
    })
    .strict();

export type PutVariantPathInput = z.infer<typeof putVariantPathBodySchema>;

/**
 * GET /transport/stops/:publicId/routes query — paginates the (potentially large)
 * list of route variants that include this stop. Capped like the other lists.
 */
export const stopRoutesQuerySchema = transportPaginationQuerySchema;

export type StopRoutesQuery = z.infer<typeof stopRoutesQuerySchema>;

/**
 * Editable point geometry for a stop. Sent as an explicit lng/lat pair so the
 * frontend never has to construct GeoJSON. `geom` is NOT NULL in the DB, so this
 * (when present) always replaces with a valid point; it can never clear geometry.
 */
const stopPointField = z
    .object({
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
    })
    .optional();

/**
 * PATCH /transport/stops/:publicId body. Partial update; `.strict()` rejects
 * unknown keys — notably the raw `name` cache, `source_refs`, and
 * `normalized_data`, none of which are edited directly. At least one field is
 * required.
 *
 * Naming is edited via `name_mm` / `name_en` only. The repo writes the
 * `transport.stop_names` rows (language my/en) as the source of truth, mirrors
 * them onto the `stops.name_mm` / `stops.name_en` cache columns, and derives the
 * `stops.name` cache (Myanmar first, English fallback). A merge-aware "at least
 * one of name_mm/name_en" rule is enforced in the repo; the refine below only
 * catches the obvious "clear both in one request" case.
 *
 * `admin_area_id` / `parent_stop_id` are nullable internal FKs (numbers). The
 * service validates referential integrity and surfaces a 400 on a bad reference.
 */
export const updateStopBodySchema = z
    .object({
        stop_code: nullableText(50),
        name_mm: nullableText(255),
        name_en: nullableText(255),
        mode: transportModeEnum.optional(),
        stop_type: z.string().trim().min(1).max(50).optional(),
        admin_area_id: z.number().int().min(1).nullable().optional(),
        parent_stop_id: z.number().int().min(1).nullable().optional(),
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
        is_active: z.boolean().optional(),
        point: stopPointField,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field must be provided.",
    })
    .refine(
        (body) =>
            !(
                body.name_mm !== undefined &&
                body.name_en !== undefined &&
                body.name_mm === null &&
                body.name_en === null
            ),
        { message: "At least one of name_mm or name_en is required." }
    );

export type UpdateStopInput = z.infer<typeof updateStopBodySchema>;

/** Path param for the stop location/nearby endpoints. */
export const stopPublicIdParamSchema = z.object({
    stopPublicId: z.string().uuid(),
});

export type StopPublicIdParam = z.infer<typeof stopPublicIdParamSchema>;

/**
 * PATCH /transport/stops/:stopPublicId/location body. Focused location-only edit:
 * moves the stop point and optionally updates review_status / confidence_score.
 * Names, mode, stop_type, admin area, and parent are intentionally NOT editable
 * here — use PATCH /transport/stops/:publicId for those. `.strict()` rejects any
 * other key (notably `source_refs` / `normalized_data`).
 */
export const updateStopLocationBodySchema = z
    .object({
        lng: z.number().min(-180).max(180),
        lat: z.number().min(-90).max(90),
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
    })
    .strict();

export type UpdateStopLocationInput = z.infer<typeof updateStopLocationBodySchema>;

/**
 * GET /transport/stops/:stopPublicId/nearby query — preview the stops within a
 * radius of an arbitrary point (e.g. before committing a location edit). Defaults
 * to the 30 m duplicate-check radius; capped to keep the lookup cheap.
 */
export const nearbyStopsQuerySchema = z
    .object({
        lng: z.coerce.number().min(-180).max(180),
        lat: z.coerce.number().min(-90).max(90),
        radius_m: z.coerce.number().min(1).max(500).default(30),
    })
    .strict();

export type NearbyStopsQuery = z.infer<typeof nearbyStopsQuerySchema>;

/**
 * PATCH /transport/terminals/:publicId body. Partial update; `.strict()` rejects
 * unknown keys — notably `source_refs` / `normalized_data`. At least one field
 * required. `linked_stop_id` / `operator_id` / `admin_area_id` are nullable
 * internal FKs validated by the service. `point` replaces the (NOT NULL) geometry.
 */
export const updateTerminalBodySchema = z
    .object({
        terminal_code: nullableText(50),
        name: requiredText(255),
        name_mm: nullableText(255),
        name_en: nullableText(255),
        mode: transportModeEnum.optional(),
        terminal_role: z.string().trim().min(1).max(50).optional(),
        linked_stop_id: z.number().int().min(1).nullable().optional(),
        operator_id: z.number().int().min(1).nullable().optional(),
        admin_area_id: z.number().int().min(1).nullable().optional(),
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
        is_active: z.boolean().optional(),
        point: stopPointField,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field must be provided.",
    });

export type UpdateTerminalInput = z.infer<typeof updateTerminalBodySchema>;

/**
 * PATCH /transport/infrastructure-lines/:publicId body. Partial update; `.strict()`
 * rejects unknown keys — notably `source_refs` / `normalized_data`. At least one
 * field required. `name` is nullable (many lines are unnamed/generated). Line
 * geometry editing is intentionally NOT supported here.
 */
export const updateInfrastructureLineBodySchema = z
    .object({
        name: nullableText(255),
        name_mm: nullableText(255),
        name_en: nullableText(255),
        mode: transportModeEnum.optional(),
        line_type: infrastructureLineTypeEnum.optional(),
        admin_area_id: z.number().int().min(1).nullable().optional(),
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
        is_active: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field must be provided.",
    });

export type UpdateInfrastructureLineInput = z.infer<typeof updateInfrastructureLineBodySchema>;

/** Path param for `:id` route_stops lookups (numeric primary key). */
export const routeStopIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/, "id must be a positive integer"),
});

export type RouteStopIdParam = z.infer<typeof routeStopIdParamSchema>;

export const SOURCE_TIME_TYPE_VALUES = [
    "arrival",
    "departure",
    "arrival_departure",
    "unknown",
] as const;

export type SourceTimeType = (typeof SOURCE_TIME_TYPE_VALUES)[number];

/**
 * PATCH /transport/route-stops/:id body. Stop membership flags only.
 * pickup_type / drop_off_type follow GTFS semantics (0–3).
 * `.strict()` blocks editing stop_sequence (use the move endpoint),
 * source_refs / normalized_data, and imported timetable provenance fields.
 */
export const updateRouteStopBodySchema = z
    .object({
        pickup_type: z.number().int().min(0).max(3).optional(),
        drop_off_type: z.number().int().min(0).max(3).optional(),
        is_timing_point: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field must be provided.",
    });

export type UpdateRouteStopInput = z.infer<typeof updateRouteStopBodySchema>;

/** Internal repo input for editable route_stops timing columns only. */
export type UpdateRouteStopTimingInput = {
    travel_time_from_previous_seconds?: number | null;
    waiting_time_seconds?: number | null;
};

/**
 * PATCH /transport/route-stops/:id/timing body. Editable timetable inputs only.
 * Offsets are recalculated for the whole variant in one transaction.
 */
export const patchRouteStopTimingBodySchema = z
    .object({
        travelTimeFromPreviousSeconds: z.number().int().min(0).nullable().optional(),
        waitingTimeSeconds: z.number().int().min(0).nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one timing field must be provided.",
    });

export type PatchRouteStopTimingInput = z.infer<typeof patchRouteStopTimingBodySchema>;

/** Maps the camelCase timing PATCH body onto snake_case repo input. */
export function mapPatchRouteStopTimingToInput(
    input: PatchRouteStopTimingInput,
): UpdateRouteStopTimingInput {
    const body: UpdateRouteStopTimingInput = {};
    if (input.travelTimeFromPreviousSeconds !== undefined) {
        body.travel_time_from_previous_seconds = input.travelTimeFromPreviousSeconds;
    }
    if (input.waitingTimeSeconds !== undefined) {
        body.waiting_time_seconds = input.waitingTimeSeconds;
    }
    return body;
}

/**
 * PATCH /transport/route-variants/:publicId/departure-time body.
 * Stores departure_time_text in variant normalized_data and recalculates offsets.
 */
export const patchVariantDepartureTimeBodySchema = z
    .object({
        departureTimeText: z.string().max(200).nullable(),
    })
    .strict()
    .superRefine((body, ctx) => {
        if (body.departureTimeText === null) {
            return;
        }
        const trimmed = body.departureTimeText.trim();
        if (trimmed.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Use null to clear departure time; empty string is not allowed.",
                path: ["departureTimeText"],
            });
            return;
        }
        if (!validateCanonicalTime(trimmed)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Use strict HH:mm like "05:00".',
                path: ["departureTimeText"],
            });
        }
    });

export type PatchVariantDepartureTimeInput = z.infer<typeof patchVariantDepartureTimeBodySchema>;

/** POST /transport/route-stops/:id/move body — swap with the adjacent stop. */
export const moveRouteStopBodySchema = z.object({
    direction: z.enum(["up", "down"]),
});

export type MoveRouteStopInput = z.infer<typeof moveRouteStopBodySchema>;

/**
 * POST /transport/route-variants/:publicId/stops/insert-existing body.
 *
 * Inserts an EXISTING stop into the variant's ordered pattern. The backend owns
 * stop_sequence: the client never sends a final sequence, only a relative
 * `position` (and an anchor route_stop id for before/after). Exactly one of
 * `stopPublicId` / `stopId` identifies the stop to insert. `.strict()` blocks
 * `stop_sequence` and any source_refs / normalized_data.
 *
 * pickup_type / drop_off_type follow GTFS semantics (0–3); all three membership
 * flags default to the route_stops column defaults (0 / 0 / false).
 */
export const insertExistingRouteStopBodySchema = z
    .object({
        stopPublicId: z.string().uuid().optional(),
        stopId: z.coerce.number().int().min(1).optional(),
        position: z.enum(["start", "end", "before", "after"]),
        anchorRouteStopId: z
            .string()
            .regex(/^\d+$/, "anchorRouteStopId must be a positive integer")
            .optional(),
        pickup_type: z.number().int().min(0).max(3).default(0),
        drop_off_type: z.number().int().min(0).max(3).default(0),
        is_timing_point: z.boolean().default(false),
    })
    .strict()
    .refine((body) => body.stopPublicId !== undefined || body.stopId !== undefined, {
        message: "Either stopPublicId or stopId is required.",
    })
    .refine(
        (body) =>
            (body.position !== "before" && body.position !== "after") ||
            body.anchorRouteStopId !== undefined,
        { message: "anchorRouteStopId is required when position is 'before' or 'after'." }
    );

export type InsertExistingRouteStopInput = z.infer<typeof insertExistingRouteStopBodySchema>;

/**
 * POST /transport/route-variants/:publicId/stops/create-and-insert body.
 *
 * Quick create path for the Insert Stop modal: creates a new stop (localized names,
 * mode, stop_type only) and inserts it into this variant in one transaction.
 * Placeholder geometry is derived server-side from the variant sequence. The
 * backend owns stop_sequence and resequences the variant to 1..N.
 */
export const createAndInsertRouteStopBodySchema = z
    .object({
        name_mm: z.string().trim().min(1).max(255).optional(),
        name_en: z.string().trim().min(1).max(255).optional(),
        mode: transportModeEnum,
        stop_type: z.string().trim().min(1).max(50),
        position: z.enum(["start", "end", "before", "after"]),
        anchorRouteStopId: z
            .string()
            .regex(/^\d+$/, "anchorRouteStopId must be a positive integer")
            .optional(),
        pickup_type: z.number().int().min(0).max(3).default(0),
        drop_off_type: z.number().int().min(0).max(3).default(0),
        is_timing_point: z.boolean().default(false),
        longitude: z.number().min(-180).max(180).optional(),
        latitude: z.number().min(-90).max(90).optional(),
    })
    .strict()
    .refine((body) => body.name_mm !== undefined || body.name_en !== undefined, {
        message: "At least one of name_mm or name_en is required.",
    })
    .refine(
        (body) =>
            (body.position !== "before" && body.position !== "after") ||
            body.anchorRouteStopId !== undefined,
        { message: "anchorRouteStopId is required when position is 'before' or 'after'." }
    )
    .refine(
        (body) =>
            (body.longitude === undefined && body.latitude === undefined) ||
            (body.longitude !== undefined && body.latitude !== undefined),
        { message: "longitude and latitude must both be provided or both omitted." }
    );

export type CreateAndInsertRouteStopInput = z.infer<typeof createAndInsertRouteStopBodySchema>;

/**
 * DELETE /transport/route-stops/:id body. Optional free-text reason recorded in
 * the removal audit log metadata. The body itself is optional (no body = no reason).
 */
export const removeRouteStopBodySchema = z.object({
    reason: z.string().trim().max(500).optional(),
});

export type RemoveRouteStopInput = z.infer<typeof removeRouteStopBodySchema>;

/**
 * DELETE /transport/stops/:publicId body. Optional free-text reason recorded in
 * the archive audit log metadata. The body itself is optional (no body = no reason).
 * Archiving only soft-deletes the stop (and any linked terminals); it never
 * deletes route_stops and is rejected when the stop is still used by routes.
 */
export const archiveStopBodySchema = z.object({
    reason: z.string().trim().max(500).optional(),
});

export type ArchiveStopInput = z.infer<typeof archiveStopBodySchema>;

export const transportReviewActionBodySchema = z.object({
    action: z.enum(["mark_reviewed", "mark_needs_review", "mark_verified", "reject"]),
    reason: z.string().trim().min(1).max(500).optional(),
});

export type TransportReviewActionBody = z.infer<typeof transportReviewActionBodySchema>;

export const replaceRouteStopBodySchema = z.object({
    stop_public_id: z.string().uuid(),
    reason: z.string().trim().min(1).max(500).optional(),
});

export type ReplaceRouteStopBody = z.infer<typeof replaceRouteStopBodySchema>;

export const mergeStopBodySchema = z.object({
    target_stop_public_id: z.string().uuid(),
    reason: z.string().trim().min(1).max(500).optional(),
});

export type MergeStopBody = z.infer<typeof mergeStopBodySchema>;

/** POST /transport/stops/merge-preview — read-only merge comparison for two stops. */
export const stopMergePreviewBodySchema = z
    .object({
        currentStopId: z.string().uuid(),
        candidateStopId: z.string().uuid(),
    })
    .superRefine((body, ctx) => {
        if (body.currentStopId === body.candidateStopId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "currentStopId and candidateStopId must be different.",
                path: ["candidateStopId"],
            });
        }
    });

export type StopMergePreviewBody = z.infer<typeof stopMergePreviewBodySchema>;

/** POST /transport/stops/merge — global keep-canonical merge (hard-delete duplicate). */
export const stopMergeFieldSourceSchema = z.enum(["current", "candidate"]);

export const stopMergeFieldSourcesSchema = z
    .object({
        name: stopMergeFieldSourceSchema.optional(),
        name_mm: stopMergeFieldSourceSchema.optional(),
        name_en: stopMergeFieldSourceSchema.optional(),
        stop_type: stopMergeFieldSourceSchema.optional(),
        geom: stopMergeFieldSourceSchema.optional(),
        admin_area_id: stopMergeFieldSourceSchema.optional(),
        confidence_score: stopMergeFieldSourceSchema.optional(),
        review_status: stopMergeFieldSourceSchema.optional(),
        is_active: stopMergeFieldSourceSchema.optional(),
    })
    .strict();

export const stopMergeGlobalBodySchema = z
    .object({
        canonicalStopId: z.string().uuid(),
        duplicateStopId: z.string().uuid(),
        currentStopId: z.string().uuid(),
        candidateStopId: z.string().uuid(),
        fieldSources: stopMergeFieldSourcesSchema.optional(),
        acknowledgeSameVariantOccurrences: z.boolean().optional(),
        reason: z.string().trim().min(1).max(500).optional(),
    })
    .superRefine((body, ctx) => {
        if (body.canonicalStopId === body.duplicateStopId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "canonicalStopId and duplicateStopId must be different.",
                path: ["duplicateStopId"],
            });
        }
        const mergeIds = new Set([body.canonicalStopId, body.duplicateStopId]);
        const compareIds = new Set([body.currentStopId, body.candidateStopId]);
        if (
            mergeIds.size !== 2 ||
            compareIds.size !== 2 ||
            mergeIds.size !== compareIds.size ||
            ![...mergeIds].every((id) => compareIds.has(id))
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    "canonicalStopId and duplicateStopId must match currentStopId and candidateStopId.",
                path: ["canonicalStopId"],
            });
        }
    });

export type StopMergeFieldSources = z.infer<typeof stopMergeFieldSourcesSchema>;
export type StopMergeGlobalBody = z.infer<typeof stopMergeGlobalBodySchema>;
