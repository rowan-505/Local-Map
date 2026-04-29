import type { FastifyPluginAsync } from "fastify";

import { streetIdParamsSchema, streetsQuerySchema, updateStreetBodySchema } from "./streets.schema.js";
import { StreetsRepository } from "./streets.repo.js";
import { StreetNotFoundError, StreetsService, StreetValidationError } from "./streets.service.js";

const EDIT_STREET_ROLES = new Set(["admin", "editor"]);

function sanitizeStreetPatchBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }

    const { updated_at: _ignoredUpdatedAt, ...rest } = body as Record<string, unknown>;
    return rest;
}

const streetsRoutes: FastifyPluginAsync = async (app) => {
    const streetsRepo = new StreetsRepository(app.prisma);
    const streetsService = new StreetsService(streetsRepo);

    app.get(
        "/streets",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = streetsQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid streets query",
                    issues: parsed.error.flatten(),
                });
            }

            const streets = await streetsService.listStreets(parsed.data.limit);
            return reply.send(streets);
        }
    );

    app.get(
        "/streets/:id",
        {
            preHandler: app.authenticate,
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
        }
    );

    app.patch(
        "/streets/:id",
        {
            preHandler: app.authenticate,
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
                const street = await streetsService.updateStreet(paramsParsed.data.id, bodyParsed.data);
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
        }
    );
};

export default streetsRoutes;
