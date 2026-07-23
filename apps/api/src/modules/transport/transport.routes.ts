import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
    TransportFeatureNotImplementedError,
    TransportGeneratePathFromStopsError,
    TransportInvalidReferenceError,
    TransportMergeExecutionFailedError,
    TransportMergeParentConflictError,
    TransportMergePreviewFailedError,
    TransportMergeTerminalConflictError,
    TransportNameRequiredError,
    TransportNotFoundError,
    TransportRouteMetadataError,
    TransportRouteConflictError,
    TransportRouteStopTransactionTimeoutError,
    TransportReviewGuardError,
    TransportSchemaUnavailableError,
    TransportStopInUseError,
    TransportStopDeleteBlockedError,
} from "./transport.errors.js";
import { isHttpAuthError } from "./stopMergePreview.js";
import { RoutingServiceDisabledError } from "../../config/env.js";
import {
    RoutingEngineTimeoutError,
    RoutingEngineUnavailableError,
} from "../routing/routing.errors.js";
import {
    deleteRouteStopSchema,
    deleteTransportStopSchema,
    getTransportStopDeleteEligibilitySchema,
    permanentDeleteTransportStopSchema,
    getTransportDataQualityQueuesSchema,
    getTransportImportBatchesSchema,
    getTransportImportErrorsSchema,
    getTransportOverviewSchema,
    getTransportQualitySummarySchema,
    getTransportSourceLinksSchema,
    getTransportRouteDetailSchema,
    getTransportRouteDiagnosticsSchema,
    getTransportRouteVariantsSchema,
    getTransportRoutesSchema,
    getTransportStopDetailSchema,
    getTransportStopRoutesSchema,
    getTransportStopRouteUsageDetailSchema,
    postTransportStopMergePreviewSchema,
    postTransportStopMergeGlobalSchema,
    getTransportStopsSchema,
    getTransportTerminalDetailSchema,
    getTransportInfrastructureLineDetailSchema,
    getTransportInfrastructureLinesSchema,
    getTransportTerminalsSchema,
    getTransportVariantStopsSchema,
    getTransportVariantStopQualitySchema,
    getTransportVariantOrderedStopsSchema,
    searchTransportStopsSchema,
    searchRoutesBetweenStopsSchema,
    getTransportNearbyStopCandidatesSchema,
    insertExistingRouteStopSchema,
    createAndInsertRouteStopSchema,
    moveRouteStopSchema,
    patchRouteStopSchema,
    patchRouteStopTimingSchema,
    patchVariantDepartureTimeSchema,
    patchTransportInfrastructureLineSchema,
    postTransportRouteSchema,
    patchTransportRouteSchema,
    patchRouteMetadataSchema,
    patchTransportStopSchema,
    patchTransportStopLocationSchema,
    getTransportStopNearbySchema,
    patchTransportTerminalSchema,
    patchTransportVariantSchema,
    postRouteVariantSchema,
    patchVariantSchema,
    deleteVariantSchema,
    putTransportVariantPathSchema,
    deleteTransportVariantPathSchema,
    postGeneratePathFromStopsSchema,
    postSwapRouteDirectionSchema,
} from "./transport.openapi.js";
import {
    listTransportRoutesQuerySchema,
    listPublicTransportRoutesQuerySchema,
    listTransportStopsQuerySchema,
    listImportBatchesQuerySchema,
    listImportErrorsQuerySchema,
    listSourceLinksQuerySchema,
    listTransportInfrastructureLinesQuerySchema,
    listTransportTerminalsQuerySchema,
    updateInfrastructureLineBodySchema,
    archiveStopBodySchema,
    listVariantStopsQuerySchema,
    nearbyTransportStopCandidatesQuerySchema,
    searchTransportStopsQuerySchema,
    searchRoutesBetweenStopsQuerySchema,
    createRouteBodySchema,
    createVariantBodySchema,
    patchVariantBodySchema,
    putVariantPathBodySchema,
    routeVariantsParamSchema,
    variantPublicIdParamSchema,
    insertExistingRouteStopBodySchema,
    createAndInsertRouteStopBodySchema,
    moveRouteStopBodySchema,
    nearbyStopsQuerySchema,
    removeRouteStopBodySchema,
    routeStopIdParamSchema,
    stopPublicIdParamSchema,
    stopRoutesQuerySchema,
    transportRouteCodeParamSchema,
    transportPublicIdParamSchema,
    updateRouteBodySchema,
    patchRouteMetadataBodySchema,
    patchRouteStopTimingBodySchema,
    patchVariantDepartureTimeBodySchema,
    mapPatchRouteStopTimingToInput,
    updateRouteStopBodySchema,
    updateStopBodySchema,
    updateStopLocationBodySchema,
    updateTerminalBodySchema,
    updateVariantBodySchema,
    transportReviewActionBodySchema,
    replaceRouteStopBodySchema,
    mergeStopBodySchema,
    stopMergePreviewBodySchema,
    stopMergeGlobalBodySchema,
} from "./transport.schema.js";
import { sendTransportListReply } from "./transport-pagination.js";
import { TransportService } from "./transport.service.js";
import { TransportPublicService } from "./transport-public.service.js";
import {
    isTransportPublicIdParam,
    isTransportRouteCodeParam,
} from "./transport-public-visibility.js";
import type { TransportAuditContext } from "./transport-audit.js";

