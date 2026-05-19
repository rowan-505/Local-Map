import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import type { JwtUser } from "../../plugins/auth.js";

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
 * - **IMPORT_REVIEW_ADMIN_TOKEN unset:** Bearer JWT verified; missing/invalid JWT → **401**; valid JWT lacking `roles: ["admin"]` passes here and hits {@link requireImportReviewAdmin}.
 * - **IMPORT_REVIEW_ADMIN_TOKEN set (temporary symmetric guard):** header must match env byte‑for‑byte; missing/blank → **401**, wrong → **403**; bypasses Bearer entirely.
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
 * Coarse JWT `admin` gate when using Bearer auth (`IMPORT_REVIEW_ADMIN_TOKEN` not configured).
 * Header-token synth user always satisfies this.
 *
 * TODO(import-review-rbac): Replace coarse `admin` role check with `import_review:write`.
 */
export async function requireImportReviewAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void | FastifyReply> {
    if (request.method === "OPTIONS") {
        return;
    }
    const roles = request.user?.roles ?? [];
    if (!roles.includes("admin")) {
        return reply.code(403).send({ message: "Import review endpoints require admin role." });
    }
}
