import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Prisma } from "@prisma/client";

import { disconnectImportReviewPrisma } from "./db/import-review-prisma.js";
import { prisma } from "./db/prisma.js";
import {
    getImportReviewReadiness,
    getImportReviewReadinessSnapshot,
} from "./modules/import-review/import-review-readiness.js";
import authPlugin from "./plugins/auth.js";
import prismaPlugin from "./plugins/prisma.js";
import { swaggerCorePlugin, swaggerUiPlugin } from "./plugins/swagger.js";
import adminAreasRoutes from "./modules/admin-areas/admin-areas.routes.js";
import entityAdminAreaRoutes from "./modules/entity-admin-area/entity-admin-area.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import savedPlacesRoutes from "./modules/saved-places/saved-places.routes.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import pointsRoutes from "./modules/points/points.routes.js";
import adminUsersRoutes from "./modules/admin-users/admin-users.routes.js";
import categoriesRoutes from "./modules/categories/categories.routes.js";
import placesRoutes from "./modules/places/places.routes.js";
import publicMapRoutes from "./modules/public-map/public-map.routes.js";
import shareRoutes from "./modules/share/share.routes.js";
import streetsRoutes from "./modules/streets/streets.routes.js";
import buildingsRoutes from "./modules/buildings/buildings.routes.js";
import placeBuildingRoutes from "./modules/place-buildings/place-buildings.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import importReviewRoutes from "./modules/import-review/import-review.routes.js";
import coreVerificationCompatRoutes from "./modules/core-verification-compat/core-verification-compat.routes.js";
import coreReviewRoutes from "./modules/core-review/core-review.routes.js";
import routingRoutes from "./modules/routing/routing.routes.js";
import routingAdminRoutes from "./modules/routing/routing-admin.routes.js";
import transportRoutes from "./modules/transport/transport.routes.js";
import refRoutes from "./modules/ref/ref.routes.js";
import addressesRoutes from "./modules/addresses/addresses.routes.js";
import { IMPORT_REVIEW_ADMIN_TOKEN_HEADER } from "./modules/import-review/import-review-admin.guard.js";
import { buildApiErrorResponse } from "./lib/api-error-response.js";
import { healthGetSchema } from "./lib/openapi/health.openapi.js";

const LOCAL_DASHBOARD_ORIGIN = "http://localhost:3000";
const LOCAL_WEB_ORIGIN = "http://localhost:5173";

function isProductionEnv() {
    return process.env.NODE_ENV === "production";
}

/**
 * Allowed CORS origins. In production ONLY the explicit `CORS_ORIGIN` allowlist is
 * trusted; localhost dev origins are never added. Outside production the localhost
 * dashboard/web origins are included for convenience.
 */
