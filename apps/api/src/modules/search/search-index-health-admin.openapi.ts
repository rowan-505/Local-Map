import type { FastifySchema } from "fastify";

import {
    Tags,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
} from "../../lib/openapi/common.js";

const indexRunSchema = {
    type: "object",
    required: ["id", "status", "started_at", "finished_at", "entity_counts"],
    properties: {
        id: { type: "string" },
        status: { type: "string" },
        started_at: { type: "string", format: "date-time" },
        finished_at: { type: "string", format: "date-time", nullable: true },
        entity_counts: {},
    },
    additionalProperties: false,
} as const;

const familySchema = {
    type: "object",
    required: [
        "entity_family",
        "search_entity_type",
        "expected_searchable_count",
        "canonical_count",
        "indexed_count",
        "missing_count",
        "ghost_count",
        "stale_count",
        "latest_indexed_at",
        "latest_source_updated_at",
        "severity",
        "severity_reasons",
        "status",
    ],
    properties: {
        entity_family: { type: "string" },
        search_entity_type: { type: "string" },
        expected_searchable_count: { type: "integer" },
        canonical_count: { type: "integer" },
        indexed_count: { type: "integer" },
        missing_count: { type: "integer" },
        ghost_count: { type: "integer" },
        stale_count: { type: "integer" },
        latest_indexed_at: { type: "string", format: "date-time", nullable: true },
        latest_source_updated_at: { type: "string", format: "date-time", nullable: true },
        severity: { type: "string", enum: ["healthy", "warning", "critical"] },
        severity_reasons: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["healthy", "unhealthy"] },
    },
    additionalProperties: false,
} as const;

const healthReportSchema = {
    type: "object",
    required: [
        "overall_status",
        "overall_severity",
        "overall_severity_reasons",
        "health_query_ok",
        "health_query_error",
        "totals",
        "families",
        "last_rebuild_run",
        "last_successful_run",
    ],
    properties: {
        overall_status: { type: "string", enum: ["healthy", "unhealthy"] },
        overall_severity: { type: "string", enum: ["healthy", "warning", "critical"] },
        overall_severity_reasons: { type: "array", items: { type: "string" } },
        health_query_ok: { type: "boolean" },
        health_query_error: { type: "string", nullable: true },
        totals: {
            type: "object",
            required: [
                "expected_searchable_count",
                "canonical_count",
                "indexed_count",
                "missing_count",
                "ghost_count",
                "stale_count",
            ],
            properties: {
                expected_searchable_count: { type: "integer" },
                canonical_count: { type: "integer" },
                indexed_count: { type: "integer" },
                missing_count: { type: "integer" },
                ghost_count: { type: "integer" },
                stale_count: { type: "integer" },
            },
            additionalProperties: false,
        },
        families: { type: "array", items: familySchema },
        last_rebuild_run: { oneOf: [indexRunSchema, { type: "null" }] },
        last_successful_run: { oneOf: [indexRunSchema, { type: "null" }] },
    },
    additionalProperties: false,
} as const;

const maintenanceOperationSchema = {
    type: "object",
    required: [
        "operation",
        "status",
        "duration_ms",
        "affected_families",
        "entity_family",
        "entity_type",
        "entity_id",
        "rebuild_views",
        "rebuild_run_id",
        "rows_rebuilt",
        "message",
        "health_before",
        "health_after",
    ],
    properties: {
        operation: {
            type: "string",
            enum: ["health_check", "reindex_family", "reindex_entity", "repair_unhealthy"],
        },
        status: {
            type: "string",
            enum: ["success", "partial", "failed", "skipped", "conflict"],
        },
        duration_ms: { type: "integer" },
        affected_families: { type: "array", items: { type: "string" } },
        entity_family: { type: "string", nullable: true },
        entity_type: { type: "string", nullable: true },
        entity_id: { type: "string", nullable: true },
        rebuild_views: { type: "array", items: { type: "string" } },
        rebuild_run_id: { type: "string", nullable: true },
        rows_rebuilt: { type: "integer" },
        message: { type: "string", nullable: true },
        health_before: healthReportSchema,
        health_after: healthReportSchema,
    },
    additionalProperties: false,
} as const;

export const getSearchIndexHealthSchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Read-only unified search index health report",
    security: bearerAuth,
    response: {
        200: healthReportSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
};

export const postSearchIndexHealthCheckSchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Run unified search index health check (admin)",
    description: "Admin/super_admin. Re-runs the health SQL and returns before/after snapshots (identical for read-only check).",
    security: bearerAuth,
    response: {
        200: maintenanceOperationSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
};

export const postSearchIndexReindexFamilySchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Rebuild one allowlisted search index family",
    description: "Super_admin only. Rebuilds the mapped source view via search.rebuild_search_documents.",
    security: bearerAuth,
    body: {
        type: "object",
        required: ["entity_family"],
        properties: {
            entity_family: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: maintenanceOperationSchema,
        400: messageSchema,
        401: messageSchema,
        403: forbiddenSchema,
        409: messageSchema,
    },
};

export const postSearchIndexRepairSchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Repair all unhealthy search index families",
    description: "Super_admin only. Rebuilds only unhealthy families (same logic as search:reconcile --repair).",
    security: bearerAuth,
    response: {
        200: maintenanceOperationSchema,
        400: messageSchema,
        401: messageSchema,
        403: forbiddenSchema,
        409: messageSchema,
    },
};

export const postSearchIndexReindexEntitySchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Incrementally reindex one searchable entity",
    description:
        "Super_admin only. Uses search.sync_search_documents for supported entity types (places, admin areas, street groups, transport).",
    security: bearerAuth,
    body: {
        type: "object",
        required: ["entity_type", "entity_id"],
        properties: {
            entity_type: { type: "string" },
            entity_id: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: maintenanceOperationSchema,
        400: messageSchema,
        401: messageSchema,
        403: forbiddenSchema,
        500: messageSchema,
    },
};

