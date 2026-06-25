import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
    TransportInvalidReferenceError,
    TransportNameRequiredError,
    TransportNotFoundError,
    TransportRouteStopDuplicateError,
    TransportRouteStopTransactionTimeoutError,
    TransportSchemaUnavailableError,
    TransportStopInUseError,
} from "./transport.errors.js";
import {
    deleteRouteStopSchema,
    deleteTransportStopSchema,
    getTransportDataQualityQueuesSchema,
    getTransportImportBatchesSchema,
    getTransportImportErrorsSchema,
    getTransportOverviewSchema,
    getTransportSourceLinksSchema,
    getTransportRouteDetailSchema,
    getTransportRouteVariantsSchema,
    getTransportRoutesSchema,
    getTransportStopDetailSchema,
    getTransportStopRoutesSchema,
    getTransportStopsSchema,
    getTransportTerminalDetailSchema,
    getTransportInfrastructureLineDetailSchema,
    getTransportInfrastructureLinesSchema,
    getTransportTerminalsSchema,
    getTransportVariantStopsSchema,
    getTransportVariantOrderedStopsSchema,
    searchTransportStopsSchema,
    insertExistingRouteStopSchema,
    createAndInsertRouteStopSchema,
    moveRouteStopSchema,
    patchRouteStopSchema,
    patchTransportInfrastructureLineSchema,
    patchTransportRouteSchema,
    patchTransportStopSchema,
    patchTransportTerminalSchema,
    patchTransportVariantSchema,
} from "./transport.openapi.js";
import {
    listTransportRoutesQuerySchema,
    listTransportStopsQuerySchema,
    listImportBatchesQuerySchema,
    listImportErrorsQuerySchema,
    listSourceLinksQuerySchema,
    listTransportInfrastructureLinesQuerySchema,
    listTransportTerminalsQuerySchema,
    updateInfrastructureLineBodySchema,
    archiveStopBodySchema,
    listVariantStopsQuerySchema,
    searchTransportStopsQuerySchema,
    insertExistingRouteStopBodySchema,
    createAndInsertRouteStopBodySchema,
    moveRouteStopBodySchema,
    removeRouteStopBodySchema,
    routeStopIdParamSchema,
    stopRoutesQuerySchema,
    transportPublicIdParamSchema,
    updateRouteBodySchema,
    updateRouteStopBodySchema,
    updateStopBodySchema,
    updateTerminalBodySchema,
    updateVariantBodySchema,
} from "./transport.schema.js";
import { TransportService } from "./transport.service.js";
import type { TransportAuditContext } from "./transport-audit.js";

const ADMIN_ROLES = new Set(["admin"]);

function requireAdminRole(roles: string[] | undefined): boolean {
    return (roles ?? []).some((role) => ADMIN_ROLES.has(role));
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
    if (error instanceof TransportRouteStopDuplicateError) {
        return reply.code(409).send({ message: error.message });
    }
    if (error instanceof TransportStopInUseError) {
        return reply.code(409).send({ message: error.message });
    }
    if (error instanceof TransportNameRequiredError) {
        return reply.code(400).send({ message: error.message });
    }
    if (error instanceof TransportSchemaUnavailableError) {
        return reply.code(503).send({ message: error.message });
    }
    if (error instanceof TransportRouteStopTransactionTimeoutError) {
        return reply.code(503).send({ message: error.message });
    }
    return undefined;
}

const transportRoutes: FastifyPluginAsync = async (app) => {
    const service = new TransportService(app.prisma);

    app.addHook("onRequest", async (request, reply) => {
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
        return reply.send(result);
    });

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
        "/stops/:publicId/routes",
        { schema: getTransportStopRoutesSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const query = stopRoutesQuerySchema.parse(request.query);
                const result = await service.listRoutesForStop(publicId, query);
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

    app.get("/routes/:publicId", { schema: getTransportRouteDetailSchema }, async (request, reply) => {
        try {
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
        "/routes/:publicId/variants",
        { schema: getTransportRouteVariantsSchema },
        async (request, reply) => {
            try {
                const { publicId } = transportPublicIdParamSchema.parse(request.params);
                const items = await service.listVariantsForRoute(publicId);
                return reply.send({ items, total: items.length });
            } catch (error) {
                const handled = sendTransportError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

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
};

export default transportRoutes;
