import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    conflictSchema,
    forbiddenSchema,
    messageSchema,
    unauthorizedSchema,
    bearerAuth,
} from "../../lib/openapi/common.js";

const authUserSchema = {
    type: "object",
    required: ["id", "public_id", "email", "display_name", "roles"],
    properties: {
        id: { type: "string" },
        public_id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
        display_name: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
} as const;

export const postAuthLoginSchema = {
    tags: [Tags.Auth],
    summary: "Log in",
    description:
        "Authenticate with email or username plus password. Returns a JWT `accessToken` and user profile. Either `email` or `username` must be set (not both).",
    body: {
        type: "object",
        required: ["password"],
        properties: {
            email: { type: "string", format: "email" },
            username: { type: "string", minLength: 3 },
            password: { type: "string", minLength: 6 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["accessToken", "user"],
            properties: {
                accessToken: { type: "string" },
                user: authUserSchema,
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const postAuthSignupSchema = {
    tags: [Tags.Auth],
    summary: "Sign up demo admin",
    description: "Creates a demo administrator account (development / internal use).",
    body: {
        type: "object",
        required: ["username", "password"],
        properties: {
            username: { type: "string", minLength: 3 },
            password: { type: "string", minLength: 6 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["message", "user"],
            properties: {
                message: { type: "string", enum: ["Demo admin account created"] },
                user: authUserSchema,
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const getMeSchema = {
    tags: [Tags.User],
    summary: "Current user",
    description: "Returns the authenticated user profile from the JWT (or dev bypass user).",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: ["id", "public_id", "email", "display_name", "roles"],
            properties: {
                id: { type: "string" },
                public_id: { type: "string" },
                email: { type: "string", format: "email" },
                display_name: { type: "string" },
                roles: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
        },
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;
