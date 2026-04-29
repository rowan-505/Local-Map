import Fastify from "fastify";
import cors from "@fastify/cors";

import authPlugin from "./plugins/auth.js";
import prismaPlugin from "./plugins/prisma.js";
import adminAreasRoutes from "./modules/admin-areas/admin-areas.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import categoriesRoutes from "./modules/categories/categories.routes.js";
import placesRoutes from "./modules/places/places.routes.js";
import streetsRoutes from "./modules/streets/streets.routes.js";

export async function buildApp() {
    const app = Fastify({
        logger: true,
    });

    await app.register(cors, {
        origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
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
