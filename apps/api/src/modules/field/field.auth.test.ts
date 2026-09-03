import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";

import authPlugin, {
    hasFieldSurveyorAccess,
    requireFieldSurveyor,
    DEV_AUTH_BYPASS_USER,
} from "../../plugins/auth.js";

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

test("only the surveyor role has field access", () => {
    assert.equal(hasFieldSurveyorAccess(["surveyor"]), true);
    assert.equal(hasFieldSurveyorAccess(["user"]), false);
    assert.equal(hasFieldSurveyorAccess(["viewer"]), false);
    assert.equal(hasFieldSurveyorAccess(["admin"]), false);
    assert.equal(hasFieldSurveyorAccess(["super_admin"]), false);
    assert.equal(hasFieldSurveyorAccess(DEV_AUTH_BYPASS_USER.roles), false);
});

test("requireFieldSurveyor forbids dashboard and public roles", async () => {
    for (const roles of [["user"], ["viewer"], ["admin"], ["super_admin"]]) {
        const { captured, reply } = captureReply();
        await requireFieldSurveyor(requestWithRoles(roles), reply);
        assert.equal(captured.statusCode, 403);
    }

    const ok = captureReply();
    const result = await requireFieldSurveyor(requestWithRoles(["surveyor"]), ok.reply);
    assert.equal(result, undefined);
    assert.equal(ok.captured.statusCode, undefined);
});

async function withAuthApp(
    env: { JWT_SECRET?: string; AUTH_BYPASS?: string },
    run: (app: ReturnType<typeof Fastify>) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = env.JWT_SECRET ?? "field-test-secret";
    if (env.AUTH_BYPASS === undefined) {
        delete process.env.AUTH_BYPASS;
    } else {
        process.env.AUTH_BYPASS = env.AUTH_BYPASS;
    }
    process.env.NODE_ENV = "test";

    const app = Fastify();
    try {
        await app.register(authPlugin);
        app.get(
            "/field/bootstrap",
            { preHandler: [app.authenticate, app.requireFieldSurveyor] },
            async () => ({ snapshotRevision: "v1-test", unchanged: true })
        );
        app.post(
            "/field/reports",
            { preHandler: [app.authenticate, app.requireFieldSurveyor] },
            async () => ({ publicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sourceCode: "field_survey" })
        );
        await app.ready();
        await run(app);
    } finally {
        await app.close();
        if (previous.JWT_SECRET === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = previous.JWT_SECRET;
        }
        if (previous.AUTH_BYPASS === undefined) {
            delete process.env.AUTH_BYPASS;
        } else {
            process.env.AUTH_BYPASS = previous.AUTH_BYPASS;
        }
        if (previous.NODE_ENV === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = previous.NODE_ENV;
        }
    }
}

test("GET /field/bootstrap requires a surveyor JWT", async () => {
    await withAuthApp({}, async (app) => {
        const missing = await app.inject({ method: "GET", url: "/field/bootstrap" });
        assert.equal(missing.statusCode, 401);

        const sign = (roles: string[]) =>
            app.jwt.sign({ sub: "u1", email: "u1@example.com", roles });

        for (const roles of [["user"], ["viewer"], ["admin"]]) {
            const denied = await app.inject({
                method: "GET",
                url: "/field/bootstrap",
                headers: { authorization: `Bearer ${sign(roles)}` },
            });
            assert.equal(denied.statusCode, 403);
        }

        const allowed = await app.inject({
            method: "GET",
            url: "/field/bootstrap",
            headers: { authorization: `Bearer ${sign(["surveyor"])}` },
        });
        assert.equal(allowed.statusCode, 200);
        assert.deepEqual(allowed.json(), { snapshotRevision: "v1-test", unchanged: true });
    });
});

test("AUTH_BYPASS admin user cannot read field bootstrap", async () => {
    await withAuthApp({ AUTH_BYPASS: "true" }, async (app) => {
        const response = await app.inject({ method: "GET", url: "/field/bootstrap" });
        assert.equal(response.statusCode, 403);
    });
});

test("POST /field/reports allows surveyor and rejects a regular user", async () => {
    await withAuthApp({}, async (app) => {
        const sign = (roles: string[]) =>
            app.jwt.sign({ sub: "u1", email: "u1@example.com", roles });

        const userDenied = await app.inject({
            method: "POST",
            url: "/field/reports",
            headers: { authorization: `Bearer ${sign(["user"])}` },
            payload: {},
        });
        assert.equal(userDenied.statusCode, 403);

        const surveyorOk = await app.inject({
            method: "POST",
            url: "/field/reports",
            headers: { authorization: `Bearer ${sign(["surveyor"])}` },
            payload: {},
        });
        assert.equal(surveyorOk.statusCode, 200);
    });
});
