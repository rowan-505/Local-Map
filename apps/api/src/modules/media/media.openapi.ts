import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";

const mediaErrorSchema = {
    type: "object",
    required: ["code", "message"],
    properties: {
        code: { type: "string" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

const mediaPublicIdParams = {
    type: "object",
    required: ["publicId"],
    properties: { publicId: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

export const postMediaUploadSchema: FastifySchema = {
    tags: [Tags.Media],
    summary: "Create a private media upload",
    description:
        "Authenticated. Creates a pending media.assets row and returns a short-lived presigned PUT for the private R2 bucket. JPEG images or short AAC/M4A audio. Does not make the object public.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["mediaType", "mimeType", "byteSize"],
        properties: {
            mediaType: { type: "string", enum: ["image", "audio"] },
            mimeType: { type: "string", enum: ["image/jpeg", "audio/mp4", "audio/m4a"] },
            byteSize: { type: "integer", minimum: 1, maximum: 8_388_608 },
        },
        additionalProperties: false,
    },
    response: {
        201: {
            type: "object",
            required: ["publicId", "mediaType", "mimeType", "byteSize", "status", "upload"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                mediaType: { type: "string", enum: ["image", "audio"] },
                mimeType: { type: "string", enum: ["image/jpeg", "audio/mp4", "audio/m4a"] },
                byteSize: { type: "integer" },
                status: { type: "string", enum: ["pending"] },
                upload: {
                    type: "object",
                    required: ["method", "url", "headers", "expiresAt"],
                    properties: {
                        method: { type: "string", enum: ["PUT"] },
                        url: { type: "string" },
                        headers: {
                            type: "object",
                            required: ["Content-Type", "Content-Length"],
                            properties: {
                                "Content-Type": { type: "string" },
                                "Content-Length": { type: "string" },
                            },
                            additionalProperties: false,
                        },
                        expiresAt: { type: "string", format: "date-time" },
                    },
                    additionalProperties: false,
                },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        503: mediaErrorSchema,
    },
};

export const postMediaCompleteSchema: FastifySchema = {
    tags: [Tags.Media],
    summary: "Mark a private upload ready",
    description:
        "Owner-only. HEADs the private object, checks existence and size, then sets status=ready. Abandoned pending rows stay pending.",
    security: [...bearerAuth],
    params: mediaPublicIdParams,
    response: {
        200: {
            type: "object",
            required: ["publicId", "mediaType", "mimeType", "byteSize", "storageScope", "status", "readyAt"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                mediaType: { type: "string" },
                mimeType: { type: "string" },
                byteSize: { type: "integer" },
                storageScope: { type: "string", enum: ["private", "public"] },
                status: { type: "string", enum: ["ready"] },
                readyAt: { type: "string", format: "date-time" },
            },
            additionalProperties: false,
        },
        400: mediaErrorSchema,
        401: unauthorizedSchema,
        404: mediaErrorSchema,
        409: mediaErrorSchema,
        503: mediaErrorSchema,
    },
};

export const getAdminMediaAccessSchema: FastifySchema = {
    tags: [Tags.Media],
    summary: "Get a short-lived private media URL (admin)",
    description:
        "Admin and super_admin only, matching report review. The asset must be ready, private, and linked to a user report. Returns a short-lived presigned GET. The URL is not stored in PostgreSQL. Does not publish to coremap-media-public.",
    security: [...bearerAuth],
    params: mediaPublicIdParams,
    response: {
        200: {
            type: "object",
            required: ["publicId", "mimeType", "byteSize", "method", "url", "expiresAt"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                mimeType: { type: "string" },
                byteSize: { type: "integer" },
                method: { type: "string", enum: ["GET"] },
                url: { type: "string" },
                expiresAt: { type: "string", format: "date-time" },
            },
            additionalProperties: false,
        },
        400: mediaErrorSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: mediaErrorSchema,
        503: mediaErrorSchema,
    },
};

export const postAdminPublishStopPhotoSchema: FastifySchema = {
    tags: [Tags.Media],
    summary: "Publish a sanitized stop photo (admin)",
    description:
        "Admin and super_admin only. Reads the private original, applies server-side crop/rotate/pixel blur, writes new public JPEGs (detail ~1280 and card ~640) to the public bucket, inserts public media.assets rows with source_asset_id, and links transport.stop_media. Never flips the private original to public. Does not run when a report is resolved.",
    security: [...bearerAuth],
    params: mediaPublicIdParams,
    body: {
        type: "object",
        properties: {
            rotateDegrees: { type: "integer", enum: [0, 90, 180, 270] },
            crop: {
                type: "object",
                nullable: true,
                required: ["x", "y", "width", "height"],
                properties: {
                    x: { type: "number", minimum: 0, maximum: 1 },
                    y: { type: "number", minimum: 0, maximum: 1 },
                    width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                    height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                },
                additionalProperties: false,
            },
            blurRects: {
                type: "array",
                maxItems: 8,
                items: {
                    type: "object",
                    required: ["x", "y", "width", "height"],
                    properties: {
                        x: { type: "number", minimum: 0, maximum: 1 },
                        y: { type: "number", minimum: 0, maximum: 1 },
                        width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                        height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                    },
                    additionalProperties: false,
                },
            },
            note: { type: "string", nullable: true, maxLength: 500 },
            isPrimary: { type: "boolean" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["stopPublicId", "sourceAssetPublicId", "detail", "card", "isPrimary", "note"],
            properties: {
                stopPublicId: { type: "string", format: "uuid" },
                sourceAssetPublicId: { type: "string", format: "uuid" },
                detail: {
                    type: "object",
                    required: ["publicId", "url", "width", "height"],
                    properties: {
                        publicId: { type: "string", format: "uuid" },
                        url: { type: "string" },
                        width: { type: "integer" },
                        height: { type: "integer" },
                    },
                    additionalProperties: false,
                },
                card: {
                    type: "object",
                    required: ["publicId", "url", "width", "height"],
                    properties: {
                        publicId: { type: "string", format: "uuid" },
                        url: { type: "string" },
                        width: { type: "integer" },
                        height: { type: "integer" },
                    },
                    additionalProperties: false,
                },
                isPrimary: { type: "boolean" },
                note: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        400: mediaErrorSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: mediaErrorSchema,
        409: mediaErrorSchema,
        503: mediaErrorSchema,
    },
};

export const postFieldReportMediaSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Attach ready private media to a field report",
    description:
        "Surveyor-only. Attaches a ready private asset owned by the caller to an owned field_survey report.",
    security: [...bearerAuth],
    params: mediaPublicIdParams,
    body: {
        type: "object",
        required: ["assetPublicId"],
        properties: {
            assetPublicId: { type: "string", format: "uuid" },
            note: { type: "string", nullable: true, maxLength: 500 },
            sortOrder: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
    },
    response: {
        201: {
            type: "object",
            required: ["reportPublicId", "assetPublicId", "note", "sortOrder", "createdAt"],
            properties: {
                reportPublicId: { type: "string", format: "uuid" },
                assetPublicId: { type: "string", format: "uuid" },
                note: { type: "string", nullable: true },
                sortOrder: { type: "integer" },
                createdAt: { type: "string", format: "date-time" },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: mediaErrorSchema,
        404: mediaErrorSchema,
        409: mediaErrorSchema,
        503: mediaErrorSchema,
    },
};
