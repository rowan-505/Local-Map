import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";
import { ACCOUNT_STATUSES, ANALYTICS_BUCKETS } from "./admin-users.schema.js";

const userListItemSchema = {
    type: "object",
    required: [
        "public_id",
        "email",
        "display_name",
        "phone",
        "email_verified",
        "account_status",
        "primary_region_id",
        "roles",
        "total_points",
        "last_seen_at",
        "last_login_at",
        "created_at",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        email: { type: "string" },
        display_name: { type: "string" },
        phone: { type: "string", nullable: true },
        email_verified: { type: "boolean" },
        account_status: { type: "string" },
        primary_region_id: { type: "string", nullable: true },
        roles: { type: "array", items: { type: "string" } },
        total_points: { type: "integer" },
        last_seen_at: { type: "string", format: "date-time", nullable: true },
        last_login_at: { type: "string", format: "date-time", nullable: true },
        created_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const userDetailSchema = {
    type: "object",
    required: [
        ...userListItemSchema.required,
        "is_active",
        "preferred_language",
        "admin_note",
        "lifetime_points_earned",
        "lifetime_points_removed",
        "saved_places_count",
        "updated_at",
        "deleted_at",
    ],
    properties: {
        ...userListItemSchema.properties,
        is_active: { type: "boolean" },
        preferred_language: { type: "string" },
        admin_note: { type: "string", nullable: true },
        lifetime_points_earned: { type: "integer" },
        lifetime_points_removed: { type: "integer" },
        saved_places_count: { type: "integer" },
        updated_at: { type: "string", format: "date-time" },
        deleted_at: { type: "string", format: "date-time", nullable: true },
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

export const getAdminUsersSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: list users",
    description: "Admin/super_admin. Paginated, filterable user list. No secrets returned.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            search: { type: "string", description: "Matches display_name / email / phone" },
            role: { type: "string" },
            emailVerified: { type: "boolean" },
            accountStatus: { type: "string", enum: [...ACCOUNT_STATUSES] },
            primaryRegionId: { type: "integer", minimum: 1 },
            createdFrom: { type: "string", format: "date-time" },
            createdTo: { type: "string", format: "date-time" },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "page", "pageSize"],
            properties: {
                items: { type: "array", items: userListItemSchema },
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

export const getAdminUserSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: user detail",
    description: "Admin/super_admin. Full user profile by public_id. No secrets returned.",
    security: [...bearerAuth],
    params: userIdParams,
    response: {
        200: userDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const patchUserStatusSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: set account status",
    description:
        "admin can enable/disable normal users; super_admin required for admin accounts and for 'deleted'. Audited.",
    security: [...bearerAuth],
    params: userIdParams,
    body: {
        type: "object",
        required: ["accountStatus"],
        properties: {
            accountStatus: { type: "string", enum: [...ACCOUNT_STATUSES] },
        },
        additionalProperties: false,
    },
    response: {
        200: userDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const patchUserAdminNoteSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: set admin note",
    description: "Admin/super_admin. Sets or clears the internal admin note. Audited.",
    security: [...bearerAuth],
    params: userIdParams,
    body: {
        type: "object",
        required: ["adminNote"],
        properties: {
            adminNote: { type: "string", maxLength: 2000, nullable: true },
        },
        additionalProperties: false,
    },
    response: {
        200: userDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postUserRoleSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: assign role",
    description:
        "Assigns a role. super_admin required to assign admin/super_admin. admin cannot create admins. Audited.",
    security: [...bearerAuth],
    params: userIdParams,
    body: {
        type: "object",
        required: ["roleCode"],
        properties: {
            roleCode: { type: "string", pattern: "^[a-z_]+$" },
        },
        additionalProperties: false,
    },
    response: {
        200: userDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const deleteUserRoleSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: remove role",
    description:
        "Removes a role. super_admin required to remove admin/super_admin. Cannot remove your own privileged role. Audited.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id", "roleCode"],
        properties: {
            id: { type: "string", format: "uuid" },
            roleCode: { type: "string", pattern: "^[a-z_]+$" },
        },
        additionalProperties: false,
    },
    response: {
        200: userDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const analyticsResponses = {
    401: messageSchema,
    403: forbiddenSchema,
} as const;

export const getAnalyticsSummarySchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: user analytics summary",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: [
                "total_users",
                "verified_users",
                "unverified_users",
                "new_today",
                "new_this_week",
                "new_this_month",
                "active_this_week",
                "disabled_users",
                "admin_count",
                "super_admin_count",
                "total_saved_places",
                "total_points_awarded",
            ],
            properties: {
                total_users: { type: "integer" },
                verified_users: { type: "integer" },
                unverified_users: { type: "integer" },
                new_today: { type: "integer" },
                new_this_week: { type: "integer" },
                new_this_month: { type: "integer" },
                active_this_week: { type: "integer" },
                disabled_users: { type: "integer" },
                admin_count: { type: "integer" },
                super_admin_count: { type: "integer" },
                total_saved_places: { type: "integer" },
                total_points_awarded: { type: "integer" },
            },
            additionalProperties: false,
        },
        ...analyticsResponses,
    },
} satisfies FastifySchema;

export const getAnalyticsGrowthSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: user growth time series",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            bucket: { type: "string", enum: [...ANALYTICS_BUCKETS], default: "day" },
            days: { type: "integer", minimum: 1, maximum: 365, default: 30 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "array",
            items: {
                type: "object",
                required: ["bucket", "count"],
                properties: {
                    bucket: { type: "string" },
                    count: { type: "integer" },
                },
                additionalProperties: false,
            },
        },
        400: badRequestSchema,
        ...analyticsResponses,
    },
} satisfies FastifySchema;

export const getAnalyticsByRoleSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: users by role",
    security: [...bearerAuth],
    response: {
        200: {
            type: "array",
            items: {
                type: "object",
                required: ["role", "count"],
                properties: {
                    role: { type: "string" },
                    count: { type: "integer" },
                },
                additionalProperties: false,
            },
        },
        ...analyticsResponses,
    },
} satisfies FastifySchema;

