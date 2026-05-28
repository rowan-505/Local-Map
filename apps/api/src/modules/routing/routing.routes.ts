import type { FastifyPluginAsync } from "fastify";

import {
    RoutingGraphBuildDisabledError,
    RoutingGraphBuildInputError,
    RoutingGraphBuildMaxRoadsError,
} from "./routing.errors.js";
import { RoutingGraphBuildService } from "./routing-graph-build.service.js";
import { postRoutingFeedbackBodySchema } from "./routing-feedback.schema.js";
import { sendRoutingError } from "./routing-error-response.js";
import {
    getRoutingHealthSchema,
    getRoutingProfilesSchema,
    postRoutingAdminBuildGraphSchema,
    postRoutingFeedbackSchema,
    postRoutingRouteSchema,
} from "./routing.openapi.js";
import { RoutingRepository } from "./routing.repo.js";
import { createRoutingService } from "./routing.service.js";
import { buildRoutingGraphBodySchema } from "./routing.schema.js";
import type { RoutingGraphBuildInput } from "./routing.types.js";

const ADMIN_ROLES = new Set(["admin"]);

function requireAdminRole(roles: string[] | undefined): boolean {
    return (roles ?? []).some((role) => ADMIN_ROLES.has(role));
}

function mapBodyToInput(
    body: ReturnType<typeof buildRoutingGraphBodySchema.parse>,
    createdBy: bigint | null
): RoutingGraphBuildInput {
    return {
        profileCode: body.profile_code,
        sourcePublishBatchId: body.source_publish_batch_id
            ? BigInt(body.source_publish_batch_id)
            : null,
        sourceReviewBatchId: body.source_review_batch_id
            ? BigInt(body.source_review_batch_id)
            : null,
        bbox: body.bbox
            ? {
                  minLon: body.bbox.min_lon,
                  minLat: body.bbox.min_lat,
                  maxLon: body.bbox.max_lon,
                  maxLat: body.bbox.max_lat,
              }
            : null,
        regionCode: body.region_code ?? null,
        maxRoads: body.max_roads,
        dryRun: body.dry_run,
        createdBy,
    };
}

const routingRoutes: FastifyPluginAsync = async (app) => {
    const graphBuildService = new RoutingGraphBuildService(app.prisma);
    const routingRepo = new RoutingRepository(app.prisma);
    const routingService = createRoutingService(routingRepo);

    app.get("/health", { schema: getRoutingHealthSchema }, async (_request, reply) => {
        const result = await routingService.getHealth();
        return reply.send(result);
    });

    app.get("/profiles", { schema: getRoutingProfilesSchema }, async (_request, reply) => {
        const result = await routingService.listProfiles();
        return reply.send(result);
    });

    app.post("/route", { schema: postRoutingRouteSchema }, async (request, reply) => {
        const userIdRaw = request.user?.id ?? request.user?.sub;
        const userId = userIdRaw && /^\d+$/.test(userIdRaw) ? BigInt(userIdRaw) : null;

        try {
            const result = await routingService.route(request.body, {
                userId,
                warn: (message, meta) => {
                    request.log.warn(meta ?? {}, message);
                },
            });
            return reply.send(result);
        } catch (error) {
            const handled = sendRoutingError(reply, error);
            if (handled) {
                return handled;
            }
            throw error;
        }
    });

    app.post("/feedback", { schema: postRoutingFeedbackSchema }, async (request, reply) => {
        const parsed = postRoutingFeedbackBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid routing feedback body",
                code: "ROUTING_VALIDATION_ERROR",
                issues: parsed.error.flatten(),
            });
        }

        const userIdRaw = request.user?.id ?? request.user?.sub;
        const userId = userIdRaw && /^\d+$/.test(userIdRaw) ? BigInt(userIdRaw) : null;

        const result = await routingService.submitFeedback(parsed.data, { userId });
        return reply.send({
            publicId: result.publicId,
            status: result.status,
            stored: result.stored,
        });
    });

    app.post(
        "/admin/build-graph",
        {
            preHandler: app.authenticate,
            schema: postRoutingAdminBuildGraphSchema,
        },
        async (request, reply) => {
            if (!requireAdminRole(request.user?.roles)) {
                return reply.code(403).send({ message: "Routing admin endpoints require admin role." });
            }

            const parsed = buildRoutingGraphBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid build-graph body",
                    issues: parsed.error.flatten(),
                });
            }

            const createdByRaw = request.user?.id ?? request.user?.sub;
            const createdBy =
                createdByRaw && /^\d+$/.test(createdByRaw) ? BigInt(createdByRaw) : null;

            try {
                const result = await graphBuildService.buildGraph(
                    mapBodyToInput(parsed.data, createdBy)
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof RoutingGraphBuildDisabledError) {
                    return reply.code(409).send({ message: error.message });
                }
                if (error instanceof RoutingGraphBuildInputError) {
                    return reply.code(400).send({ message: error.message, details: error.details });
                }
                if (error instanceof RoutingGraphBuildMaxRoadsError) {
                    return reply.code(400).send({
                        message: error.message,
                        max_roads: error.maxRoads,
                        requested_max_roads: error.requestedMaxRoads,
                    });
                }
                throw error;
            }
        }
    );
};

export default routingRoutes;
