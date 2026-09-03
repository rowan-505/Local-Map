import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import authPlugin from "../../plugins/auth.js";

async function withAuthApp(
    env: { JWT_SECRET?: string; AUTH_BYPASS?: string },
    run: (app: ReturnType<typeof Fastify>) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = env.JWT_SECRET ?? "media-admin-test-secret";
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
            "/admin/media/:publicId/access",
            { preHandler: [app.authenticate, app.requireRole("admin", "super_admin")] },
            async () => ({ method: "GET", url: "https://example.invalid/get" })
        );
        app.post(
            "/admin/media/:publicId/publish-stop",
            { preHandler: [app.authenticate, app.requireRole("admin", "super_admin")] },
            async () => ({ ok: true })
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

const ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("GET /admin/media/:id/access requires admin or super_admin", async () => {
    await withAuthApp({}, async (app) => {
        const missing = await app.inject({
            method: "GET",
            url: `/admin/media/${ASSET_ID}/access`,
        });
        assert.equal(missing.statusCode, 401);

        const sign = (roles: string[]) => app.jwt.sign({ sub: "u1", email: "u1@example.com", roles });

        for (const roles of [["user"], ["viewer"], ["surveyor"]]) {
            const denied = await app.inject({
                method: "GET",
                url: `/admin/media/${ASSET_ID}/access`,
                headers: { authorization: `Bearer ${sign(roles)}` },
            });
            assert.equal(denied.statusCode, 403);
        }

        for (const roles of [["admin"], ["super_admin"]]) {
            const allowed = await app.inject({
                method: "GET",
                url: `/admin/media/${ASSET_ID}/access`,
                headers: { authorization: `Bearer ${sign(roles)}` },
            });
            assert.equal(allowed.statusCode, 200);
        }
    });
});

test("POST /admin/media/:id/publish-stop requires admin or super_admin", async () => {
    await withAuthApp({}, async (app) => {
        const missing = await app.inject({
            method: "POST",
            url: `/admin/media/${ASSET_ID}/publish-stop`,
        });
        assert.equal(missing.statusCode, 401);

        const sign = (roles: string[]) => app.jwt.sign({ sub: "u1", email: "u1@example.com", roles });

        for (const roles of [["user"], ["viewer"], ["surveyor"]]) {
            const denied = await app.inject({
                method: "POST",
                url: `/admin/media/${ASSET_ID}/publish-stop`,
                headers: { authorization: `Bearer ${sign(roles)}` },
            });
            assert.equal(denied.statusCode, 403);
        }

        for (const roles of [["admin"], ["super_admin"]]) {
            const allowed = await app.inject({
                method: "POST",
                url: `/admin/media/${ASSET_ID}/publish-stop`,
                headers: { authorization: `Bearer ${sign(roles)}` },
            });
            assert.equal(allowed.statusCode, 200);
        }
    });
});
