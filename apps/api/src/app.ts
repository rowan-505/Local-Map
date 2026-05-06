import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Prisma } from "@prisma/client";

import { prisma } from "./lib/prisma.js";
import authPlugin from "./plugins/auth.js";
import prismaPlugin from "./plugins/prisma.js";
import adminAreasRoutes from "./modules/admin-areas/admin-areas.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import categoriesRoutes from "./modules/categories/categories.routes.js";
import placesRoutes from "./modules/places/places.routes.js";
import publicMapRoutes from "./modules/public-map/public-map.routes.js";
import streetsRoutes from "./modules/streets/streets.routes.js";
import buildingsRoutes from "./modules/buildings/buildings.routes.js";
import placeBuildingRoutes from "./modules/place-buildings/place-buildings.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";

const LOCAL_DASHBOARD_ORIGIN = "http://localhost:3000";
const LOCAL_WEB_ORIGIN = "http://localhost:5173";

function getCorsOrigins() {
    const origins = new Set([LOCAL_DASHBOARD_ORIGIN, LOCAL_WEB_ORIGIN]);
    const configuredOrigins = process.env.CORS_ORIGIN?.split(",") ?? [];

    for (const origin of configuredOrigins) {
        const trimmedOrigin = origin.trim();

        if (trimmedOrigin) {
            origins.add(trimmedOrigin);
        }
    }

    return [...origins];
}

export async function buildApp() {
    const app = Fastify({
        logger: true,
    });

    registerPublicErrorHandler(app);

    await app.register(cors, {
        origin: getCorsOrigins(),
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    });

    await app.register(prismaPlugin);
    app.addHook("onClose", async () => {
        await prisma.$disconnect();
    });
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
    await app.register(publicMapRoutes);
    await app.register(streetsRoutes);
    await app.register(buildingsRoutes);
    await app.register(placeBuildingRoutes);
    await app.register(dashboardRoutes);

    return app;
}

/** Safe JSON bodies for browsers; structured logs retain Prisma / DB diagnostics. */
function registerPublicErrorHandler(app: FastifyInstance) {
    app.setErrorHandler((error, request, reply) => {
        const fastifyErr = error as { statusCode?: number; message?: string; validation?: unknown };

        const statusCode =
            typeof fastifyErr.statusCode === "number" && fastifyErr.statusCode > 0
                ? fastifyErr.statusCode
                : 500;

        const prismaKnown = error instanceof Prisma.PrismaClientKnownRequestError;
        const prismaUnknown = error instanceof Prisma.PrismaClientUnknownRequestError;
        const prismaInit = error instanceof Prisma.PrismaClientInitializationError;

        const errMessage = error instanceof Error ? error.message : String(error);
        if (/max clients reached|pool.?size|connection.*refused/i.test(errMessage)) {
            request.log.warn(
                { poolHint: "possible Supabase session pool exhaustion" },
                "Database pool / connection limit"
            );
        }

        request.log.error(
            {
                err: error,
                statusCode,
                prismaCode: prismaKnown ? error.code : undefined,
            },
            "API request failed"
        );

        if (reply.sent) {
            return;
        }

        const message = publicClientErrorMessage(statusCode, error, {
            prismaKnown,
            prismaUnknown,
            prismaInit,
        });

        return reply.code(statusCode).send({ message });
    });
}

function publicClientErrorMessage(
    statusCode: number,
    error: unknown,
    flags: { prismaKnown: boolean; prismaUnknown: boolean; prismaInit: boolean }
): string {
    if (statusCode >= 500 || flags.prismaKnown || flags.prismaUnknown || flags.prismaInit) {
        return "We could not load this data right now. Please try again in a moment.";
    }

    const raw =
        error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";

    if (!raw || raw.length > 240 || /prisma|\$queryRaw|connector:/i.test(raw)) {
        return "Request could not be completed.";
    }

    return raw;
}
