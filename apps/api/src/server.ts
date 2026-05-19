import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root then apps/api — later files override for duplicate keys (api wins). */
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

async function start() {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const port = Number(process.env.PORT ?? 3001);

    try {
        await app.listen({
            port,
            host: "0.0.0.0",
        });
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
}

void start();