export const getAnalyticsByRegionSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: users by region",
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
        ...analyticsResponses,
    },
} satisfies FastifySchema;

export const getAnalyticsPointsSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: points analytics",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: [
                "total_awarded",
                "total_removed",
                "net_points",
                "ledger_entries",
                "users_with_points",
            ],
            properties: {
                total_awarded: { type: "integer" },
                total_removed: { type: "integer" },
                net_points: { type: "integer" },
                ledger_entries: { type: "integer" },
                users_with_points: { type: "integer" },
            },
            additionalProperties: false,
        },
        ...analyticsResponses,
    },
} satisfies FastifySchema;

export const getAnalyticsByReasonSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: points by reason",
    security: [...bearerAuth],
    response: {
        200: {
            type: "array",
            items: {
                type: "object",
                required: ["reason_code", "net_points", "total_awarded", "total_removed", "entries"],
                properties: {
                    reason_code: { type: "string" },
                    net_points: { type: "integer" },
                    total_awarded: { type: "integer" },
                    total_removed: { type: "integer" },
                    entries: { type: "integer" },
                },
                additionalProperties: false,
            },
        },
        ...analyticsResponses,
    },
} satisfies FastifySchema;

export const getUserAuditSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: user audit history",
    description: "Admin/super_admin. Recent audit log entries for a user (newest first).",
    security: [...bearerAuth],
    params: userIdParams,
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "array",
            items: {
                type: "object",
                required: [
                    "id",
                    "action_type",
                    "actor_display_name",
                    "before_snapshot",
                    "after_snapshot",
                    "created_at",
                ],
                properties: {
                    id: { type: "string" },
                    action_type: { type: "string" },
                    actor_display_name: { type: "string", nullable: true },
                    before_snapshot: { nullable: true },
                    after_snapshot: { nullable: true },
                    created_at: { type: "string", format: "date-time" },
                },
                additionalProperties: false,
            },
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const getAnalyticsSavedPlacesSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: saved places analytics",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: ["total_saved_places", "users_with_saved_places", "distinct_places_saved"],
            properties: {
                total_saved_places: { type: "integer" },
                users_with_saved_places: { type: "integer" },
                distinct_places_saved: { type: "integer" },
            },
            additionalProperties: false,
        },
        ...analyticsResponses,
    },
} satisfies FastifySchema;