const ADMIN_ROLES = new Set(["admin"]);

function requireAdminRole(roles: string[] | undefined): boolean {
    return (roles ?? []).some((role) => ADMIN_ROLES.has(role));
}

/** Transport path without query string (plugin is mounted at /transport). */
function transportPath(request: FastifyRequest): string {
    const url = request.url.split("?")[0] ?? request.url;
    return url.startsWith("/transport") ? url.slice("/transport".length) || "/" : url;
}

/**
 * Public read endpoints accept anonymous callers. Optional JWT lets the dashboard
 * reuse the same URLs with admin-only data when the caller is an admin.
 */
function isOptionalAuthTransportGet(request: FastifyRequest): boolean {
    if (request.method !== "GET") {
        return false;
    }
    const path = transportPath(request);
    if (path === "/routes") {
        return true;
    }
    if (/^\/stops\/[^/]+\/routes$/.test(path)) {
        return true;
    }
    const match = path.match(/^\/routes\/([^/]+)(?:\/(variants|stops))?$/);
    if (!match) {
        return false;
    }
    const param = decodeURIComponent(match[1]);
    const sub = match[2];
    if (isTransportPublicIdParam(param)) {
        return sub === undefined;
    }
    if (isTransportRouteCodeParam(param)) {
        return true;
    }
    return false;
}

/**
 * Resolves the audit actor + correlation context from the authenticated request.
 * actor_user_id is only set when the JWT subject/id is a numeric app user id
 * (e.g. the dev-admin bypass yields null), matching the existing review patterns.
 */
function auditContextFrom(request: FastifyRequest): TransportAuditContext {
    const raw = request.user?.id ?? request.user?.sub;
    const actorUserId = typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : null;
    return { actorUserId, requestId: request.id ?? null };
}

/** Maps known transport errors to HTTP responses; returns undefined for unknown errors (rethrow). */
function sendTransportError(reply: FastifyReply, error: unknown): FastifyReply | undefined {
    if (error instanceof ZodError) {
        return reply.code(400).send({ message: "Invalid request", issues: error.flatten() });
    }
    if (error instanceof TransportNotFoundError) {
        return reply.code(404).send({ message: error.message });
    }
    if (error instanceof TransportInvalidReferenceError) {
        return reply.code(400).send({ message: error.message });
    }
    if (error instanceof TransportRouteConflictError) {
        return reply.code(409).send({ message: error.message });
    }
    if (error instanceof TransportStopInUseError) {
        return reply.code(409).send({ message: error.message });
    }
    if (error instanceof TransportStopDeleteBlockedError) {
        return reply.code(409).send({
            message: error.message,
            has_route_usage: error.hasRouteUsage,
            route_count: error.routeCount,
            blockers: error.blockers,
        });
    }
    if (error instanceof TransportNameRequiredError) {
        return reply.code(400).send({ message: error.message });
    }
    if (error instanceof TransportRouteMetadataError) {
        return reply.code(400).send({ message: error.message });
    }
    if (error instanceof TransportSchemaUnavailableError) {
        return reply.code(503).send({ message: error.message });
    }
    if (error instanceof TransportRouteStopTransactionTimeoutError) {
        return reply.code(503).send({ message: error.message });
    }
    if (error instanceof TransportReviewGuardError) {
        return reply.code(409).send({
            message: error.message,
            code: error.code,
            blockers: error.blockers,
        });
    }
    if (error instanceof TransportFeatureNotImplementedError) {
        return reply.code(501).send({ message: error.message });
    }
    if (error instanceof TransportGeneratePathFromStopsError) {
        return reply.code(400).send({ message: error.message });
    }
    if (error instanceof TransportMergeTerminalConflictError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            code: error.code,
            canonicalStopId: error.canonicalStopId,
            duplicateStopId: error.duplicateStopId,
            canonicalTerminalId: error.canonicalTerminalId,
            duplicateTerminalId: error.duplicateTerminalId,
        });
    }
    if (error instanceof TransportMergeParentConflictError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            code: error.code,
            canonicalStopId: error.canonicalStopId,
            duplicateStopId: error.duplicateStopId,
        });
    }
    if (error instanceof TransportMergePreviewFailedError) {
        return reply.code(500).send({ message: error.message });
    }
    if (error instanceof TransportMergeExecutionFailedError) {
        return reply.code(500).send({
            message: error.message,
            code: "MERGE_EXECUTION_FAILED",
            stage: error.context.stage,
        });
    }
    if (isHttpAuthError(error)) {
        return reply.code(error.statusCode).send({
            message: error instanceof Error ? error.message : "Unauthorized",
        });
    }
    if (error instanceof RoutingServiceDisabledError) {
        return reply.code(503).send({ message: error.message });
    }
    if (
        error instanceof RoutingEngineTimeoutError ||
        error instanceof RoutingEngineUnavailableError
    ) {
        return reply.code(503).send({ message: error.message });
    }
    return undefined;
}

