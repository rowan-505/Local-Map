import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    conflictSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";

const savedPlaceSchema = {
    type: "object",
    required: [
        "id",
        "entity_type",
        "entity_id",
        "display_name",
        "custom_name",
        "category",
        "address_line",
        "plus_code",
        "latitude",
        "longitude",
        "admin_area_id",
        "created_at",
    ],
    properties: {
        id: { type: "string", description: "Saved item id" },
        entity_type: { type: "string", enum: ["place", "map_point"] },
        entity_id: { type: "string", nullable: true, description: "core_places.id for places" },
        display_name: { type: "string", nullable: true },
        custom_name: { type: "string", nullable: true },
        category: {
            type: "object",
            nullable: true,
            required: ["code", "name"],
            properties: {
                code: { type: "string" },
                name: { type: "string" },
            },
            additionalProperties: false,
        },
        address_line: { type: "string", nullable: true },
        plus_code: { type: "string", nullable: true },
        latitude: { type: "number", nullable: true },
        longitude: { type: "number", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

export const getSavedPlacesSchema = {
    tags: [Tags.User],
    summary: "List saved places",
    description: "Returns the authenticated user's saved places (newest first).",
    security: [...bearerAuth],
    response: {
        200: { type: "array", items: savedPlaceSchema },
        401: messageSchema,
    },
} satisfies FastifySchema;

export const postSavedPlaceSchema = {
    tags: [Tags.User],
    summary: "Save a place or map point",
    description:
        "Saves an item for the authenticated user. `entityType: \"place\"` references a public, non-deleted core place (duplicate saves return 409). `entityType: \"map_point\"` stores an arbitrary clicked location (latitude/longitude required).",
    security: [...bearerAuth],
    body: {
        oneOf: [
            {
                type: "object",
                required: ["entityType", "entityId"],
                properties: {
                    entityType: { type: "string", enum: ["place"] },
                    entityId: { type: "integer", minimum: 1, description: "core_places.id" },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: ["entityType", "latitude", "longitude"],
                properties: {
                    entityType: { type: "string", enum: ["map_point"] },
                    customName: { type: "string", minLength: 1, maxLength: 120 },
                    latitude: { type: "number", minimum: -90, maximum: 90 },
                    longitude: { type: "number", minimum: -180, maximum: 180 },
                    addressLine: { type: "string", maxLength: 500 },
                    plusCode: { type: "string", maxLength: 60 },
                    adminAreaId: { type: "integer", minimum: 1 },
                },
                additionalProperties: false,
            },
        ],
    },
    response: {
        201: savedPlaceSchema,
        400: badRequestSchema,
        401: messageSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const deleteSavedPlaceSchema = {
    tags: [Tags.User],
    summary: "Delete a saved place",
    description: "Removes one of the authenticated user's own saved places.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$", description: "Saved place id" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["message"],
            properties: {
                message: { type: "string", enum: ["Saved place removed"] },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;
