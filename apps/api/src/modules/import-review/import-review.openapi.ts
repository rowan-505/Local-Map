import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    conflictSchema,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";

/** Scope selectors validated against XOR rules in Zod (`source_snapshot_version` is canonical; `snapshot_version` alias). */
const importReviewScopeQueryProperties = {
    source_snapshot_version: {
        type: "string",
        minLength: 1,
        description: "Normalized pipeline snapshot identifier for `import_review.review_batches.source_snapshot_version`.",
    },
    snapshot_version: {
        type: "string",
        minLength: 1,
        description: "Alias accepted for dashboards; forwarded as `source_snapshot_version` internally.",
    },
    review_batch_id: {
        type: "string",
        pattern: "^\\d+$",
        description: "import_review.review_batches id (mutually exclusive with source_snapshot_version).",
    },
} as const;

const importReviewEnvelopeResponseProperties = {
    source_snapshot_version: {
        type: "string",
        description: "Resolved `import_review.review_batches.source_snapshot_version` for this scope.",
    },
    review_batch_id: {
        type: "string",
        nullable: true,
        description: "import_review.review_batches id string when batch scope can be resolved from the request.",
    },
    source_snapshot_id_local: {
        type: "string",
        nullable: true,
        description: "Optional pipeline link echoing `review_batches.source_snapshot_id_local` when present.",
    },
} as const;

const geoJsonObjectSchema = {
    nullable: true,
    type: "object",
    additionalProperties: true,
} as const;

