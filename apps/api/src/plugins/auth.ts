import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";

export type JwtUser = {
    sub: string;
    id?: string;
    email: string;
    roles: string[];
};

export const DASHBOARD_ACCESS_ROLES = new Set(["viewer", "editor", "admin", "super_admin"]);
export const DASHBOARD_WRITE_ROLES = new Set(["editor", "admin", "super_admin"]);

export function hasDashboardAccess(roles: readonly string[] | null | undefined): boolean {
    return (roles ?? []).some((role) => DASHBOARD_ACCESS_ROLES.has(role));
}

export function canDashboardWrite(roles: readonly string[] | null | undefined): boolean {
    return (roles ?? []).some((role) => DASHBOARD_WRITE_ROLES.has(role));
}

export async function requireDashboardAccess(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (!hasDashboardAccess(request.user?.roles)) {
        return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Dashboard access requires a dashboard role.",
        });
    }
}

export async function requireDashboardWrite(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (!canDashboardWrite(request.user?.roles)) {
        const readOnly = request.user?.roles?.includes("viewer") ?? false;
        return reply.code(403).send({
            code: readOnly ? "READ_ONLY" : "FORBIDDEN",
            message: readOnly
                ? "Read-only dashboard access cannot modify data."
                : "Dashboard write access requires an editor or administrator role.",
        });
    }
}

export const DEV_AUTH_BYPASS_USER: JwtUser = {
    id: "dev-admin",
    sub: "dev-admin",
    email: "dev@local",
    roles: ["admin"],
};

/**
 * Raw flag check. AUTH_BYPASS is a dev-only convenience; production safety is
 * enforced by {@link assertAuthBypassNotInProduction} (fail-fast at startup) and
 * by {@link isAuthBypassActive} (inert at request time in production).
 */
export function isAuthBypassEnabled() {
    return process.env.AUTH_BYPASS === "true";
}

/** True only when bypass is requested AND we are not in production. */
export function isAuthBypassActive() {
    return isAuthBypassEnabled() && process.env.NODE_ENV !== "production";
}

/**
 * Hard production safety guard: AUTH_BYPASS short-circuits JWT verification and
 * must never be active in production. Fail fast at startup instead of silently
 * shipping an open API.
 */
export function assertAuthBypassNotInProduction(): void {
    if (process.env.NODE_ENV === "production" && isAuthBypassEnabled()) {
        throw new Error(
            "AUTH_BYPASS=true is not allowed when NODE_ENV=production. Unset AUTH_BYPASS."
        );
    }
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
        requireDashboardAccess: typeof requireDashboardAccess;
        requireDashboardWrite: typeof requireDashboardWrite;
        requireRole: (
            ...allowedRoles: string[]
        ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void | FastifyReply>;
    }
}

export default fp(async function authPlugin(app) {
    assertAuthBypassNotInProduction();

    const secret = process.env.JWT_SECRET;

    if (!secret) {
        throw new Error("JWT_SECRET is required");
    }

    await app.register(fastifyJwt, {
        secret,
    });

    app.decorate("authenticate", async function authenticate(request, reply) {
        if (isAuthBypassActive()) {
            request.user = { ...DEV_AUTH_BYPASS_USER };
            return;
        }

        await request.jwtVerify();
    });

    app.decorate("requireDashboardAccess", requireDashboardAccess);
    app.decorate("requireDashboardWrite", requireDashboardWrite);

    /**
     * Role gate factory. Use as a preHandler AFTER `app.authenticate`, e.g.
     * `{ preHandler: [app.authenticate, app.requireRole("admin", "super_admin")] }`.
     * Backend authorization only — frontend hiding is never authorization.
     */
    app.decorate("requireRole", function requireRole(...allowedRoles: string[]) {
        return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
            const roles = request.user?.roles ?? [];
            const permitted = allowedRoles.some((role) => roles.includes(role));

            if (!permitted) {
                return reply.code(403).send({ message: "Insufficient role" });
            }
        };
    });
});
