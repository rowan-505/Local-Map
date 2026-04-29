import Fastify from "fastify";
import cors from "@fastify/cors";

import authPlugin from "./plugins/auth.js";
import prismaPlugin from "./plugins/prisma.js";
import adminAreasRoutes from "./modules/admin-areas/admin-areas.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import categoriesRoutes from "./modules/categories/categories.routes.js";
import placesRoutes from "./modules/places/places.routes.js";
import streetsRoutes from "./modules/streets/streets.routes.js";

const LOCAL_DASHBOARD_ORIGIN = "http://localhost:3000";

function getCorsOrigins() {
    const origins = new Set([LOCAL_DASHBOARD_ORIGIN]);
    const configuredOrigin = process.env.CORS_ORIGIN?.trim();

    if (configuredOrigin) {
        origins.add(configuredOrigin);
    }

    return [...origins];
}

export async function buildApp() {
    const app = Fastify({
        logger: true,
    });

    await app.register(cors, {
        origin: getCorsOrigins(),
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    });

    await app.register(prismaPlugin);
    await app.register(authPlugin);

    app.get("/health", async () => {
        return {
            ok: true,
        };
    });

    await app.register(authRoutes);
    await app.register(categoriesRoutes);
    await app.register(adminAreasRoutes);
    await app.register(placesRoutes);
    await app.register(streetsRoutes);

    return app;
}
