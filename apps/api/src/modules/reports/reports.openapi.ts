import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    conflictSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";
import {
    ADMIN_REPORT_TARGET_ENTITY_TYPES,
    FIELD_VARIANT_FILTER_CODES,
    REPORT_REWARD_REASON_CODES,
    REPORT_SOURCE_CODES,
    REPORT_STATUS_CODES,
    REPORT_TARGET_ENTITY_TYPES,
    REPORT_TYPE_CODES,
} from "./reports.schema.js";

const pointSummarySchema = {
    type: "object",
    required: ["total_points", "lifetime_points_earned", "lifetime_points_removed", "updated_at"],
    properties: {
        total_points: { type: "integer" },
        lifetime_points_earned: { type: "integer" },
        lifetime_points_removed: { type: "integer" },
        updated_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const codeName = {
    type: "object",
    required: ["code", "name"],
    properties: { code: { type: "string" }, name: { type: "string" } },
    additionalProperties: false,
} as const;

const reportSchema = {
    type: "object",
    required: [
        "public_id",
        "is_anonymous",
        "eligible_for_points",
        "report_type",
        "status",
        "description",
        "priority",
        "confidence_score",
        "created_at",
        "updated_at",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        is_anonymous: { type: "boolean" },
        eligible_for_points: { type: "boolean" },
        report_type: codeName,
        status: codeName,
        reason_code: { type: "string", nullable: true },
        target_entity_type: { type: "string", nullable: true },
        target_entity_id: { type: "string", nullable: true },
        target_public_id: { type: "string", nullable: true },
        title: { type: "string", nullable: true },
        description: { type: "string" },
        latitude: { type: "number", nullable: true },
        longitude: { type: "number", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        priority: { type: "string" },
        confidence_score: { type: "integer" },
        admin_note: { type: "string", nullable: true },
        reviewed_at: { type: "string", format: "date-time", nullable: true },
        reward_granted_at: { type: "string", format: "date-time", nullable: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const followupSchema = {
    type: "object",
    required: ["actor_type", "message", "created_at"],
    properties: {
        actor_type: { type: "string", enum: ["admin", "user", "system"] },
        actor_display_name: { type: "string", nullable: true },
        message: { type: "string" },
        created_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const statusEventSchema = {
    type: "object",
    required: ["old_status_code", "new_status_code", "created_at"],
    properties: {
        old_status_code: { type: "string", nullable: true },
        new_status_code: { type: "string" },
        actor_display_name: { type: "string", nullable: true },
        note: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const fieldContextSchema = {
    type: "object",
    nullable: true,
    required: [
        "route_code",
        "route_public_id",
        "variant_code",
        "variant_public_id",
        "stop_public_id",
        "stop_name",
        "stop_sequence",
        "snapshot_revision",
        "canonical_snapshot",
    ],
    properties: {
        route_code: { type: "string", nullable: true },
        route_public_id: { type: "string", format: "uuid", nullable: true },
        variant_code: { type: "string", nullable: true },
        variant_public_id: { type: "string", format: "uuid", nullable: true },
        stop_public_id: { type: "string", format: "uuid", nullable: true },
        stop_name: { type: "string", nullable: true },
        stop_sequence: { type: "integer", nullable: true },
        snapshot_revision: { type: "string", nullable: true },
        canonical_snapshot: { nullable: true },
    },
    additionalProperties: false,
} as const;

const canonicalTargetSchema = {
    type: "object",
    nullable: true,
    required: ["latitude", "longitude"],
    properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
    },
    additionalProperties: false,
} as const;

const adminReportSchema = {
    type: "object",
    required: [
        ...reportSchema.required,
        "anonymous_id",
        "author",
        "source_code",
        "observed_at",
        "location_accuracy_m",
        "field",
        "canonical_target",
        "distance_m",
        "media_count",
    ],
    properties: {
        ...reportSchema.properties,
        anonymous_id: { type: "string", nullable: true },
        author: {
            type: "object",
            nullable: true,
            required: ["public_id", "display_name", "email"],
            properties: {
                public_id: { type: "string" },
                display_name: { type: "string", nullable: true },
                email: { type: "string" },
            },
            additionalProperties: false,
        },
        source_code: { type: "string", enum: [...REPORT_SOURCE_CODES] },
        observed_at: { type: "string", format: "date-time", nullable: true },
        location_accuracy_m: { type: "number", nullable: true },
        field: fieldContextSchema,
        canonical_target: canonicalTargetSchema,
        distance_m: { type: "number", nullable: true },
        media_count: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const reportDetailSchema = {
    type: "object",
    required: [...reportSchema.required, "followups", "status_events"],
    properties: {
        ...reportSchema.properties,
        followups: { type: "array", items: followupSchema },
        status_events: { type: "array", items: statusEventSchema },
    },
    additionalProperties: false,
} as const;

const reportMediaEvidenceSchema = {
    type: "object",
        required: ["publicId", "mimeType", "byteSize", "width", "height", "note", "sortOrder", "published"],
    properties: {
        publicId: { type: "string", format: "uuid" },
        mimeType: { type: "string" },
        byteSize: { type: "integer" },
        width: { type: "integer", nullable: true },
        height: { type: "integer", nullable: true },
        note: { type: "string", nullable: true },
        sortOrder: { type: "integer" },
        published: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const adminReportDetailSchema = {
    type: "object",
    required: [...adminReportSchema.required, "followups", "status_events", "media"],
    properties: {
        ...adminReportSchema.properties,
        followups: { type: "array", items: followupSchema },
        status_events: { type: "array", items: statusEventSchema },
        media: { type: "array", items: reportMediaEvidenceSchema },
    },
    additionalProperties: false,
} as const;

const createReportBody = {
    type: "object",
    required: ["reportTypeCode", "description", "targetEntityType"],
    properties: {
        reportTypeCode: { type: "string", enum: [...REPORT_TYPE_CODES] },
        reasonCode: { type: "string", minLength: 1, maxLength: 120 },
        title: { type: "string", minLength: 1, maxLength: 200 },
        description: { type: "string", minLength: 1, maxLength: 4000 },
        targetEntityType: { type: "string", enum: [...REPORT_TARGET_ENTITY_TYPES] },
        targetEntityId: { type: "integer", minimum: 1 },
        targetPublicId: { type: "string", format: "uuid" },
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        anonymousId: { type: "string", minLength: 1, maxLength: 128 },
    },
    additionalProperties: false,
} as const;

const createReportResponseSchema = {
    type: "object",
    required: [...reportSchema.required, "duplicate_warning"],
    properties: {
        ...reportSchema.properties,
        duplicate_warning: {
            type: "boolean",
            description: "true when an existing duplicate report is returned instead of creating a new one.",
        },
        message: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const publicIdParam = {
    type: "object",
    required: ["publicId"],
    properties: { publicId: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

const adminIdParam = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

export const postReportSchema = {
    tags: [Tags.Reports],
    summary: "Submit a report",
    description:
        "Creates a report. Works for signed-in users (created_by set, point-eligible) and anonymous users (anonymous_id required via body or the x-anonymous-id header; not point-eligible). Returns 201 on creation, or 200 with duplicate_warning=true when a recent duplicate from the same submitter already exists. DB-based rate limits return 429.",
    body: createReportBody,
    response: {
        200: createReportResponseSchema,
        201: createReportResponseSchema,
        400: badRequestSchema,
        429: messageSchema,
    },
} satisfies FastifySchema;

export const getMyReportsSchema = {
    tags: [Tags.Reports],
    summary: "List my reports",
    description: "Returns the authenticated user's reports (newest first).",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
        additionalProperties: false,
    },
    response: { 200: { type: "array", items: reportSchema }, 400: badRequestSchema, 401: messageSchema },
} satisfies FastifySchema;

export const getReportSchema = {
    tags: [Tags.Reports],
    summary: "Get a report",
    description:
        "Returns a single report. Authored reports require the owner; anonymous reports require a matching x-anonymous-id header.",
    params: publicIdParam,
    response: { 200: reportDetailSchema, 400: badRequestSchema, 404: notFoundSchema },
} satisfies FastifySchema;

export const postFollowupSchema = {
    tags: [Tags.Reports],
    summary: "Reply to a report",
    description:
        "Adds a follow-up message from the report owner and moves the report back to 'submitted'. Anonymous reports cannot use follow-ups.",
    security: [...bearerAuth],
    params: publicIdParam,
    body: {
        type: "object",
        required: ["message"],
        properties: { message: { type: "string", minLength: 1, maxLength: 2000 } },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: [...reportSchema.required, "followups"],
            properties: { ...reportSchema.properties, followups: { type: "array", items: followupSchema } },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const getAdminReportsSchema = {
    tags: [Tags.Reports],
    summary: "List reports (admin)",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            status: { type: "string", enum: [...REPORT_STATUS_CODES] },
            type: { type: "string", enum: [...REPORT_TYPE_CODES] },
            adminAreaId: { type: "integer", minimum: 1 },
            targetEntityType: { type: "string", enum: [...ADMIN_REPORT_TARGET_ENTITY_TYPES] },
            source: { type: "string", enum: [...REPORT_SOURCE_CODES] },
            routeCode: { type: "string", minLength: 1, maxLength: 40 },
            variantCode: { type: "string", enum: [...FIELD_VARIANT_FILTER_CODES] },
            anonymous: { type: "string", enum: ["true", "false"] },
            createdFrom: { type: "string", format: "date" },
            createdTo: { type: "string", format: "date" },
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
                items: { type: "array", items: adminReportSchema },
                total: { type: "integer" },
                page: { type: "integer" },
                pageSize: { type: "integer" },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminReportSchema = {
    tags: [Tags.Reports],
    summary: "Get a report (admin)",
    security: [...bearerAuth],
    params: adminIdParam,
    response: {
        200: adminReportDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const patchAdminReportStatusSchema = {
    tags: [Tags.Reports],
    summary: "Change report status (admin)",
    security: [...bearerAuth],
    params: adminIdParam,
    body: {
        type: "object",
        required: ["statusCode"],
        properties: {
            statusCode: { type: "string", enum: [...REPORT_STATUS_CODES] },
            note: { type: "string", maxLength: 1000 },
        },
        additionalProperties: false,
    },
    response: {
        200: adminReportSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const postAdminRequestInfoSchema = {
    tags: [Tags.Reports],
    summary: "Request more info (admin)",
    description:
        "Adds an admin follow-up message and moves the report to 'needs_more_info' without creating a new report. Not allowed for anonymous reports.",
    security: [...bearerAuth],
    params: adminIdParam,
    body: {
        type: "object",
        required: ["message"],
        properties: { message: { type: "string", minLength: 1, maxLength: 2000 } },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: [...adminReportSchema.required, "followups"],
            properties: { ...adminReportSchema.properties, followups: { type: "array", items: followupSchema } },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const patchAdminReportNoteSchema = {
    tags: [Tags.Reports],
    summary: "Update admin note (admin)",
    security: [...bearerAuth],
    params: adminIdParam,
    body: {
        type: "object",
        required: ["adminNote"],
        properties: { adminNote: { type: "string", maxLength: 2000, nullable: true } },
        additionalProperties: false,
    },
    response: { 200: adminReportSchema, 400: badRequestSchema, 401: messageSchema, 403: messageSchema, 404: notFoundSchema },
} satisfies FastifySchema;

export const postAdminRewardPointsSchema = {
    tags: [Tags.Reports],
    summary: "Reward points for a report (admin)",
    description:
        "Manually grants points to the author of an ACCEPTED report via the append-only point ledger, updates the point summary, and links the ledger row to the report. Points are never granted automatically. Rejected when the report is not accepted, anonymous, ineligible, or already rewarded. Positive pointsDelta rewards; negative is allowed for penalty/reversal reason codes.",
    security: [...bearerAuth],
    params: adminIdParam,
    body: {
        type: "object",
        required: ["pointsDelta", "reasonCode"],
        properties: {
            pointsDelta: { type: "integer", minimum: -1000000, maximum: 1000000 },
            reasonCode: { type: "string", enum: [...REPORT_REWARD_REASON_CODES] },
            note: { type: "string", maxLength: 1000 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["report", "summary"],
            properties: { report: adminReportSchema, summary: pointSummarySchema },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

// --- Analytics ---

const analyticsAuthResponses = {
    401: messageSchema,
    403: messageSchema,
} as const;

const codeCountSchema = {
    type: "object",
    required: ["code", "name", "count"],
    properties: {
        code: { type: "string" },
        name: { type: "string" },
        count: { type: "integer" },
    },
    additionalProperties: false,
} as const;

export const getReportAnalyticsSummarySchema = {
    tags: [Tags.Reports],
    summary: "Report analytics summary (admin)",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: [
                "total",
                "submitted",
                "in_review",
                "needs_more_info",
                "accepted",
                "rejected",
                "duplicate",
                "anonymous",
                "logged_in",
                "this_week",
                "this_month",
            ],
            properties: {
                total: { type: "integer" },
                submitted: { type: "integer" },
                in_review: { type: "integer" },
                needs_more_info: { type: "integer" },
                accepted: { type: "integer" },
                rejected: { type: "integer" },
                duplicate: { type: "integer" },
                anonymous: { type: "integer" },
                logged_in: { type: "integer" },
                this_week: { type: "integer" },
                this_month: { type: "integer" },
            },
            additionalProperties: false,
        },
        ...analyticsAuthResponses,
    },
} satisfies FastifySchema;

export const getReportAnalyticsByTypeSchema = {
    tags: [Tags.Reports],
    summary: "Reports by type (admin)",
    security: [...bearerAuth],
    response: {
        200: { type: "array", items: codeCountSchema },
        ...analyticsAuthResponses,
    },
} satisfies FastifySchema;

export const getReportAnalyticsByStatusSchema = {
    tags: [Tags.Reports],
    summary: "Reports by status (admin)",
    security: [...bearerAuth],
    response: {
        200: { type: "array", items: codeCountSchema },
        ...analyticsAuthResponses,
    },
} satisfies FastifySchema;

export const getReportAnalyticsByRegionSchema = {
    tags: [Tags.Reports],
    summary: "Reports by region (admin)",
    security: [...bearerAuth],
    response: {
        200: {
            type: "array",
            items: {
                type: "object",
                required: ["region_id", "region_name", "count"],
                properties: {
                    region_id: { type: "string", nullable: true },
                    region_name: { type: "string", nullable: true },
                    count: { type: "integer" },
                },
                additionalProperties: false,
            },
        },
        ...analyticsAuthResponses,
    },
} satisfies FastifySchema;

export const getReportAnalyticsAnonymousSchema = {
    tags: [Tags.Reports],
    summary: "Anonymous vs logged-in reports (admin)",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: ["anonymous", "logged_in"],
            properties: {
                anonymous: { type: "integer" },
                logged_in: { type: "integer" },
            },
            additionalProperties: false,
        },
        ...analyticsAuthResponses,
    },
} satisfies FastifySchema;
