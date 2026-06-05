import type { FastifySchema } from "fastify";

import { apiErrorResponseSchema } from "../../lib/api-error-response.js";
import { IMPORT_REVIEW_ENTITY_FAMILIES } from "./import-review-config.js";
import {
    Tags,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";

/** Standard import-review API error envelope for 4xx/5xx handled by `sendImportReviewError`. */
export const importReviewApiErrorResponseSchema = apiErrorResponseSchema;

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
    latest: {
        type: "boolean",
        default: false,
        description:
            "When multiple non-archived batches share source_snapshot_version, select the newest by uploaded_at (requires snapshot scope).",
    },
} as const;

const importReviewBatchChoiceSchema = {
    type: "object",
    required: [
        "id",
        "batch_name",
        "source_snapshot_version",
        "status",
        "uploaded_at",
        "created_at",
        "updated_at",
        "total_candidate_count",
        "entity_families",
    ],
    properties: {
        id: { type: "string" },
        batch_name: { type: "string" },
        source_snapshot_version: { type: "string" },
        status: { type: "string" },
        uploaded_at: { type: "string", format: "date-time" },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        total_candidate_count: { type: "integer", minimum: 0 },
        entity_families: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
} as const;

export const importReviewMultipleBatchesErrorResponseSchema = {
    type: "object",
    required: ["ok", "error", "message", "source_snapshot_version", "batches"],
    properties: {
        ok: { type: "boolean", const: false },
        error: { type: "string", const: "MULTIPLE_REVIEW_BATCHES" },
        message: { type: "string" },
        source_snapshot_version: { type: "string" },
        batches: { type: "array", items: importReviewBatchChoiceSchema },
    },
    additionalProperties: false,
} as const;

/** Scope ambiguity (409) or standard API error envelope. */
export const importReview409ResponseSchema = {
    anyOf: [importReviewApiErrorResponseSchema, importReviewMultipleBatchesErrorResponseSchema],
} as const;

const importReviewBatchesListResponseSchema = {
    type: "object",
    required: ["source_snapshot_version", "batches"],
    properties: {
        source_snapshot_version: { type: "string" },
        batches: { type: "array", items: importReviewBatchChoiceSchema },
    },
    additionalProperties: false,
} as const;

export const getImportReviewBatchesSchema = {
    tags: [Tags.ImportReview],
    summary: "List import-review batches for a snapshot",
    description:
        "Lightweight list of non-archived `import_review.review_batches` rows for a source_snapshot_version, newest first. No geometry or large JSONB fields.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        required: ["source_snapshot_version"],
        properties: {
            source_snapshot_version: importReviewScopeQueryProperties.source_snapshot_version,
            snapshot_version: importReviewScopeQueryProperties.snapshot_version,
        },
        additionalProperties: false,
    },
    response: {
        200: importReviewBatchesListResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

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
    batch_name: {
        type: "string",
        nullable: true,
        description: "Resolved import_review.review_batches.batch_name.",
    },
    selected_by: {
        type: "string",
        nullable: true,
        enum: ["review_batch_id", "source_snapshot_version_unique", "source_snapshot_version_latest"],
        description: "How the review batch was resolved from the request scope.",
    },
    status: { type: "string", nullable: true },
    uploaded_at: { type: "string", format: "date-time", nullable: true },
    total_candidate_count: { type: "integer", nullable: true },
    entity_families: { type: "array", items: { type: "string" }, nullable: true },
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

const importReviewFamilySummarySchema = {
    type: "object",
    required: [
        "entity_family",
        "table_name",
        "batch_total",
        "active",
        "pending_review",
        "approved",
        "rejected",
        "needs_review",
        "ignored",
        "merged",
        "ready_for_publish",
        "promoted",
        "promotion_failed",
        "validation_error_count",
        "validation_warning_count",
    ],
    properties: {
        entity_family: { type: "string" },
        table_name: { type: "string" },
        batch_total: { type: "integer", minimum: 0 },
        active: { type: "integer", minimum: 0 },
        pending_review: { type: "integer", minimum: 0 },
        approved: { type: "integer", minimum: 0 },
        rejected: { type: "integer", minimum: 0 },
        needs_review: { type: "integer", minimum: 0 },
        ignored: { type: "integer", minimum: 0 },
        merged: { type: "integer", minimum: 0 },
        ready_for_publish: { type: "integer", minimum: 0 },
        promoted: { type: "integer", minimum: 0 },
        promotion_failed: { type: "integer", minimum: 0 },
        validation_error_count: { type: "integer", minimum: 0 },
        validation_warning_count: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewSummaryRollupSchema = {
    type: "object",
    required: [
        "batch_total_candidates",
        "active_candidates",
        "pending_review_candidates",
        "approved_candidates",
        "rejected_candidates",
        "needs_review_candidates",
        "ignored_candidates",
        "merged_candidates",
        "ready_for_publish_candidates",
        "promoted_candidates",
        "promotion_failed_candidates",
    ],
    properties: {
        batch_total_candidates: { type: "integer", minimum: 0 },
        active_candidates: { type: "integer", minimum: 0 },
        pending_review_candidates: { type: "integer", minimum: 0 },
        approved_candidates: { type: "integer", minimum: 0 },
        rejected_candidates: { type: "integer", minimum: 0 },
        needs_review_candidates: { type: "integer", minimum: 0 },
        ignored_candidates: { type: "integer", minimum: 0 },
        merged_candidates: { type: "integer", minimum: 0 },
        ready_for_publish_candidates: { type: "integer", minimum: 0 },
        promoted_candidates: { type: "integer", minimum: 0 },
        promotion_failed_candidates: { type: "integer", minimum: 0 },
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
        "family_summaries",
        "rollup",
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
        family_summaries: {
            type: "array",
            items: importReviewFamilySummarySchema,
            description: "Per-family counts; sums equal `rollup` fields.",
        },
        rollup: {
            ...importReviewSummaryRollupSchema,
            description: "Batch-wide totals scoped to the resolved review_batch_id.",
        },
        warnings: {
            type: "array",
            items: { type: "string" },
            description: "Non-fatal gaps (e.g. optional candidate tables missing on remote DB).",
        },
        total_pending_review_count: {
            type: "integer",
            minimum: 0,
            description: "Deprecated alias for rollup.pending_review_candidates.",
        },
        total_approved_count: {
            type: "integer",
            minimum: 0,
            description: "Deprecated alias for rollup.approved_candidates.",
        },
        total_rejected_count: {
            type: "integer",
            minimum: 0,
            description: "Deprecated alias for rollup.rejected_candidates.",
        },
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
        building_type: {
            type: "string",
            nullable: true,
            description: "Legacy imported staging text only; not used for edits. Prefer building_type_code/name from ref join.",
        },
        building_type_id: { type: "string", nullable: true },
        building_type_code: { type: "string", nullable: true },
        building_type_name: { type: "string", nullable: true },
        landuse_class_id: {
            type: "string",
            nullable: true,
            description: "Landuse list/patch only — effective ref.ref_landuse_classes id.",
        },
        landuse_class_code: { type: "string", nullable: true },
        landuse_class_name: { type: "string", nullable: true },
        landuse_class_name_mm: { type: "string", nullable: true },
        category_id: {
            type: "string",
            nullable: true,
            description:
                "Places: typed POI category FK (import_review.place_candidates.category_id → ref.ref_poi_categories.id).",
        },
        primary_name: {
            type: "string",
            nullable: true,
            description: "Places: typed primary_name column.",
        },
        display_name: {
            type: "string",
            nullable: true,
            description: "Places: typed display_name column.",
        },
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
        road_class_id: {
            type: "string",
            nullable: true,
            description: "Road list/patch — same as road_candidate_road_class_id.",
        },
        road_class: {
            type: "string",
            nullable: true,
            description: "Road list/patch — reviewed `import_review.road_candidates.road_class` text.",
        },
        road_class_name: {
            type: "string",
            nullable: true,
            description: "Road list/patch — `ref.ref_road_classes.name` for road_class_id.",
        },
        road_class_label: {
            type: "string",
            nullable: true,
            description:
                "Road list/patch — display label: COALESCE(ref name, ref code, road_class column).",
        },
        road_candidate_class_label: {
            type: "string",
            nullable: true,
            description: "Resolved `ref.ref_road_classes.code` (or legacy `road_class` text) for roads.",
        },
        road_candidate_surface: { type: "string", nullable: true },
        road_candidate_is_oneway: { type: "boolean", nullable: true },
        length_m: {
            type: "number",
            nullable: true,
            description:
                "Road candidates only — meters along effective centerline (typed geom column when set, else geom), rounded to 2 decimals.",
        },
        effective_name: {
            type: "string",
            nullable: true,
            description: "Primary display name (English when available, else Myanmar).",
        },
        name_mm: {
            type: "string",
            nullable: true,
            description:
                "Reviewer-facing Myanmar name from name_mm column or imported Myanmar sources (tags, normalized_data).",
        },
        name_en: {
            type: "string",
            nullable: true,
            description:
                "Reviewer-facing English name from name_en column or imported English sources (tags, normalized_data).",
        },
        effective_name_mm: {
            type: "string",
            nullable: true,
            description: "Myanmar label from name_mm column or imported Myanmar sources.",
        },
        effective_name_en: {
            type: "string",
            nullable: true,
            description: "English label from name_en column or imported English sources.",
        },
        effective_name_und: {
            type: "string",
            nullable: true,
            description: "Undetermined-language label from tags.name when not mapped to en/mm.",
        },
        effective_name_local: {
            type: "string",
            nullable: true,
            description: "Deprecated alias of effective_name_mm.",
        },
        effective_stop_code: { type: "string", nullable: true },
        effective_canonical_name: { type: "string", nullable: true },
        effective_class_code: { type: "string", nullable: true },
        effective_landuse_class_id: { type: "string", nullable: true },
        effective_admin_area_id: { type: "string", nullable: true },
        effective_admin_area_name: { type: "string", nullable: true },
        admin_area_name: {
            type: "string",
            nullable: true,
            description: "Roads: resolved admin area label (override id join or geometry inference).",
        },
        effective_levels: { type: "integer", nullable: true },
        effective_height_m: { type: "number", nullable: true },
        effective_full_address: {
            type: "string",
            nullable: true,
            description: "Addresses: alias of display_full_address (generated from components).",
        },
        effective_house_number: { type: "string", nullable: true },
        effective_street_name: { type: "string", nullable: true },
        effective_quarter: { type: "string", nullable: true },
        effective_township: { type: "string", nullable: true },
        generated_full_address_en: {
            type: "string",
            nullable: true,
            description: "Addresses: readonly composed English full address from address_components.",
        },
        generated_full_address_my: {
            type: "string",
            nullable: true,
            description: "Addresses: readonly composed Myanmar full address from address_components.",
        },
        display_full_address: {
            type: "string",
            nullable: true,
            description: "Addresses: preferred display full address (en-first by default).",
        },
        source_entity_type: { type: "string", nullable: true },
        source_classification: { type: "string", nullable: true },
        has_place_evidence: { type: "boolean" },
        has_address_evidence: { type: "boolean" },
        address_strength: { type: "string", nullable: true },
        place_candidate_status: { type: "string", nullable: true },
        linked_place_candidate_id: { type: "string", nullable: true },
        matched_core_place_id: { type: "string", nullable: true },
        classification_reasons: {
            type: "array",
            nullable: true,
            items: {},
        },
        source_name: {
            type: "string",
            nullable: true,
            description: "Addresses: OSM source_tags name (place context, not address component).",
        },
        source_type_hint: {
            type: "string",
            nullable: true,
            description: "Addresses: first amenity/shop/tourism/etc. from source_tags.",
        },
        source_context: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            description: "Addresses detail: derived OSM source/place evidence.",
        },
        linked_place_candidate: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            description: "Addresses detail: linked import_review.place_candidates summary.",
        },
        matched_core_place: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            description: "Addresses detail: matched core.core_places summary.",
        },
        place_address_link: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            description: "Addresses detail: import_review.place_address_links summary.",
        },
        map_preview_layers: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            description: "Addresses detail: GeoJSON layers for map preview when include_geometry=true.",
        },
        validation_status: { type: "string", nullable: true },
        promotion_blockers: { type: "array", items: { type: "object" }, nullable: true },
        promotion_warnings: { type: "array", items: { type: "object" }, nullable: true },
        house_number: { type: "string", nullable: true, description: "Addresses: from components." },
        street: { type: "string", nullable: true, description: "Addresses: street/road from components." },
        locality: {
            type: "string",
            nullable: true,
            description: "Addresses: township/village/quarter display from components.",
        },
        city: { type: "string", nullable: true, description: "Addresses: city from components." },
        address_components: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            description: "Addresses detail: grouped by component_type_code then language_code.",
        },
        address_components_flat: {
            type: "array",
            nullable: true,
            items: { type: "object", additionalProperties: true },
        },
        components_by_type: {
            type: "object",
            nullable: true,
            additionalProperties: true,
        },
        composition_warnings: {
            type: "array",
            items: { type: "string" },
            nullable: true,
        },
        source_tags: { type: "object", nullable: true, additionalProperties: true },
        matched_admin_area_id: { type: "string", nullable: true },
        matched_street_id: { type: "string", nullable: true },
        matched_building_id: { type: "string", nullable: true },
        matched_place_id: { type: "string", nullable: true },
        admin_match_type: { type: "string", nullable: true },
        street_match_type: { type: "string", nullable: true },
        admin_match_confidence: { type: "number", nullable: true },
        street_match_confidence: { type: "number", nullable: true },
        promoted_core_address_id: { type: "string", nullable: true },
        validated_at: { type: "string", nullable: true, format: "date-time" },
        entrance_geometry: { type: "object", nullable: true, additionalProperties: true },
        effective_admin_level_id: { type: "string", nullable: true },
        effective_parent_id: { type: "string", nullable: true },
        effective_slug: { type: "string", nullable: true },
        barrier_type: {
            type: "string",
            nullable: true,
            description: "Routing barriers: typed barrier_type column.",
        },
        effective_barrier_type: { type: "string", nullable: true },
        has_overrides: {
            type: "boolean",
            description: "True when at least one typed edit column is set on the candidate.",
        },
        overridden_fields: {
            type: "array",
            items: { type: "string" },
            description: "Typed column keys with non-null values on the candidate.",
        },
    },
    additionalProperties: false,
} as const;

