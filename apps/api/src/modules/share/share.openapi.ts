import type { FastifySchema } from "fastify";

import { Tags, badRequestSchema, messageSchema, notFoundSchema } from "../../lib/openapi/common.js";

const SHARE_CODE_PATTERN = "^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{6,8}$";

const createShareLinkBody = {
    oneOf: [
        {
            type: "object",
            required: ["target_type", "lat", "lng"],
            properties: {
                target_type: { type: "string", enum: ["point"] },
                lat: { type: "number", minimum: -90, maximum: 90 },
                lng: { type: "number", minimum: -180, maximum: 180 },
                zoom: { type: "number", minimum: 0, maximum: 24 },
                address_line: { type: "string", maxLength: 500 },
                plus_code: { type: "string", maxLength: 60 },
            },
            additionalProperties: false,
        },
        {
            type: "object",
            required: ["target_type", "place_public_id"],
            properties: {
                target_type: { type: "string", enum: ["place"] },
                place_public_id: { type: "string", format: "uuid" },
            },
            additionalProperties: false,
        },
    ],
} as const;

const createShareLinkResponse = {
    type: "object",
    required: ["code", "url"],
    properties: {
        code: { type: "string", description: "Short share code" },
        url: { type: "string", description: "Absolute CoreMap share URL" },
    },
    additionalProperties: false,
} as const;

const resolvedShareLinkResponse = {
    oneOf: [
        {
            type: "object",
            required: ["target_type", "lat", "lng", "zoom", "address_line", "plus_code"],
            properties: {
                target_type: { type: "string", enum: ["point"] },
                lat: { type: "number" },
                lng: { type: "number" },
                zoom: { type: "number", nullable: true },
                address_line: { type: "string", nullable: true },
                plus_code: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        {
            type: "object",
            required: ["target_type", "place_public_id"],
            properties: {
                target_type: { type: "string", enum: ["place"] },
                place_public_id: { type: "string", format: "uuid" },
            },
            additionalProperties: false,
        },
    ],
} as const;

export const postShareLinkSchema = {
    tags: [Tags.Share],
    summary: "Create a share link",
    description:
        "Creates a CoreMap-only short share link for a map point or a core place. Existing links for the same target are reused (dedup). No authentication required.",
    body: createShareLinkBody,
    response: {
        201: createShareLinkResponse,
        400: badRequestSchema,
        404: notFoundSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getShareLinkSchema = {
    tags: [Tags.Share],
    summary: "Resolve a share link",
    description:
        "Resolves a share code to its target. Point links return a stored coordinate snapshot (no reverse geocode); place links return the place public id.",
    params: {
        type: "object",
        required: ["code"],
        properties: {
            code: { type: "string", pattern: SHARE_CODE_PATTERN, description: "Short share code" },
        },
        additionalProperties: false,
    },
    response: {
        200: resolvedShareLinkResponse,
        400: badRequestSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;
