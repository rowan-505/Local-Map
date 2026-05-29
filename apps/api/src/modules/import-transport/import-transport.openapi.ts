import type { FastifySchema } from "fastify";

import { apiErrorResponseSchema } from "../../lib/api-error-response.js";
import {
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    notFoundSchema,
    Tags,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";
import { IMPORT_TRANSPORT_FAMILIES } from "./import-transport.config.js";

const importTransportScopeQueryProperties = {
    import_batch_id: { type: "integer", minimum: 1 },
    source_snapshot_version: { type: "string", minLength: 1 },
    latest: { type: "boolean" },
} as const;

const importTransportFamilyParamProperties = {
    family: {
        type: "string",
        enum: [...IMPORT_TRANSPORT_FAMILIES],
    },
} as const;

const importTransportCandidateItemSchema = {
    type: "object",
    additionalProperties: true,
    properties: {
        id: { type: "string" },
        external_id: { type: ["string", "null"] },
        review_status: { type: "string" },
        review_decision: { type: ["string", "null"] },
        promotion_status: { type: ["string", "null"] },
        validation_status: { type: ["string", "null"] },
        confidence_score: { type: ["number", "null"] },
        review_note: { type: ["string", "null"] },
        normalized_data: { type: ["object", "null"], additionalProperties: true },
        source_refs: { type: ["object", "null"], additionalProperties: true },
        created_at: { type: ["string", "null"] },
        updated_at: { type: ["string", "null"] },
    },
} as const;

const importTransportCandidatesListResponseSchema = {
    type: "object",
    required: ["items", "import_batch_id", "selected_by"],
    properties: {
        items: { type: "array", items: importTransportCandidateItemSchema },
        total: { type: "integer" },
        has_more: { type: "boolean" },
        import_batch_id: { type: "string" },
        source_snapshot_version: { type: ["string", "null"] },
        selected_by: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const getImportTransportSummarySchema = {
    tags: [Tags.ImportTransport],
    summary: "Import transport batch summary",
    description:
        "Per-family candidate counts for a resolved import_transport import batch. Provide exactly one of import_batch_id or source_snapshot_version.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: { ...importTransportScopeQueryProperties },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["import_batch_id", "selected_by", "families"],
            properties: {
                import_batch_id: { type: "string" },
                source_snapshot_version: { type: ["string", "null"] },
                selected_by: { type: "string" },
                batch_name: { type: "string" },
                import_status: { type: "string" },
                validation_status: { type: "string" },
                validation: {
                    type: "object",
                    required: ["blocked_count", "warning_count"],
                    properties: {
                        blocked_count: { type: "integer" },
                        warning_count: { type: "integer" },
                    },
                },
                rollup: {
                    type: "object",
                    required: ["total_candidates", "pending", "ready_for_promotion", "promoted"],
                    properties: {
                        total_candidates: { type: "integer" },
                        pending: { type: "integer" },
                        ready_for_promotion: { type: "integer" },
                        promoted: { type: "integer" },
                    },
                },
                families: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["entity_family", "total", "pending", "approved", "promoted"],
                        properties: {
                            entity_family: { type: "string", enum: [...IMPORT_TRANSPORT_FAMILIES] },
                            total: { type: "integer" },
                            pending: { type: "integer" },
                            approved: { type: "integer" },
                            promoted: { type: "integer" },
                        },
                    },
                },
            },
        },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportBatchesSchema = {
    tags: [Tags.ImportTransport],
    summary: "List import transport batches",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
            import_status: { type: "string" },
            validation_status: { type: "string" },
            source_snapshot_version: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: { type: "object", additionalProperties: true } },
                total: { type: "integer" },
                limit: { type: "integer" },
                offset: { type: "integer" },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportOptionsSchema = {
    tags: [Tags.ImportTransport],
    summary: "Import transport UI options",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            additionalProperties: true,
        },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportFamilyCandidatesSchema = {
    tags: [Tags.ImportTransport],
    summary: "List import transport candidates by family",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family"],
        properties: importTransportFamilyParamProperties,
    },
    querystring: {
        type: "object",
        properties: {
            ...importTransportScopeQueryProperties,
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
            sort: { type: "string" },
            review_status: { type: "string" },
            review_decision: { type: "string" },
            promotion_status: { type: "string" },
            validation_status: { type: "string" },
            q: { type: "string" },
            include_total: { type: "boolean" },
            include_geometry: { type: "boolean" },
            include_promoted: { type: "boolean", default: false },
        },
        additionalProperties: false,
    },
    response: {
        200: importTransportCandidatesListResponseSchema,
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportFamilyCandidateByIdSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get one import transport candidate",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family", "id"],
        properties: {
            ...importTransportFamilyParamProperties,
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    querystring: {
        type: "object",
        properties: {
            ...importTransportScopeQueryProperties,
            include_geometry: { type: "boolean" },
        },
        additionalProperties: false,
    },
    response: {
        200: importTransportCandidateItemSchema,
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

const importTransportValidationIssueSchema = {
    type: "object",
    required: ["id", "issue_code", "severity", "message"],
    properties: {
        id: { type: "string" },
        import_batch_id: { type: "string" },
        entity_kind: { type: ["string", "null"] },
        entity_id: { type: ["string", "null"] },
        entity_source_id: { type: ["string", "null"] },
        issue_code: { type: "string" },
        severity: { type: "string" },
        issue_status: { type: "string" },
        message: { type: "string" },
        details: { type: "object", additionalProperties: true },
        created_at: { type: "string" },
        resolved_at: { type: ["string", "null"] },
    },
    additionalProperties: true,
} as const;

export const postImportTransportValidateCandidateSchema = {
    tags: [Tags.ImportTransport],
    summary: "Validate one import transport candidate",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["family", "id"],
        properties: {
            ...importTransportFamilyParamProperties,
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    querystring: {
        type: "object",
        properties: { ...importTransportScopeQueryProperties },
        additionalProperties: false,
    },
    body: {
        type: "object",
        properties: {
            confirm_warnings: { type: "boolean", default: false },
            review_note: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            additionalProperties: true,
        },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportTransportBatchValidationSchema = {
    tags: [Tags.ImportTransport],
    summary: "Validate import transport candidates in batch scope",
    security: [...bearerAuth],
    body: {
        type: "object",
        properties: {
            ...importTransportScopeQueryProperties,
            families: {
                type: "array",
                items: { type: "string", enum: [...IMPORT_TRANSPORT_FAMILIES] },
            },
            confirm_warnings: { type: "boolean", default: false },
            review_note: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            additionalProperties: true,
        },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportValidationIssuesSchema = {
    tags: [Tags.ImportTransport],
    summary: "List open import transport validation issues",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            ...importTransportScopeQueryProperties,
            entity_kind: { type: "string" },
            entity_id: { type: "integer", minimum: 1 },
            severity: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: importTransportValidationIssueSchema },
                total: { type: "integer" },
                limit: { type: "integer" },
                offset: { type: "integer" },
            },
            additionalProperties: false,
        },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportPromotionReadySchema = {
    tags: [Tags.ImportTransport],
    summary: "Promotion-ready candidate counts per entity family",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        required: ["import_batch_id"],
        properties: {
            import_batch_id: { type: "integer", minimum: 1 },
            include_warnings: { type: "boolean", default: false },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportTransportPromotionBatchSchema = {
    tags: [Tags.ImportTransport],
    summary: "Create import transport promotion batch (draft items only)",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["import_batch_id", "mode"],
        properties: {
            import_batch_id: { type: "integer", minimum: 1 },
            mode: { type: "string", enum: ["one_entity", "all_entities"] },
            entity_family: { type: ["string", "null"], enum: [...IMPORT_TRANSPORT_FAMILIES, null] },
            include_warnings: { type: "boolean", default: false },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportPromotionBatchesSchema = {
    tags: [Tags.ImportTransport],
    summary: "List import transport promotion batches",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            import_batch_id: { type: "integer", minimum: 1 },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportPromotionBatchByIdSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get import transport promotion batch by id",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportTransportPromotionBatchValidateSchema = {
    tags: [Tags.ImportTransport],
    summary: "Validate import transport promotion batch",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportPromotionBatchProgressSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get import transport promotion batch validation progress",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportPromotionBatchLogsSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get import transport promotion batch stage logs",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportTransportPromotionBatchPromoteSchema = {
    tags: [Tags.ImportTransport],
    summary: "Promote validated import transport batch to core_transport",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    body: {
        type: "object",
        properties: {
            confirm_warnings: { type: "boolean", default: false },
            review_note: { type: ["string", "null"] },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportHistoryImportBatchesSchema = {
    tags: [Tags.ImportTransport],
    summary: "List import transport import batch history",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            import_status: { type: "string" },
            validation_status: { type: "string" },
            source_dataset_code: { type: "string" },
            source_snapshot_version: { type: "string" },
            imported_after: { type: "string", format: "date-time" },
            imported_before: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportHistoryImportBatchByIdSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get import transport import batch history detail",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportHistoryPromotionBatchesSchema = {
    tags: [Tags.ImportTransport],
    summary: "List import transport promotion batch history",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            import_batch_id: { type: "integer", minimum: 1 },
            promotion_status: { type: "string" },
            validation_status: { type: "string" },
            mode: { type: "string", enum: ["one_entity", "all_entities"] },
            entity_family: { type: "string", enum: [...IMPORT_TRANSPORT_FAMILIES] },
            created_after: { type: "string", format: "date-time" },
            created_before: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportHistoryPromotionBatchByIdSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get import transport promotion batch history detail",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportHistoryPromotionBatchItemsSchema = {
    tags: [Tags.ImportTransport],
    summary: "List import transport promotion batch history items",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    querystring: {
        type: "object",
        properties: {
            entity_kind: { type: "string" },
            promotion_status: { type: "string" },
            item_validation_status: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportHistoryPromotionBatchLogsSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get import transport promotion batch history stage logs",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportGtfsExportsSchema = {
    tags: [Tags.ImportTransport],
    summary: "List GTFS export builds from gtfs_export schema",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            scope: { type: "string" },
            status: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        503: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const postImportTransportGtfsExportSchema = {
    tags: [Tags.ImportTransport],
    summary: "Create GTFS export dry-run batch (readiness snapshot only)",
    security: [...bearerAuth],
    body: {
        type: "object",
        properties: {
            scope: { type: "string", default: "yangon_local_bus" },
            dry_run: { type: "boolean", default: true },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: apiErrorResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        503: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportGtfsExportByIdSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get GTFS export build by id",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        503: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportGtfsExportValidationSchema = {
    tags: [Tags.ImportTransport],
    summary: "Get GTFS export validation report for a build",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        503: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;

export const getImportTransportGtfsOtpBuildsSchema = {
    tags: [Tags.ImportTransport],
    summary: "List OTP graph build metadata records",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            export_build_id: { type: "integer", minimum: 1 },
            scope: { type: "string" },
            build_status: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        503: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
    },
} satisfies FastifySchema;
