import {
    badRequestSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";

const coreReviewErrorResponses = {
    400: badRequestSchema,
    404: notFoundSchema,
    500: messageSchema,
} as const;

export const coreReviewListQuerySchemaOpenApi = {
    type: "object",
    properties: {
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        search: { type: "string" },
        sortBy: { type: "string" },
        sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
        isVerified: { type: "boolean" },
        adminAreaId: { type: "string" },
        categoryId: { type: "string" },
        buildingTypeId: { type: "string" },
        roadClassId: { type: "string" },
        isPublic: { type: "boolean" },
        status: { type: "string", enum: ["active", "deleted", "all"], default: "active" },
        includeDeleted: { type: "boolean" },
        routeId: { type: "string" },
    },
};

const paginationSchema = {
    type: "object",
    required: ["page", "pageSize", "total", "totalPages"],
    properties: {
        page: { type: "integer" },
        pageSize: { type: "integer" },
        total: { type: "integer" },
        totalPages: { type: "integer" },
    },
};

export const getCoreReviewListSchema = {
    tags: ["core-review"],
    summary: "List core schema entities (paginated)",
    params: {
        type: "object",
        required: ["entity"],
        properties: {
            entity: { type: "string" },
        },
    },
    querystring: coreReviewListQuerySchemaOpenApi,
    response: {
        200: {
            type: "object",
            required: ["data", "pagination"],
            properties: {
                data: { type: "array", items: { type: "object", additionalProperties: true } },
                pagination: paginationSchema,
                filters: { type: "object", additionalProperties: true },
                meta: { type: "object", additionalProperties: true },
            },
        },
        ...coreReviewErrorResponses,
    },
};

export const getCoreReviewDetailSchema = {
    tags: ["core-review"],
    summary: "Get core schema entity by id",
    params: {
        type: "object",
        required: ["entity", "id"],
        properties: {
            entity: { type: "string" },
            id: { type: "string" },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["data"],
            properties: {
                data: { type: "object", additionalProperties: true },
            },
        },
        ...coreReviewErrorResponses,
    },
};

const coreReviewWriteBodySchema = {
    type: "object",
    additionalProperties: true,
};

const coreReviewWriteDetailResponse = {
    201: {
        type: "object",
        required: ["data"],
        properties: {
            data: { type: "object", additionalProperties: true },
        },
    },
    200: {
        type: "object",
        required: ["data"],
        properties: {
            data: { type: "object", additionalProperties: true },
        },
    },
    400: badRequestSchema,
    403: messageSchema,
    404: notFoundSchema,
    500: messageSchema,
};

export const postCoreReviewEntitySchema = {
    tags: ["core-review"],
    summary: "Create core schema entity",
    params: {
        type: "object",
        required: ["entity"],
        properties: {
            entity: { type: "string" },
        },
    },
    body: coreReviewWriteBodySchema,
    response: coreReviewWriteDetailResponse,
};

const coreReviewLifecycleDetailResponse = {
    200: {
        type: "object",
        required: ["data"],
        properties: {
            data: { type: "object", additionalProperties: true },
        },
    },
    400: badRequestSchema,
    403: messageSchema,
    404: notFoundSchema,
    500: messageSchema,
} as const;

export const patchCoreReviewSoftDeleteSchema = {
    tags: ["core-review"],
    summary: "Soft-delete core schema entity",
    params: {
        type: "object",
        required: ["entity", "id"],
        properties: {
            entity: { type: "string" },
            id: { type: "string" },
        },
    },
    response: coreReviewLifecycleDetailResponse,
};

export const patchCoreReviewRestoreSchema = {
    tags: ["core-review"],
    summary: "Restore soft-deleted core schema entity",
    params: {
        type: "object",
        required: ["entity", "id"],
        properties: {
            entity: { type: "string" },
            id: { type: "string" },
        },
    },
    response: coreReviewLifecycleDetailResponse,
};

export const patchCoreReviewEntitySchema = {
    tags: ["core-review"],
    summary: "Update core schema entity",
    params: {
        type: "object",
        required: ["entity", "id"],
        properties: {
            entity: { type: "string" },
            id: { type: "string" },
        },
    },
    body: coreReviewWriteBodySchema,
    response: coreReviewWriteDetailResponse,
};
