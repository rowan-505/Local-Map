import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
    createSearchAliasBodySchema,
    listSearchAliasesQuerySchema,
    searchAliasIdParamSchema,
    updateSearchAliasBodySchema,
} from "./search-aliases.schema.js";
import {
    SearchAliasesError,
    SearchAliasesService,
    type SearchAliasActor,
} from "./search-aliases.service.js";
import { SearchAliasesRepository } from "./search-aliases.repo.js";
import {
    deleteSearchAliasSchema,
    getSearchAliasesSchema,
    patchSearchAliasSchema,
    postSearchAliasSchema,
} from "./search-aliases.openapi.js";

function handleError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SearchAliasesError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }
    throw error;
}

function toActor(request: FastifyRequest): SearchAliasActor {
    return {
        publicId: request.user.sub,
        ipAddress: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
    };
}

const searchAliasesRoutes: FastifyPluginAsync = async (app) => {
    const service = new SearchAliasesService(
        new SearchAliasesRepository(app.prisma),
        app.prisma,
    );
    const readGuard = { preHandler: [app.authenticate, app.requireDashboardAccess] };
    const writeGuard = { preHandler: [app.authenticate, app.requireDashboardWrite] };

    app.get(
        "/admin/search/aliases",
        { ...readGuard, schema: getSearchAliasesSchema },
        async (request, reply) => {
            const parsed = listSearchAliasesQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid search alias list query",
                    issues: parsed.error.flatten(),
                });
            }
            return reply.send(await service.list(parsed.data));
        },
    );

    app.post(
        "/admin/search/aliases",
        { ...writeGuard, schema: postSearchAliasSchema },
        async (request, reply) => {
            const body = createSearchAliasBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid search alias payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                const created = await service.create(toActor(request), body.data);
                return reply.code(201).send(created);
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );

    app.patch(
        "/admin/search/aliases/:id",
        { ...writeGuard, schema: patchSearchAliasSchema },
        async (request, reply) => {
            const params = searchAliasIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid alias id", issues: params.error.flatten() });
            }
            const body = updateSearchAliasBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid search alias update payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.update(toActor(request), params.data.id, body.data),
                );
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );

    app.delete(
        "/admin/search/aliases/:id",
        { ...writeGuard, schema: deleteSearchAliasSchema },
        async (request, reply) => {
            const params = searchAliasIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid alias id", issues: params.error.flatten() });
            }
            try {
                return reply.send(await service.disable(toActor(request), params.data.id));
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );
};

export default searchAliasesRoutes;