const transportRoutes: FastifyPluginAsync = async (app) => {
    const service = new TransportService(app.prisma);
    const publicService = new TransportPublicService(app.prisma);

    app.addHook("onRequest", async (request, reply) => {
        if (request.method === "GET" && isOptionalAuthTransportGet(request)) {
            try {
                await app.authenticate(request, reply);
            } catch {
                // A Bearer token was sent but could not be verified — return 401 so
                // dashboard clients refresh the session instead of treating the caller
                // as anonymous (public route lists exclude most admin-imported rows).
                if (request.headers.authorization) {
                    return reply.code(401).send({ message: "Invalid or expired token" });
                }
                // Public callers stay unauthenticated.
            }
            return;
        }

        await app.authenticate(request, reply);
        if (reply.sent) {
            return;
        }
        if (!requireAdminRole(request.user?.roles)) {
            return reply.code(403).send({ message: "Transport endpoints require admin role." });
        }
    });

    app.get("/overview", { schema: getTransportOverviewSchema }, async (_request, reply) => {
        const result = await service.getOverview();
        return reply.send(result);
    });

    app.get(
        "/data-quality/queues",
        { schema: getTransportDataQualityQueuesSchema },
        async (_request, reply) => {
            const result = await service.getDataQualityQueues();
            return reply.send(result);
        }
    );

    app.get(
        "/quality-summary",
        { schema: getTransportQualitySummarySchema },
        async (_request, reply) => {
            const result = await service.getQualitySummary();
            return reply.send(result);
        }
    );

    app.get(
        "/import-batches",
        { schema: getTransportImportBatchesSchema },
        async (request, reply) => {
            let query;
            try {
                query = listImportBatchesQuerySchema.parse(request.query);
            } catch (error) {
                if (error instanceof ZodError) {
                    return reply
                        .code(400)
                        .send({ message: "Invalid query parameters", issues: error.flatten() });
                }
                throw error;
            }
            const result = await service.listImportBatches(query);
            return reply.send(result);
        }
    );

    app.get(
        "/import-errors",
        { schema: getTransportImportErrorsSchema },
        async (request, reply) => {
            let query;
            try {
                query = listImportErrorsQuerySchema.parse(request.query);
            } catch (error) {
                if (error instanceof ZodError) {
                    return reply
                        .code(400)
                        .send({ message: "Invalid query parameters", issues: error.flatten() });
                }
                throw error;
            }
            const result = await service.listImportErrors(query);
            return reply.send(result);
        }
    );

    app.get(
        "/source-links",
        { schema: getTransportSourceLinksSchema },
        async (request, reply) => {
            let query;
            try {
                query = listSourceLinksQuerySchema.parse(request.query);
            } catch (error) {
                if (error instanceof ZodError) {
                    return reply
                        .code(400)
                        .send({ message: "Invalid query parameters", issues: error.flatten() });
                }
                throw error;
            }
            const result = await service.listSourceLinks(query);
            return reply.send(result);
        }
    );

    app.get("/routes", { schema: getTransportRoutesSchema }, async (request, reply) => {
        if (requireAdminRole(request.user?.roles)) {
            let query;
            try {
                query = listTransportRoutesQuerySchema.parse(request.query);
            } catch (error) {
                if (error instanceof ZodError) {
                    return reply
                        .code(400)
                        .send({ message: "Invalid query parameters", issues: error.flatten() });
                }
                throw error;
            }
            const result = await service.listRoutes(query);
            return sendTransportListReply(reply, result, query);
        }

        let publicQuery;
        try {
            publicQuery = listPublicTransportRoutesQuerySchema.parse(request.query);
        } catch (error) {
            if (error instanceof ZodError) {
                return reply
                    .code(400)
                    .send({ message: "Invalid query parameters", issues: error.flatten() });
            }
            throw error;
        }
        const result = await publicService.listRoutes(publicQuery);
        return sendTransportListReply(reply, result, publicQuery);
    });

    app.get(
        "/routes/between-stops",
        { schema: searchRoutesBetweenStopsSchema },
        async (request, reply) => {
            let query;
            try {
                query = searchRoutesBetweenStopsQuerySchema.parse(request.query);
            } catch (error) {
                if (error instanceof ZodError) {
                    return reply
                        .code(400)
                        .send({ message: "Invalid query parameters", issues: error.flatten() });
                }
                throw error;
            }

            const result = await publicService.searchRoutesBetweenStops(query);
            if (!result) {
                return reply.code(404).send({ message: "One or both transport stops were not found" });
            }
            return reply.send(result);
        },
    );

    app.get("/stops", { schema: getTransportStopsSchema }, async (request, reply) => {
        let query;
        try {
            query = listTransportStopsQuerySchema.parse(request.query);
        } catch (error) {
            if (error instanceof ZodError) {
                return reply
                    .code(400)
                    .send({ message: "Invalid query parameters", issues: error.flatten() });
            }
            throw error;
        }
        const result = await service.listStops(query);
        return reply.send(result);
    });

    app.get("/terminals", { schema: getTransportTerminalsSchema }, async (request, reply) => {
        let query;
        try {
            query = listTransportTerminalsQuerySchema.parse(request.query);
        } catch (error) {
            if (error instanceof ZodError) {
                return reply
                    .code(400)
                    .send({ message: "Invalid query parameters", issues: error.flatten() });
            }
            throw error;
        }
        const result = await service.listTerminals(query);
        return reply.send(result);
    });

    app.get(
        "/infrastructure-lines",
        { schema: getTransportInfrastructureLinesSchema },
        async (request, reply) => {
            let query;
            try {
                query = listTransportInfrastructureLinesQuerySchema.parse(request.query);
            } catch (error) {
                if (error instanceof ZodError) {
                    return reply
                        .code(400)
                        .send({ message: "Invalid query parameters", issues: error.flatten() });
                }
                throw error;
            }
            const result = await service.listInfrastructureLines(query);
            return reply.send(result);
        }
    );

    app.get(
        "/infrastructure-lines/:publicId",
        { schema: getTransportInfrastructureLineDetailSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const result = await service.getInfrastructureLine(publicId);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.patch(
        "/infrastructure-lines/:publicId",
        { schema: patchTransportInfrastructureLineSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const body = updateInfrastructureLineBodySchema.parse(request.body);
                const result = await service.updateInfrastructureLine(
                    publicId,
                    body,
                    auditContextFrom(request)
                );
                request.log.info(
                    { publicId, fields: Object.keys(body) },
                    "transport infrastructure line updated"
                );
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.get(
        "/terminals/:publicId",
        { schema: getTransportTerminalDetailSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const result = await service.getTerminal(publicId);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.patch(
        "/terminals/:publicId",
        { schema: patchTransportTerminalSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const body = updateTerminalBodySchema.parse(request.body);
                const result = await service.updateTerminal(
                    publicId,
                    body,
                    auditContextFrom(request)
                );
                request.log.info(
                    { publicId, fields: Object.keys(body) },
                    "transport terminal updated"
                );
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.get("/stops/search", { schema: searchTransportStopsSchema }, async (request, reply) => {
        let query;
        try {
            query = searchTransportStopsQuerySchema.parse(request.query);
        } catch (error) {
            if (error instanceof ZodError) {
                return reply
                    .code(400)
                    .send({ message: "Invalid query parameters", issues: error.flatten() });
            }
            throw error;
        }
        const result = await service.searchStops(query);
        return reply.send(result);
    });

    app.get(
        "/stops/nearby-candidates",
        { schema: getTransportNearbyStopCandidatesSchema },
        async (request, reply) => {
            try {
                const query = nearbyTransportStopCandidatesQuerySchema.parse(request.query);
                const result = await service.listNearbyStopCandidates(query);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.post(
        "/stops/merge-preview",
        { schema: postTransportStopMergePreviewSchema },
        async (request, reply) => {
            let currentStopId: string | undefined;
            let candidateStopId: string | undefined;
            try {
                const body = stopMergePreviewBodySchema.parse(request.body);
                currentStopId = body.currentStopId;
                candidateStopId = body.candidateStopId;
                const result = await service.getStopMergePreview(
                    body.currentStopId,
                    body.candidateStopId,
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof TransportMergePreviewFailedError) {
                    request.log.error(
                        {
                            err: error.cause ?? error,
                            currentStopId: error.context.currentStopId,
                            candidateStopId: error.context.candidateStopId,
                            routeIds: error.context.routeIds,
                            variantIds: error.context.variantIds,
                            sqlErrorCode: error.context.sqlErrorCode,
                        },
                        "transport stop merge-preview failed",
                    );
                } else if (!isHttpAuthError(error)) {
                    request.log.error(
                        {
                            err: error,
                            currentStopId,
                            candidateStopId,
                            routeIds: [],
                            variantIds: [],
                            sqlErrorCode: null,
                        },
                        "transport stop merge-preview failed",
                    );
                }
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.post(
        "/stops/merge",
        { schema: postTransportStopMergeGlobalSchema },
        async (request, reply) => {
            let canonicalStopId: string | undefined;
            let duplicateStopId: string | undefined;
            let currentStopId: string | undefined;
            let candidateStopId: string | undefined;
            try {
                const body = stopMergeGlobalBodySchema.parse(request.body);
                canonicalStopId = body.canonicalStopId;
                duplicateStopId = body.duplicateStopId;
                currentStopId = body.currentStopId;
                candidateStopId = body.candidateStopId;
                const result = await service.mergeStopsGlobal(body, auditContextFrom(request));
                return reply.send(result);
            } catch (error) {
                if (error instanceof TransportMergeExecutionFailedError) {
                    request.log.error(
                        {
                            err: error.cause ?? error,
                            requestId: error.context.requestId ?? request.id,
                            currentStopId: error.context.currentStopId,
                            candidateStopId: error.context.candidateStopId,
                            canonicalStopId: error.context.canonicalStopId,
                            duplicateStopId: error.context.duplicateStopId,
                            canonicalNumericId: error.context.canonicalNumericId,
                            duplicateNumericId: error.context.duplicateNumericId,
                            stage: error.context.stage,
                            routeIds: error.context.routeIds,
                            variantIds: error.context.variantIds,
                            sameVariantConflictCount: error.context.sameVariantConflictCount,
                            prismaCode: error.context.prismaCode,
                            sqlErrorCode: error.context.sqlErrorCode,
                            constraintName: error.context.constraintName,
                            tableName: error.context.tableName,
                        },
                        "transport stop merge execution failed",
                    );
                } else if (
                    !(error instanceof TransportMergeTerminalConflictError) &&
                    !(error instanceof TransportMergeParentConflictError) &&
                    !(error instanceof TransportReviewGuardError) &&
                    !(error instanceof TransportNotFoundError) &&
                    !(error instanceof ZodError) &&
                    !isHttpAuthError(error)
                ) {
                    request.log.error(
                        {
                            err: error,
                            requestId: request.id,
                            currentStopId,
                            candidateStopId,
                            canonicalStopId,
                            duplicateStopId,
                            stage: "pre_transaction_or_unclassified",
                        },
                        "transport stop merge execution failed",
                    );
                }
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.get("/stops/:publicId", { schema: getTransportStopDetailSchema }, async (request, reply) => {
        try {
            const { publicId } = transportPublicIdParamSchema.parse(request.params);
            const result = await service.getStop(publicId);
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.get(
        "/stops/:publicId/route-usage-detail",
        { schema: getTransportStopRouteUsageDetailSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const result = await service.getStopRouteUsageDetail(publicId);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.get(
        "/stops/:publicId/routes",
        { schema: getTransportStopRoutesSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const query = stopRoutesQuerySchema.parse(request.query);
                if (requireAdminRole(request.user?.roles)) {
                    const result = await service.listRoutesForStop(publicId, query);
                    return reply.send(result);
                }
                const result = await publicService.listRoutesForStop(publicId, query);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.patch("/stops/:publicId", { schema: patchTransportStopSchema }, async (request, reply) => {
        try {
            const { publicId } = transportPublicIdParamSchema.parse(request.params);
            const body = updateStopBodySchema.parse(request.body);
            const result = await service.updateStop(publicId, body, auditContextFrom(request));
            request.log.info({ publicId, fields: Object.keys(body) }, "transport stop updated");
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.patch(
        "/stops/:stopPublicId/location",
        { schema: patchTransportStopLocationSchema },
        async (request, reply) => {
            try {
                const { stopPublicId } = stopPublicIdParamSchema.parse(request.params);
                const body = updateStopLocationBodySchema.parse(request.body);
                const result = await service.updateStopLocation(
                    stopPublicId,
                    body,
                    auditContextFrom(request),
                );
                request.log.info(
                    { stopPublicId, nearby: result.nearby_stops.length },
                    "transport stop location updated",
                );
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.get(
        "/stops/:stopPublicId/nearby",
        { schema: getTransportStopNearbySchema },
        async (request, reply) => {
            try {
                const { stopPublicId } = stopPublicIdParamSchema.parse(request.params);
                const query = nearbyStopsQuerySchema.parse(request.query);
                const result = await service.getNearbyStops(stopPublicId, query);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.delete("/stops/:publicId", { schema: deleteTransportStopSchema }, async (request, reply) => {
        try {
            const { publicId } = transportPublicIdParamSchema.parse(request.params);
            const { reason } = archiveStopBodySchema.parse(request.body ?? {});
            const result = await service.archiveStop(
                publicId,
                auditContextFrom(request),
                reason
            );
            request.log.info(
                { publicId, archivedTerminals: result.archived_terminals.length },
                "transport stop archived"
            );
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.get(
        "/stops/:publicId/delete-eligibility",
        { schema: getTransportStopDeleteEligibilitySchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const result = await service.getStopDeleteEligibility(publicId);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.delete(
        "/stops/:publicId/permanent",
        { schema: permanentDeleteTransportStopSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const { reason } = archiveStopBodySchema.parse(request.body ?? {});
                const result = await service.permanentDeleteStop(
                    publicId,
                    auditContextFrom(request),
                    reason
                );
                request.log.info({ publicId }, "transport stop permanently deleted");
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.get("/routes/:publicId", { schema: getTransportRouteDetailSchema }, async (request, reply) => {
        try {
            const raw = request.params as { publicId: string };
            const param = raw.publicId;
            if (isTransportRouteCodeParam(param)) {
                const result = await publicService.getRouteByCode(param);
                return reply.send(result);
            }
            if (!requireAdminRole(request.user?.roles)) {
                return reply.code(404).send({ message: "Route not found." });
            }
            const { publicId } = transportPublicIdParamSchema.parse(request.params);
            const result = await service.getRoute(publicId);
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.get(
        "/routes/:publicId/diagnostics",
        { schema: getTransportRouteDiagnosticsSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const result = await service.getRouteDiagnostics(publicId);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.get(
        "/routes/:publicId/variants",
        { schema: getTransportRouteVariantsSchema },
        async (request, reply) => {
            try {
                const raw = request.params as { publicId: string };
                const param = raw.publicId;
                if (isTransportRouteCodeParam(param)) {
                    const items = await publicService.listVariantsForRouteCode(param);
                    return reply.send({ items, total: items.length });
                }
                if (!requireAdminRole(request.user?.roles)) {
                    return reply.code(404).send({ message: "Route not found." });
                }
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const items = await service.listVariantsForRoute(publicId);
                return reply.send({ items, total: items.length });
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.get("/routes/:routeCode/stops", async (request, reply) => {
        try {
            const raw = request.params as { routeCode: string };
            if (!isTransportRouteCodeParam(raw.routeCode)) {
                return reply.code(404).send({ message: "Route not found." });
            }
            const { routeCode } = transportRouteCodeParamSchema.parse(request.params);
            const result = await publicService.listStopsForRouteCode(routeCode);
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.get(
        "/route-variants/:publicId/ordered-stops",
        { schema: getTransportVariantOrderedStopsSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const result = await service.getOrderedStops(publicId);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.patch(
        "/route-variants/:publicId/departure-time",
        { schema: patchVariantDepartureTimeSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const body = patchVariantDepartureTimeBodySchema.parse(request.body);
                const result = await service.updateVariantDepartureTime(
                    publicId,
                    body.departureTimeText,
                    auditContextFrom(request),
                );
                request.log.info({ publicId }, "transport variant departure time updated");
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.get(
        "/route-variants/:publicId/stops",
        { schema: getTransportVariantStopsSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const query = listVariantStopsQuerySchema.parse(request.query);
                const result = await service.listStopsForVariant(publicId, query);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.get(
        "/variants/:variantPublicId/stop-quality",
        { schema: getTransportVariantStopQualitySchema },
        async (request, reply) => {
            try {
                const { variantPublicId } = variantPublicIdParamSchema.parse(request.params);
                const result = await service.getVariantStopQuality(variantPublicId);
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.post("/routes", { schema: postTransportRouteSchema }, async (request, reply) => {
        try {
            const body = createRouteBodySchema.parse(request.body ?? {});
            const result = await service.createRoute(body, auditContextFrom(request));
            request.log.info(
                {
                    publicId: result.public_id,
                    routeCode: body.route_code,
                    mode: body.mode,
                    variants: result.variants.length,
                },
                "transport route created"
            );
            return reply.code(201).send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.patch("/routes/:publicId", { schema: patchTransportRouteSchema }, async (request, reply) => {
        try {
            const { publicId } = transportPublicIdParamSchema.parse(request.params);
            const body = updateRouteBodySchema.parse(request.body);
            const result = await service.updateRoute(publicId, body, auditContextFrom(request));
            request.log.info({ publicId, fields: Object.keys(body) }, "transport route updated");
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.patch(
        "/routes/:publicId/metadata",
        { schema: patchRouteMetadataSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const body = patchRouteMetadataBodySchema.parse(request.body);
                const result = await service.updateRouteMetadata(
                    publicId,
                    body,
                    auditContextFrom(request),
                );
                request.log.info(
                    { publicId, sections: Object.keys(body) },
                    "transport route metadata updated",
                );
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.patch(
        "/route-variants/:publicId",
        { schema: patchTransportVariantSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const body = updateVariantBodySchema.parse(request.body);
                const result = await service.updateVariant(
                    publicId,
                    body,
                    auditContextFrom(request)
                );
                request.log.info(
                    { publicId, fields: Object.keys(body) },
                    "transport route variant updated"
                );
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.post(
        "/routes/:routePublicId/variants",
        { schema: postRouteVariantSchema },
        async (request, reply) => {
            try {
                const { routePublicId } = routeVariantsParamSchema.parse(request.params);
                const body = createVariantBodySchema.parse(request.body ?? {});
                const result = await service.createVariant(
                    routePublicId,
                    body,
                    auditContextFrom(request)
                );
                request.log.info(
                    { routePublicId, variantCode: body.variant_code },
                    "transport route variant created"
                );
                return reply.code(201).send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.patch("/variants/:variantPublicId", { schema: patchVariantSchema }, async (request, reply) => {
        try {
            const { variantPublicId } = variantPublicIdParamSchema.parse(request.params);
            const body = patchVariantBodySchema.parse(request.body);
            const result = await service.updateVariant(
                variantPublicId,
                body,
                auditContextFrom(request)
            );
            request.log.info(
                { variantPublicId, fields: Object.keys(body) },
                "transport route variant updated"
            );
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.delete(
        "/variants/:variantPublicId",
        { schema: deleteVariantSchema },
        async (request, reply) => {
            try {
                const { variantPublicId } = variantPublicIdParamSchema.parse(request.params);
                const result = await service.softDeleteVariant(
                    variantPublicId,
                    auditContextFrom(request)
                );
                request.log.info({ variantPublicId }, "transport route variant soft-deleted");
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.put(
        "/variants/:variantPublicId/path",
        { schema: putTransportVariantPathSchema },
        async (request, reply) => {
            try {
                const { variantPublicId } = variantPublicIdParamSchema.parse(request.params);
                const body = putVariantPathBodySchema.parse(request.body ?? {});
                const result = await service.upsertVariantPath(
                    variantPublicId,
                    body,
                    auditContextFrom(request),
                );
                request.log.info(
                    { variantPublicId, points: body.coordinates.length },
                    "transport variant path upserted",
                );
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.delete(
        "/variants/:variantPublicId/path",
        { schema: deleteTransportVariantPathSchema },
        async (request, reply) => {
            try {
                const { variantPublicId } = variantPublicIdParamSchema.parse(request.params);
                const result = await service.deleteVariantPath(
                    variantPublicId,
                    auditContextFrom(request),
                );
                request.log.info({ variantPublicId }, "transport variant path soft-deleted");
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.post(
        "/route-variants/:publicId/generate-path-from-stops",
        { schema: postGeneratePathFromStopsSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const result = await service.generatePathFromStops(
                    publicId,
                    auditContextFrom(request),
                );
                request.log.info(
                    { variantPublicId: publicId, pathKind: result.path_kind },
                    "transport variant path generated from stops",
                );
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.post(
        "/route-variants/:publicId/stops/insert-existing",
        { schema: insertExistingRouteStopSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const body = insertExistingRouteStopBodySchema.parse(request.body ?? {});
                const result = await service.insertExistingRouteStop(
                    publicId,
                    body,
                    auditContextFrom(request)
                );
                request.log.info(
                    { publicId, position: body.position, stops: result.route_stop_count },
                    "transport route stop inserted into variant"
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof TransportRouteStopTransactionTimeoutError) {
                    request.log.error(
                        { err: error, publicId: (request.params as { publicId?: string }).publicId },
                        "Transport route stop transaction timed out"
                    );
                }
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.post(
        "/route-variants/:publicId/stops/create-and-insert",
        { schema: createAndInsertRouteStopSchema },
        async (request, reply) => {
            // TEMP perf: gated by TRANSPORT_PERF_LOG=1 (no-op otherwise).
            const perfOn = process.env.TRANSPORT_PERF_LOG === "1";
            const t0 = perfOn ? performance.now() : 0;
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const body = createAndInsertRouteStopBodySchema.parse(request.body ?? {});
                if (perfOn) {
                    request.log.info(
                        { ms: Number((performance.now() - t0).toFixed(1)) },
                        "[transport.perf] create-and-insert | validate payload done"
                    );
                }
                const result = await service.createAndInsertRouteStop(
                    publicId,
                    body,
                    auditContextFrom(request)
                );
                if (perfOn) {
                    request.log.info(
                        {
                            ms: Number((performance.now() - t0).toFixed(1)),
                            stops: result.route_stop_count,
                        },
                        "[transport.perf] create-and-insert | handler done (response ready)"
                    );
                }
                request.log.info(
                    { publicId, position: body.position, stops: result.route_stop_count },
                    "transport route stop created and inserted into variant"
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof TransportRouteStopTransactionTimeoutError) {
                    request.log.error(
                        { err: error, publicId: (request.params as { publicId?: string }).publicId },
                        "Transport route stop transaction timed out"
                    );
                }
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.patch("/route-stops/:id", { schema: patchRouteStopSchema }, async (request, reply) => {
        try {
            const { id } = routeStopIdParamSchema.parse(request.params);
            const body = updateRouteStopBodySchema.parse(request.body);
            const result = await service.updateRouteStopFlags(
                BigInt(id),
                body,
                auditContextFrom(request)
            );
            request.log.info({ id, fields: Object.keys(body) }, "transport route stop flags updated");
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.patch(
        "/route-stops/:id/timing",
        { schema: patchRouteStopTimingSchema },
        async (request, reply) => {
            try {
                const { id } = routeStopIdParamSchema.parse(request.params);
                const body = patchRouteStopTimingBodySchema.parse(request.body);
                const result = await service.updateRouteStopTiming(
                    BigInt(id),
                    mapPatchRouteStopTimingToInput(body),
                    auditContextFrom(request),
                );
                request.log.info(
                    { id, fields: Object.keys(body) },
                    "transport route stop timing updated",
                );
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.post("/route-stops/:id/move", { schema: moveRouteStopSchema }, async (request, reply) => {
        try {
            const { id } = routeStopIdParamSchema.parse(request.params);
            const { direction } = moveRouteStopBodySchema.parse(request.body);
            const result = await service.moveRouteStop(
                BigInt(id),
                direction,
                auditContextFrom(request)
            );
            request.log.info({ id, direction, moved: result.moved }, "transport route stop moved");
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.delete("/route-stops/:id", { schema: deleteRouteStopSchema }, async (request, reply) => {
        // TEMP perf: gated by TRANSPORT_PERF_LOG=1 (no-op otherwise).
        const perfOn = process.env.TRANSPORT_PERF_LOG === "1";
        const t0 = perfOn ? performance.now() : 0;
        try {
            const { id } = routeStopIdParamSchema.parse(request.params);
            const { reason } = removeRouteStopBodySchema.parse(request.body ?? {});
            const result = await service.removeRouteStop(
                BigInt(id),
                auditContextFrom(request),
                reason
            );
            if (perfOn) {
                request.log.info(
                    {
                        ms: Number((performance.now() - t0).toFixed(1)),
                        stops: result.route_stop_count,
                    },
                    "[transport.perf] remove-route-stop | handler done (response ready)"
                );
            }
            request.log.info({ id }, "transport route stop removed from variant");
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.get("/routes/:publicId/review-readiness", async (request, reply) => {
        try {
            const { publicId } = transportPublicIdParamSchema.parse(request.params);
            const result = await service.getRouteReviewReadiness(publicId);
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.post("/routes/:publicId/review-action", async (request, reply) => {
        try {
            const { publicId } = transportPublicIdParamSchema.parse(request.params);
            const body = transportReviewActionBodySchema.parse(request.body);
            const result = await service.applyRouteReviewAction(
                publicId,
                body.action,
                auditContextFrom(request),
                body.reason,
            );
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.post(
        "/routes/:publicId/swap-direction",
        { schema: postSwapRouteDirectionSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const result = await service.swapRouteDirection(
                    publicId,
                    auditContextFrom(request),
                );
                request.log.info({ publicId }, "transport route direction swapped");
                return reply.send(result);
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        },
    );

    app.post("/stops/:publicId/review-action", async (request, reply) => {
        try {
            const { stopPublicId } = stopPublicIdParamSchema.parse(request.params);
            const body = transportReviewActionBodySchema.parse(request.body);
            const result = await service.applyStopReviewAction(
                stopPublicId,
                body.action,
                auditContextFrom(request),
                body.reason,
            );
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.post("/route-paths/:id/review-action", async (request, reply) => {
        try {
            const { id } = routeStopIdParamSchema.parse(request.params);
            const body = transportReviewActionBodySchema.parse(request.body);
            const result = await service.applyRoutePathReviewAction(
                BigInt(id),
                body.action,
                auditContextFrom(request),
                body.reason,
            );
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.patch("/route-stops/:id/replace-stop", async (request, reply) => {
        try {
            const { id } = routeStopIdParamSchema.parse(request.params);
            const body = replaceRouteStopBodySchema.parse(request.body);
            const result = await service.replaceRouteStop(
                BigInt(id),
                body.stop_public_id,
                auditContextFrom(request),
                body.reason,
            );
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.post("/stops/:publicId/merge", async (request, reply) => {
        try {
            const { stopPublicId } = stopPublicIdParamSchema.parse(request.params);
            const body = mergeStopBodySchema.parse(request.body);
            const result = await service.mergeStop(
                stopPublicId,
                body.target_stop_public_id,
                auditContextFrom(request),
                body.reason,
            );
            return reply.send(result);
        } catch (error) {
            const handled = sendTransportError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });
};

export default transportRoutes;
