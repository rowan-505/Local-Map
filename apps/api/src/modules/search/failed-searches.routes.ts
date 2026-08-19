import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
    failedSearchIdParamSchema,
    listFailedSearchesQuerySchema,
    updateFailedSearchBodySchema,
} from "./failed-searches.schema.js";
import { FailedSearchesRepository } from "./failed-searches.repo.js";
import {
    FailedSearchesError,
    FailedSearchesService,
} from "./failed-searches.service.js";
import {
    getFailedSearchByIdSchema,
    getFailedSearchesSchema,
    patchFailedSearchSchema,
} from "./failed-searches.openapi.js";

function handleError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof FailedSearchesError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }
    throw error;
}

const failedSearchesRoutes: FastifyPluginAsync = async (app) => {
    const service = new FailedSearchesService(new FailedSearchesRepository(app.prisma));
    const readGuard = { preHandler: [app.authenticate, app.requireDashboardAccess] };
    const writeGuard = { preHandler: [app.authenticate, app.requireDashboardWrite] };

    app.get(
        "/admin/search/failed-searches",
        { ...readGuard, schema: getFailedSearchesSchema },
        async (request, reply) => {
            const parsed = listFailedSearchesQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid failed searches list query",
                    issues: parsed.error.flatten(),
                });
            }
            return reply.send(await service.list(parsed.data));
        },
    );

    app.get(
        "/admin/search/failed-searches/:id",
        { ...readGuard, schema: getFailedSearchByIdSchema },
        async (request, reply) => {
            const params = failedSearchIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid failed search id",
                    issues: params.error.flatten(),
                });
            }
            try {
                return reply.send(await service.getById(params.data.id));
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );

    app.patch(
        "/admin/search/failed-searches/:id",
        { ...writeGuard, schema: patchFailedSearchSchema },
        async (request, reply) => {
            const params = failedSearchIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid failed search id",
                    issues: params.error.flatten(),
                });
            }
            const body = updateFailedSearchBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid failed search update payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                return reply.send(await service.update(params.data.id, body.data));
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );
};

export default failedSearchesRoutes;
