import type { FastifyPluginAsync } from "fastify";

import { isRoadEntityAdminAreaKind } from "./entity-admin-area-kind.js";
import {
    entityAdminAreaInferBodySchema,
    entityAdminAreaValidateManualBodySchema,
} from "./entity-admin-area.schema.js";
import { EntityAdminAreaRepository } from "./entity-admin-area.repo.js";
import type { EntityAdminAreaInferResult } from "./entity-admin-area.service.js";
import { EntityAdminAreaService } from "./entity-admin-area.service.js";
import {
    postEntityAdminAreaInferSchema,
    postEntityAdminAreaValidateManualSchema,
} from "./entity-admin-area.openapi.js";

const ROAD_INFER_QUERY_ERROR_MESSAGE = "Township inference failed. Check API logs.";

function roadInferQueryErrorResult(): EntityAdminAreaInferResult {
    return {
        admin_area_id: null,
        canonical_name: null,
        admin_level_code: null,
        name_mm: null,
        name_en: null,
        geometry_contains: false,
        status: "no_match",
        message: ROAD_INFER_QUERY_ERROR_MESSAGE,
        currentAdminArea: null,
        recommendedTownship: null,
        intersectingTownships: [],
        debugReason: "query_error",
    };
}

function legacyInferErrorResult(): EntityAdminAreaInferResult {
    return {
        admin_area_id: null,
        canonical_name: null,
        admin_level_code: null,
        name_mm: null,
        name_en: null,
        geometry_contains: false,
    };
}

const entityAdminAreaRoutes: FastifyPluginAsync = async (app) => {
    const repo = new EntityAdminAreaRepository(app.prisma);
    const service = new EntityAdminAreaService(repo);

        app.post(
        "/entity-admin-area/infer",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
            schema: postEntityAdminAreaInferSchema,
        },
        async (request, reply) => {
            const parsed = entityAdminAreaInferBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid infer payload",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const started = performance.now();
                const result = await service.infer(parsed.data);
                const durationMs = Math.round(performance.now() - started);
                const body = parsed.data;
                if (body.kind === "street") {
                    request.log.info(
                        {
                            streetId: body.entity_public_id ?? null,
                            geometryType: body.geometry?.type ?? null,
                            currentAdminAreaId: body.current_admin_area_id ?? null,
                            currentAdminLevelCode: result.currentAdminArea?.level_code ?? null,
                            intersectingTownshipCount: result.intersectingTownships?.length ?? 0,
                            nearestTownshipDistanceM: result.nearestTownshipDistanceM ?? null,
                            recommendationStatus: result.status ?? null,
                            recommendationMode: result.recommendationMode ?? null,
                            debugReason: result.debugReason ?? null,
                            durationMs,
                        },
                        "road township infer completed",
                    );
                }
                return reply.send(result);
            } catch (error) {
                const body = parsed.data;
                const logContext = {
                    err: error,
                    stack: error instanceof Error ? error.stack : undefined,
                    kind: body.kind,
                    entityPublicId: body.entity_public_id ?? null,
                    currentAdminAreaId: body.current_admin_area_id ?? null,
                    geometryType: body.geometry?.type ?? null,
                };

                if (isRoadEntityAdminAreaKind(body.kind)) {
                    request.log.error(logContext, "road township infer failed");
                    return reply.send(roadInferQueryErrorResult());
                }

                request.log.error(logContext, "entity-admin-area infer failed");
                return reply.send(legacyInferErrorResult());
            }
        }
    );

    app.post(
        "/entity-admin-area/validate-manual",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
            schema: postEntityAdminAreaValidateManualSchema,
        },
        async (request, reply) => {
            const parsed = entityAdminAreaValidateManualBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid validate payload",
                    issues: parsed.error.flatten(),
                });
            }

            const result = await service.validateManual(parsed.data, request.user);
            return reply.send(result);
        }
    );
};

export default entityAdminAreaRoutes;
