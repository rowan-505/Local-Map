import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
    canDashboardWrite,
    hasDashboardAccess,
    requireDashboardAccess,
    requireDashboardWrite,
} from "./auth.js";
import { registerBodySchema } from "../modules/auth/auth.schema.js";
import {
    authenticateImportReview,
    importReviewRouteAccess,
} from "../modules/import-review/import-review-admin.guard.js";

test("dashboard role capabilities keep viewer read-only", () => {
    assert.equal(hasDashboardAccess(["user"]), false);
    assert.equal(hasDashboardAccess(["surveyor"]), false);
    assert.equal(hasDashboardAccess(["viewer"]), true);
    assert.equal(hasDashboardAccess(["admin"]), true);
    assert.equal(hasDashboardAccess(["super_admin"]), true);

    assert.equal(canDashboardWrite(["user"]), false);
    assert.equal(canDashboardWrite(["surveyor"]), false);
    assert.equal(canDashboardWrite(["viewer"]), false);
    assert.equal(canDashboardWrite(["admin"]), true);
    assert.equal(canDashboardWrite(["super_admin"]), true);
});

function captureReply() {
    const captured: { statusCode?: number; body?: unknown } = {};
    const reply = {
        code(statusCode: number) {
            captured.statusCode = statusCode;
            return this;
        },
        send(body: unknown) {
            captured.body = body;
            return this;
        },
    } as unknown as FastifyReply;
    return { captured, reply };
}

function requestWithRoles(roles: string[]): FastifyRequest {
    return { user: { sub: "test", email: "test@example.com", roles } } as FastifyRequest;
}

test("viewer gets the stable READ_ONLY response before dashboard writes", async () => {
    const { captured, reply } = captureReply();
    await requireDashboardWrite(requestWithRoles(["viewer"]), reply);
    assert.equal(captured.statusCode, 403);
    assert.deepEqual(captured.body, {
        code: "READ_ONLY",
        message: "Read-only dashboard access cannot modify data.",
    });
});

test("normal user gets FORBIDDEN for dashboard reads", async () => {
    const { captured, reply } = captureReply();
    await requireDashboardAccess(requestWithRoles(["user"]), reply);
    assert.equal(captured.statusCode, 403);
    assert.deepEqual(captured.body, {
        code: "FORBIDDEN",
        message: "Dashboard access requires a dashboard role.",
    });
});

test("surveyor cannot read or write dashboard or canonical transport APIs", async () => {
    const read = captureReply();
    await requireDashboardAccess(requestWithRoles(["surveyor"]), read.reply);
    assert.equal(read.captured.statusCode, 403);
    assert.deepEqual(read.captured.body, {
        code: "FORBIDDEN",
        message: "Dashboard access requires a dashboard role.",
    });

    const write = captureReply();
    await requireDashboardWrite(requestWithRoles(["surveyor"]), write.reply);
    assert.equal(write.captured.statusCode, 403);
    assert.deepEqual(write.captured.body, {
        code: "FORBIDDEN",
        message: "Dashboard write access requires an administrator role.",
    });
});

test("import-review access classifies real read-only POST routes explicitly", () => {
    assert.equal(importReviewRouteAccess("GET", "/api/import-review/history/publish-batches"), "read");
    assert.equal(importReviewRouteAccess("POST", "/api/import-review/cleanup/promoted/dry-run"), "read");
    assert.equal(importReviewRouteAccess("POST", "/api/import-review/places/promote-dry-run"), "read");

    assert.equal(importReviewRouteAccess("POST", "/api/import-review/places/validate"), "write");
    assert.equal(importReviewRouteAccess("POST", "/api/import-review/promotion/batches/42/dry-run"), "write");
    assert.equal(importReviewRouteAccess("PATCH", "/api/import-review/buildings/42/decision"), "write");
});

test("import-review prefers a viewer JWT over the temporary admin header mode", async () => {
    const previousToken = process.env.IMPORT_REVIEW_ADMIN_TOKEN;
    process.env.IMPORT_REVIEW_ADMIN_TOKEN = "temporary-test-token";

    try {
        let jwtVerifyCalls = 0;
        const rawRequest: {
            method: string;
            headers: { authorization: string };
            user?: { sub: string; email: string; roles: string[] };
            jwtVerify: () => Promise<void>;
        } = {
            method: "GET",
            headers: { authorization: "Bearer viewer.jwt.token" },
            async jwtVerify() {
                jwtVerifyCalls += 1;
                rawRequest.user = { sub: "viewer", email: "viewer@example.com", roles: ["viewer"] };
            },
        };
        const request = rawRequest as unknown as FastifyRequest;
        const { captured, reply } = captureReply();

        await authenticateImportReview(request, reply);

        assert.equal(jwtVerifyCalls, 1);
        assert.deepEqual(request.user?.roles, ["viewer"]);
        assert.equal(captured.statusCode, undefined);
    } finally {
        if (previousToken === undefined) {
            delete process.env.IMPORT_REVIEW_ADMIN_TOKEN;
        } else {
            process.env.IMPORT_REVIEW_ADMIN_TOKEN = previousToken;
        }
    }
});

test("public registration ignores submitted role fields", () => {
    const parsed = registerBodySchema.parse({
        email: "demo@coremapmm.com",
        displayName: "CoreMap Demo",
        password: "correct-horse-battery-staple",
        role: "admin",
        roles: ["super_admin"],
    });

    assert.equal("role" in parsed, false);
    assert.equal("roles" in parsed, false);
});