function getCorsOrigins() {
    const origins = new Set<string>();

    if (!isProductionEnv()) {
        origins.add(LOCAL_DASHBOARD_ORIGIN);
        origins.add(LOCAL_WEB_ORIGIN);
    }

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

    // NOTE: the import-review DB bootstrap (a Supabase round-trip) intentionally does
    // NOT run here. buildApp() must only build/register routes + plugins and return
    // fast so app.listen() binds the port immediately (Render port scan). The
    // bootstrap runs non-blockingly AFTER listen in server.ts.

    registerPublicErrorHandler(app);

    const corsOrigins = getCorsOrigins();
    if (isProductionEnv() && corsOrigins.length === 0) {
        app.log.warn(
            "CORS_ORIGIN is empty in production: all cross-origin requests will be blocked. Set CORS_ORIGIN to the dashboard/web origins."
        );
    }

    await app.register(cors, {
        origin: corsOrigins,
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            IMPORT_REVIEW_ADMIN_TOKEN_HEADER,
            // Guests submit reports with a persisted anonymous id via this header.
            "x-anonymous-id",
        ],
    });

    // Opt-in only (global: false): routes enable limits via `config.rateLimit`.
    // In-memory store — no Redis. Sensitive auth routes opt in (see auth.routes.ts).
    await app.register(rateLimit, {
        global: false,
        // The plugin throws this; returning an Error with statusCode lets the global
        // error handler emit a sanitized 429 (never leaks limits/IPs/retry internals).
        errorResponseBuilder: (_request, context) => {
            const error = new Error(
                "Too many requests. Please slow down and try again shortly."
            ) as Error & { statusCode: number };
            error.statusCode = context.statusCode;
            return error;
        },
    });

    await app.register(prismaPlugin);
    app.addHook("onClose", async () => {
        await disconnectImportReviewPrisma();
        await prisma.$disconnect();
    });
    await app.register(authPlugin);

    await app.register(swaggerCorePlugin);

    // Liveness probe — DB-FREE on purpose. Must respond instantly (used by Render's
    // port scan / health checks); never queries Supabase.
    app.get("/health", { schema: healthGetSchema }, async () => {
        return {
            ok: true,
        };
    });

    // Optional readiness/DB probe — separate from /health so a slow or down database
    // never makes the liveness check fail. Returns 503 when the DB is unreachable.
    app.get("/health/db", async (_request, reply) => {
        try {
            await app.prisma.$queryRaw`SELECT 1`;
            return { ok: true, importReview: getImportReviewReadiness() };
        } catch (error) {
            app.log.error({ err: error }, "[api] /health/db check failed");
            return reply.code(503).send({ ok: false, importReview: getImportReviewReadiness() });
        }
    });

    // Observability for the (time-boxed, after-listen) import-review DB bootstrap.
    // DB-free: reports the in-memory status only — never queries Supabase. Returns
    // 503 while pending/failed so external probes can distinguish readiness.
    app.get("/health/import-review", async (_request, reply) => {
        const snapshot = getImportReviewReadinessSnapshot();
        if (snapshot.status !== "ready") {
            return reply.code(503).send(snapshot);
        }
        return snapshot;
    });

    await app.register(authRoutes);
    await app.register(savedPlacesRoutes);
    await app.register(reportsRoutes);
    await app.register(pointsRoutes);
    await app.register(adminUsersRoutes);
    await app.register(categoriesRoutes);
    await app.register(adminAreasRoutes);
    await app.register(entityAdminAreaRoutes);
    await app.register(placesRoutes);
    await app.register(publicMapRoutes);
    await app.register(shareRoutes);
    await app.register(addressesRoutes);
    await app.register(streetsRoutes);
    await app.register(buildingsRoutes);
    await app.register(placeBuildingRoutes);
    await app.register(dashboardRoutes);
    await app.register(importReviewRoutes, { prefix: "/api/import-review" });
    await app.register(coreVerificationCompatRoutes, { prefix: "/api/core-verification" });
    await app.register(routingRoutes, { prefix: "/api/routing" });
    await app.register(routingAdminRoutes, { prefix: "/admin/routing" });
    await app.register(transportRoutes, { prefix: "/transport" });
    await app.register(refRoutes, { prefix: "/admin/ref" });
    await app.register(coreReviewRoutes, { prefix: "/core-review" });

    await app.register(swaggerUiPlugin);

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

        const url = request.url.split("?")[0] ?? request.url;
        if (url.startsWith("/api/import-review")) {
            const fastifyValidation = fastifyErr.validation;
            const errorCode =
                statusCode === 400
                    ? "VALIDATION_ERROR"
                    : statusCode === 404
                      ? "NOT_FOUND"
                      : statusCode === 401
                        ? "UNAUTHORIZED"
                        : statusCode === 403
                          ? "FORBIDDEN"
                          : "INTERNAL_ERROR";
            return reply
                .code(statusCode)
                .send(
                    buildApiErrorResponse(
                        errorCode,
                        message,
                        fastifyValidation === undefined ? null : { issues: fastifyValidation }
                    )
                );
        }

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
