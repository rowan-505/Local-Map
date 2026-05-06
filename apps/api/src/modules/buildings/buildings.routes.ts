import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
    buildingIdParamsSchema,
    buildingsQuerySchema,
    createBuildingBodySchema,
    updateBuildingBodySchema,
} from "./buildings.schema.js";
import { BuildingsRepository } from "./buildings.repo.js";
import {
    BuildingNotFoundError,
    BuildingsService,
    BuildingValidationError,
} from "./buildings.service.js";

const EDIT_BUILDING_ROLES = new Set(["admin", "editor"]);

const IS_BUILDINGS_DEV_DEBUG = process.env.NODE_ENV !== "production";

function replyBuildingsReadError(request: FastifyRequest, reply: FastifyReply, error: unknown, context: string) {
    request.log.error({ err: error }, context);

    return reply.code(500).send({
        message: "Unable to load building data.",
    });
}

function replyBuildingsMutationError(request: FastifyRequest, reply: FastifyReply, error: unknown, context: string) {
    request.log.error({ err: error }, context);

    return reply.code(500).send({
        message: "We could not save that building change. Please try again.",
    });
}

function sanitizeBuildingCreateBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }

    const {
        id: _ignoredId,
        public_id: _ignoredPublicId,
        created_at: _ignoredCreatedAt,
        updated_at: _ignoredUpdatedAt,
        deleted_at: _ignoredDeletedAt,
        ...rest
    } = body as Record<string, unknown>;

    return rest;
}

function sanitizeBuildingPatchBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }

    const { updated_at: _ignoredUpdatedAt, ...rest } = body as Record<string, unknown>;
    return rest;
}

const buildingsRoutes: FastifyPluginAsync = async (app) => {
    const buildingsRepo = new BuildingsRepository(app.prisma);
    const buildingsService = new BuildingsService(buildingsRepo);

    app.get(
        "/building-types",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            try {
                const types = await buildingsService.listRefBuildingTypes();
                return reply.send(types);
            } catch (error) {
                return replyBuildingsReadError(request, reply, error, "building-types GET failed");
            }
        }
    );

    app.get(
        "/buildings",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = buildingsQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid buildings query",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const buildings = await buildingsService.listBuildings(parsed.data);
                return reply.send(buildings);
            } catch (error) {
                return replyBuildingsReadError(request, reply, error, "buildings GET list failed");
            }
        }
    );

    app.get(
        "/buildings/:id",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = buildingIdParamsSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid building id",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const building = await buildingsService.getBuildingByPublicId(parsed.data.id);
                return reply.send(building);
            } catch (error) {
                if (error instanceof BuildingNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                return replyBuildingsReadError(request, reply, error, "buildings GET by id failed");
            }
        }
    );

    app.post(
        "/buildings",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const sanitizedBody = sanitizeBuildingCreateBody(request.body);
            const parsed = createBuildingBodySchema.safeParse(sanitizedBody);

            if (!parsed.success) {
                if (IS_BUILDINGS_DEV_DEBUG) {
                    request.log.warn(
                        {
                            issues: parsed.error.flatten(),
                            body: sanitizedBody,
                        },
                        "buildings POST validation failed"
                    );
                }

                return reply.code(400).send({
                    message: "Invalid building payload",
                    issues: parsed.error.flatten(),
                });
            }

            const canMutate = request.user.roles.some((role) => EDIT_BUILDING_ROLES.has(role));

            if (!canMutate) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const created = await buildingsService.createBuilding(parsed.data);
                if (IS_BUILDINGS_DEV_DEBUG) {
                    request.log.info(
                        {
                            public_id: created.public_id,
                            created_at: created.created_at,
                            updated_at: created.updated_at,
                        },
                        "building created with timestamps"
                    );
                    request.log.info("tiles_buildings_v includes dashboard buildings");
                }
                return reply.code(201).send(created);
            } catch (error) {
                if (error instanceof BuildingValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                        issues: error.issues,
                    });
                }

                return replyBuildingsMutationError(request, reply, error, "buildings POST failed");
            }
        }
    );

    app.patch(
        "/buildings/:id",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const paramsParsed = buildingIdParamsSchema.safeParse(request.params);
            const sanitizedBody = sanitizeBuildingPatchBody(request.body);
            const bodyParsed = updateBuildingBodySchema.safeParse(sanitizedBody);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid building id",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                if (IS_BUILDINGS_DEV_DEBUG) {
                    request.log.warn(
                        {
                            issues: bodyParsed.error.flatten(),
                            body: sanitizedBody,
                        },
                        "buildings PATCH validation failed"
                    );
                }

                return reply.code(400).send({
                    message: "Invalid building payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const canMutate = request.user.roles.some((role) => EDIT_BUILDING_ROLES.has(role));

            if (!canMutate) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const updated = await buildingsService.updateBuilding(
                    paramsParsed.data.id,
                    bodyParsed.data
                );

                if (IS_BUILDINGS_DEV_DEBUG) {
                    request.log.info(
                        {
                            public_id: updated.public_id,
                            updated_at: updated.updated_at,
                        },
                        "building updated timestamp"
                    );
                }

                return reply.send(updated);
            } catch (error) {
                if (error instanceof BuildingValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                        issues: error.issues,
                    });
                }

                if (error instanceof BuildingNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                return replyBuildingsMutationError(request, reply, error, "buildings PATCH failed");
            }
        }
    );

    app.delete(
        "/buildings/:id",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = buildingIdParamsSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid building id",
                    issues: parsed.error.flatten(),
                });
            }

            const canMutate = request.user.roles.some((role) => EDIT_BUILDING_ROLES.has(role));

            if (!canMutate) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const { public_id } = await buildingsService.softDeleteBuilding(parsed.data.id);
                request.log.info({ public_id }, "building soft deleted");

                return reply.send({
                    ok: true,
                    deleted: true,
                    public_id,
                });
            } catch (error) {
                if (error instanceof BuildingNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                return replyBuildingsMutationError(request, reply, error, "buildings DELETE failed");
            }
        }
    );
};

export default buildingsRoutes;