const importReviewBuildingsListResponseSchema = {
    type: "object",
    required: [
        "source_snapshot_version",
        "review_batch_id",
        "source_snapshot_id_local",
        "items",
        "has_more",
        "limit",
        "offset",
    ],
    properties: {
        ...importReviewEnvelopeResponseProperties,
        items: {
            type: "array",
            items: importReviewBuildingItemSchema,
        },
        total: {
            type: "integer",
            minimum: 0,
            description: "Exact COUNT(*) when include_total=true; omitted on later pages when include_total=false.",
        },
        has_more: {
            type: "boolean",
            description: "True when another page exists (LIMIT+1 probe).",
        },
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
        "Grouped counts over `import_review.*` candidates for the resolved review batch (`DATABASE_URL`, optional `IMPORT_REVIEW_DATABASE_URL` override). Supply exactly one of `source_snapshot_version` (alias: `snapshot_version`) or `review_batch_id`. When both are sent, `review_batch_id` is preferred.",
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
            include_geometry: { type: "boolean", default: false },
            include_total: {
                type: "boolean",
                default: true,
                description: "When false, skips COUNT(*) (use has_more; cache total from offset=0).",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: importReviewBuildingsListResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        include_geometry: { type: "boolean", default: false },
        include_total: {
            type: "boolean",
            default: true,
            description: "When false, skips COUNT(*) (use has_more; cache total from offset=0).",
        },
    },
    additionalProperties: false,
} as const;

const importReviewRoadsListQuerystring = {
    type: "object",
    properties: {
        ...importReviewPlacesRoadsListQuerystring.properties,
        promotion_status: {
            type: "string",
            minLength: 1,
            description: "Filter by promotion_status, or __unreviewed__ for NULL/empty.",
        },
        class_code: { type: "string", minLength: 1 },
        include_promoted: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

export const getImportReviewRoadDryRunSummarySchema = {
    tags: [Tags.ImportReview],
    summary: "Road dry-run summary for a review batch",
    description:
        "Returns the latest publish-batch road dry-run result indexed by review_candidate_id for the scoped review batch.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: { ...importReviewScopeQueryProperties },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPlacesSchema = {
    tags: [Tags.ImportReview],
    summary: "List import-review place candidates",
    description:
        "Paginated `import_review.place_candidates` within the resolved batch/source snapshot.",
    security: [...bearerAuth],
    querystring: importReviewPlacesRoadsListQuerystring,
    response: {
        200: importReviewBuildingsListResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewRoadsSchema = {
    tags: [Tags.ImportReview],
    summary: "List import-review road candidates",
    description:
        "Paginated `import_review.road_candidates` within the resolved batch/source snapshot.",
    security: [...bearerAuth],
    querystring: importReviewRoadsListQuerystring,
    response: {
        200: importReviewBuildingsListResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
                "Roads only: deprecated — persisted routing validation_warnings do not block approval.",
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewReviewOverridesPrimitiveOpenApi = {
    anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "integer" },
        { type: "boolean" },
        { type: "null" },
    ],
} as const;

const importReviewReviewOverridesPatchOpenApi = {
    type: "object",
    description:
        "Shallow field patch for typed columns. Use name_mm (Myanmar) and name_en (English). null clears a column; {} is a no-op.",
    additionalProperties: importReviewReviewOverridesPrimitiveOpenApi,
} as const;

const importReviewRoadReviewOverridesPatchOpenApi = {
    type: "object",
    description:
        "Shallow field patch for road typed columns. null clears a column; {} is a no-op.",
    additionalProperties: {
        anyOf: [
            ...importReviewReviewOverridesPrimitiveOpenApi.anyOf,
            { type: "object", additionalProperties: true },
        ],
    },
} as const;

const patchImportReviewCandidateOverridesBodyOpenApi = {
    type: "object",
    required: ["fields"],
    properties: {
        ...importReviewScopeQueryProperties,
        fields: importReviewReviewOverridesPatchOpenApi,
        review_note: {
            type: "string",
            nullable: true,
            description:
                "Optional candidate review_note column update merged with overrides save (does not mutate normalized_data or source_refs).",
        },
    },
    additionalProperties: false,
} as const;

const patchImportReviewBuildingOverridesBodyOpenApi = {
    type: "object",
    required: ["fields"],
    properties: {
        ...importReviewScopeQueryProperties,
        fields: importReviewReviewOverridesPatchOpenApi,
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
        "Deprecated shim — writes typed columns via `fields` plus optional audit row (`import_review.review_candidate_edits`).",
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const patchImportReviewRoadOverridesBodyOpenApi = {
    type: "object",
    required: ["fields"],
    properties: {
        ...importReviewScopeQueryProperties,
        fields: importReviewRoadReviewOverridesPatchOpenApi,
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
            description:
                "Deprecated — routing continuity warnings are informational; saves proceed without this flag.",
        },
    },
    additionalProperties: false,
} as const;

export const patchImportReviewRoadOverridesSchema = {
    tags: [Tags.ImportReview],
    summary: "Patch import_review road overrides (routing-safe)",
    description:
        "Validates LineString/MultiLineString geometry, ref road class FK, surface text, and routing continuity warnings before updating typed columns on `import_review.road_candidates`.",
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewBulkDecisionResponseSchema = {
    type: "object",
    required: [
        "source_snapshot_version",
        "review_batch_id",
        "source_snapshot_id_local",
        "success",
        "updated_count",
        "skipped_count",
        "skipped_reasons",
        "dry_run",
    ],
    properties: {
        ...importReviewEnvelopeResponseProperties,
        success: { type: "boolean" },
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
        updated_ids: {
            type: "array",
            items: { type: "integer", minimum: 0 },
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
        review_status: {
            type: "string",
            enum: ["approved", "rejected", "needs_review", "ignored", "merged"],
        },
        review_note: { type: "string", nullable: true },
        force: { type: "boolean", default: false },
        force_approval: { type: "boolean", default: false },
        dry_run: { type: "boolean", default: false },
        ids: {
            type: "array",
            items: { type: "integer", minimum: 0 },
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        "derived_status",
        "total_item_count",
        "success_count",
        "failed_count",
        "skipped_count",
        "core_verified_count",
        "import_review_marked_promoted_count",
        "inserted_count",
        "updated_count",
        "created_at",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string" },
        batch_name: { type: "string" },
        status: { type: "string" },
        derived_status: { type: "string" },
        derived_status_reason: { type: "string", nullable: true },
        stored_status_recommendation: { type: "string", nullable: true },
        status_note: { type: "string", nullable: true },
        source_review_batch_id: { type: "string", nullable: true },
        source_snapshot_version: { type: "string", nullable: true },
        region_code: { type: "string", nullable: true },
        total_item_count: { type: "integer", minimum: 0 },
        success_count: { type: "integer", minimum: 0 },
        failed_count: { type: "integer", minimum: 0 },
        skipped_count: { type: "integer", minimum: 0 },
        core_verified_count: { type: "integer", minimum: 0 },
        import_review_marked_promoted_count: { type: "integer", minimum: 0 },
        inserted_count: { type: "integer", minimum: 0 },
        updated_count: { type: "integer", minimum: 0 },
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

const publishEntityItemCountsSchema = {
    type: "object",
    required: ["pending", "success", "failed", "skipped", "total"],
    properties: {
        pending: { type: "integer", minimum: 0 },
        success: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
        skipped: { type: "integer", minimum: 0 },
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
            required: ["item_counts", "building_item_counts", "item_counts_by_entity_family"],
            properties: {
                item_counts: publishItemCountsSchema,
                building_item_counts: publishItemCountsSchema,
                item_counts_by_entity_family: {
                    type: "object",
                    additionalProperties: publishEntityItemCountsSchema,
                },
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        building_type_code: { type: "string", nullable: true },
        building_type_name: { type: "string", nullable: true },
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewPromotionSkippedReasonSchema = {
    type: "object",
    required: ["reason", "count"],
    properties: {
        reason: { type: "string" },
        count: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewPromotionFamilyEligibilitySchema = {
    type: "object",
    required: [
        "entity_family",
        "table_name",
        "approved_ready",
        "with_warnings",
        "blocked",
        "already_promoted",
        "excluded",
        "skipped_reasons",
    ],
    properties: {
        entity_family: { type: "string" },
        table_name: { type: "string" },
        approved_ready: { type: "integer", minimum: 0 },
        with_warnings: { type: "integer", minimum: 0 },
        blocked: { type: "integer", minimum: 0 },
        already_promoted: { type: "integer", minimum: 0 },
        excluded: { type: "integer", minimum: 0 },
        skipped_reasons: { type: "array", items: importReviewPromotionSkippedReasonSchema },
    },
    additionalProperties: false,
} as const;

const importReviewPromotionEligibilityCountErrorSchema = {
    type: "object",
    required: ["ok", "code", "message"],
    properties: {
        ok: { type: "boolean", enum: [false] },
        code: { type: "string" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

const importReviewPromotionEligibilityFamilySchema = {
    type: "object",
    required: [
        "family",
        "label",
        "risk_level",
        "target",
        "counts_ok",
        "count_error",
        "approved_count",
        "ready_existing_count",
        "blocked_existing_count",
        "warning_existing_count",
        "already_batched_count",
        "already_promoted_count",
        "ready_now",
        "retry_needed",
        "active_locked",
        "stale_locked",
        "ready",
        "warnings",
        "blocked",
        "batched",
        "promoted",
    ],
    properties: {
        family: { type: "string" },
        label: { type: "string" },
        risk_level: { type: "string", enum: ["normal", "high_risk"] },
        target: { type: "string" },
        counts_ok: { type: "boolean" },
        count_error: {
            oneOf: [importReviewPromotionEligibilityCountErrorSchema, { type: "null" }],
        },
        approved_count: { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        ready_existing_count: { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        blocked_existing_count: { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        warning_existing_count: { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        already_batched_count: { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        already_promoted_count: { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        ready_now: { type: "integer", minimum: 0 },
        retry_needed: { type: "integer", minimum: 0 },
        active_locked: { type: "integer", minimum: 0 },
        stale_locked: { type: "integer", minimum: 0 },
        ready: { type: "integer", minimum: 0 },
        warnings: { type: "integer", minimum: 0 },
        blocked: { type: "integer", minimum: 0 },
        batched: { type: "integer", minimum: 0 },
        promoted: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewPromotionEligibilityTotalsSchema = {
    type: "object",
    required: [
        "ready_now",
        "retry_needed",
        "active_locked",
        "stale_locked",
        "promoted",
        "ready",
        "warnings",
        "blocked",
        "batched",
    ],
    properties: {
        ready_now: { type: "integer", minimum: 0 },
        retry_needed: { type: "integer", minimum: 0 },
        active_locked: { type: "integer", minimum: 0 },
        stale_locked: { type: "integer", minimum: 0 },
        promoted: { type: "integer", minimum: 0 },
        ready: { type: "integer", minimum: 0 },
        warnings: { type: "integer", minimum: 0 },
        blocked: { type: "integer", minimum: 0 },
        batched: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewPromotionEligibilityDetailItemSchema = {
    type: "object",
    required: [
        "id",
        "external_id",
        "display_name",
        "match_status",
        "auto_action",
        "review_status",
        "review_decision",
        "promotion_status",
        "confidence_score",
        "reason_codes",
        "reason_messages",
        "validation_errors",
        "validation_warnings",
        "target",
        "publish_batch_id",
        "publish_batch_status",
        "promoted_core_id",
        "created_at",
        "updated_at",
    ],
    properties: {
        id: { type: "integer" },
        external_id: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        match_status: { type: "string", nullable: true },
        auto_action: { type: "string", nullable: true },
        review_status: { type: "string", nullable: true },
        review_decision: { type: "string", nullable: true },
        promotion_status: { type: "string", nullable: true },
        confidence_score: { type: "number", nullable: true },
        reason_codes: { type: "array", items: { type: "string" } },
        reason_messages: { type: "array", items: { type: "string" } },
        validation_errors: {},
        validation_warnings: {},
        target: { type: "string" },
        publish_batch_id: { type: "integer", nullable: true },
        publish_batch_status: { type: "string", nullable: true },
        promoted_core_id: { type: "integer", nullable: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

export const getImportReviewPromotionEligibilityDetailsSchema = {
    tags: [Tags.ImportReview],
    summary: "Promotion eligibility candidate details for a family bucket",
    description:
        "Paginated candidates for ready, warnings, blocked, batched, or promoted buckets. Uses the same bucket rules as GET /promotion/eligibility.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        required: ["review_batch_id", "family", "bucket"],
        properties: {
            review_batch_id: { type: "string", description: "Numeric review batch id" },
            family: { type: "string", description: "Entity family slug, e.g. roads" },
            bucket: {
                type: "string",
                enum: ["ready", "warnings", "blocked", "batched", "promoted"],
            },
            include_warnings: { type: "boolean", default: false },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
            search: {
                type: "string",
                maxLength: 200,
                description: "Filter by id, external_id, display name, or validation/reason text",
            },
            reason_code: {
                type: "string",
                maxLength: 120,
                description: "Filter by normalized reason code (best-effort SQL match)",
            },
            sort_by: {
                type: "string",
                enum: ["id", "updated_at", "confidence_score"],
                default: "id",
            },
            sort_order: { type: "string", enum: ["asc", "desc"], default: "asc" },
        },
    },
    response: {
        200: {
            type: "object",
            required: [
                "review_batch_id",
                "family",
                "bucket",
                "target",
                "total",
                "limit",
                "offset",
                "items",
            ],
            properties: {
                review_batch_id: { type: "integer" },
                family: { type: "string" },
                bucket: {
                    type: "string",
                    enum: ["ready", "warnings", "blocked", "batched", "promoted"],
                },
                target: { type: "string" },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
                items: { type: "array", items: importReviewPromotionEligibilityDetailItemSchema },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPromotionEligibilitySchema = {
    tags: [Tags.ImportReview],
    summary: "Promotion eligibility for checkbox-selected entity families",
    description:
        "Read-only approximate per-family counts from import_review candidate tables (no candidate updates or validation runs). Requires explicit families query (comma-separated). Rejects legacy bus families with TRANSPORT_PROMOTION_DEPRECATED.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        required: ["review_batch_id", "families"],
        properties: {
            review_batch_id: { type: "string", description: "Numeric review batch id" },
            families: {
                type: "string",
                description: "Comma-separated entity families, e.g. buildings,places,routing_barriers",
            },
            include_warnings: { type: "boolean", default: false },
        },
    },
    response: {
        200: {
            type: "object",
            required: [
                "review_batch_id",
                "families",
                "totals",
                "has_high_risk",
                "can_create_batch",
                "messages",
            ],
            properties: {
                review_batch_id: { type: "integer" },
                families: { type: "array", items: importReviewPromotionEligibilityFamilySchema },
                totals: importReviewPromotionEligibilityTotalsSchema,
                has_high_risk: { type: "boolean" },
                can_create_batch: { type: "boolean" },
                messages: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        503: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPromotionBatchEligibilitySchema = {
    tags: [Tags.ImportReview],
    summary: "Preview publish batch eligibility counts per entity family",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            ...importReviewScopeQueryProperties,
            include_merged: { type: "boolean", default: false },
            latest: { type: "boolean", default: false },
            entity_families: {
                type: "array",
                items: { type: "string" },
            },
            include_warnings: { type: "boolean", default: false },
            mode: { type: "string", enum: ["approved_only"], default: "approved_only" },
        },
    },
    response: {
        200: {
            type: "object",
            required: [
                "review_batch_id",
                "source_snapshot_version",
                "entity_families",
                "by_family",
                "totals",
            ],
            properties: {
                review_batch_id: { type: "string" },
                source_snapshot_version: { type: "string" },
                entity_families: { type: "array", items: { type: "string" } },
                by_family: { type: "array", items: importReviewPromotionFamilyEligibilitySchema },
                totals: {
                    type: "object",
                    required: ["approved_ready", "with_warnings", "blocked", "already_promoted"],
                    properties: {
                        approved_ready: { type: "integer", minimum: 0 },
                        with_warnings: { type: "integer", minimum: 0 },
                        blocked: { type: "integer", minimum: 0 },
                        already_promoted: { type: "integer", minimum: 0 },
                    },
                    additionalProperties: false,
                },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchSchema = {
    tags: [Tags.ImportReview],
    summary: "Create publish batch from checkbox-selected entity families",
    description:
        "Requires review_batch_id and families[]. When dry_run=false: inserts system.system_publish_batches + system.system_publish_items and marks candidates batched. dry_run=true previews counts only. Does not validate or promote.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["review_batch_id", "families"],
        properties: {
            review_batch_id: { type: "integer", description: "Import review batch id" },
            families: {
                type: "array",
                minItems: 1,
                items: { type: "string" },
                description: "Entity families to include, e.g. buildings, places, routing_barriers",
            },
            include_warnings: { type: "boolean", default: false },
            dry_run: { type: "boolean", default: false },
            batch_name: { type: "string", minLength: 1, maxLength: 200 },
            note: { type: "string", maxLength: 4000 },
            include_merged: { type: "boolean", default: false },
            max_items: {
                type: "integer",
                minimum: 1,
                maximum: 10000,
                description: "Max eligible candidates per family (all_ready mode). Roads use approved+not_ready selection.",
            },
            limit_per_family: {
                type: "object",
                additionalProperties: { type: "integer", minimum: 1, maximum: 10000 },
            },
            entity_families: {
                type: "array",
                items: { type: "string" },
                description: "Deprecated alias for families",
            },
        },
    },
    response: {
        200: {
            type: "object",
            required: [
                "dry_run",
                "batch_name",
                "entity_families",
                "totals",
                "by_family",
                "stages",
                "message",
            ],
            properties: {
                dry_run: { type: "boolean", enum: [true] },
                batch_name: { type: "string" },
                entity_families: { type: "array", items: { type: "string" } },
                totals: {
                    type: "object",
                    required: ["included", "excluded", "skipped"],
                    properties: {
                        included: { type: "integer", minimum: 0 },
                        excluded: { type: "integer", minimum: 0 },
                        skipped: { type: "integer", minimum: 0 },
                    },
                    additionalProperties: false,
                },
                by_family: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["entity_family", "included", "excluded", "skipped", "skipped_reasons"],
                        properties: {
                            entity_family: { type: "string" },
                            included: { type: "integer", minimum: 0 },
                            excluded: { type: "integer", minimum: 0 },
                            skipped: { type: "integer", minimum: 0 },
                            skipped_reasons: { type: "array", items: importReviewPromotionSkippedReasonSchema },
                        },
                        additionalProperties: false,
                    },
                },
                stages: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["stage_key", "stage_label", "message", "counts"],
                        properties: {
                            stage_key: { type: "string" },
                            stage_label: { type: "string" },
                            message: { type: "string" },
                            counts: { type: "object", additionalProperties: { type: "integer" } },
                        },
                        additionalProperties: false,
                    },
                },
                message: { type: "string" },
            },
            additionalProperties: false,
        },
        201: {
            type: "object",
            required: [
                "id",
                "public_id",
                "review_batch_id",
                "mode",
                "total_item_count",
                "count_by_family",
                "message",
                "batch",
                "batch_id",
                "publish_batch_id",
                "families",
                "status",
                "total_items",
                "items_added",
                "total_selected",
                "candidates_marked_batched",
                "by_family",
                "by_entity",
                "skipped",
                "building_candidates_marked_batched",
            ],
            properties: {
                id: {
                    type: "integer",
                    minimum: 1,
                    description: "Numeric system.system_publish_batches.id (use for navigation)",
                },
                public_id: { type: "string", description: "Publish batch public id (uuid)" },
                message: { type: "string" },
                batch: importReviewPublishBatchDetailSchema,
                batch_id: { type: "string", description: "Publish batch id as string" },
                publish_batch_id: { type: "string", description: "Alias of batch_id" },
                review_batch_id: { type: "integer" },
                mode: { type: "string", enum: ["selected", "all_ready"] },
                families: { type: "array", items: { type: "string" } },
                status: { type: "string" },
                total_items: { type: "integer", minimum: 0 },
                total_item_count: { type: "integer", minimum: 0 },
                count_by_family: {
                    type: "object",
                    additionalProperties: { type: "integer", minimum: 0 },
                },
                items_added: { type: "integer", minimum: 0 },
                total_selected: { type: "integer", minimum: 0 },
                candidates_marked_batched: { type: "integer", minimum: 0 },
                by_family: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["entity_family", "items_added", "marked_batched", "skipped_reasons"],
                        properties: {
                            entity_family: { type: "string" },
                            items_added: { type: "integer", minimum: 0 },
                            marked_batched: { type: "integer", minimum: 0 },
                            skipped_reasons: { type: "array", items: importReviewPromotionSkippedReasonSchema },
                        },
                        additionalProperties: false,
                    },
                },
                by_entity: {
                    type: "object",
                    additionalProperties: { type: "integer", minimum: 0 },
                },
                skipped: { type: "integer", minimum: 0 },
                timing_ms: {
                    type: "object",
                    properties: {
                        resolve_ms: { type: "number" },
                        eligibility_ms: { type: "number" },
                        payload_ms: { type: "number" },
                        transaction_ms: { type: "number" },
                        total_ms: { type: "number" },
                    },
                    additionalProperties: false,
                },
                building_candidates_marked_batched: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewPublishBatchEntityValidationCountsSchema = {
    type: "object",
    required: ["total", "valid", "warning", "blocked", "skipped"],
    properties: {
        total: { type: "integer", minimum: 0 },
        valid: { type: "integer", minimum: 0 },
        ready: { type: "integer", minimum: 0 },
        warning: { type: "integer", minimum: 0 },
        blocked: { type: "integer", minimum: 0 },
        skipped: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewPublishBatchValidationResultSchema = {
    type: "object",
    required: [
        "outcome",
        "can_promote",
        "requires_warning_confirmation",
        "valid_count",
        "warning_count",
        "blocked_count",
        "skipped_count",
        "total_items",
        "by_publish_action",
        "by_entity",
        "promotable_entity_families",
    ],
    properties: {
        outcome: { type: "string", enum: ["passed", "partial", "blocked"] },
        can_promote: { type: "boolean" },
        requires_warning_confirmation: { type: "boolean" },
        valid_count: { type: "integer", minimum: 0 },
        ready_count: { type: "integer", minimum: 0 },
        warning_count: { type: "integer", minimum: 0 },
        blocked_count: { type: "integer", minimum: 0 },
        skipped_count: { type: "integer", minimum: 0 },
        promotable_count: { type: "integer", minimum: 0 },
        total_count: { type: "integer", minimum: 0 },
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
        by_entity: {
            type: "object",
            additionalProperties: importReviewPublishBatchEntityValidationCountsSchema,
        },
        entity_family: {
            type: "object",
            properties: { buildings: { type: "integer", minimum: 0 } },
            additionalProperties: false,
        },
        promotable_entity_families: {
            type: "array",
            items: { type: "string" },
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
        stage_status: {
            type: "string",
            enum: ["pending", "running", "success", "warning", "failed", "skipped"],
        },
        message: { type: "string", nullable: true },
        progress_percent: { type: "number", minimum: 0, maximum: 100 },
        details: {},
        started_at: { type: "string", format: "date-time" },
        finished_at: { type: "string", format: "date-time", nullable: true },
    },
    additionalProperties: false,
} as const;

export const postImportReviewPromotionBatchCancelValidationSchema = {
    tags: [Tags.ImportReview],
    summary: "Request cancel of in-flight publish batch validation",
    description:
        "Sets validation_cancel_requested_at while status=validating. Stops at the next checkpoint; if the worker is not responding, finalizes the batch as cancelled immediately.",
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchCancelPromotionSchema = {
    tags: [Tags.ImportReview],
    summary: "Request cancel of in-flight publish batch promotion",
    description:
        "Sets promotion_cancel_requested_at in batch summary while status=promoting. Stops at the next checkpoint; if the worker is not responding, finalizes immediately.",
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchResetPromotionSchema = {
    tags: [Tags.ImportReview],
    summary: "Reset stuck publish batch promotion worker state",
    description:
        "Fails running promotion stage logs and returns batch to ready/partially_promoted when the worker is not in-process. Does not delete publish items.",
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const promotionStageControlResponseSchema = {
    type: "object",
    required: ["batch_id", "action", "status", "message"],
    properties: {
        batch_id: { type: "string" },
        action: { type: "string" },
        status: { type: "string" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const postImportReviewPromotionBatchResumeSchema = {
    tags: [Tags.ImportReview],
    summary: "Resume the current publish batch pipeline stage",
    description:
        "Continues validation (skipping items with validation_result), dry-run, or promotion for remaining promotable items. Returns already_complete when nothing is left to do.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: promotionStageControlResponseSchema,
        202: promotionStageControlResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchCancelCurrentStageSchema = {
    tags: [Tags.ImportReview],
    summary: "Cancel the in-flight publish batch stage",
    description:
        "Stops validation or promotion at the next chunk checkpoint. Does not delete publish_items or promote anything.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        202: promotionStageControlResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchResetDryRunSchema = {
    tags: [Tags.ImportReview],
    summary: "Clear publish batch dry-run result",
    description: "Removes summary.dry_run_result only. Keeps per-item validation_result.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: promotionStageControlResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchResetPromotionFailuresSchema = {
    tags: [Tags.ImportReview],
    summary: "Reset failed unpromoted publish items for retry",
    description:
        "Sets failed publish items back to pending and releases candidates for retry. Never changes publish_status=success or unpromotes core rows.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: promotionStageControlResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchResetValidationSchema = {
    tags: [Tags.ImportReview],
    summary: "Reset publish batch validation state to draft",
    description:
        "Clears per-item validation_result and batch validation counters. Does not delete publish items. Not allowed on promoted batches.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: {
            type: "object",
            required: ["batch_id", "status", "message"],
            properties: {
                batch_id: { type: "string" },
                status: { type: "string" },
                message: { type: "string" },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchValidateSchema = {
    tags: [Tags.ImportReview],
    summary: "Start publish batch validation (multi-family)",
    description:
        "Validates publish items across supported entity families without writing to core. Returns 202 immediately; poll progress and logs endpoints. Batches with more than 50 items that include high-risk families (roads, addresses, admin_areas, routing_barriers) require allow_high_risk_families=true. Batches over 200 items also require confirm_large_batch=true.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        properties: {
            confirm_large_batch: { type: "boolean", default: false },
            allow_high_risk_families: { type: "boolean", default: false },
            mixed_high_risk_confirm: { type: "boolean", default: false },
        },
        additionalProperties: false,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        "verification_metadata_applied_count",
        "verification_metadata_skipped_already_verified_count",
        "started_at",
        "finished_at",
        "duration_ms",
        "promoted_entity_families",
    ],
    properties: {
        status: { type: "string", enum: ["promoted", "partially_promoted", "failed"] },
        promoted_count: { type: "integer", minimum: 0 },
        skipped_blocked_count: { type: "integer", minimum: 0 },
        skipped_warning_count: { type: "integer", minimum: 0 },
        inserted_count: { type: "integer", minimum: 0 },
        updated_count: { type: "integer", minimum: 0 },
        success_count: { type: "integer", minimum: 0 },
        partial_promotion: { type: "boolean" },
        failed_count: { type: "integer", minimum: 0 },
        skipped_count: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 0 },
        core_verified_count: { type: "integer", minimum: 0 },
        import_review_marked_promoted_count: { type: "integer", minimum: 0 },
        verification_metadata_applied_count: { type: "integer", minimum: 0 },
        verification_metadata_skipped_already_verified_count: { type: "integer", minimum: 0 },
        partial_success: { type: "boolean" },
        started_at: { type: "string", format: "date-time" },
        finished_at: { type: "string", format: "date-time" },
        duration_ms: { type: "integer", minimum: 0 },
        promoted_entity_families: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
} as const;

const importReviewRoadPromotionGateCheckSchema = {
    type: "object",
    required: ["id", "label", "satisfied", "detail"],
    properties: {
        id: {
            type: "string",
            enum: [
                "env_enabled",
                "env_bulk_enabled",
                "road_validation_passed",
                "road_dry_run_completed",
                "routing_readiness_validation_completed",
            ],
        },
        label: { type: "string" },
        satisfied: { type: "boolean" },
        detail: { type: "string" },
        helper: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const importReviewRoadPromotionGatesResultSchema = {
    type: "object",
    required: [
        "applies",
        "can_promote",
        "road_item_count",
        "roads_ready_count",
        "recommend_sql_bulk_promotion",
        "api_bulk_promotion_allowed",
        "sql_bulk_promotion_ready_threshold",
        "sql_bulk_promote_script",
        "sql_bulk_validate_script",
        "env_enabled",
        "gates",
        "primary_blocker",
        "primary_blocker_message",
    ],
    properties: {
        applies: { type: "boolean" },
        can_promote: { type: "boolean" },
        road_item_count: { type: "integer", minimum: 0 },
        roads_ready_count: { type: "integer", minimum: 0 },
        recommend_sql_bulk_promotion: { type: "boolean" },
        api_bulk_promotion_allowed: { type: "boolean" },
        sql_bulk_promotion_ready_threshold: { type: "integer", minimum: 0 },
        sql_bulk_promote_script: { type: "string" },
        sql_bulk_validate_script: { type: "string" },
        env_enabled: { type: "boolean" },
        gates: {
            type: "array",
            items: importReviewRoadPromotionGateCheckSchema,
        },
        primary_blocker: {
            type: "string",
            nullable: true,
            enum: [
                "env_enabled",
                "env_bulk_enabled",
                "road_validation_passed",
                "road_dry_run_completed",
                "routing_readiness_validation_completed",
            ],
        },
        primary_blocker_message: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const importReviewPublishBatchDryRunResultSchema = {
    type: "object",
    required: ["status"],
    properties: {
        status: { type: "string", enum: ["passed", "failed"] },
        checked_at: { type: "string", format: "date-time" },
        ran_at: { type: "string", format: "date-time" },
        total: { type: "integer", minimum: 0 },
        ready_count: { type: "integer", minimum: 0 },
        blocked_count: { type: "integer", minimum: 0 },
        failed_count: { type: "integer", minimum: 0 },
        would_insert_count: { type: "integer", minimum: 0 },
        would_update_count: { type: "integer", minimum: 0 },
        entity_families: {
            type: "array",
            items: { type: "string" },
        },
        sample_errors: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    candidate_id: { type: ["integer", "null"] },
                    external_id: { type: ["string", "null"] },
                    code: { type: "string" },
                    message: { type: "string" },
                },
                additionalProperties: true,
            },
        },
    },
    additionalProperties: true,
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
                "derived_status",
                "derived_status_reason",
                "stored_status_recommendation",
                "status_note",
                "workflow",
                "validation_total",
                "validation_done",
                "validation_percent",
                "total_item_count",
                "item_processed_count",
                "stage_count",
                "validated_at",
                "current_stage_key",
                "current_stage_label",
                "current_stage_status",
                "current_entity_family",
                "current_message",
                "validation_result",
                "validation_logs_summary",
                "promotion_result",
                "promotion_logs_summary",
                "validation_heartbeat_at",
                "validation_cancel_requested_at",
                "validation_heartbeat_stale_warning",
                "promotion_heartbeat_at",
                "promotion_heartbeat_stale_warning",
                "promotion_worker_in_process",
                "current_promotable_count",
                "validation_promotable_count",
                "publish_item_status_counts",
                "promotion_status",
                "failed_ready_retry_count",
                "road_promotion_gates",
                "current_stage",
                "percent",
                "processed_count",
                "total",
                "last_heartbeat_at",
                "resumable_actions",
            ],
            properties: {
                batch_id: { type: "string" },
                status: { type: "string" },
                derived_status: { type: "string" },
                derived_status_reason: { type: "string", nullable: true },
                stored_status_recommendation: { type: "string", nullable: true },
                status_note: { type: "string", nullable: true },
                workflow: { type: "string", enum: ["validation", "promotion", "idle"] },
                validation_total: { type: "integer", minimum: 0 },
                validation_done: { type: "integer", minimum: 0 },
                validation_percent: { type: "number", minimum: 0, maximum: 100 },
                total_item_count: { type: "integer", minimum: 0 },
                item_processed_count: { type: "integer", minimum: 0 },
                stage_count: { type: "integer", minimum: 0 },
                validated_at: { type: "string", format: "date-time", nullable: true },
                current_stage_key: { type: "string", nullable: true },
                current_stage_label: { type: "string", nullable: true },
                current_stage_status: { type: "string", nullable: true },
                current_entity_family: { type: "string", nullable: true },
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
                validation_heartbeat_at: { type: "string", format: "date-time", nullable: true },
                validation_cancel_requested_at: { type: "string", format: "date-time", nullable: true },
                validation_heartbeat_stale_warning: { type: "boolean" },
                promotion_heartbeat_at: { type: "string", format: "date-time", nullable: true },
                promotion_heartbeat_stale_warning: { type: "boolean" },
                promotion_worker_in_process: { type: "boolean" },
                current_promotable_count: { type: "integer", minimum: 0 },
                validation_promotable_count: { type: "integer", minimum: 0, nullable: true },
                publish_item_status_counts: {
                    type: "object",
                    required: ["pending", "success", "failed", "skipped", "total"],
                    properties: {
                        pending: { type: "integer", minimum: 0 },
                        success: { type: "integer", minimum: 0 },
                        failed: { type: "integer", minimum: 0 },
                        skipped: { type: "integer", minimum: 0 },
                        total: { type: "integer", minimum: 0 },
                    },
                    additionalProperties: false,
                },
                promotion_status: {
                    type: "string",
                    nullable: true,
                    enum: [
                        "not_started",
                        "promoting",
                        "promoted",
                        "partially_promoted",
                        "promotion_failed",
                    ],
                },
                failed_ready_retry_count: { type: "integer", minimum: 0 },
                road_promotion_gates: {
                    ...importReviewRoadPromotionGatesResultSchema,
                    nullable: true,
                },
                dry_run_result: {
                    ...importReviewPublishBatchDryRunResultSchema,
                    nullable: true,
                },
                current_stage: {
                    type: "string",
                    nullable: true,
                    enum: ["validate_items", "dry_run_items", "promote_items", "verify_items"],
                },
                percent: { type: "number", minimum: 0, maximum: 100 },
                processed_count: { type: "integer", minimum: 0 },
                total: { type: "integer", minimum: 0 },
                last_heartbeat_at: { type: "string", format: "date-time", nullable: true },
                resumable_actions: {
                    type: "array",
                    items: { type: "string" },
                },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionReleaseStaleBatchedSchema = {
    tags: [Tags.ImportReview],
    summary: "Release stale batched import-review candidates",
    description:
        "Safely moves candidates stuck in promotion_status=batched back to not_ready when their latest publish item failed on a closed batch (status failed or partial only). Never releases candidates tied to draft, validating, ready, dry_run_passed, or promoting batches.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["review_batch_id"],
        properties: {
            review_batch_id: { type: "integer", minimum: 1 },
            families: {
                type: "array",
                items: { type: "string", minLength: 1 },
            },
            dry_run: { type: "boolean", default: false },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: [
                "status",
                "dry_run",
                "review_batch_id",
                "released_total",
                "by_family",
                "samples",
            ],
            properties: {
                status: { type: "string", enum: ["success"] },
                dry_run: { type: "boolean" },
                review_batch_id: { type: "string" },
                released_total: { type: "integer", minimum: 0 },
                by_family: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["entity_family", "eligible_count", "released_count"],
                        properties: {
                            entity_family: { type: "string" },
                            eligible_count: { type: "integer", minimum: 0 },
                            released_count: { type: "integer", minimum: 0 },
                        },
                        additionalProperties: false,
                    },
                },
                samples: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["entity_family", "candidate_id"],
                        properties: {
                            entity_family: { type: "string" },
                            candidate_id: { type: "string" },
                            publish_batch_id: { type: ["string", "null"] },
                            publish_item_id: { type: ["string", "null"] },
                            publish_status: { type: ["string", "null"] },
                            batch_status: { type: ["string", "null"] },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewRepairInvalidPromotedBatchesSchema = {
    tags: [Tags.ImportReview],
    summary: "Repair invalid empty promoted publish batches",
    description:
        "Finds publish batches stored as promoted with no successful promotion/verification, downgrades status to failed/blocked, and persists derived_status metadata into summary JSONB.",
    security: [...bearerAuth],
    body: {
        type: "object",
        properties: {
            batch_id: { type: "string", pattern: "^\\d+$" },
            review_batch_id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["scanned", "repaired", "skipped", "batches", "message"],
            properties: {
                scanned: { type: "integer", minimum: 0 },
                repaired: { type: "integer", minimum: 0 },
                skipped: { type: "integer", minimum: 0 },
                message: { type: "string" },
                batches: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["id", "previous_status", "new_status", "derived_status"],
                        properties: {
                            id: { type: "string" },
                            previous_status: { type: "string" },
                            new_status: { type: "string" },
                            derived_status: { type: "string" },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        403: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const cleanupExampleRowSchema = {
    type: "object",
    required: ["candidate_id", "entity_family", "promoted_core_id", "promoted_at", "publish_batch_id"],
    properties: {
        candidate_id: { type: "string" },
        entity_family: { type: "string" },
        promoted_core_id: { type: "string", nullable: true },
        promoted_at: { type: "string", nullable: true },
        publish_batch_id: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const cleanupScopeBodySchema = {
    type: "object",
    required: ["review_batch_id"],
    properties: {
        review_batch_id: { type: "string", pattern: "^\\d+$" },
        entity_families: {
            type: "array",
            items: { type: "string" },
        },
        publish_batch_id: { type: "string", pattern: "^\\d+$" },
        older_than_days: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

export const postImportReviewCleanupPromotedDryRunSchema = {
    tags: [Tags.ImportReview],
    summary: "Dry-run permanent cleanup of promoted import_review candidates",
    description:
        "Reports which soft-hidden promoted import_review candidate rows are eligible for permanent deletion. Does not mutate data. Core rows and system publish history are never deleted.",
    security: [...bearerAuth],
    body: cleanupScopeBodySchema,
    response: {
        200: {
            type: "object",
            required: [
                "review_batch_id",
                "publish_batch_id",
                "selected_entity_families",
                "eligible_counts_by_entity",
                "not_eligible_counts_by_reason",
                "estimated_rows_to_delete",
                "estimated_geometry_rows_to_delete",
                "example_eligible_rows",
                "example_blocked_rows",
                "execute_enabled",
                "message",
            ],
            properties: {
                review_batch_id: { type: "string" },
                publish_batch_id: { type: "string", nullable: true },
                selected_entity_families: { type: "array", items: { type: "string" } },
                eligible_counts_by_entity: {
                    type: "object",
                    additionalProperties: { type: "integer", minimum: 0 },
                },
                not_eligible_counts_by_reason: {
                    type: "object",
                    additionalProperties: { type: "integer", minimum: 0 },
                },
                estimated_rows_to_delete: { type: "integer", minimum: 0 },
                estimated_geometry_rows_to_delete: { type: "integer", minimum: 0 },
                example_eligible_rows: { type: "array", items: cleanupExampleRowSchema },
                example_blocked_rows: {
                    type: "array",
                    items: {
                        ...cleanupExampleRowSchema,
                        required: [...cleanupExampleRowSchema.required, "reason"],
                        properties: {
                            ...cleanupExampleRowSchema.properties,
                            reason: { type: "string" },
                        },
                    },
                },
                execute_enabled: { type: "boolean" },
                message: { type: "string" },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewCleanupPromotedExecuteSchema = {
    tags: [Tags.ImportReview],
    summary: "Execute permanent cleanup of promoted import_review candidates",
    description:
        "Permanently deletes eligible import_review candidate rows only when ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP=true and confirmation_text matches. Core and system publish history are preserved.",
    security: [...bearerAuth],
    body: {
        ...cleanupScopeBodySchema,
        required: ["review_batch_id", "confirmation_text"],
        properties: {
            ...cleanupScopeBodySchema.properties,
            confirmation_text: { type: "string", enum: ["DELETE PROMOTED REVIEW DATA"] },
        },
    },
    response: {
        200: {
            type: "object",
            required: [
                "review_batch_id",
                "publish_batch_id",
                "deleted_count",
                "deleted_by_entity",
                "message",
            ],
            properties: {
                review_batch_id: { type: "string" },
                publish_batch_id: { type: "string", nullable: true },
                deleted_count: { type: "integer", minimum: 0 },
                deleted_by_entity: {
                    type: "object",
                    additionalProperties: { type: "integer", minimum: 0 },
                },
                message: { type: "string" },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const addressMatchBuildingOptionSchema = {
    type: "object",
    required: ["id", "label", "distance_m", "match_score", "match_method"],
    properties: {
        id: { type: "string" },
        label: { type: "string" },
        building_type: { type: "string", nullable: true },
        distance_m: { type: "number" },
        match_score: { type: "number" },
        match_method: { type: "string" },
    },
    additionalProperties: false,
} as const;

const addressMatchPlaceOptionSchema = {
    type: "object",
    required: ["id", "display_name", "distance_m", "match_score", "match_method"],
    properties: {
        id: { type: "string" },
        display_name: { type: "string" },
        name_en: { type: "string", nullable: true },
        name_my: { type: "string", nullable: true },
        category: { type: "string", nullable: true },
        distance_m: { type: "number" },
        match_score: { type: "number" },
        match_method: { type: "string" },
    },
    additionalProperties: false,
} as const;

const addressMatchStreetOptionSchema = {
    type: "object",
    required: [
        "id",
        "canonical_name",
        "distance_m",
        "match_score",
        "match_method",
    ],
    properties: {
        id: { type: "string" },
        canonical_name: { type: "string" },
        name_en: { type: "string", nullable: true },
        name_my: { type: "string", nullable: true },
        name_und: { type: "string", nullable: true },
        distance_m: { type: "number" },
        match_score: { type: "number", minimum: 0, maximum: 100 },
        match_method: { type: "string" },
    },
    additionalProperties: false,
} as const;

const addressMatchAdminAreaOptionSchema = {
    type: "object",
    required: ["id", "canonical_name", "admin_level_code", "match_score", "match_method"],
    properties: {
        id: { type: "string" },
        canonical_name: { type: "string" },
        name_en: { type: "string", nullable: true },
        name_my: { type: "string", nullable: true },
        admin_level_code: { type: "string" },
        boundary_status: { type: "string", nullable: true },
        address_usage: { type: "string", nullable: true },
        distance_m: { type: "number", nullable: true },
        match_score: { type: "number", minimum: 0, maximum: 100 },
        match_method: { type: "string" },
    },
    additionalProperties: false,
} as const;

const addressMatchPostcodeOptionSchema = {
    type: "object",
    required: ["value", "source"],
    properties: {
        value: { type: "string" },
        language_code: { type: "string", nullable: true },
        source: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const getImportReviewAddressOptionsSchema = {
    tags: [Tags.ImportReview],
    summary: "Street/admin/building/place/postcode match options for an address candidate",
    description:
        "Returns ranked nearby core.core_streets (300m then 1000m fallback), admin area options from point geometry, building options (contains + 50m), place options (100m + name similarity), and postcode values from address_components.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: {
            type: "object",
            required: ["address_candidate_id", "streets", "adminAreas", "postcodes", "buildings", "places"],
            properties: {
                address_candidate_id: { type: "string" },
                streets: { type: "array", items: addressMatchStreetOptionSchema },
                adminAreas: { type: "array", items: addressMatchAdminAreaOptionSchema },
                postcodes: { type: "array", items: addressMatchPostcodeOptionSchema },
                buildings: { type: "array", items: addressMatchBuildingOptionSchema },
                places: { type: "array", items: addressMatchPlaceOptionSchema },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const patchImportReviewAddressComponentsSchema = {
    tags: [Tags.ImportReview],
    summary: "Upsert or soft-delete address components for a candidate",
    description:
        "Persists structured import_review.address_components rows. Does not modify readonly generated full address fields on the candidate.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        properties: {
            upsert: {
                type: "array",
                items: {
                    type: "object",
                    required: ["component_type_code", "component_value", "language_code"],
                    properties: {
                        id: { type: "string", pattern: "^\\d+$" },
                        component_type_code: { type: "string" },
                        component_value: { type: "string" },
                        language_code: { type: "string", enum: ["en", "my", "und"] },
                        confidence_score: { type: "number", nullable: true },
                        match_type: { type: "string", nullable: true },
                        is_reviewed: { type: "boolean" },
                    },
                    additionalProperties: false,
                },
            },
            delete_ids: {
                type: "array",
                items: { type: "string", pattern: "^\\d+$" },
            },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            additionalProperties: true,
            description: "Address candidate detail after component save.",
        },
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const patchImportReviewAddressMatchesSchema = {
    tags: [Tags.ImportReview],
    summary: "Save matched street/admin/building/place ids for an address candidate",
    description:
        "Updates matched_* columns on import_review.address_candidates. When matched_street_id is set, syncs inferred street components from core.core_street_names (skips is_reviewed unless replace_reviewed_street_components=true).",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        properties: {
            matched_street_id: { type: "string", nullable: true, pattern: "^\\d+$" },
            matched_admin_area_id: { type: "string", nullable: true, pattern: "^\\d+$" },
            matched_building_id: { type: "string", nullable: true, pattern: "^\\d+$" },
            matched_place_id: { type: "string", nullable: true, pattern: "^\\d+$" },
            street_match_confidence: { type: "number", minimum: 0, maximum: 100 },
            replace_reviewed_street_components: { type: "boolean" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: [
                "address_candidate_id",
                "matched_street_id",
                "matched_admin_area_id",
                "matched_building_id",
                "matched_place_id",
                "street_match_type",
                "street_match_confidence",
                "street_components_synced",
            ],
            properties: {
                address_candidate_id: { type: "string" },
                matched_street_id: { type: "string", nullable: true },
                matched_admin_area_id: { type: "string", nullable: true },
                matched_building_id: { type: "string", nullable: true },
                matched_place_id: { type: "string", nullable: true },
                street_match_type: { type: "string", nullable: true },
                street_match_confidence: { type: "number", nullable: true },
                street_components_synced: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["language_code", "action"],
                        properties: {
                            language_code: { type: "string" },
                            action: {
                                type: "string",
                                enum: ["inserted", "updated", "skipped"],
                            },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewAddressPlaceWorkflowResponseSchema = {
    type: "object",
    required: ["address_candidate_id", "linked_place_candidate_id", "matched_core_place_id", "place_candidate_status"],
    properties: {
        address_candidate_id: { type: "string" },
        linked_place_candidate_id: { type: "string", nullable: true },
        matched_core_place_id: { type: "string", nullable: true },
        place_candidate_status: { type: "string", nullable: true },
        linked_place_candidate: { type: "object", nullable: true, additionalProperties: true },
        matched_core_place: { type: "object", nullable: true, additionalProperties: true },
        place_address_link: { type: "object", nullable: true, additionalProperties: true },
    },
    additionalProperties: false,
} as const;

export const postImportReviewAddressCreatePlaceCandidateSchema = {
    tags: [Tags.ImportReview],
    summary: "Create or link a place candidate from address source evidence",
    description:
        "Creates an import_review.place_candidates row from address source tags, links it to the address candidate, and creates a review-time place_address_link when address strength is partial, strong, or full. Does not promote to core.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: importReviewAddressPlaceWorkflowResponseSchema,
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const patchImportReviewAddressPlaceStatusSchema = {
    tags: [Tags.ImportReview],
    summary: "Update address place candidate workflow status",
    description:
        "Marks place evidence ignored, links a matched core place id, or clears the linked place candidate when no non-clearable place/address link exists. Does not promote to core.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        properties: {
            place_candidate_status: { type: "string", enum: ["ignored"] },
            matched_core_place_id: { type: "string", nullable: true, pattern: "^\\d+$" },
            clear_linked_place_candidate: { type: "boolean" },
        },
        additionalProperties: false,
    },
    response: {
        200: importReviewAddressPlaceWorkflowResponseSchema,
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const addressAdminInferenceVerificationSampleSchema = {
    type: "object",
    required: [
        "address_candidate_id",
        "component_type_code",
        "language_code",
        "component_value",
    ],
    properties: {
        address_candidate_id: { type: "string" },
        component_type_code: { type: "string" },
        language_code: { type: "string" },
        component_value: { type: "string" },
        match_type: { type: "string", nullable: true },
        confidence_score: { type: "number", nullable: true },
        boundary_status: { type: "string", nullable: true },
        address_usage: { type: "string", nullable: true },
        source_admin_area_id: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const addressValidationIssueSchema = {
    type: "object",
    required: ["code", "message", "severity"],
    properties: {
        code: { type: "string" },
        message: { type: "string" },
        severity: { type: "string", enum: ["error", "warning"] },
        field: { type: "string" },
        component_id: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const postImportReviewAddressValidateSchema = {
    tags: [Tags.ImportReview],
    summary: "Validate address candidates before promotion",
    description:
        "Runs promotion-readiness checks on import_review.address_candidates and address_components. " +
        "Persists validation_status, promotion_blockers, promotion_warnings, and validated_at. Does not promote to core.",
    security: [...bearerAuth],
    body: {
        type: "object",
        properties: {
            review_batch_id: { type: "string", pattern: "^\\d+$" },
            candidate_ids: {
                type: "array",
                items: { type: "string", pattern: "^\\d+$" },
            },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["review_batch_id", "candidate_count", "summary", "results"],
            properties: {
                review_batch_id: { type: "string", nullable: true },
                candidate_count: { type: "integer", minimum: 0 },
                summary: {
                    type: "object",
                    required: ["blocked", "valid_with_warnings", "valid"],
                    properties: {
                        blocked: { type: "integer", minimum: 0 },
                        valid_with_warnings: { type: "integer", minimum: 0 },
                        valid: { type: "integer", minimum: 0 },
                    },
                    additionalProperties: false,
                },
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        required: [
                            "address_candidate_id",
                            "validation_status",
                            "promotion_blockers",
                            "promotion_warnings",
                            "validation_errors",
                            "validation_warnings",
                            "validated_at",
                        ],
                        properties: {
                            address_candidate_id: { type: "string" },
                            validation_status: {
                                type: "string",
                                enum: ["blocked", "valid_with_warnings", "valid"],
                            },
                            promotion_blockers: {
                                type: "array",
                                items: addressValidationIssueSchema,
                            },
                            promotion_warnings: {
                                type: "array",
                                items: addressValidationIssueSchema,
                            },
                            validation_errors: {
                                type: "array",
                                items: addressValidationIssueSchema,
                            },
                            validation_warnings: {
                                type: "array",
                                items: addressValidationIssueSchema,
                            },
                            validated_at: { type: "string", format: "date-time" },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewValidationSummarySchema = {
    type: "object",
    required: ["blocked", "valid_with_warnings", "valid"],
    properties: {
        blocked: { type: "integer", minimum: 0 },
        valid_with_warnings: { type: "integer", minimum: 0 },
        valid: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

export const postImportReviewPlaceValidateSchema = {
    tags: [Tags.ImportReview],
    summary: "Validate place candidates before promotion",
    description:
        "Runs review-time promotion-readiness checks on import_review.place_candidates. Persists validation_errors and validation_warnings only. Does not promote to core.",
    security: [...bearerAuth],
    body: {
        type: "object",
        properties: {
            review_batch_id: { type: "string", pattern: "^\\d+$" },
            candidate_ids: {
                type: "array",
                items: { type: "string", pattern: "^\\d+$" },
            },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["review_batch_id", "candidate_count", "summary", "results"],
            properties: {
                review_batch_id: { type: "string", nullable: true },
                candidate_count: { type: "integer", minimum: 0 },
                summary: importReviewValidationSummarySchema,
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        required: [
                            "place_candidate_id",
                            "validation_status",
                            "validation_errors",
                            "validation_warnings",
                            "validated_at",
                        ],
                        properties: {
                            place_candidate_id: { type: "string" },
                            validation_status: {
                                type: "string",
                                enum: ["blocked", "valid_with_warnings", "valid"],
                            },
                            validation_errors: { type: "array", items: addressValidationIssueSchema },
                            validation_warnings: { type: "array", items: addressValidationIssueSchema },
                            validated_at: { type: "string", format: "date-time" },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPlaceAddressLinkValidateSchema = {
    tags: [Tags.ImportReview],
    summary: "Validate place/address links before promotion",
    description:
        "Runs review-time checks on import_review.place_address_links and persists validation_status, validation_errors, and validation_warnings. Does not promote to core.",
    security: [...bearerAuth],
    body: {
        type: "object",
        properties: {
            review_batch_id: { type: "string", pattern: "^\\d+$" },
            link_ids: {
                type: "array",
                items: { type: "string", pattern: "^\\d+$" },
            },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["review_batch_id", "link_count", "summary", "results"],
            properties: {
                review_batch_id: { type: "string", nullable: true },
                link_count: { type: "integer", minimum: 0 },
                summary: importReviewValidationSummarySchema,
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        required: [
                            "place_address_link_id",
                            "validation_status",
                            "validation_errors",
                            "validation_warnings",
                            "validated_at",
                        ],
                        properties: {
                            place_address_link_id: { type: "string" },
                            validation_status: {
                                type: "string",
                                enum: ["blocked", "valid_with_warnings", "valid"],
                            },
                            validation_errors: { type: "array", items: addressValidationIssueSchema },
                            validation_warnings: { type: "array", items: addressValidationIssueSchema },
                            validated_at: { type: "string", format: "date-time" },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const addressPromotionResponseSchema = {
    type: "object",
    required: [
        "dry_run",
        "review_batch_id",
        "candidate_count",
        "promoted",
        "skipped",
        "duplicate_review_needed",
        "failed",
        "warnings",
        "items",
        "finished_at",
    ],
    properties: {
        dry_run: { type: "boolean" },
        review_batch_id: { type: "string", nullable: true },
        candidate_count: { type: "integer", minimum: 0 },
        promoted: { type: "integer", minimum: 0 },
        skipped: { type: "integer", minimum: 0 },
        duplicate_review_needed: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
        warnings: { type: "array", items: { type: "string" } },
        items: {
            type: "array",
            items: {
                type: "object",
                required: [
                    "address_candidate_id",
                    "external_id",
                    "outcome",
                    "reasons",
                    "core_address_id",
                    "promotion_warnings",
                    "promotion_blockers",
                ],
                properties: {
                    address_candidate_id: { type: "string" },
                    external_id: { type: "string", nullable: true },
                    outcome: {
                        type: "string",
                        enum: [
                            "promoted",
                            "would_promote",
                            "skipped",
                            "duplicate_review_needed",
                            "failed",
                        ],
                    },
                    reasons: { type: "array", items: { type: "string" } },
                    core_address_id: { type: "string", nullable: true },
                    promotion_warnings: { type: "array", items: { type: "object" } },
                    promotion_blockers: { type: "array", items: { type: "object" } },
                },
                additionalProperties: false,
            },
        },
        finished_at: { type: "string", format: "date-time" },
        disabled_because_env_flag_false: { type: "boolean" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

const addressPromotionBodySchema = {
    type: "object",
    properties: {
        review_batch_id: { type: "string", pattern: "^\\d+$" },
        candidate_ids: {
            type: "array",
            items: { type: "string", pattern: "^\\d+$" },
        },
        confirm_warnings: { type: "boolean", default: false },
    },
    additionalProperties: false,
} as const;

const splitPromotionResponseSchema = {
    type: "object",
    required: [
        "dry_run",
        "review_batch_id",
        "candidate_count",
        "promoted",
        "skipped",
        "failed",
        "warnings",
        "items",
        "finished_at",
    ],
    properties: {
        dry_run: { type: "boolean" },
        review_batch_id: { type: "string", nullable: true },
        candidate_count: { type: "integer", minimum: 0 },
        promoted: { type: "integer", minimum: 0 },
        skipped: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
        warnings: { type: "array", items: { type: "string" } },
        items: {
            type: "array",
            items: {
                type: "object",
                required: [
                    "candidate_id",
                    "external_id",
                    "outcome",
                    "reasons",
                    "core_id",
                    "promotion_warnings",
                    "promotion_blockers",
                ],
                properties: {
                    candidate_id: { type: "string" },
                    external_id: { type: "string", nullable: true },
                    outcome: {
                        type: "string",
                        enum: ["promoted", "would_promote", "skipped", "failed"],
                    },
                    reasons: { type: "array", items: { type: "string" } },
                    core_id: { type: "string", nullable: true },
                    promotion_warnings: { type: "array", items: { type: "object" } },
                    promotion_blockers: { type: "array", items: { type: "object" } },
                },
                additionalProperties: false,
            },
        },
        finished_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const linkPromotionBodySchema = {
    type: "object",
    properties: {
        review_batch_id: { type: "string", pattern: "^\\d+$" },
        link_ids: {
            type: "array",
            items: { type: "string", pattern: "^\\d+$" },
        },
        confirm_warnings: { type: "boolean", default: false },
    },
    additionalProperties: false,
} as const;

export const postImportReviewAddressPromotionDryRunSchema = {
    tags: [Tags.ImportReview],
    summary: "Dry-run address promotion to core",
    description:
        "Evaluates import_review.address_candidates for promotion without writing core rows. " +
        "Requires review_status=approved, validation_status valid/valid_with_warnings (with confirm_warnings when warnings), empty promotion_blockers.",
    security: [...bearerAuth],
    body: addressPromotionBodySchema,
    response: {
        200: addressPromotionResponseSchema,
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewAddressPromotionSchema = {
    tags: [Tags.ImportReview],
    summary: "Promote approved address candidates to core",
    description:
        "Transactionally inserts core.core_addresses + core.core_address_components from review components, " +
        "and marks candidates promoted. Place/address links are promoted separately after both sides exist in core. " +
        "Blocked candidates and duplicates are skipped or flagged duplicate_review_needed.",
    security: [...bearerAuth],
    body: addressPromotionBodySchema,
    response: {
        200: addressPromotionResponseSchema,
        400: messageSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPlacePromotionSchema = {
    tags: [Tags.ImportReview],
    summary: "Promote approved place candidates to core",
    description:
        "Promotes import_review.place_candidates to core.core_places and core.core_place_names. Requires approved review status, valid validation result, no blockers, and no existing core duplicate.",
    security: [...bearerAuth],
    body: addressPromotionBodySchema,
    response: {
        200: splitPromotionResponseSchema,
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPlaceAddressLinkPromotionSchema = {
    tags: [Tags.ImportReview],
    summary: "Promote approved place/address links to core",
    description:
        "Promotes import_review.place_address_links to core.core_place_addresses only when both sides resolve to existing core rows.",
    security: [...bearerAuth],
    body: linkPromotionBodySchema,
    response: {
        200: splitPromotionResponseSchema,
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewAddressAdminInferenceSchema = {
    tags: [Tags.ImportReview],
    summary: "Infer address admin components for a review batch",
    description:
        "Runs import_review.infer_address_admin_components for address candidates with point_geom. " +
        "Inserts idempotent inferred components from core.core_admin_areas (respecting boundary_status and address_usage), " +
        "updates matched_admin_area_id and admin_match_* on candidates. Does not modify is_reviewed components.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["review_batch_id"],
        properties: {
            review_batch_id: { type: "string", pattern: "^\\d+$" },
            nearest_village_meters: {
                type: "number",
                minimum: 1,
                maximum: 50000,
                default: 3000,
                description: "Max distance (m) for nearest-village centroid locality hint when no village polygon match.",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["review_batch_id", "run", "verification"],
            properties: {
                review_batch_id: { type: "string" },
                run: {
                    type: "object",
                    required: [
                        "candidates_with_point",
                        "candidates_matched",
                        "components_inserted",
                        "candidates_updated",
                    ],
                    properties: {
                        candidates_with_point: { type: "string" },
                        candidates_matched: { type: "string" },
                        components_inserted: { type: "string" },
                        candidates_updated: { type: "string" },
                    },
                    additionalProperties: false,
                },
                verification: {
                    type: "object",
                    required: [
                        "matched_admin_area_count",
                        "candidates_with_point",
                        "components_by_type_language",
                        "sample_components",
                    ],
                    properties: {
                        matched_admin_area_count: { type: "string" },
                        candidates_with_point: { type: "string" },
                        components_by_type_language: {
                            type: "array",
                            items: {
                                type: "object",
                                required: ["component_type_code", "language_code", "row_count"],
                                properties: {
                                    component_type_code: { type: "string" },
                                    language_code: { type: "string" },
                                    row_count: { type: "string" },
                                },
                                additionalProperties: false,
                            },
                        },
                        sample_components: {
                            type: "array",
                            items: addressAdminInferenceVerificationSampleSchema,
                        },
                    },
                    additionalProperties: false,
                },
            },
            additionalProperties: false,
        },
        400: messageSchema,
        401: messageSchema,
        404: messageSchema,
        503: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const publishBatchDryRunSampleErrorSchema = {
    type: "object",
    required: ["candidate_id", "external_id", "code", "message"],
    properties: {
        candidate_id: { type: ["integer", "null"] },
        external_id: { type: ["string", "null"] },
        code: { type: "string" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

const publishBatchDryRunResponseBodySchema = {
    type: "object",
    required: [
        "status",
        "batch_id",
        "entity_family",
        "total",
        "ready_count",
        "blocked_count",
        "failed_count",
        "would_insert_count",
        "would_update_count",
        "duplicate_fixed_count",
        "duplicate_blocked_count",
        "duplicate_samples",
        "sample_errors",
        "summary",
    ],
    properties: {
        status: { type: "string", enum: ["passed", "failed"] },
        batch_id: { type: "integer", minimum: 1 },
        entity_family: { type: "string" },
        total: { type: "integer", minimum: 0 },
        ready_count: { type: "integer", minimum: 0 },
        blocked_count: { type: "integer", minimum: 0 },
        failed_count: { type: "integer", minimum: 0 },
        would_insert_count: { type: "integer", minimum: 0 },
        would_update_count: { type: "integer", minimum: 0 },
        duplicate_fixed_count: { type: "integer", minimum: 0 },
        duplicate_blocked_count: { type: "integer", minimum: 0 },
        duplicate_samples: {
            type: "array",
            items: {
                type: "object",
                required: ["candidate_id", "action", "message"],
                properties: {
                    candidate_id: { type: "integer", minimum: 1 },
                    external_id: { type: ["string", "null"] },
                    action: {
                        type: "string",
                        enum: [
                            "converted_to_update",
                            "blocked_duplicate",
                            "in_review_duplicate",
                        ],
                    },
                    message: { type: "string" },
                    core_street_id: { type: ["integer", "null"] },
                },
                additionalProperties: false,
            },
        },
        sample_errors: {
            type: "array",
            items: publishBatchDryRunSampleErrorSchema,
        },
        summary: { type: "object", additionalProperties: true },
    },
    additionalProperties: false,
} as const;

export const postImportReviewPromotionBatchDryRunSchema = {
    tags: [Tags.ImportReview],
    summary: "Dry-run publish batch (no core writes)",
    description:
        "Checks pending ready items for insert/update targets. Persists summary.dry_run_result (passed|failed). Does not write to core or change publish_status.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        properties: {
            confirm_large_batch: { type: "boolean" },
        },
        additionalProperties: false,
    },
    response: {
        200: publishBatchDryRunResponseBodySchema,
        400: publishBatchDryRunResponseBodySchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: publishBatchDryRunResponseBodySchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchPromoteSchema = {
    tags: [Tags.ImportReview],
    summary: "Promote validated publish batch to core (buildings and places)",
    description:
        "Writes approved building and place candidates to core.core_map_buildings and core.core_places (including place names and sources). Returns 202 immediately; poll progress and logs endpoints.",
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
            confirm_warnings: { type: "boolean", default: false },
            allow_high_risk_families: { type: "boolean", default: false },
            confirm_large_batch: { type: "boolean", default: false },
            warning_confirmation_note: { type: "string", minLength: 1, maxLength: 4000 },
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewPromotionBatchRetryFailedReadySchema = {
    tags: [Tags.ImportReview],
    summary: "Create retry publish batch from failed ready items",
    description:
        "Creates a new draft publish batch from publish items on the source batch that failed promotion but had validation_result.status=ready. Does not modify the source batch. User must validate the new batch before promotion.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        properties: {
            batch_name: { type: "string", minLength: 1, maxLength: 200 },
            note: { type: "string", maxLength: 4000 },
            confirm_large_batch: { type: "boolean", default: false },
            allow_high_risk_families: { type: "boolean", default: false },
            mixed_high_risk_confirm: { type: "boolean", default: false },
        },
        additionalProperties: false,
    },
    response: {
        201: {
            type: "object",
            required: [
                "id",
                "public_id",
                "review_batch_id",
                "source_publish_batch_id",
                "failed_ready_source_count",
                "failed_ready_retry_count",
                "total_item_count",
                "message",
                "batch_id",
                "publish_batch_id",
            ],
            properties: {
                id: { type: "integer", minimum: 1 },
                public_id: { type: "string" },
                review_batch_id: { type: "integer" },
                source_publish_batch_id: { type: "string" },
                failed_ready_source_count: { type: "integer", minimum: 0 },
                failed_ready_retry_count: { type: "integer", minimum: 0 },
                total_item_count: { type: "integer", minimum: 0 },
                message: { type: "string" },
                batch_id: { type: "string" },
                publish_batch_id: { type: "string" },
                batch: importReviewPublishBatchDetailSchema,
                count_by_family: {
                    type: "object",
                    additionalProperties: { type: "integer", minimum: 0 },
                },
            },
            additionalProperties: true,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        409: importReview409ResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const roadDryRunSampleItemSchema = {
    type: "object",
    required: [
        "publish_item_id",
        "review_candidate_id",
        "external_id",
        "canonical_name",
        "dry_run_status",
        "blocking_reasons",
        "warning_codes",
        "info_codes",
    ],
    properties: {
        publish_item_id: { type: "string" },
        review_candidate_id: { type: "string" },
        external_id: { type: "string", nullable: true },
        canonical_name: { type: "string", nullable: true },
        dry_run_status: {
            type: "string",
            enum: ["safe_to_promote", "promote_with_warning", "needs_manual_review", "blocked"],
        },
        blocking_reasons: { type: "array", items: { type: "string" } },
        warning_codes: { type: "array", items: { type: "string" } },
        info_codes: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
} as const;

const roadDryRunItemSchema = {
    type: "object",
    required: [
        "publish_item_id",
        "review_candidate_id",
        "external_id",
        "canonical_name",
        "publish_action",
        "dry_run_status",
        "blocking_reasons",
        "warning_codes",
        "info_codes",
        "matched_core_id",
        "geometry_summary",
        "connectivity_summary",
        "duplicate_summary",
        "routing_summary",
        "can_promote_later",
    ],
    properties: {
        publish_item_id: { type: "string" },
        review_candidate_id: { type: "string" },
        external_id: { type: "string", nullable: true },
        canonical_name: { type: "string", nullable: true },
        publish_action: { type: "string" },
        dry_run_status: {
            type: "string",
            enum: ["safe_to_promote", "promote_with_warning", "needs_manual_review", "blocked"],
        },
        blocking_reasons: { type: "array", items: { type: "string" } },
        warning_codes: { type: "array", items: { type: "string" } },
        info_codes: { type: "array", items: { type: "string" } },
        matched_core_id: { type: "string", nullable: true },
        geometry_summary: { type: "object", nullable: true, additionalProperties: true },
        connectivity_summary: { type: "object", nullable: true, additionalProperties: true },
        duplicate_summary: { type: "object", nullable: true, additionalProperties: true },
        routing_summary: { type: "object", nullable: true, additionalProperties: true },
        can_promote_later: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const roadDryRunSummaryBlockSchema = {
    type: "object",
    required: ["status", "checked_count", "passed_count", "failed_count", "sample_errors", "ran_at"],
    properties: {
        status: { type: "string", enum: ["passed", "failed"] },
        checked_count: { type: "integer", minimum: 0 },
        passed_count: { type: "integer", minimum: 0 },
        failed_count: { type: "integer", minimum: 0 },
        sample_errors: {
            type: "array",
            items: {
                type: "object",
                required: ["publish_item_id", "code", "message"],
                properties: {
                    publish_item_id: { type: "string" },
                    review_candidate_id: { type: "string", nullable: true },
                    external_id: { type: "string", nullable: true },
                    code: { type: "string" },
                    message: { type: "string" },
                },
                additionalProperties: false,
            },
        },
        ran_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const routingReadinessSummaryBlockSchema = {
    type: "object",
    required: [
        "status",
        "type",
        "checked_count",
        "failed_count",
        "warning_count",
        "sample_errors",
        "sample_warnings",
        "ran_at",
    ],
    properties: {
        status: { type: "string", enum: ["passed", "failed"] },
        type: { type: "string", enum: ["db_routing_readiness"] },
        checked_count: { type: "integer", minimum: 0 },
        failed_count: { type: "integer", minimum: 0 },
        warning_count: { type: "integer", minimum: 0 },
        sample_errors: {
            type: "array",
            items: {
                type: "object",
                required: ["publish_item_id", "code", "message"],
                properties: {
                    publish_item_id: { type: "string" },
                    review_candidate_id: { type: "string", nullable: true },
                    external_id: { type: "string", nullable: true },
                    code: { type: "string" },
                    message: { type: "string" },
                },
                additionalProperties: false,
            },
        },
        sample_warnings: {
            type: "array",
            items: {
                type: "object",
                required: ["publish_item_id", "code", "message"],
                properties: {
                    publish_item_id: { type: "string" },
                    review_candidate_id: { type: "string", nullable: true },
                    external_id: { type: "string", nullable: true },
                    code: { type: "string" },
                    message: { type: "string" },
                },
                additionalProperties: false,
            },
        },
        ran_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const roadDryRunSummaryResponseSchema = {
    type: "object",
    required: ["batch_id", "road_dry_run", "routing_readiness_validation"],
    properties: {
        batch_id: { type: "string" },
        road_dry_run: roadDryRunSummaryBlockSchema,
        routing_readiness_validation: routingReadinessSummaryBlockSchema,
    },
    additionalProperties: false,
} as const;

const roadDryRunResultSchema = {
    type: "object",
    required: [
        "batch_id",
        "review_batch_id",
        "total_count",
        "safe_to_promote_count",
        "promote_with_warning_count",
        "needs_manual_review_count",
        "blocked_count",
        "warning_count",
        "error_count",
        "duplicate_risk_count",
        "connectivity_warning_count",
        "unsplit_intersection_count",
        "would_insert_count",
        "would_update_count",
        "by_warning_code",
        "by_error_code",
        "by_road_class",
        "sample_blocked_items",
        "sample_warning_items",
        "disabled_because_env_flag_false",
        "items",
        "finished_at",
        "message",
    ],
    properties: {
        batch_id: { type: "string" },
        review_batch_id: { type: "string", nullable: true },
        total_count: { type: "integer", minimum: 0 },
        safe_to_promote_count: { type: "integer", minimum: 0 },
        promote_with_warning_count: { type: "integer", minimum: 0 },
        needs_manual_review_count: { type: "integer", minimum: 0 },
        blocked_count: { type: "integer", minimum: 0 },
        warning_count: { type: "integer", minimum: 0 },
        error_count: { type: "integer", minimum: 0 },
        duplicate_risk_count: { type: "integer", minimum: 0 },
        connectivity_warning_count: { type: "integer", minimum: 0 },
        unsplit_intersection_count: { type: "integer", minimum: 0 },
        would_insert_count: { type: "integer", minimum: 0 },
        would_update_count: { type: "integer", minimum: 0 },
        by_warning_code: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        by_error_code: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        by_road_class: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        sample_blocked_items: { type: "array", items: roadDryRunSampleItemSchema },
        sample_warning_items: { type: "array", items: roadDryRunSampleItemSchema },
        disabled_because_env_flag_false: { type: "boolean" },
        items: { type: "array", items: roadDryRunItemSchema },
        finished_at: { type: "string" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const postImportReviewPromotionRoadDryRunSchema = {
    tags: [Tags.ImportReview],
    summary: "Run road promotion dry-run for a publish batch",
    description:
        "Evaluates pending ready road publish items with road dry-run and DB routing-readiness validation (no Valhalla). Persists summary.road_dry_run and summary.routing_readiness_validation. Does not write to core.core_streets.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        properties: {
            include_warnings: { type: "boolean", default: false },
            revalidate: { type: "boolean", default: true },
            connectivity_threshold_m: { type: "number", minimum: 5, maximum: 250, default: 35 },
            duplicate_threshold_m: { type: "number", minimum: 1, maximum: 100, default: 15 },
        },
        additionalProperties: false,
    },
    response: {
        200: roadDryRunSummaryResponseSchema,
        400: messageSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        409: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPromotionRoadDryRunSchema = {
    tags: [Tags.ImportReview],
    summary: "Get cached road promotion dry-run result",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: roadDryRunSummaryResponseSchema,
        400: messageSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const routingBarrierDryRunResultSchema = {
    type: "object",
    required: [
        "batch_id",
        "review_batch_id",
        "total_count",
        "safe_to_promote_count",
        "promote_with_warning_count",
        "needs_manual_review_count",
        "blocked_count",
        "warning_count",
        "error_count",
        "duplicate_risk_count",
        "network_warning_count",
        "would_insert_count",
        "would_update_count",
        "by_warning_code",
        "by_error_code",
        "by_barrier_type",
        "sample_blocked_items",
        "sample_warning_items",
        "disabled_because_env_flag_false",
        "items",
        "finished_at",
        "message",
    ],
    properties: {
        batch_id: { type: "string" },
        review_batch_id: { type: "string", nullable: true },
        total_count: { type: "integer", minimum: 0 },
        safe_to_promote_count: { type: "integer", minimum: 0 },
        promote_with_warning_count: { type: "integer", minimum: 0 },
        needs_manual_review_count: { type: "integer", minimum: 0 },
        blocked_count: { type: "integer", minimum: 0 },
        warning_count: { type: "integer", minimum: 0 },
        error_count: { type: "integer", minimum: 0 },
        duplicate_risk_count: { type: "integer", minimum: 0 },
        network_warning_count: { type: "integer", minimum: 0 },
        would_insert_count: { type: "integer", minimum: 0 },
        would_update_count: { type: "integer", minimum: 0 },
        by_warning_code: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        by_error_code: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        by_barrier_type: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        sample_blocked_items: { type: "array", items: { type: "object", additionalProperties: true } },
        sample_warning_items: { type: "array", items: { type: "object", additionalProperties: true } },
        disabled_because_env_flag_false: { type: "boolean" },
        items: { type: "array", items: { type: "object", additionalProperties: true } },
        finished_at: { type: "string" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const postImportReviewPromotionRoutingBarrierDryRunSchema = {
    tags: [Tags.ImportReview],
    summary: "Run routing barrier promotion dry-run for a publish batch",
    description:
        "Evaluates routing barrier publish items with blocking checks and network impact warnings. Does not write routing graph rows.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        properties: {
            include_warnings: { type: "boolean", default: false },
            revalidate: { type: "boolean", default: true },
            nearby_core_road_threshold_m: { type: "number", minimum: 1, maximum: 250, default: 30 },
            nearby_review_road_threshold_m: { type: "number", minimum: 1, maximum: 250, default: 30 },
            duplicate_threshold_m: { type: "number", minimum: 1, maximum: 100, default: 10 },
        },
        additionalProperties: false,
    },
    response: {
        200: routingBarrierDryRunResultSchema,
        400: messageSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewPromotionRoutingBarrierDryRunSchema = {
    tags: [Tags.ImportReview],
    summary: "Get cached routing barrier promotion dry-run result",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: routingBarrierDryRunResultSchema,
        400: messageSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewFamilyParamProperties = {
    family: {
        type: "string",
        enum: [...IMPORT_REVIEW_ENTITY_FAMILIES],
    },
} as const;

const importReviewFamilyCandidatesListQuerystring = {
    type: "object",
    properties: {
        ...importReviewScopeQueryProperties,
        match_status: { type: "string", minLength: 1 },
        auto_action: { type: "string", minLength: 1 },
        review_status: { type: "string", minLength: 1 },
        review_decision: { type: "string", minLength: 1 },
        class_code: { type: "string", minLength: 1 },
        promotion_status: { type: "string", minLength: 1 },
        q: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        offset: { type: "integer", minimum: 0, default: 0 },
        sort: { type: "string", enum: [...importReviewBuildingSortEnum], default: "updated_at_desc" },
        include_geometry: { type: "boolean", default: false },
        include_total: {
            type: "boolean",
            default: true,
            description: "When false, skips COUNT(*) (use has_more; cache total from offset=0).",
        },
    },
    additionalProperties: false,
} as const;

export const getImportReviewFamilyCandidatesSchema = {
    tags: [Tags.ImportReview],
    summary: "List import-review candidates by entity family",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family"],
        properties: importReviewFamilyParamProperties,
    },
    querystring: importReviewFamilyCandidatesListQuerystring,
    response: {
        200: importReviewBuildingsListResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewFamilyCandidateByIdSchema = {
    tags: [Tags.ImportReview],
    summary: "Get one import-review candidate by entity family and id",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family", "id"],
        properties: {
            ...importReviewFamilyParamProperties,
            id: { type: "string", pattern: "^\\d+$" },
        },
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
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewFamilyFilterOptionsSchema = {
    tags: [Tags.ImportReview],
    summary: "Distinct filter values for an import-review entity family",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family"],
        properties: importReviewFamilyParamProperties,
    },
    querystring: {
        type: "object",
        properties: importReviewScopeQueryProperties,
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: [
                "source_snapshot_version",
                "review_batch_id",
                "source_snapshot_id_local",
            ],
            properties: {
                ...importReviewEnvelopeResponseProperties,
            },
            additionalProperties: {
                type: "array",
                items: { type: "string" },
            },
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewReferenceOptionItemSchema = {
    type: "object",
    required: ["id"],
    properties: {
        id: { type: "string" },
        code: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const importReviewFormOptionItemSchema = {
    type: "object",
    required: ["value", "label"],
    properties: {
        id: { type: "string" },
        value: { anyOf: [{ type: "string" }, { type: "number" }] },
        label: { type: "string" },
        code: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        parent_id: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

/** POI categories need raw fields in the JSON response (not only value/label). */
const importReviewPoiCategoryFormOptionSchema = {
    type: "object",
    required: ["id", "value", "label", "code", "name", "name_mm", "parent_id"],
    properties: {
        id: { type: "string" },
        value: { type: "string" },
        label: { type: "string" },
        code: { type: "string" },
        name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        parent_id: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const importReviewAdminAreaFormOptionSchema = {
    type: "object",
    required: ["id", "value", "label", "canonical_name", "admin_level_id"],
    properties: {
        id: { type: "string" },
        value: { anyOf: [{ type: "string" }, { type: "number" }] },
        label: { type: "string" },
        code: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        canonical_name: { type: "string" },
        admin_level_id: { type: "string" },
        parent_id: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

export const getImportReviewFormOptionsSchema = {
    tags: [Tags.ImportReview],
    summary: "Form dropdown options for import-review override editors",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: [
                "admin_areas",
                "admin_levels",
                "road_classes",
                "poi_categories",
                "building_types",
                "landuse_classes",
                "waterway_classes",
                "water_classes",
                "barrier_types",
                "surface_presets",
            ],
            properties: {
                admin_areas: { type: "array", items: importReviewAdminAreaFormOptionSchema },
                admin_levels: { type: "array", items: importReviewFormOptionItemSchema },
                road_classes: { type: "array", items: importReviewFormOptionItemSchema },
                poi_categories: { type: "array", items: importReviewPoiCategoryFormOptionSchema },
                building_types: { type: "array", items: importReviewFormOptionItemSchema },
                landuse_classes: { type: "array", items: importReviewFormOptionItemSchema },
                waterway_classes: { type: "array", items: importReviewFormOptionItemSchema },
                water_classes: { type: "array", items: importReviewFormOptionItemSchema },
                barrier_types: { type: "array", items: importReviewFormOptionItemSchema },
                surface_presets: { type: "array", items: importReviewFormOptionItemSchema },
            },
            additionalProperties: false,
        },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewReferenceOptionsSchema = {
    tags: [Tags.ImportReview],
    summary: "Reference dropdown options for import-review override editors",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: [
                "ref_poi_categories",
                "ref_road_classes",
                "ref_building_types",
                "ref_admin_levels",
                "ref_address_component_types",
                "ref_source_types",
                "core_admin_areas",
            ],
            properties: {
                ref_poi_categories: { type: "array", items: importReviewReferenceOptionItemSchema },
                ref_road_classes: { type: "array", items: importReviewReferenceOptionItemSchema },
                ref_building_types: {
                    type: "array",
                    items: importReviewReferenceOptionItemSchema,
                    description:
                        "Active flat building types only (ref.ref_building_types where is_active and parent_id IS NULL).",
                },
                ref_admin_levels: { type: "array", items: importReviewReferenceOptionItemSchema },
                ref_address_component_types: { type: "array", items: importReviewReferenceOptionItemSchema },
                ref_source_types: { type: "array", items: importReviewReferenceOptionItemSchema },
                core_admin_areas: { type: "array", items: importReviewReferenceOptionItemSchema },
            },
            additionalProperties: false,
        },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const patchImportReviewFamilyCandidateDecisionSchema = {
    tags: [Tags.ImportReview],
    summary: "Patch review decision for one candidate in any entity family",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family", "id"],
        properties: {
            ...importReviewFamilyParamProperties,
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    body: patchImportReviewBuildingDecisionBodyOpenApi,
    response: {
        200: importReviewBuildingItemSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const patchImportReviewCandidateColumnsBodyOpenApi = {
    type: "object",
    required: ["fields"],
    properties: {
        ...importReviewScopeQueryProperties,
        fields: importReviewReviewOverridesPatchOpenApi,
        review_note: {
            type: "string",
            nullable: true,
            description: "Optional candidate review_note column update.",
        },
    },
    additionalProperties: false,
} as const;

export const patchImportReviewFamilyCandidateColumnsSchema = {
    tags: [Tags.ImportReview],
    summary: "Patch typed candidate columns (authoritative)",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family", "id"],
        properties: {
            ...importReviewFamilyParamProperties,
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    body: patchImportReviewCandidateColumnsBodyOpenApi,
    response: {
        200: importReviewBuildingItemSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const patchImportReviewFamilyCandidateOverridesSchema = {
    tags: [Tags.ImportReview],
    summary:
        "Deprecated shim: same as PATCH /:family/:id — writes typed columns only",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family", "id"],
        properties: {
            ...importReviewFamilyParamProperties,
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    body: patchImportReviewCandidateOverridesBodyOpenApi,
    response: {
        200: importReviewBuildingItemSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportReviewFamilyBulkDecisionSchema = {
    tags: [Tags.ImportReview],
    summary: "Bulk review decision for candidates in an entity family",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family"],
        properties: importReviewFamilyParamProperties,
    },
    body: postBulkImportReviewBuildingDecisionBodyOpenApi,
    response: {
        200: importReviewBulkDecisionResponseSchema,
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importReviewHistoryFamilySummarySchema = {
    type: "object",
    required: [
        "entity_family",
        "table_name",
        "batch_total",
        "active",
        "pending_review",
        "approved",
        "rejected",
        "needs_review",
        "ignored",
        "merged",
        "ready_for_publish",
        "promoted",
        "promotion_failed",
        "validation_error_count",
        "validation_warning_count",
    ],
    properties: {
        entity_family: { type: "string" },
        table_name: { type: "string" },
        batch_total: { type: "integer", minimum: 0 },
        active: { type: "integer", minimum: 0 },
        pending_review: { type: "integer", minimum: 0 },
        approved: { type: "integer", minimum: 0 },
        rejected: { type: "integer", minimum: 0 },
        needs_review: { type: "integer", minimum: 0 },
        ignored: { type: "integer", minimum: 0 },
        merged: { type: "integer", minimum: 0 },
        ready_for_publish: { type: "integer", minimum: 0 },
        promoted: { type: "integer", minimum: 0 },
        promotion_failed: { type: "integer", minimum: 0 },
        validation_error_count: { type: "integer", minimum: 0 },
        validation_warning_count: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const importReviewHistoryReviewBatchListItemSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "batch_name",
        "source_snapshot_version",
        "source_snapshot_id_local",
        "status",
        "created_at",
        "uploaded_at",
        "validated_at",
        "promoted_at",
        "total_candidate_count",
        "entity_families",
        "counts",
        "counts_by_entity_family",
        "publish_batches",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string" },
        batch_name: { type: "string" },
        source_snapshot_version: { type: "string" },
        source_snapshot_id_local: { type: "string", nullable: true },
        status: { type: "string" },
        created_at: { type: "string", format: "date-time" },
        uploaded_at: { type: "string", format: "date-time" },
        validated_at: { type: "string", format: "date-time", nullable: true },
        promoted_at: { type: "string", format: "date-time", nullable: true },
        total_candidate_count: { type: "integer", minimum: 0 },
        entity_families: { type: "array", items: { type: "string" } },
        counts: { type: "object", additionalProperties: true },
        counts_by_entity_family: {
            type: "array",
            items: importReviewHistoryFamilySummarySchema,
        },
        publish_batches: { type: "object", additionalProperties: true },
    },
    additionalProperties: false,
} as const;

export const getImportReviewHistoryReviewBatchesSchema = {
    tags: [Tags.ImportReview],
    summary: "List import-review upload (review) batches for history",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            status: { type: "string" },
            source_snapshot_version: { type: "string" },
            entity_family: { type: "string" },
            uploaded_after: { type: "string", format: "date-time" },
            uploaded_before: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: importReviewHistoryReviewBatchListItemSchema },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewHistoryReviewBatchByIdSchema = {
    tags: [Tags.ImportReview],
    summary: "Get one import-review upload batch history detail",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewHistoryPublishBatchesSchema = {
    tags: [Tags.ImportReview],
    summary: "List publish batches for history (cross review-batch)",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            status: { type: "string" },
            source_review_batch_id: { type: "string", pattern: "^\\d+$" },
            source_snapshot_version: { type: "string" },
            entity_family: { type: "string" },
            created_after: { type: "string", format: "date-time" },
            created_before: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: { type: "object", additionalProperties: true } },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewHistoryPublishBatchByIdSchema = {
    tags: [Tags.ImportReview],
    summary: "Get one publish batch history detail",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewHistoryPublishBatchItemsSchema = {
    tags: [Tags.ImportReview],
    summary: "List publish batch items for history",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    querystring: {
        type: "object",
        properties: {
            publish_status: {
                type: "string",
                description:
                    "Filter token or publish_status value. Tokens: failed, pending, skipped, promoted, blocked, skipped_blocked.",
            },
            status: {
                type: "string",
                description: "Alias for publish_status (same accepted tokens).",
            },
            entity_family: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: { type: "object", additionalProperties: true } },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportReviewHistoryPublishBatchLogsSchema = {
    tags: [Tags.ImportReview],
    summary: "Get publish batch process-state logs for history",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: importReviewApiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: importReviewApiErrorResponseSchema,
        500: importReviewApiErrorResponseSchema,
    },
} satisfies FastifySchema;
