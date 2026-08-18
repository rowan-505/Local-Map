import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
    getRefAddressUsageTypesSchema,
    getRefBoundaryStatusesSchema,
    getRefLandAreaClassesSchema,
    getRefWaterClassesSchema,
} from "./ref.openapi.js";
import { RefAddressUsageTypesRepository } from "./ref-address-usage-types.repo.js";
import { RefBoundaryStatusesRepository } from "./ref-boundary-statuses.repo.js";
import { RefLandAreaClassesRepository } from "./ref-land-area-classes.repo.js";
import { RefLandAreaClassesService } from "./ref-land-area-classes.service.js";
import { RefWaterClassesRepository } from "./ref-water-classes.repo.js";
import { RefWaterClassesService } from "./ref-water-classes.service.js";

function replyRefReadError(request: FastifyRequest, reply: FastifyReply, error: unknown, context: string) {
    request.log.error({ err: error }, context);
    return reply.code(500).send({
        message: "Unable to load reference data.",
    });
}

const refRoutes: FastifyPluginAsync = async (app) => {
    const landAreaClassesRepo = new RefLandAreaClassesRepository(app.prisma);
    const landAreaClassesService = new RefLandAreaClassesService(landAreaClassesRepo);
    const waterClassesRepo = new RefWaterClassesRepository(app.prisma);
    const waterClassesService = new RefWaterClassesService(waterClassesRepo);
    const boundaryStatusesRepo = new RefBoundaryStatusesRepository(app.prisma);
    const addressUsageTypesRepo = new RefAddressUsageTypesRepository(app.prisma);

    const listLandAreaClasses = async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const rows = await landAreaClassesService.listActiveLandAreaClasses();
            return reply.send(rows);
        } catch (error) {
            return replyRefReadError(request, reply, error, "GET /admin/ref/land-area-classes failed");
        }
    };

    const listWaterClasses = async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const rows = await waterClassesService.listActiveWaterClasses();
            return reply.send(rows);
        } catch (error) {
            return replyRefReadError(request, reply, error, "GET /admin/ref/water-classes failed");
        }
    };

    app.get(
        "/land-area-classes",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
            schema: getRefLandAreaClassesSchema,
        },
        listLandAreaClasses
    );

    // Compatibility alias (same payload). Prefer /land-area-classes.
    app.get(
        "/landuse-classes",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
            schema: getRefLandAreaClassesSchema,
        },
        listLandAreaClasses
    );

    app.get(
        "/water-classes",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
            schema: getRefWaterClassesSchema,
        },
        listWaterClasses
    );

    app.get(
        "/boundary-statuses",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
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
            preHandler: [app.authenticate, app.requireDashboardAccess],
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
