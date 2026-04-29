import { buildApp } from "./app.js";

async function start() {
    const app = await buildApp();
    const port = Number(process.env.PORT ?? 3001);
    const host = process.env.HOST ?? "0.0.0.0";

    try {
        await app.listen({
            port,
            host,
        });
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
}

void start();
