import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { getApiEnv } from "../../config/env.js";
import { createEmailService } from "../email/email.service.js";
import { DEV_AUTH_BYPASS_USER, isAuthBypassActive } from "../../plugins/auth.js";
import { AuthError, AuthService, type AuthSessionResult } from "./auth.service.js";
import { AuthRepository, type AuthUserProfile } from "./auth.repo.js";
import {
    emailOtpStatusResponseSchema,
    loginBodySchema,
    logoutBodySchema,
    logoutResponseSchema,
    refreshBodySchema,
    registerBodySchema,
    registerResponseSchema,
    sessionResponseSchema,
    updateProfileBodySchema,
    verifyEmailOtpBodySchema,
} from "./auth.schema.js";
import {
    getMeSchema,
    patchMeProfileSchema,
    postAuthLoginSchema,
    postAuthLogoutSchema,
    postAuthRefreshSchema,
    postAuthRegisterSchema,
    postAuthSendOtpSchema,
    postAuthVerifyOtpSchema,
} from "./auth.openapi.js";
import { ACCESS_TOKEN_TTL } from "./refresh-token.js";

/**
 * Per-IP rate limits are applied below via `config.rateLimit` (in-memory store,
 * registered globally with `global: false` in app.ts). Limits/window come from
 * AUTH_RATE_LIMIT_MAX / AUTH_RATE_LIMIT_WINDOW (see config/env.ts). For multi-instance
 * deployments, swap the in-memory store for Redis.
 */

function sessionContext(request: FastifyRequest) {
    return {
        userAgent: request.headers["user-agent"] ?? null,
        ipAddress: request.ip ?? null,
    };
}

async function issueSessionResponse(
    reply: FastifyReply,
    result: AuthSessionResult
): Promise<AuthSessionResult & { accessToken: string }> {
    const accessToken = await reply.jwtSign(result.accessTokenClaims, {
        expiresIn: ACCESS_TOKEN_TTL,
    });

    return { ...result, accessToken };
}

function devBypassProfile(): AuthUserProfile {
    return {
        id: DEV_AUTH_BYPASS_USER.id ?? DEV_AUTH_BYPASS_USER.sub,
        public_id: DEV_AUTH_BYPASS_USER.sub,
        email: DEV_AUTH_BYPASS_USER.email,
        display_name: "Development Admin",
        phone: null,
        roles: DEV_AUTH_BYPASS_USER.roles,
        is_active: true,
        email_verified: true,
        account_status: "active",
        primary_region_id: null,
        preferred_language: "my",
        total_points: 0,
    };
}

function handleAuthError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }

    throw error;
}

