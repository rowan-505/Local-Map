import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import {
    requireDashboardAccess,
    requireDashboardWrite,
    type JwtUser,
} from "../../plugins/auth.js";

/**
 * Required when `IMPORT_REVIEW_ADMIN_TOKEN` is set (temporary symmetric guard).
 * HTTP header lookup is lowercase (Node/normalized IncomingHttpHeaders).
 */
export const IMPORT_REVIEW_ADMIN_TOKEN_HEADER = "x-import-review-admin-token";

const IMPORT_REVIEW_ENV_TOKEN_ADMIN_USER: JwtUser = {
    sub: "import-review-env-admin-token",
    email: "import-review-admin-token@dev-only.local",
    roles: ["admin"],
};

/** True when IMPORT_REVIEW_ADMIN_TOKEN is configured — callers must prove possession via IMPORT_REVIEW_ADMIN_TOKEN_HEADER (401 missing, 403 wrong). */
export function isImportReviewHeaderTokenGuardEnabled(): boolean {
    return Boolean(importReviewExpectedAdminTokenUtf8());
}

function importReviewExpectedAdminTokenUtf8(): string | null {
    const t = process.env.IMPORT_REVIEW_ADMIN_TOKEN?.trim() ?? "";
    return t.length > 0 ? t : null;
}

function readImportReviewAdminTokenHeader(headers: FastifyRequest["headers"]): string | undefined {
    const raw = headers[IMPORT_REVIEW_ADMIN_TOKEN_HEADER];
    if (Array.isArray(raw)) {
        return raw[0];
    }
    return raw;
}

function timingSafeOpaqueEqual(receivedUtf8: string, expectedUtf8: string): boolean {
    try {
        const a = Buffer.from(receivedUtf8, "utf8");
        const b = Buffer.from(expectedUtf8, "utf8");
        if (a.length !== b.length) {
            return false;
        }
        return timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

/**
 * Runs very early (`onRequest` on the import_review plugin subtree) — **before** Fastify validates
 * query/body/params schemas for those routes.
 *
 * - **Bearer JWT present:** JWT is verified first, even when the temporary header token is configured;
 *   role capability is checked by {@link requireImportReviewRouteAccess}.
 * - **No Bearer JWT + IMPORT_REVIEW_ADMIN_TOKEN set (temporary symmetric guard):** header must
 *   match env byte‑for‑byte; missing/blank → **401**, wrong → **403**.
 * - **No Bearer JWT + IMPORT_REVIEW_ADMIN_TOKEN unset:** missing credentials → **401**.
 *
 * IMPORTANT: **`AUTH_BYPASS` does not affect import_review** — unauthenticated PATCH was previously possible solely because AUTH_BYPASS short‑circuited JWT.
 *
 * Never logs header/token values.
 */
export async function authenticateImportReview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    /** CORS preflight must not hit JWT / symmetric checks (browser sends no Authorization / admin header). */
    if (request.method === "OPTIONS") {
        return;
    }

    const authorization = request.headers.authorization?.trim() ?? "";
    const hasBearerJwt = /^Bearer\s+\S+/i.test(authorization);

    if (hasBearerJwt) {
        try {
            await request.jwtVerify();
        } catch {
            void reply.code(401).send({ message: "Unauthorized" });
        }
        return;
    }

    const expected = importReviewExpectedAdminTokenUtf8();

    if (expected !== null) {
        const hdr = readImportReviewAdminTokenHeader(request.headers)?.trim();

        if (hdr === undefined || hdr === "") {
            void reply.code(401).send({ message: "Unauthorized" });
            return;
        }

        if (!timingSafeOpaqueEqual(hdr, expected)) {
            void reply.code(403).send({ message: "Forbidden" });
            return;
        }

        request.user = IMPORT_REVIEW_ENV_TOKEN_ADMIN_USER;
        return;
    }

    try {
        await request.jwtVerify();
    } catch {
        void reply.code(401).send({ message: "Unauthorized" });
    }
}

/**
 * POST routes that are proven query-only. All other non-GET routes fail closed to
 * dashboard write access. Validation and promotion-batch dry-runs are intentionally
 * absent because they persist validation/progress state.
 */
const IMPORT_REVIEW_READ_ONLY_POST_ROUTES = new Set([
    "/cleanup/promoted/dry-run",
    "/addresses/promote-dry-run",
    "/places/promote-dry-run",
    "/place-address-links/promote-dry-run",
]);

export type ImportReviewRouteAccess = "read" | "write";

export function importReviewRouteAccess(method: string, routeUrl: string): ImportReviewRouteAccess {
    const normalizedUrl = routeUrl.replace(/^\/api\/import-review/, "");
    if (method.toUpperCase() === "GET") {
        return "read";
    }
    if (method.toUpperCase() === "POST" && IMPORT_REVIEW_READ_ONLY_POST_ROUTES.has(normalizedUrl)) {
        return "read";
    }
    return "write";
}

export async function requireImportReviewRouteAccess(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (request.method === "OPTIONS") {
        return;
    }

    const access = importReviewRouteAccess(request.method, request.routeOptions.url ?? "");
    if (access === "read") {
        return requireDashboardAccess(request, reply);
    }
    return requireDashboardWrite(request, reply);
}

/** @deprecated Use capability-aware {@link requireImportReviewRouteAccess}. */
export async function requireImportReviewAdmin(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    return requireDashboardWrite(request, reply);
}
