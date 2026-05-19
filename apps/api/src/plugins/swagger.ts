import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readApiVersion(): string {
    try {
        const raw = readFileSync(join(__dirname, "../../package.json"), "utf8");
        const pkg = JSON.parse(raw) as { version?: string };
        if (typeof pkg.version === "string" && pkg.version.length > 0) {
            return pkg.version;
        }
    } catch {
        // Fall through
    }
    return "1.0.0";
}

/**
 * Optional public base URL for the "Servers" dropdown in Swagger UI (e.g. https://api.example.com).
 * Do not put secrets here. If unset, uses `/` so requests stay on the current host (works locally and on Render).
 */
function buildOpenApiServers() {
    const base = process.env.PUBLIC_API_URL?.trim();
    if (base) {
        const url = base.replace(/\/+$/, "");
        return [{ url, description: "Public API base URL (PUBLIC_API_URL)" }];
    }
    return [{ url: "/", description: "Current origin (local dev or same host as this service)" }];
}

/**
 * Registers `@fastify/swagger` (OpenAPI 3 metadata + route introspection).
 * Must be registered **before** any HTTP routes so paths are included in the spec.
 */
export const swaggerCorePlugin = fp(
    async (app: FastifyInstance) => {
        await app.register(swagger, {
            openapi: {
                openapi: "3.0.3",
                info: {
                    title: "Local Map API",
                    description:
                        "HTTP API for Local Map (places, streets, buildings, public map). Routes marked with a lock require `Authorization: Bearer <token>` from POST /auth/login.",
                    version: readApiVersion(),
                },
                servers: buildOpenApiServers(),
                tags: [
                    { name: "Health", description: "Service liveness and readiness-style checks." },
                    { name: "Auth", description: "Login, signup, and token issuance." },
                    { name: "User", description: "Authenticated user profile (`/me`)." },
                    { name: "Categories", description: "Place category reference data (public and internal)." },
                    { name: "Admin Areas", description: "Administrative boundaries and GeoJSON layers." },
                    { name: "Places", description: "Dashboard place CRUD, form options, and place–building links." },
                    { name: "Streets", description: "Street centerlines, road classes, validation, and map GeoJSON." },
                    { name: "Buildings", description: "Building footprints and taxonomy." },
                    { name: "Dashboard", description: "Internal admin surfaces." },
                    { name: "Stats", description: "Aggregated counts for the admin dashboard." },
                    { name: "Transit", description: "Bus stops and routes (GeoJSON)." },
                    { name: "Search", description: "Public text search for the map client." },
                    {
                        name: "Import Review",
                        description:
                            "Admin-only Supabase `import_review` workspace. **`AUTH_BYPASS` is ignored.** Configure `IMPORT_REVIEW_ADMIN_TOKEN` to require header `x-import-review-admin-token` (401 missing, 403 mismatch; Bearer not required). Omit that env to require Bearer JWT whose payload includes `\"roles\": [\"admin\"]`."
                    },
                ],
                components: {
                    securitySchemes: {
                        bearerAuth: {
                            type: "http",
                            scheme: "bearer",
                            bearerFormat: "JWT",
                            description:
                                "When **`IMPORT_REVIEW_ADMIN_TOKEN` is unset**, Import Review requires `Authorization: Bearer <accessToken>` from `/auth/login` and JWT payload `roles` must include `\"admin\"` (**401** if missing or invalid JWT; **403** if not admin). When **`IMPORT_REVIEW_ADMIN_TOKEN` is set**, every Import Review request must send header **`x-import-review-admin-token: <exact token>`**; omitting/closing whitespace-only → **401**, wrong secret → **403** (Bearer JWT is **not needed** there — temporary shared-secret shim).",
                        },
                    },
                },
            },
        });
    },
    { name: "swagger-core" },
);

/**
 * Serves Swagger UI and a stable OpenAPI JSON URL. Register **after** all routes.
 */
export const swaggerUiPlugin = fp(
    async (app: FastifyInstance) => {
        await app.register(swaggerUi, {
            routePrefix: "/docs",
            uiConfig: {
                docExpansion: "list",
                deepLinking: true,
            },
        });

        app.get(
            "/openapi.json",
            {
                schema: {
                    hide: true,
                },
            },
            async (_request, reply) => {
                return reply.type("application/json; charset=utf-8").send(app.swagger());
            },
        );
    },
    { name: "swagger-ui" },
);
