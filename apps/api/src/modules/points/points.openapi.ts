import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";
import { POINT_REASON_CODES } from "./points.schema.js";

const summarySchema = {
    type: "object",
    required: ["total_points", "lifetime_points_earned", "lifetime_points_removed", "updated_at"],
    properties: {
        total_points: { type: "integer" },
        lifetime_points_earned: { type: "integer" },
        lifetime_points_removed: { type: "integer" },
        updated_at: { type: "string", format: "date-time", nullable: true },
    },
    additionalProperties: false,
} as const;

const ledgerItemSchema = {
    type: "object",
    required: [
        "id",
        "points_delta",
        "reason_code",
        "note",
        "related_entity_type",
        "related_entity_id",
        "created_at",
    ],
    properties: {
        id: { type: "string" },
        points_delta: { type: "integer" },
        reason_code: { type: "string" },
        note: { type: "string", nullable: true },
        related_entity_type: { type: "string", nullable: true },
        related_entity_id: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const limitQuerystring = {
    type: "object",
    properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    },
    additionalProperties: false,
} as const;

const userIdParams = {
    type: "object",
    required: ["id"],
    properties: {
        id: { type: "string", format: "uuid", description: "User public_id" },
    },
    additionalProperties: false,
} as const;

export const getMyPointsSchema = {
    tags: [Tags.User],
    summary: "My point summary",
    description: "Returns the authenticated user's point summary (cache of the ledger).",
    security: [...bearerAuth],
    response: {
        200: summarySchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getMyPointHistorySchema = {
    tags: [Tags.User],
    summary: "My point history",
    description: "Returns the authenticated user's recent point ledger entries (newest first).",
    security: [...bearerAuth],
    querystring: limitQuerystring,
    response: {
        200: { type: "array", items: ledgerItemSchema },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getUserPointsSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: user points",
    description:
        "Admin/super_admin only. Returns a user's point summary and recent ledger history by user public_id.",
    security: [...bearerAuth],
    params: userIdParams,
    querystring: limitQuerystring,
    response: {
        200: {
            type: "object",
            required: ["summary", "history"],
            properties: {
                summary: summarySchema,
                history: { type: "array", items: ledgerItemSchema },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const adminLedgerItemSchema = {
    type: "object",
    required: [
        "id",
        "points_delta",
        "reason_code",
        "note",
        "created_at",
        "user_public_id",
        "user_display_name",
        "user_email",
        "created_by_display_name",
    ],
    properties: {
        id: { type: "string" },
        points_delta: { type: "integer" },
        reason_code: { type: "string" },
        note: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
        user_public_id: { type: "string", format: "uuid" },
        user_display_name: { type: "string" },
        user_email: { type: "string" },
        created_by_display_name: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

export const getAdminPointsLedgerSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: recent point changes",
    description:
        "Admin/super_admin only. Paginated point_ledger feed across all users, with optional user and reason filters.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            userId: { type: "string", format: "uuid", description: "Filter by user public_id" },
            reasonCode: { type: "string", enum: [...POINT_REASON_CODES] },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "page", "pageSize"],
            properties: {
                items: { type: "array", items: adminLedgerItemSchema },
                total: { type: "integer" },
                page: { type: "integer" },
                pageSize: { type: "integer" },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const getTopPointUsersSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: top point users",
    description: "Admin/super_admin only. Users ranked by current point balance.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "array",
            items: {
                type: "object",
                required: [
                    "public_id",
                    "display_name",
                    "email",
                    "total_points",
                    "lifetime_points_earned",
                    "lifetime_points_removed",
                ],
                properties: {
                    public_id: { type: "string", format: "uuid" },
                    display_name: { type: "string" },
                    email: { type: "string" },
                    total_points: { type: "integer" },
                    lifetime_points_earned: { type: "integer" },
                    lifetime_points_removed: { type: "integer" },
                },
                additionalProperties: false,
            },
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const postUserPointsSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: adjust user points",
    description:
        "Admin/super_admin only. Appends a point_ledger row (never edits/deletes), updates the summary cache, and writes an audit log. Use a reversal row to correct mistakes.",
    security: [...bearerAuth],
    params: userIdParams,
    body: {
        type: "object",
        required: ["pointsDelta", "reasonCode"],
        properties: {
            pointsDelta: {
                type: "integer",
                minimum: -1000000,
                maximum: 1000000,
                description: "Non-zero point change (negative to deduct)",
            },
            reasonCode: { type: "string", enum: [...POINT_REASON_CODES] },
            note: { type: "string", maxLength: 1000 },
            relatedEntityType: { type: "string", maxLength: 120 },
            relatedEntityId: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
    },
    response: {
        201: {
            type: "object",
            required: ["ledger", "summary"],
            properties: {
                ledger: ledgerItemSchema,
                summary: summarySchema,
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;
