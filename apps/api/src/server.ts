import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load .env files for LOCAL development only. On a hosting platform (Render,
 * etc.) the environment is injected directly, so we never read .env there.
 *
 * Precedence: real shell/platform env > apps/api/.env > repo-root .env. We load
 * apps/api/.env first and WITHOUT override, so an already-set variable (the shell
 * or the platform, e.g. PORT) always wins and apps/api still beats the repo root.
 * Using `override: true` here was the bug: a committed PORT=3001 could clobber
 * the platform's injected PORT and make the bind fail Render's port scan.
 */
if (process.env.NODE_ENV !== "production") {
    const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const repoRoot = resolve(apiRoot, "../..");
    config({ path: resolve(apiRoot, ".env") });
    config({ path: resolve(repoRoot, ".env") });
}

async function start() {
    const nodeEnv = process.env.NODE_ENV ?? "development";
    // Read the bind target directly from the environment so the port bind is never
    // coupled to (or blocked by) the rest of the env-schema validation. Render
    // injects PORT and expects the service on it; 0.0.0.0 is required so the bind
    // is reachable (never localhost/127.0.0.1 in production).
    const port = Number(process.env.PORT ?? 3001) || 3001;
    const host = process.env.HOST ?? "0.0.0.0";

    // eslint-disable-next-line no-console -- startup diagnostics before the logger exists
    console.log(`[api] starting | NODE_ENV=${nodeEnv} | PORT=${port} | HOST=${host}`);

    try {
        const { loadApiEnv } = await import("./config/env.js");
        const { assertAuthBypassNotInProduction } = await import("./plugins/auth.js");
        loadApiEnv();
        assertAuthBypassNotInProduction();

        const { buildApp } = await import("./app.js");
        const app = await buildApp();

        await app.listen({ port, host });
        app.log.info({ port, host, nodeEnv }, `[api] listening on http://${host}:${port}`);
    } catch (error) {
        // eslint-disable-next-line no-console -- ensure the failure is visible even if the logger never started
        console.error("[api] failed to start", error);
        process.exit(1);
    }
}

void start();