const importReviewBucketSchema = {
    type: "object",
    required: [
        "entity_family",
        "review_batch_id",
        "source_snapshot_version",
        "match_status",
        "auto_action",
        "review_status",
        "review_decision",
        "promotion_status",
        "row_count",
    ],
    properties: {
        entity_family: { type: "string" },
        review_batch_id: { type: "string" },
        source_snapshot_version: { type: "string" },
        match_status: { type: "string", nullable: true },
        auto_action: { type: "string", nullable: true },
        review_status: { type: "string", nullable: true },
        review_decision: { type: "string", nullable: true },
        promotion_status: { type: "string", nullable: true },
        row_count: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewSummaryResponseSchema = {
    type: "object",
    required: [
        "source_snapshot_version",
        "review_batch_id",
        "source_snapshot_id_local",
        "entity_summaries",
        "total_pending_review_count",
        "total_approved_count",
        "total_rejected_count",
    ],
    properties: {
        ...importReviewEnvelopeResponseProperties,
        entity_summaries: {
            type: "array",
            items: importReviewBucketSchema,
        },
        warnings: {
            type: "array",
            items: { type: "string" },
            description: "Non-fatal gaps (e.g. optional candidate tables missing on remote DB).",
        },
        total_pending_review_count: { type: "integer", minimum: 0 },
        total_approved_count: { type: "integer", minimum: 0 },
        total_rejected_count: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

export const importReviewBuildingItemSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "review_batch_id",
        "source_snapshot_version",
        "local_staging_id",
        "source_snapshot_id_local",
        "external_id",
        "canonical_name",
        "name",
        "class_code",
        "building_type",
        "building_type_id",
        "admin_area_id",
        "levels",
        "height_m",
        "area_m2",
        "confidence_score",
        "match_status",
        "auto_action",
        "review_status",
        "review_decision",
        "reviewed_by",
        "reviewed_at",
        "review_note",
        "normalized_data",
        "source_refs",
        "review_overrides",
        "matched_core_id",
        "matched_core_table",
        "matched_core_data",
        "f2_comparison",
        "validation_warnings",
        "validation_errors",
        "promotion_status",
        "promoted_core_id",
        "created_at",
        "updated_at",
        "geometry",
        "geom",
        "centroid",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string" },
        review_batch_id: { type: "string" },
        source_snapshot_version: { type: "string" },
        local_staging_id: { type: "string" },
        source_snapshot_id_local: { type: "string", nullable: true },
        external_id: { type: "string", nullable: true },
        canonical_name: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        class_code: { type: "string", nullable: true },
        building_type: { type: "string", nullable: true },
        building_type_id: { type: "string", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        levels: { type: "integer", nullable: true },
        height_m: { type: "number", nullable: true },
        area_m2: { type: "number", nullable: true },
        confidence_score: { type: "number", nullable: true },
        match_status: { type: "string", nullable: true },
        auto_action: { type: "string", nullable: true },
        review_status: { type: "string", nullable: true },
        review_decision: { type: "string", nullable: true },
        reviewed_by: { type: "string", nullable: true },
        reviewed_at: { type: "string", nullable: true, format: "date-time" },
        review_note: { type: "string", nullable: true },
        normalized_data: {},
        source_refs: {},
        review_overrides: {
            nullable: true,
            description: "Merged JSON patch layer distinct from normalized_data/source_refs.",
            type: "object",
            additionalProperties: true,
        },
        matched_core_id: { type: "string", nullable: true },
        matched_core_table: { type: "string", nullable: true },
        matched_core_data: {},
        f2_comparison: {},
        validation_warnings: {},
        validation_errors: {},
        promotion_status: { type: "string", nullable: true },
        promoted_core_id: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        geometry: {
            description: "Primary geometry for dashboards (typically matches `geom`).",
            ...geoJsonObjectSchema,
        },
        geom: {
            description: "GeoJSON from `geom` when include_geometry=true.",
            ...geoJsonObjectSchema,
        },
        centroid: {
            description: "GeoJSON centroid when include_geometry=true.",
            ...geoJsonObjectSchema,
        },
        road_candidate_road_class_id: {
            type: "string",
            nullable: true,
            description: "Road list/patch only — `import_review.road_candidates.road_class_id` as string.",
        },
        road_candidate_class_label: {
            type: "string",
            nullable: true,
            description: "Resolved `ref.ref_road_classes.code` (or legacy `road_class` text) for roads.",
        },
        road_candidate_surface: { type: "string", nullable: true },
        road_candidate_is_oneway: { type: "boolean", nullable: true },
    },
    additionalProperties: false,
} as const;

const importReviewBuildingsListResponseSchema = {
    type: "object",
    required: ["source_snapshot_version", "review_batch_id", "source_snapshot_id_local", "items", "total", "limit", "offset"],
    properties: {
        ...importReviewEnvelopeResponseProperties,
        items: {
            type: "array",
            items: importReviewBuildingItemSchema,
        },
        total: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewBuildingSortEnum = [
    "updated_at_desc",
    "updated_at_asc",
    "created_at_desc",
    "created_at_asc",
    "id_desc",
    "id_asc",
    "confidence_score_desc",
    "confidence_score_asc",
    "canonical_name_asc",
    "canonical_name_desc",
    "external_id_asc",
    "external_id_desc",
] as const;

export const getImportReviewSummarySchema = {
    tags: [Tags.ImportReview],
    summary: "Import review candidate summary",
    description:
        "Grouped counts over `import_review.*` candidates for the resolved review batch (`DATABASE_URL`, optional `IMPORT_REVIEW_DATABASE_URL` override). Supply exactly one of `source_snapshot_version` (alias: `snapshot_version`) or `review_batch_id`.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: { ...importReviewScopeQueryProperties },
        additionalProperties: false,
        description:
            "Exactly one of `source_snapshot_version` (alias `snapshot_version`) xor `review_batch_id` resolves `import_review.review_batches`.",
    },
    response: {
        200: importReviewSummaryResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getImportReviewBuildingsSchema = {
    tags: [Tags.ImportReview],
    summary: "List import-review building candidates",
    description:
        "Paged list from `import_review.building_candidates` with GeoJSON `geom`/centroid when `include_geometry=true`. Scope matches summary endpoint rules.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            ...importReviewScopeQueryProperties,
            match_status: { type: "string", minLength: 1 },
            auto_action: { type: "string", minLength: 1 },
            review_status: {
                type: "string",
                minLength: 1,
                description:
                    "Filter by review_status, or literal __unreviewed__ for NULL/empty (not in DISTINCT list from filter-options).",
            },
            review_decision: {
                type: "string",
                minLength: 1,
                description:
                    "Filter by review_decision, or literal __unreviewed__ for NULL/empty (not in DISTINCT list from filter-options).",
            },
            class_code: { type: "string", minLength: 1 },
            promotion_status: {
                type: "string",
                minLength: 1,
                description:
                    "Filter by promotion_status or literal __unreviewed__ when promotion_status IS NULL / empty.",
            },
            q: { type: "string", minLength: 1 },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
            sort: { type: "string", enum: [...importReviewBuildingSortEnum], default: "updated_at_desc" },
            include_geometry: { type: "boolean", default: true },
        },
        additionalProperties: false,
    },
    response: {
        200: importReviewBuildingsListResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const importReviewPlacesRoadsListQuerystring = {
    type: "object",
    properties: {
        ...importReviewScopeQueryProperties,
        match_status: { type: "string", minLength: 1 },
        auto_action: { type: "string", minLength: 1 },
        review_status: {
            type: "string",
            minLength: 1,
            description:
                "Filter by review_status, or literal __unreviewed__ for NULL/empty (consistent with buildings).",
        },
        review_decision: {
            type: "string",
            minLength: 1,
            description:
                "Filter by review_decision, or literal __unreviewed__ for NULL/empty (consistent with buildings).",
        },
        q: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        offset: { type: "integer", minimum: 0, default: 0 },
        sort: { type: "string", enum: [...importReviewBuildingSortEnum], default: "updated_at_desc" },
        include_geometry: { type: "boolean", default: true },
    },
    additionalProperties: false,
} as const;

export const getImportReviewPlacesSchema = {
    tags: [Tags.ImportReview],
    summary: "List import-review place candidates",
    description:
        "Paginated `import_review.place_candidates` within the resolved batch/source snapshot.",
    security: [...bearerAuth],
    querystring: importReviewPlacesRoadsListQuerystring,
    response: {
        200: importReviewBuildingsListResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getImportReviewRoadsSchema = {
    tags: [Tags.ImportReview],
    summary: "List import-review road candidates",
    description:
        "Paginated `import_review.road_candidates` within the resolved batch/source snapshot.",
    security: [...bearerAuth],
    querystring: importReviewPlacesRoadsListQuerystring,
    response: {
        200: importReviewBuildingsListResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const importReviewBuildingsFilterOptionsResponseSchema = {
    type: "object",
    required: [
        "source_snapshot_version",
        "review_batch_id",
        "source_snapshot_id_local",
        "match_status",
        "auto_action",
        "review_status",
        "review_decision",
        "class_code",
        "promotion_status",
    ],
    properties: {
        ...importReviewEnvelopeResponseProperties,
        match_status: {
            type: "array",
            items: { type: "string" },
            description: "Distinct non-null non-empty match_status values",
        },
        auto_action: { type: "array", items: { type: "string" } },
        review_status: {
            type: "array",
            items: { type: "string" },
            description: "Distinct non-null non-empty values; use __unreviewed__ on list endpoint for NULL/empty",
        },
        review_decision: {
            type: "array",
            items: { type: "string" },
            description: "Distinct non-null non-empty values; use __unreviewed__ on list endpoint for NULL/empty",
        },
        class_code: { type: "array", items: { type: "string" } },
        promotion_status: {
            type: "array",
            items: { type: "string" },
            description: "Distinct promotion_status values; filter NULL/empty with __unreviewed__.",
        },
    },
    additionalProperties: false,
} as const;

export const getImportReviewBuildingsFilterOptionsSchema = {
    tags: [Tags.ImportReview],
    summary: "Distinct building candidate filter options",
    description:
        "Read-only DISTINCT dropdown values from `import_review.building_candidates` within the resolved review scope.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: { ...importReviewScopeQueryProperties },
        additionalProperties: false,
    },
    response: {
        200: importReviewBuildingsFilterOptionsResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getImportReviewBuildingByIdSchema = {
    tags: [Tags.ImportReview],
    summary: "Get one import-review building candidate",
    description: "Returns a single candidate row with GeoJSON geometry when include_geometry=true.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    querystring: {
        type: "object",
        properties: {
            ...importReviewScopeQueryProperties,
            include_geometry: { type: "boolean", default: true },
        },
        additionalProperties: false,
    },
    response: {
        200: importReviewBuildingItemSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const patchImportReviewBuildingDecisionBodyOpenApi = {
    type: "object",
    required: ["review_decision"],
    properties: {
        ...importReviewScopeQueryProperties,
        review_decision: {
            type: "string",
            enum: ["approved", "rejected", "needs_more_review", "ignored", "merged"],
        },
        review_note: { type: "string", nullable: true },
        force: { type: "boolean", default: false },
        confirm_duplicate_reviewed: { type: "boolean", default: false },
        confirm_matched_auto_update: {
            type: "boolean",
            default: false,
            description:
                "Roads only: match_status=matched_auto_update approvals require this or force=true.",
        },
        confirm_routing_warnings: {
            type: "boolean",
            default: false,
            description:
                "Roads only: approving while validation_warnings persist requires confirm_routing_warnings=true or force=true.",
        },
    },
    additionalProperties: false,
} as const;

export const patchImportReviewBuildingDecisionSchema = {
    tags: [Tags.ImportReview],
    summary: "Set import-review building decision",
    description:
        "Updates `import_review.building_candidates` decisions (never core). Rows with promotion_status=promoted require force=true for any change; manual_protected/protect_manual and duplicate_candidate follow bulk safety rules documented in dashboards.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    body: patchImportReviewBuildingDecisionBodyOpenApi,
    response: {
        200: importReviewBuildingItemSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const patchImportReviewBuildingOverridesBodyOpenApi = {
    type: "object",
    required: ["review_overrides"],
    properties: {
        ...importReviewScopeQueryProperties,
        review_overrides: {
            type: "object",
            additionalProperties: true,
            description: "Shallow JSON patch merged server-side into import_review.building_candidates.review_overrides.",
        },
        review_note: {
            type: "string",
            nullable: true,
            description:
                "Optional candidate review_note column update merged with overrides save (does not mutate normalized_data or source_refs).",
        },
    },
    additionalProperties: false,
} as const;

export const patchImportReviewBuildingOverridesSchema = {
    tags: [Tags.ImportReview],
    summary: "Patch import_review building overrides",
    description:
        "Shallow-merge JSON into `review_overrides` plus optional audit row (`import_review.review_candidate_edits`) when migration 024 tables exist.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    body: patchImportReviewBuildingOverridesBodyOpenApi,
    response: {
        200: importReviewBuildingItemSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const patchImportReviewRoadOverridesLeafOpenApi = {
    type: "object",
    additionalProperties: false,
    properties: {
        canonical_name: {
            description: "Optional canonical label; trimmed when non-null.",
            oneOf: [{ type: "string" }, { type: "null" }],
        },
        road_class_id: {
            description: "`ref.ref_road_classes.id` as integer string/BigInt JSON; null clears FK.",
            oneOf: [{ type: "string", pattern: "^\\d+$" }, { type: "integer" }, { type: "null" }],
        },
        road_class_code: {
            description: "Lookup by `ref.ref_road_classes.code` (case-insensitive). Mutually exclusive with road_class_id.",
            oneOf: [{ type: "string", minLength: 1, maxLength: 64 }, { type: "null" }],
        },
        is_oneway: { oneOf: [{ type: "boolean" }, { type: "null" }] },
        surface: { oneOf: [{ type: "string" }, { type: "null" }] },
        geom: {
            description: "GeoJSON LineString or MultiLineString in SRID 4326 (server normalizes + validates).",
            ...geoJsonObjectSchema,
        },
    },
} as const;

const patchImportReviewRoadOverridesBodyOpenApi = {
    type: "object",
    required: ["review_overrides"],
    properties: {
        ...importReviewScopeQueryProperties,
        review_overrides: patchImportReviewRoadOverridesLeafOpenApi,
        review_note: {
            type: "string",
            nullable: true,
            description: "Required when changing one-way without an existing stored review_note (warning otherwise).",
        },
        routing_validation_tolerance_meters: {
            type: "number",
            minimum: 5,
            maximum: 250,
            default: 35,
            description: "Meters used for endpoint connectivity checks vs core streets and other road candidates.",
        },
        confirm_acknowledge_routing_warnings: {
            type: "boolean",
            default: false,
            description: "When true, persist despite non-empty routing continuity warnings returned by validation.",
        },
    },
    additionalProperties: false,
} as const;

export const patchImportReviewRoadOverridesSchema = {
    tags: [Tags.ImportReview],
    summary: "Patch import_review road overrides (routing-safe)",
    description:
        "Validates LineString/MultiLineString geometry, ref road class FK, surface text, and routing continuity warnings before merging `review_overrides` and updating typed columns on `import_review.road_candidates`.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    body: patchImportReviewRoadOverridesBodyOpenApi,
    response: {
        200: importReviewBuildingItemSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const patchImportReviewPlaceDecisionSchema = {
    tags: [Tags.ImportReview],
    summary: "Set import-review place decision",
    description:
        "Updates place candidate review columns. Same rules as buildings for manual_protected and duplicate_candidate.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    body: patchImportReviewBuildingDecisionBodyOpenApi,
    response: {
        200: importReviewBuildingItemSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const importReviewRoadRoutingValidationIssueSchema = {
    type: "object",
    required: ["code", "message", "severity"],
    properties: {
        code: { type: "string" },
        message: { type: "string" },
        severity: { type: "string", enum: ["error", "warning", "info"] },
    },
    additionalProperties: false,
} as const;

const postImportReviewRoadValidateRoutingBodyOpenApi = {
    type: "object",
    properties: {
        ...importReviewScopeQueryProperties,
        use_review_overrides: { type: "boolean", default: true },
        connectivity_threshold_m: { type: "number", minimum: 1, maximum: 250, default: 10 },
        duplicate_threshold_m: { type: "number", minimum: 1, maximum: 100, default: 5 },
        confirm_warnings: { type: "boolean", default: false },
    },
    additionalProperties: false,
} as const;

const importReviewRoadRoutingValidationResponseSchema = {
    type: "object",
    required: [
        "candidate_id",
        "validation_mode",
        "can_save",
        "can_approve",
        "errors",
        "warnings",
        "stats",
    ],
    properties: {
        candidate_id: { type: "string" },
        validation_mode: { type: "string", enum: ["existing_region", "new_region"] },
        can_save: { type: "boolean" },
        can_approve: { type: "boolean" },
        errors: { type: "array", items: importReviewRoadRoutingValidationIssueSchema },
        warnings: { type: "array", items: importReviewRoadRoutingValidationIssueSchema },
        info: { type: "array", items: importReviewRoadRoutingValidationIssueSchema },
        stats: {
            type: "object",
            required: [
                "nearby_core_roads",
                "nearby_review_roads",
                "connected_endpoints",
                "isolated_endpoints",
                "possible_duplicates",
                "possible_unsplit_intersections",
                "length_m",
            ],
            properties: {
                nearby_core_roads: { type: "integer", minimum: 0 },
                nearby_review_roads: { type: "integer", minimum: 0 },
                connected_endpoints: { type: "integer", minimum: 0 },
                isolated_endpoints: { type: "integer", minimum: 0 },
                possible_duplicates: { type: "integer", minimum: 0 },
                possible_unsplit_intersections: { type: "integer", minimum: 0 },
                length_m: { type: "number", minimum: 0 },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

export const postImportReviewRoadValidateRoutingSchema = {
    tags: [Tags.ImportReview],
    summary: "Validate import-review road for routing",
    description:
        "Runs geometry, attribute, connectivity, duplicate, and promotion-readiness checks. Persists validation_errors / validation_warnings on import_review.road_candidates only (no core promotion).",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    body: postImportReviewRoadValidateRoutingBodyOpenApi,
    response: {
        200: importReviewRoadRoutingValidationResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const patchImportReviewRoadDecisionSchema = {
    tags: [Tags.ImportReview],
    summary: "Set import-review road decision",
    description:
        "Updates road candidate review columns. manual_protected and duplicate_candidate follow building rules. match_status=matched_auto_update approve requires confirm_matched_auto_update=true or force=true.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    body: patchImportReviewBuildingDecisionBodyOpenApi,
    response: {
        200: importReviewBuildingItemSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const importReviewBulkDecisionResponseSchema = {
    type: "object",
    required: [
        "source_snapshot_version",
        "review_batch_id",
        "source_snapshot_id_local",
        "updated_count",
        "skipped_count",
        "skipped_reasons",
        "dry_run",
    ],
    properties: {
        ...importReviewEnvelopeResponseProperties,
        updated_count: { type: "integer", minimum: 0 },
        skipped_count: { type: "integer", minimum: 0 },
        skipped_reasons: {
            type: "array",
            items: {
                type: "object",
                required: ["reason", "count"],
                properties: {
                    reason: { type: "string" },
                    count: { type: "integer", minimum: 0 },
                },
                additionalProperties: false,
            },
        },
        dry_run: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const postBulkImportReviewBuildingDecisionBodyOpenApi = {
    type: "object",
    required: ["review_decision"],
    properties: {
        ...importReviewScopeQueryProperties,
        review_decision: {
            type: "string",
            enum: ["approved", "rejected", "needs_more_review", "ignored", "merged"],
        },
        review_note: { type: "string", nullable: true },
        force: { type: "boolean", default: false },
        dry_run: { type: "boolean", default: false },
        ids: {
            type: "array",
            items: { oneOf: [{ type: "integer", minimum: 0 }, { type: "string", pattern: "^\\d+$" }] },
            maxItems: 10_000,
        },
        filters: {
            type: "object",
            properties: {
                match_status: { type: "string" },
                auto_action: { type: "string" },
                review_decision: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

export const postBulkImportReviewBuildingDecisionSchema = {
    tags: [Tags.ImportReview],
    summary: "Bulk import-review building decisions",
    description:
        "Bulk updates building candidates in one transaction (or dry_run for counts). Mode A: ids. Mode B: filters. Uses DATABASE_URL.",
    security: [...bearerAuth],
    body: postBulkImportReviewBuildingDecisionBodyOpenApi,
    response: {
        200: importReviewBulkDecisionResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const postBulkImportReviewPlacesDecisionSchema = {
    tags: [Tags.ImportReview],
    summary: "Bulk import-review place decisions",
    description: "Bulk updates place candidates (or dry_run). Same scope rules as buildings.",
    security: [...bearerAuth],
    body: postBulkImportReviewBuildingDecisionBodyOpenApi,
    response: {
        200: importReviewBulkDecisionResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const postBulkImportReviewRoadsDecisionSchema = {
    tags: [Tags.ImportReview],
    summary: "Bulk import-review road decisions",
    description: "Bulk updates road candidates (or dry_run). Same scope rules as buildings.",
    security: [...bearerAuth],
    body: postBulkImportReviewBuildingDecisionBodyOpenApi,
    response: {
        200: importReviewBulkDecisionResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const importReviewPromotionReadyResponseSchema = {
    type: "object",
    required: [
        "entity_family",
        "review_batch_id",
        "source_snapshot_version",
        "ready_count",
        "already_batched_count",
        "promoted_count",
        "blocked_in_active_publish_batch_count",
    ],
    properties: {
        entity_family: { type: "string", enum: ["buildings"] },
        review_batch_id: { type: "string" },
        source_snapshot_version: { type: "string" },
        ready_count: { type: "integer", minimum: 0 },
        already_batched_count: { type: "integer", minimum: 0 },
        promoted_count: { type: "integer", minimum: 0 },
        blocked_in_active_publish_batch_count: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewPublishBatchSummarySchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "batch_name",
        "status",
        "total_item_count",
        "success_count",
        "failed_count",
        "skipped_count",
        "created_at",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string" },
        batch_name: { type: "string" },
        status: { type: "string" },
        source_review_batch_id: { type: "string", nullable: true },
        source_snapshot_version: { type: "string", nullable: true },
        region_code: { type: "string", nullable: true },
        total_item_count: { type: "integer", minimum: 0 },
        success_count: { type: "integer", minimum: 0 },
        failed_count: { type: "integer", minimum: 0 },
        skipped_count: { type: "integer", minimum: 0 },
        note: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
        published_at: { type: "string", format: "date-time", nullable: true },
        promoted_at: { type: "string", format: "date-time", nullable: true },
    },
    additionalProperties: false,
} as const;

const publishItemCountsSchema = {
    type: "object",
    required: ["pending", "success", "failed", "skipped", "rolled_back", "total"],
    properties: {
        pending: { type: "integer", minimum: 0 },
        success: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
        skipped: { type: "integer", minimum: 0 },
        rolled_back: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewPublishBatchDetailSchema = {
    type: "object",
    allOf: [
        importReviewPublishBatchSummarySchema,
        {
            type: "object",
            required: ["item_counts", "building_item_counts"],
            properties: {
                item_counts: publishItemCountsSchema,
                building_item_counts: publishItemCountsSchema,
            },
            additionalProperties: false,
        },
    ],
} as const;

const importReviewPromotionScopeQueryOpenApi = {
    type: "object",
    properties: {
        ...importReviewScopeQueryProperties,
        include_merged: {
            type: "boolean",
            description:
                "When true, include approved duplicate_candidate rows with review_decision=merged.",
        },
    },
} as const;

export const getImportReviewPromotionReadySchema = {
    tags: [Tags.ImportReview],
    summary: "Count building candidates ready for publish batching",
    description:
        "Server-side readiness counts for approved import_review.building_candidates. No core writes.",
    security: [...bearerAuth],
    querystring: importReviewPromotionScopeQueryOpenApi,
    response: {
        200: importReviewPromotionReadyResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const importReviewPromotionReadyCandidateSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "validation_warnings_count",
        "validation_errors_count",
        "updated_at",
        "source_snapshot_version",
        "review_batch_id",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string" },
        external_id: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        canonical_name: { type: "string", nullable: true },
        class_code: { type: "string", nullable: true },
        building_type: { type: "string", nullable: true },
        building_type_id: { type: "string", nullable: true },
        confidence_score: { type: "number", nullable: true },
        match_status: { type: "string", nullable: true },
        auto_action: { type: "string", nullable: true },
        review_status: { type: "string", nullable: true },
        review_decision: { type: "string", nullable: true },
        promotion_status: { type: "string", nullable: true },
        validation_warnings_count: { type: "integer", minimum: 0 },
        validation_errors_count: { type: "integer", minimum: 0 },
        updated_at: { type: "string", format: "date-time" },
        source_snapshot_version: { type: "string" },
        review_batch_id: { type: "string" },
        normalized_data: {},
        review_overrides: {},
        source_refs: {},
        geometry: { type: "object", nullable: true, additionalProperties: true },
    },
    additionalProperties: false,
} as const;

export const getImportReviewPromotionReadyCandidatesSchema = {
    tags: [Tags.ImportReview],
    summary: "List building candidates ready for publish batch preview",
    description:
        "Paginated preview of approved building candidates eligible for publish batching. No core writes.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            ...importReviewPromotionScopeQueryOpenApi.properties,
            entity_family: { type: "string", enum: ["buildings"], default: "buildings" },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
            sort: {
                type: "string",
                enum: ["updated_at_desc", "updated_at_asc", "confidence_score_desc", "name_asc"],
                default: "updated_at_desc",
            },
            include_geometry: { type: "boolean", default: false },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset", "counts"],
            properties: {
                items: { type: "array", items: importReviewPromotionReadyCandidateSchema },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
                counts: {
                    type: "object",
                    required: ["ready", "already_batched", "promoted", "blocked_active_batch"],
                    properties: {
                        ready: { type: "integer", minimum: 0 },
                        already_batched: { type: "integer", minimum: 0 },
                        promoted: { type: "integer", minimum: 0 },
                        blocked_active_batch: { type: "integer", minimum: 0 },
                    },
                    additionalProperties: false,
                },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPromotionBatchesSchema = {
    tags: [Tags.ImportReview],
    summary: "List publish batches for a review scope",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            ...importReviewPromotionScopeQueryOpenApi.properties,
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: importReviewPublishBatchSummarySchema },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPromotionBatchByIdSchema = {
    tags: [Tags.ImportReview],
    summary: "Get one publish batch with item counts",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: importReviewPublishBatchDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchSchema = {
    tags: [Tags.ImportReview],
    summary: "Create publish batch from approved building candidates",
    description:
        "Transactional: inserts system.system_publish_batches + system.system_publish_items, marks building_candidates promotion_status=batched. No core promotion.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["batch_name"],
        properties: {
            ...importReviewScopeQueryProperties,
            batch_name: { type: "string", minLength: 1, maxLength: 200 },
            note: { type: "string", maxLength: 4000 },
            include_merged: { type: "boolean", default: false },
        },
    },
    response: {
        201: {
            type: "object",
            required: ["message", "batch", "items_added", "building_candidates_marked_batched"],
            properties: {
                message: { type: "string" },
                batch: importReviewPublishBatchDetailSchema,
                items_added: { type: "integer", minimum: 0 },
                building_candidates_marked_batched: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const importReviewPublishBatchValidationResultSchema = {
    type: "object",
    required: [
        "outcome",
        "valid_count",
        "warning_count",
        "blocked_count",
        "total_items",
        "by_publish_action",
        "entity_family",
    ],
    properties: {
        outcome: { type: "string", enum: ["passed", "blocked"] },
        valid_count: { type: "integer", minimum: 0 },
        warning_count: { type: "integer", minimum: 0 },
        blocked_count: { type: "integer", minimum: 0 },
        total_items: { type: "integer", minimum: 0 },
        by_publish_action: {
            type: "object",
            required: ["insert", "update", "merge"],
            properties: {
                insert: { type: "integer", minimum: 0 },
                update: { type: "integer", minimum: 0 },
                merge: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        entity_family: {
            type: "object",
            required: ["buildings"],
            properties: { buildings: { type: "integer", minimum: 0 } },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

const importReviewPublishStageLogItemSchema = {
    type: "object",
    required: [
        "id",
        "stage_key",
        "stage_label",
        "stage_status",
        "progress_percent",
        "started_at",
    ],
    properties: {
        id: { type: "string" },
        stage_key: { type: "string" },
        stage_label: { type: "string" },
        stage_status: { type: "string" },
        message: { type: "string", nullable: true },
        progress_percent: { type: "number", minimum: 0, maximum: 100 },
        details: {},
        started_at: { type: "string", format: "date-time" },
        finished_at: { type: "string", format: "date-time", nullable: true },
    },
    additionalProperties: false,
} as const;

export const postImportReviewPromotionBatchValidateSchema = {
    tags: [Tags.ImportReview],
    summary: "Start publish batch dry-run validation (buildings)",
    description:
        "Validates all publish items without writing to core. Returns 202 immediately; poll progress and logs endpoints.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        202: {
            type: "object",
            required: ["batch_id", "status", "message"],
            properties: {
                batch_id: { type: "string" },
                status: { type: "string" },
                message: { type: "string" },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

const importReviewPublishBatchPromotionResultSchema = {
    type: "object",
    required: [
        "status",
        "inserted_count",
        "updated_count",
        "success_count",
        "failed_count",
        "skipped_count",
        "total",
        "core_verified_count",
        "import_review_marked_promoted_count",
        "started_at",
        "finished_at",
        "duration_ms",
        "promoted_entity_families",
    ],
    properties: {
        status: { type: "string", enum: ["promoted", "failed"] },
        inserted_count: { type: "integer", minimum: 0 },
        updated_count: { type: "integer", minimum: 0 },
        success_count: { type: "integer", minimum: 0 },
        failed_count: { type: "integer", minimum: 0 },
        skipped_count: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 0 },
        core_verified_count: { type: "integer", minimum: 0 },
        import_review_marked_promoted_count: { type: "integer", minimum: 0 },
        partial_success: { type: "boolean" },
        started_at: { type: "string", format: "date-time" },
        finished_at: { type: "string", format: "date-time" },
        duration_ms: { type: "integer", minimum: 0 },
        promoted_entity_families: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
} as const;

export const getImportReviewPromotionBatchProgressSchema = {
    tags: [Tags.ImportReview],
    summary: "Get publish batch validation or promotion progress",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: {
            type: "object",
            required: [
                "batch_id",
                "status",
                "workflow",
                "validation_total",
                "validation_done",
                "validation_percent",
                "validated_at",
                "current_stage_key",
                "current_stage_label",
                "current_stage_status",
                "current_message",
                "validation_result",
                "validation_logs_summary",
                "promotion_result",
                "promotion_logs_summary",
            ],
            properties: {
                batch_id: { type: "string" },
                status: { type: "string" },
                workflow: { type: "string", enum: ["validation", "promotion", "idle"] },
                validation_total: { type: "integer", minimum: 0 },
                validation_done: { type: "integer", minimum: 0 },
                validation_percent: { type: "number", minimum: 0, maximum: 100 },
                validated_at: { type: "string", format: "date-time", nullable: true },
                current_stage_key: { type: "string", nullable: true },
                current_stage_label: { type: "string", nullable: true },
                current_stage_status: { type: "string", nullable: true },
                current_message: { type: "string", nullable: true },
                validation_result: {
                    ...importReviewPublishBatchValidationResultSchema,
                    nullable: true,
                },
                validation_logs_summary: { type: "string", nullable: true },
                promotion_result: {
                    ...importReviewPublishBatchPromotionResultSchema,
                    nullable: true,
                },
                promotion_logs_summary: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchPromoteSchema = {
    tags: [Tags.ImportReview],
    summary: "Promote validated publish batch to core (buildings)",
    description:
        "Writes approved building candidates to core.core_map_buildings. Returns 202 immediately; poll progress and logs endpoints.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        required: ["confirmation_text"],
        properties: {
            confirmation_text: { type: "string", enum: ["PROMOTE"] },
            chunk_size: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        },
    },
    response: {
        202: {
            type: "object",
            required: ["batch_id", "status", "message"],
            properties: {
                batch_id: { type: "string" },
                status: { type: "string" },
                message: { type: "string" },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPromotionBatchVerifySchema = {
    tags: [Tags.ImportReview],
    summary: "Verify publish batch promotion results",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: {
            type: "object",
            required: [
                "batch_id",
                "verification_status",
                "publish_items",
                "core_rows_missing",
                "core_rows_inactive",
                "candidates_promoted_missing_core_id",
                "lineage_warnings",
                "geometry_warnings",
                "issues",
            ],
            properties: {
                batch_id: { type: "string" },
                verification_status: { type: "string", enum: ["passed", "warning", "failed"] },
                publish_items: {
                    type: "object",
                    required: ["success", "failed", "pending", "skipped", "success_missing_target_id"],
                    properties: {
                        success: { type: "integer", minimum: 0 },
                        failed: { type: "integer", minimum: 0 },
                        pending: { type: "integer", minimum: 0 },
                        skipped: { type: "integer", minimum: 0 },
                        success_missing_target_id: { type: "integer", minimum: 0 },
                    },
                },
                core_rows_missing: { type: "integer", minimum: 0 },
                core_rows_inactive: { type: "integer", minimum: 0 },
                candidates_promoted_missing_core_id: { type: "integer", minimum: 0 },
                lineage_warnings: { type: "integer", minimum: 0 },
                geometry_warnings: { type: "integer", minimum: 0 },
                issues: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["code", "message", "severity"],
                        properties: {
                            code: { type: "string" },
                            message: { type: "string" },
                            severity: { type: "string", enum: ["error", "warning"] },
                        },
                    },
                },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPromotionBatchLogsSchema = {
    tags: [Tags.ImportReview],
    summary: "List publish batch validation or promotion stage logs",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: {
            type: "object",
            required: ["batch_id", "items"],
            properties: {
                batch_id: { type: "string" },
                items: { type: "array", items: importReviewPublishStageLogItemSchema },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;
