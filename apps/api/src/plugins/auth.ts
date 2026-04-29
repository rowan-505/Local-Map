import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";

export type JwtUser = {
    sub: string;
    id?: string;
    email: string;
    roles: string[];
};

export const DEV_AUTH_BYPASS_USER: JwtUser = {
    id: "dev-admin",
    sub: "dev-admin",
    email: "dev@local",
    roles: ["admin"],
};

export function isAuthBypassEnabled() {
    return process.env.AUTH_BYPASS === "true";
}

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: JwtUser;
        user: JwtUser;
    }
}

declare module "fastify" {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

export default fp(async function authPlugin(app) {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        throw new Error("JWT_SECRET is required");
    }

    await app.register(fastifyJwt, {
        secret,
    });

    app.decorate("authenticate", async function authenticate(request, reply) {
        if (isAuthBypassEnabled()) {
            request.user = { ...DEV_AUTH_BYPASS_USER };
            return;
        }

        await request.jwtVerify();
    });
});
