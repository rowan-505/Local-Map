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

const authProfileSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "email",
        "display_name",
        "phone",
        "roles",
        "email_verified",
        "account_status",
        "primary_region_id",
        "preferred_language",
        "total_points",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
        display_name: { type: "string" },
        phone: { type: "string", nullable: true },
        roles: { type: "array", items: { type: "string" } },
        email_verified: { type: "boolean" },
        account_status: { type: "string" },
        primary_region_id: { type: "string", nullable: true },
        preferred_language: { type: "string" },
        total_points: { type: "integer" },
    },
    additionalProperties: false,
} as const;

const sessionResponseSchema = {
    type: "object",
    required: ["accessToken", "refreshToken", "expiresIn", "user"],
    properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        expiresIn: { type: "string" },
        user: authUserSchema,
    },
    additionalProperties: false,
} as const;

export const postAuthRegisterSchema = {
    tags: [Tags.Auth],
    summary: "Register public user",
    description:
        "Creates a public account with role `user`. Admin / super_admin accounts cannot be created here.",
    body: {
        type: "object",
        required: ["email", "displayName", "password"],
        properties: {
            email: { type: "string", format: "email" },
            displayName: { type: "string", minLength: 2, maxLength: 120 },
            password: { type: "string", minLength: 8, maxLength: 200 },
            preferredLanguage: { type: "string", enum: ["my", "en"] },
        },
        additionalProperties: false,
    },
    response: {
        201: {
            type: "object",
            required: ["message", "user"],
            properties: {
                message: { type: "string", enum: ["Account created"] },
                user: authProfileSchema,
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        409: conflictSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;

export const postAuthLoginSchema = {
    tags: [Tags.Auth],
    summary: "Log in",
    description:
        "Authenticate with email (or legacy username) plus password. Returns a short-lived `accessToken`, a `refreshToken`, and the user profile. Either `email` or `username` must be set (not both).",
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
        200: sessionResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const postAuthRefreshSchema = {
    tags: [Tags.Auth],
    summary: "Refresh session",
    description:
        "Exchanges a valid refresh token for a new access token and a rotated refresh token. The old refresh token is invalidated.",
    body: {
        type: "object",
        required: ["refreshToken"],
        properties: {
            refreshToken: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
    },
    response: {
        200: sessionResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const postAuthLogoutSchema = {
    tags: [Tags.Auth],
    summary: "Log out",
    description: "Revokes the supplied refresh session. Idempotent.",
    body: {
        type: "object",
        required: ["refreshToken"],
        properties: {
            refreshToken: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["message"],
            properties: {
                message: { type: "string", enum: ["Logged out"] },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
    },
} satisfies FastifySchema;

const emailOtpStatusResponseSchema = {
    type: "object",
    required: ["status"],
    properties: {
        status: { type: "string", enum: ["sent", "verified", "already_verified"] },
    },
    additionalProperties: false,
} as const;

export const postAuthSendOtpSchema = {
    tags: [Tags.Auth],
    summary: "Send email verification OTP",
    description:
        "Sends a 6-digit verification code to the logged-in user's email. Optional flow — does not block account use. Returns `already_verified` if the email is already verified. Throttled to one send per 60 seconds.",
    security: [...bearerAuth],
    response: {
        200: emailOtpStatusResponseSchema,
        401: messageSchema,
        403: forbiddenSchema,
        429: messageSchema,
        502: messageSchema,
        503: messageSchema,
    },
} satisfies FastifySchema;

export const postAuthVerifyOtpSchema = {
    tags: [Tags.Auth],
    summary: "Verify email verification OTP",
    description:
        "Verifies the submitted 6-digit code for the logged-in user. On success sets `email_verified=true`. Returns `already_verified` if already verified.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["code"],
        properties: {
            code: { type: "string", pattern: "^\\d{6}$" },
        },
        additionalProperties: false,
    },
    response: {
        200: emailOtpStatusResponseSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        429: messageSchema,
        503: messageSchema,
    },
} satisfies FastifySchema;

export const getMeSchema = {
    tags: [Tags.User],
    summary: "Current user",
    description:
        "Returns the authenticated user's full profile (roles, email_verified, account_status, primary_region_id, preferred_language, total_points).",
    security: [...bearerAuth],
    response: {
        200: authProfileSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const patchMeProfileSchema = {
    tags: [Tags.User],
    summary: "Update current user profile",
    description:
        "Self-service edit of the authenticated user's profile. Editable: displayName, phone, preferredLanguage, primaryRegionId. Email, roles, verification, and points are read-only here.",
    security: [...bearerAuth],
    body: {
        type: "object",
        minProperties: 1,
        properties: {
            displayName: { type: "string", minLength: 2, maxLength: 120 },
            phone: { type: "string", minLength: 3, maxLength: 40, nullable: true },
            preferredLanguage: { type: "string", enum: ["my", "en"] },
            primaryRegionId: { type: "integer", minimum: 1, nullable: true },
        },
        additionalProperties: false,
    },
    response: {
        200: authProfileSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;
