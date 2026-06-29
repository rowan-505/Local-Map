import { z } from "zod";

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
    page: z.coerce.number().int().min(1).optional(),
});

export type ListTransportRoutesQuery = z.infer<typeof listTransportRoutesQuerySchema>;

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
    return z
        .string()
        .trim()
        .max(max)
        .nullable()
        .optional()
        .transform((v) => (v === "" ? null : v));
}

/** Required, trimmed, non-empty text for edit forms. */
function requiredText(max: number) {
    return z.string().trim().min(1).max(max).optional();
}

/** confidence_score mirrors the live CHECK (0–100). Numeric column → number body. */
const confidenceScoreField = z.number().min(0).max(100).optional();

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
        route_code: requiredText(50),
        name_mm: nullableText(200),
        name_en: nullableText(200),
        mode: transportModeEnum.optional(),
        route_kind: requiredText(50),
        origin_name: nullableText(200),
        destination_name: nullableText(200),
        description: nullableText(2000),
        review_status: transportReviewStatusEnum.optional(),
        confidence_score: confidenceScoreField,
        is_active: z.boolean().optional(),
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

export type UpdateRouteInput = z.infer<typeof updateRouteBodySchema>;

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
 * `path_kind` is restricted to "manual" (this endpoint only manages hand-drawn
 * paths — no snapping / Valhalla). `.strict()` rejects any other key.
 */
export const putVariantPathBodySchema = z
    .object({
        coordinates: z.array(pathCoordinateSchema).min(2),
        path_kind: z.literal("manual").optional(),
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

/**
 * PATCH /transport/route-stops/:id body. Stop membership flags only.
 * pickup_type / drop_off_type follow GTFS semantics (0–3). `.strict()` blocks
 * editing stop_sequence (use the move endpoint) and source_refs / normalized_data.
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
 * Secondary "quick create" path for the Insert Stop modal: creates a new stop
 * (minimal fields only) and inserts it into this variant in one transaction.
 * The backend owns stop_sequence and resequences the variant to 1..N.
 *
 * At least one of `name_mm` / `name_en` is required. `.strict()` blocks any
 * attempt to set full stop metadata here (admin_area, stop_code, review fields,
 * source_refs, etc.) — full editing stays on the Stop Detail page.
 */
export const createAndInsertRouteStopBodySchema = z
    .object({
        name_mm: z.string().trim().min(1).max(255).optional(),
        name_en: z.string().trim().min(1).max(255).optional(),
        mode: transportModeEnum,
        stop_type: z.string().trim().min(1).max(50),
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
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
    .refine((body) => body.name_mm !== undefined || body.name_en !== undefined, {
        message: "At least one of name_mm or name_en is required.",
    })
    .refine(
        (body) =>
            (body.position !== "before" && body.position !== "after") ||
            body.anchorRouteStopId !== undefined,
        { message: "anchorRouteStopId is required when position is 'before' or 'after'." }
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