const authRoutes: FastifyPluginAsync = async (app) => {
    const authRepo = new AuthRepository(app.prisma);
    const emailEnv = getApiEnv().email;
    const rl = getApiEnv().authRateLimit;

    // Per-IP limit config for a route (shared window from AUTH_RATE_LIMIT_WINDOW).
    const ipRateLimit = (max: number) => ({ rateLimit: { max, timeWindow: rl.windowMs } });
    const authService = new AuthService(authRepo, {
        emailService: createEmailService(),
        otpSecret: emailEnv.otpSecret,
        ttlMinutes: emailEnv.otpTtlMinutes,
        maxAttempts: emailEnv.otpMaxAttempts,
    });

    app.post(
        "/auth/register",
        { schema: postAuthRegisterSchema, config: ipRateLimit(rl.register) },
        async (request, reply) => {
        const parsed = registerBodySchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid registration payload",
                issues: parsed.error.flatten(),
            });
        }

        try {
            const user = await authService.register({
                email: parsed.data.email,
                displayName: parsed.data.displayName,
                password: parsed.data.password,
                preferredLanguage: parsed.data.preferredLanguage,
            });

            return reply.code(201).send(
                registerResponseSchema.parse({
                    message: "Account created",
                    user,
                })
            );
        } catch (error) {
            return handleAuthError(error, reply);
        }
    });

    app.post(
        "/auth/login",
        { schema: postAuthLoginSchema, config: ipRateLimit(rl.login) },
        async (request, reply) => {
        const parsed = loginBodySchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid login payload",
                issues: parsed.error.flatten(),
            });
        }

        try {
            const result = await authService.login(
                { email: parsed.data.email, username: parsed.data.username },
                parsed.data.password,
                sessionContext(request)
            );
            const withAccess = await issueSessionResponse(reply, result);

            return reply.send(
                sessionResponseSchema.parse({
                    accessToken: withAccess.accessToken,
                    refreshToken: withAccess.refreshToken,
                    expiresIn: ACCESS_TOKEN_TTL,
                    user: withAccess.user,
                })
            );
        } catch (error) {
            return handleAuthError(error, reply);
        }
    });

    app.post(
        "/auth/refresh",
        { schema: postAuthRefreshSchema, config: ipRateLimit(rl.refresh) },
        async (request, reply) => {
        const parsed = refreshBodySchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid refresh payload",
                issues: parsed.error.flatten(),
            });
        }

        try {
            const result = await authService.refresh(parsed.data.refreshToken);
            const withAccess = await issueSessionResponse(reply, result);

            return reply.send(
                sessionResponseSchema.parse({
                    accessToken: withAccess.accessToken,
                    refreshToken: withAccess.refreshToken,
                    expiresIn: ACCESS_TOKEN_TTL,
                    user: withAccess.user,
                })
            );
        } catch (error) {
            return handleAuthError(error, reply);
        }
    });

    app.post("/auth/logout", { schema: postAuthLogoutSchema }, async (request, reply) => {
        const parsed = logoutBodySchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid logout payload",
                issues: parsed.error.flatten(),
            });
        }

        await authService.logout(parsed.data.refreshToken);

        return reply.send(logoutResponseSchema.parse({ message: "Logged out" }));
    });

    app.post(
        "/auth/email/send-otp",
        {
            preHandler: app.authenticate,
            schema: postAuthSendOtpSchema,
            config: ipRateLimit(rl.sendOtp),
        },
        async (request, reply) => {
            if (isAuthBypassActive()) {
                return reply.send(emailOtpStatusResponseSchema.parse({ status: "already_verified" }));
            }

            try {
                const result = await authService.sendEmailOtp(
                    request.user.sub,
                    sessionContext(request)
                );
                return reply.send(emailOtpStatusResponseSchema.parse(result));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/email/verify-otp",
        {
            preHandler: app.authenticate,
            schema: postAuthVerifyOtpSchema,
        },
        async (request, reply) => {
            if (isAuthBypassActive()) {
                return reply.send(emailOtpStatusResponseSchema.parse({ status: "already_verified" }));
            }

            const parsed = verifyEmailOtpBodySchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid verification payload",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const result = await authService.verifyEmailOtp(
                    request.user.sub,
                    parsed.data.code,
                    sessionContext(request)
                );
                return reply.send(emailOtpStatusResponseSchema.parse(result));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.get(
        "/auth/me",
        {
            preHandler: app.authenticate,
            schema: getMeSchema,
        },
        async (request, reply) => {
            if (isAuthBypassActive()) {
                return reply.send(devBypassProfile());
            }

            try {
                const user = await authService.getMe(request.user.sub);
                return reply.send(user);
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.patch(
        "/me/profile",
        {
            preHandler: app.authenticate,
            schema: patchMeProfileSchema,
        },
        async (request, reply) => {
            if (isAuthBypassActive()) {
                // The dev bypass user is not a real DB row; nothing to persist.
                return reply.send(devBypassProfile());
            }

            const parsed = updateProfileBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid profile payload",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const updated = await authService.updateProfile(request.user.sub, {
                    displayName: parsed.data.displayName,
                    phone: parsed.data.phone,
                    preferredLanguage: parsed.data.preferredLanguage,
                    primaryRegionId:
                        parsed.data.primaryRegionId === undefined
                            ? undefined
                            : parsed.data.primaryRegionId === null
                              ? null
                              : BigInt(parsed.data.primaryRegionId),
                });
                return reply.send(updated);
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );
};

export default authRoutes;
