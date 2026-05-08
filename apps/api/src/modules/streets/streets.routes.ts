import type { FastifyPluginAsync } from "fastify";

import {
    createStreetBodySchema,
    deleteStreetBodySchema,
    nearestStreetPointQuerySchema,
    splitStreetIdParamsSchema,
    splitStreetBodySchema,
    streetIdParamsSchema,
    streetsQuerySchema,
    updateStreetBodySchema,
    validateStreetGeometryBodySchema,
} from "./streets.schema.js";
import { StreetsRepository } from "./streets.repo.js";
import { StreetNotFoundError, StreetsService, StreetValidationError } from "./streets.service.js";
import {
    deleteStreetSchema,
    getRoadClassesSchema,
    getStreetByIdSchema,
    getStreetsListSchema,
    getStreetsNearestPointSchema,
    patchStreetSchema,
    postStreetSplitSchema,
    postStreetsSchema,
    postStreetsValidateGeometrySchema,
} from "./streets.openapi.js";

const EDIT_STREET_ROLES = new Set(["admin", "editor"]);

function sanitizeStreetPatchBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }

    const {
        updated_at: _ignoredUpdatedAt,
        canonical_name: _ignoredCanonical,
        canonicalName: _ignoredCanonicalCamel,
        ...rest
    } = body as Record<string, unknown>;
    return rest;
}

const streetsRoutes: FastifyPluginAsync = async (app) => {
    const streetsRepo = new StreetsRepository(app.prisma);
    const streetsService = new StreetsService(streetsRepo);

    app.get(
        "/road-classes",
        {
            preHandler: app.authenticate,
            schema: getRoadClassesSchema,
        },
        async (_request, reply) => {
            const rows = await streetsService.listRoadClasses();
            return reply.send(rows);
        },
    );

    app.get(
        "/streets",
        {
            preHandler: app.authenticate,
            schema: getStreetsListSchema,
        },
        async (request, reply) => {
            const parsed = streetsQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid streets query",
                    issues: parsed.error.flatten(),
                });
            }

            const streets = await streetsService.listStreets(parsed.data);
            return reply.send(streets);
        },
    );

    app.get(
        "/streets/nearest-point",
        {
            preHandler: app.authenticate,
            schema: getStreetsNearestPointSchema,
        },
        async (request, reply) => {
            const parsed = nearestStreetPointQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid nearest-point query",
                    issues: parsed.error.flatten(),
                });
            }

            const hit = await streetsService.getNearestStreetPoint(parsed.data);
            return reply.send(hit);
        },
    );

    app.post(
        "/streets/validate-geometry",
        {
            preHandler: app.authenticate,
            schema: postStreetsValidateGeometrySchema,
        },
        async (request, reply) => {
            const parsed = validateStreetGeometryBodySchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid validate-geometry payload",
                    issues: parsed.error.flatten(),
                });
            }

            const canValidate = request.user.roles.some((role) => EDIT_STREET_ROLES.has(role));

            if (!canValidate) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            const result = await streetsService.validateStreetGeometry(parsed.data);
            return reply.send(result);
        },
    );

    app.get(
        "/streets/:id",
        {
            preHandler: app.authenticate,
            schema: getStreetByIdSchema,
        },
        async (request, reply) => {
            const parsed = streetIdParamsSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid street id",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const street = await streetsService.getStreetByPublicId(parsed.data.id);
                return reply.send(street);
            } catch (error) {
                if (error instanceof StreetNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        },
    );

    app.post(
        "/streets",
        {
            preHandler: app.authenticate,
            schema: postStreetsSchema,
        },
        async (request, reply) => {
            const parsed = createStreetBodySchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid street payload",
                    issues: parsed.error.flatten(),
                });
            }

            const canCreateStreet = request.user.roles.some((role) => EDIT_STREET_ROLES.has(role));

            if (!canCreateStreet) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const street = await streetsService.createStreet(parsed.data, request.user);
                return reply.code(201).send(street);
            } catch (error) {
                if (error instanceof StreetValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        },
    );

    app.patch(
        "/streets/:id",
        {
            preHandler: app.authenticate,
            schema: patchStreetSchema,
        },
        async (request, reply) => {
            const paramsParsed = streetIdParamsSchema.safeParse(request.params);
            const sanitizedBody = sanitizeStreetPatchBody(request.body);
            const bodyParsed = updateStreetBodySchema.safeParse(sanitizedBody);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid street id",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid street payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const canEditStreet = request.user.roles.some((role) => EDIT_STREET_ROLES.has(role));

            if (!canEditStreet) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const street = await streetsService.updateStreet(
                    paramsParsed.data.id,
                    bodyParsed.data,
                    request.user,
                );
                return reply.send(street);
            } catch (error) {
                if (error instanceof StreetValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                    });
                }

                if (error instanceof StreetNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        },
    );

    app.post(
        "/streets/:id/split",
        {
            preHandler: app.authenticate,
            schema: postStreetSplitSchema,
        },
        async (request, reply) => {
            const paramsParsed = splitStreetIdParamsSchema.safeParse(request.params);
            const bodyParsed = splitStreetBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid street id",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid street split payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const canEditStreet = request.user.roles.some((role) => EDIT_STREET_ROLES.has(role));

            if (!canEditStreet) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const result = await streetsService.splitStreet(
                    paramsParsed.data.id,
                    bodyParsed.data,
                    request.user,
                );
                return reply.code(200).send(result);
            } catch (error) {
                if (error instanceof StreetValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                    });
                }

                if (error instanceof StreetNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        },
    );

    app.delete(
        "/streets/:id",
        {
            preHandler: app.authenticate,
            schema: deleteStreetSchema,
        },
        async (request, reply) => {
            const paramsParsed = streetIdParamsSchema.safeParse(request.params);
            const rawBody =
                typeof request.body === "object" && request.body !== null && !Array.isArray(request.body)
                    ? request.body
                    : {};

            const bodyParsed = deleteStreetBodySchema.safeParse(rawBody);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid street id",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid delete payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const canDeleteStreet = request.user.roles.some((role) => EDIT_STREET_ROLES.has(role));

            if (!canDeleteStreet) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const street = await streetsService.softDeleteStreet(
                    paramsParsed.data.id,
                    request.user,
                    bodyParsed.data.edit_reason,
                );
                return reply.send(street);
            } catch (error) {
                if (error instanceof StreetValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                    });
                }

                if (error instanceof StreetNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        },
    );
};

export default streetsRoutes;
