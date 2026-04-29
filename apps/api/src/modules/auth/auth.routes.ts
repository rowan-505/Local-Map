import type { FastifyPluginAsync } from "fastify";

import { DEV_AUTH_BYPASS_USER, isAuthBypassEnabled } from "../../plugins/auth.js";
import { AuthError, AuthService } from "./auth.service.js";
import { AuthRepository } from "./auth.repo.js";
import {
    loginBodySchema,
    loginResponseSchema,
    signupBodySchema,
    signupResponseSchema,
} from "./auth.schema.js";

const authRoutes: FastifyPluginAsync = async (app) => {
    const authRepo = new AuthRepository(app.prisma);
    const authService = new AuthService(authRepo);

    app.post("/auth/login", async (request, reply) => {
        const parsed = loginBodySchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid login payload",
                issues: parsed.error.flatten(),
            });
        }

        try {
            const user = await authService.login(
                {
                    email: parsed.data.email,
                    username: parsed.data.username,
                },
                parsed.data.password
            );
            const accessToken = await reply.jwtSign(
                {
                    sub: user.public_id,
                    email: user.email,
                    roles: user.roles,
                },
                {
                    expiresIn: "7d",
                }
            );

            const response = {
                accessToken,
                user,
            };

            return reply.send(loginResponseSchema.parse(response));
        } catch (error) {
            if (error instanceof AuthError) {
                return reply.code(error.statusCode).send({
                    message: error.message,
                });
            }

            throw error;
        }
    });

    app.post("/auth/signup", async (request, reply) => {
        const parsed = signupBodySchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid signup payload",
                issues: parsed.error.flatten(),
            });
        }

        try {
            const user = await authService.signupDemoAdmin(
                parsed.data.username,
                parsed.data.password
            );

            return reply.send(
                signupResponseSchema.parse({
                    message: "Demo admin account created",
                    user,
                })
            );
        } catch (error) {
            if (error instanceof AuthError) {
                return reply.code(error.statusCode).send({
                    message: error.message,
                });
            }

            throw error;
        }
    });

    app.get(
        "/me",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            if (isAuthBypassEnabled()) {
                return reply.send({
                    id: DEV_AUTH_BYPASS_USER.id ?? DEV_AUTH_BYPASS_USER.sub,
                    public_id: DEV_AUTH_BYPASS_USER.sub,
                    email: DEV_AUTH_BYPASS_USER.email,
                    display_name: "Development Admin",
                    roles: DEV_AUTH_BYPASS_USER.roles,
                });
            }

            try {
                const user = await authService.getMe(request.user.sub);
                return reply.send(user);
            } catch (error) {
                if (error instanceof AuthError) {
                    return reply.code(error.statusCode).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        }
    );
};

export default authRoutes;
