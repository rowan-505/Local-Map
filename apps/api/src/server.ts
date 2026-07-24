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

        const { resolveEffectivePrismaConnectionLimit } = await import("./db/prisma.js");
        // Numeric limit only — never log DATABASE_URL or credentials.
        // eslint-disable-next-line no-console
        console.log(
            `[api] prisma connection_limit=${resolveEffectivePrismaConnectionLimit()}`,
        );

        const { buildApp } = await import("./app.js");
        // Startup checkpoints. buildApp() must NOT do external DB work, so the gap
        // between "before buildApp" and "before listen" stays tiny and the port binds
        // quickly. The import-review DB bootstrap runs only AFTER "listening".
        // eslint-disable-next-line no-console
        console.log("[api] before buildApp");
        const app = await buildApp();
        // eslint-disable-next-line no-console
        console.log("[api] after buildApp");

        // eslint-disable-next-line no-console
        console.log("[api] before listen");
        await app.listen({ port, host });
        // eslint-disable-next-line no-console
        console.log("[api] listening");
        app.log.info({ port, host, nodeEnv }, `[api] listening on http://${host}:${port}`);

        // Import-review DB bootstrap runs AFTER the port is bound, non-blocking and
        // time-boxed. A slow/unreachable Supabase connection can no longer delay the
        // HTTP bind (the Render "no open ports" failure) nor hang forever. Failures
        // flip import-review into a "failed" readiness state (its routes return 503)
        // and trigger a slow retry, but never crash the process or affect other modules.
        void (async () => {
            const { startImportReviewBootstrap } = await import(
                "./modules/import-review/import-review-bootstrap.js"
            );
            startImportReviewBootstrap(app.log);
        })();
    } catch (error) {
        // eslint-disable-next-line no-console -- ensure the failure is visible even if the logger never started
        console.error("[api] startup failed", error);
        process.exit(1);
    }
}

void start();
