import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
    getRefAddressUsageTypesSchema,
    getRefBoundaryStatusesSchema,
    getRefLanduseClassesSchema,
} from "./ref.openapi.js";
import { RefAddressUsageTypesRepository } from "./ref-address-usage-types.repo.js";
import { RefBoundaryStatusesRepository } from "./ref-boundary-statuses.repo.js";
import { RefLanduseClassesRepository } from "./ref-landuse-classes.repo.js";
import { RefLanduseClassesService } from "./ref-landuse-classes.service.js";

function replyRefReadError(request: FastifyRequest, reply: FastifyReply, error: unknown, context: string) {
    request.log.error({ err: error }, context);
    return reply.code(500).send({
        message: "Unable to load reference data.",
    });
}

const refRoutes: FastifyPluginAsync = async (app) => {
    const landuseRepo = new RefLanduseClassesRepository(app.prisma);
    const landuseService = new RefLanduseClassesService(landuseRepo);
    const boundaryStatusesRepo = new RefBoundaryStatusesRepository(app.prisma);
    const addressUsageTypesRepo = new RefAddressUsageTypesRepository(app.prisma);

    app.get(
        "/landuse-classes",
        {
            preHandler: app.authenticate,
            schema: getRefLanduseClassesSchema,
        },
        async (request, reply) => {
            try {
                const rows = await landuseService.listActiveLanduseClasses();
                return reply.send(rows);
            } catch (error) {
                return replyRefReadError(request, reply, error, "GET /admin/ref/landuse-classes failed");
            }
        }
    );

    app.get(
        "/boundary-statuses",
        {
            preHandler: app.authenticate,
            schema: getRefBoundaryStatusesSchema,
        },
        async (request, reply) => {
            try {
                const rows = await boundaryStatusesRepo.listActiveBoundaryStatuses();
                return reply.send(rows);
            } catch (error) {
                return replyRefReadError(request, reply, error, "GET /admin/ref/boundary-statuses failed");
            }
        }
    );

    app.get(
        "/address-usage-types",
        {
            preHandler: app.authenticate,
            schema: getRefAddressUsageTypesSchema,
        },
        async (request, reply) => {
            try {
                const rows = await addressUsageTypesRepo.listActiveAddressUsageTypes();
                return reply.send(rows);
            } catch (error) {
                return replyRefReadError(request, reply, error, "GET /admin/ref/address-usage-types failed");
            }
        }
    );
};

export default refRoutes;
