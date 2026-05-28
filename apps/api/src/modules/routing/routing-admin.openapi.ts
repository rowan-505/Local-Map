import type { FastifySchema } from "fastify";

import { Tags, bearerAuth, messageSchema } from "../../lib/openapi/common.js";

const paginatedMetaSchema = {
    type: "object",
    required: ["total", "limit", "offset"],
    properties: {
        total: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
    },
} as const;

const buildSummarySchema = {
    type: "object",
    required: [
        "id",
        "publicId",
        "engineCode",
        "buildVersion",
        "status",
        "isActive",
        "isPublic",
        "profileCodes",
        "warningCount",
        "errorCount",
        "createdAt",
        "updatedAt",
    ],
    properties: {
        id: { type: "string" },
        publicId: { type: "string", format: "uuid" },
        engineCode: { type: "string" },
        regionCode: { type: "string", nullable: true },
        buildVersion: { type: "string" },
        buildLabel: { type: "string", nullable: true },
        status: { type: "string" },
        isActive: { type: "boolean" },
        isPublic: { type: "boolean" },
        profileCodes: { type: "array", items: { type: "string" } },
        warningCount: { type: "integer" },
        errorCount: { type: "integer" },
        startedAt: { type: "string", nullable: true },
        finishedAt: { type: "string", nullable: true },
        publishedAt: { type: "string", nullable: true },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
    },
} as const;

export const getAdminRoutingBuildsSchema = {
    tags: [Tags.Routing],
    summary: "List routing engine builds (admin)",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            engine_code: { type: "string" },
            status: { type: "string" },
            is_active: { type: "string", enum: ["true", "false"] },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: buildSummarySchema },
                ...paginatedMetaSchema.properties,
            },
        },
        401: messageSchema,
        403: messageSchema,
        503: messageSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminRoutingBuildByIdSchema = {
    tags: [Tags.Routing],
    summary: "Get routing build detail (admin)",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
    },
    response: {
        200: {
            allOf: [
                buildSummarySchema,
                {
                    type: "object",
                    required: ["summary", "smokeTestSummary", "artifactCount", "sourceCount"],
                    properties: {
                        sourceDescription: { type: "string", nullable: true },
                        summary: { type: "object", additionalProperties: true },
                        smokeTestSummary: { type: "object", additionalProperties: true },
                        artifactCount: { type: "integer" },
                        sourceCount: { type: "integer" },
                    },
                },
            ],
        },
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        503: messageSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminRoutingHealthSchema = {
    tags: [Tags.Routing],
    summary: "Routing service health (admin)",
    security: [...bearerAuth],
    response: {
        200: { type: "object", additionalProperties: true },
        401: messageSchema,
        403: messageSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminRoutingFeedbackSchema = {
    tags: [Tags.Routing],
    summary: "List routing user feedback (admin)",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            status: { type: "string", enum: ["open", "triaged", "resolved", "dismissed"] },
            problem_type: { type: "string" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: messageSchema,
        403: messageSchema,
        503: messageSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const patchAdminRoutingFeedbackStatusSchema = {
    tags: [Tags.Routing],
    summary: "Update routing feedback status (admin)",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
    },
    body: {
        type: "object",
        required: ["status"],
        properties: {
            status: { type: "string", enum: ["open", "triaged", "resolved", "dismissed"] },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        503: messageSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminRoutingValidationReportsSchema = {
    tags: [Tags.Routing],
    summary: "List routing validation reports (admin)",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            routing_build_id: { type: "string", pattern: "^\\d+$" },
            severity: { type: "string", enum: ["info", "warning", "error"] },
            report_scope: {
                type: "string",
                enum: ["graph_build", "engine_build", "smoke_test", "publish", "request"],
            },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        401: messageSchema,
        403: messageSchema,
        503: messageSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;
