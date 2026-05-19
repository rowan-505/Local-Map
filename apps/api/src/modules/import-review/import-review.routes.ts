import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { getImportReviewPrisma } from "../../lib/import-review-prisma.js";
import {
    getImportReviewBuildingByIdSchema,
    getImportReviewBuildingsFilterOptionsSchema,
    getImportReviewBuildingsSchema,
    getImportReviewPlacesSchema,
    getImportReviewRoadsSchema,
    getImportReviewSummarySchema,
    patchImportReviewBuildingDecisionSchema,
    patchImportReviewBuildingOverridesSchema,
    patchImportReviewPlaceDecisionSchema,
    patchImportReviewRoadOverridesSchema,
    postImportReviewRoadValidateRoutingSchema,
    patchImportReviewRoadDecisionSchema,
    postBulkImportReviewBuildingDecisionSchema,
    postBulkImportReviewPlacesDecisionSchema,
    postBulkImportReviewRoadsDecisionSchema,
    getImportReviewPromotionReadySchema,
    getImportReviewPromotionReadyCandidatesSchema,
    getImportReviewPromotionBatchesSchema,
    getImportReviewPromotionBatchByIdSchema,
    postImportReviewPromotionBatchSchema,
    postImportReviewPromotionBatchValidateSchema,
    getImportReviewPromotionBatchProgressSchema,
    getImportReviewPromotionBatchLogsSchema,
    postImportReviewPromotionBatchPromoteSchema,
    getImportReviewPromotionBatchVerifySchema,
} from "./import-review.openapi.js";
import {
    authenticateImportReview,
    isImportReviewHeaderTokenGuardEnabled,
    requireImportReviewAdmin,
} from "./import-review-admin.guard.js";
import { createImportReviewDataRepository } from "./import-review-repository.factory.js";
import {
    ImportReviewBatchAmbiguousError,
    ImportReviewBatchNotFoundError,
    ImportReviewBuildingNotFoundError,
    ImportReviewDecisionRuleError,
    ImportReviewInvalidScopeError,
    ImportReviewPlaceNotFoundError,
    ImportReviewRoadNotFoundError,
    ImportReviewRoadOverridesValidationFailedError,
    ImportReviewRoadOverridesWarningsPendingError,
} from "./import-review-errors.js";
import {
    bulkImportReviewBuildingDecisionBodySchema,
    importReviewBuildingIdParamsSchema,
    importReviewBuildingsQuerySchema,
    importReviewPlacesQuerySchema,
    importReviewRoadsQuerySchema,
    importReviewScopedIncludeGeometryQuerySchema,
    importReviewSummaryQuerySchema,
    patchImportReviewBuildingDecisionBodySchema,
    patchImportReviewBuildingOverridesBodySchema,
    patchImportReviewRoadOverridesBodySchema,
    postImportReviewRoadValidateRoutingBodySchema,
} from "./import-review.schema.js";
import { ImportReviewService } from "./import-review.service.js";
import { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import { ImportReviewPromotionService } from "./import-review-promotion.service.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import {
    ImportReviewPublishBatchNameConflictError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchInvalidStatusError,
    ImportReviewPublishBatchPromotionConfirmationError,
    ImportReviewPublishBatchPromotionConflictError,
    ImportReviewPublishBatchValidationConflictError,
    ImportReviewPromotionNoEligibleCandidatesError,
} from "./import-review-promotion.errors.js";
import {
    importReviewPromotionBatchIdParamsSchema,
    importReviewPromotionBatchesListQuerySchema,
    importReviewPromotionReadyCandidatesQuerySchema,
    importReviewPromotionReadyQuerySchema,
    postImportReviewPromotionBatchBodySchema,
    postImportReviewPromotionBatchPromoteBodySchema,
} from "./import-review-promotion.schema.js";

/** @returns true if `reply` was sent. */
function sendImportReviewError(reply: FastifyReply, error: unknown): boolean {
    if (error instanceof ImportReviewInvalidScopeError) {
        void reply.code(400).send({ message: error.message });
        return true;
    }

    if (error instanceof ImportReviewDecisionRuleError) {
        void reply.code(400).send({ message: error.message });
        return true;
    }

    if (
        error instanceof ImportReviewBatchNotFoundError ||
        error instanceof ImportReviewBuildingNotFoundError ||
        error instanceof ImportReviewPlaceNotFoundError ||
        error instanceof ImportReviewRoadNotFoundError
    ) {
        void reply.code(404).send({ message: error.message });
        return true;
    }

    if (error instanceof ImportReviewBatchAmbiguousError) {
        void reply.code(409).send({ message: error.message });
        return true;
    }

    if (error instanceof ImportReviewRoadOverridesValidationFailedError) {
        void reply.code(400).send({
            message: "Road overrides validation failed",
            errors: error.errors,
            warnings: error.warnings,
        });
        return true;
    }

    if (error instanceof ImportReviewRoadOverridesWarningsPendingError) {
        void reply.code(409).send({
            message:
                "Routing continuity warnings detected — retry with confirm_acknowledge_routing_warnings=true after acknowledging.",
            warnings: error.warnings,
            errors: [] as string[],
        });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchNotFoundError) {
        void reply.code(404).send({ message: error.message });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchNameConflictError) {
        void reply.code(409).send({ message: error.message });
        return true;
    }

    if (error instanceof ImportReviewPromotionNoEligibleCandidatesError) {
        void reply.code(400).send({
            message: error.message,
            ready_count: error.readyCount,
        });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchValidationConflictError) {
        void reply.code(409).send({ message: error.message, batch_id: error.batchId });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchPromotionConflictError) {
        void reply.code(409).send({ message: error.message, batch_id: error.batchId });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchPromotionConfirmationError) {
        void reply.code(400).send({ message: error.message, batch_id: error.batchId });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchInvalidStatusError) {
        void reply.code(400).send({
            message: error.message,
            batch_id: error.batchId,
            status: error.status,
        });
        return true;
    }

    return false;
}

function importReviewAuthorizedPreHandlers(): [typeof requireImportReviewAdmin] {
    return [requireImportReviewAdmin];
}

const importReviewRoutes: FastifyPluginAsync = async (app) => {
    app.log.info(`import-review admin guard enabled: ${isImportReviewHeaderTokenGuardEnabled()}`);

    app.addHook("onRequest", async (request, reply) => {
        await authenticateImportReview(request, reply);
    });

    const prisma = getImportReviewPrisma();
    const repo = createImportReviewDataRepository(prisma);
    const importReviewService = new ImportReviewService(repo);
    const promotionRepo = new ImportReviewPromotionRepository(prisma);
    const promotionValidationRepo = new ImportReviewPromotionValidationRepository(prisma);
    const promotionPromoteRepo = new ImportReviewPromotionPromoteRepository(prisma, promotionValidationRepo);
    const promotionService = new ImportReviewPromotionService(
        promotionRepo,
        promotionValidationRepo,
        promotionPromoteRepo
    );

    app.get(
        "/summary",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewSummarySchema,
        },
        async (request, reply) => {
            const parsed = importReviewSummaryQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const summary = await importReviewService.getSummary(parsed.data);
                return reply.send(summary);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/buildings/filter-options",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewBuildingsFilterOptionsSchema,
        },
        async (request, reply) => {
            const parsed = importReviewSummaryQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const options = await importReviewService.getBuildingFilterOptions(parsed.data);
                return reply.send(options);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/buildings/:id",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewBuildingByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewBuildingIdParamsSchema.safeParse(request.params);
            const queryParsed = importReviewScopedIncludeGeometryQuerySchema.safeParse(request.query);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!queryParsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: queryParsed.error.flatten(),
                });
            }

            try {
                const item = await importReviewService.getBuildingById({
                    id: paramsParsed.data.id,
                    source_snapshot_version: queryParsed.data.source_snapshot_version,
                    review_batch_id: queryParsed.data.review_batch_id,
                    include_geometry: queryParsed.data.include_geometry,
                });
                return reply.send(item);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/buildings",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewBuildingsSchema,
        },
        async (request, reply) => {
            const parsed = importReviewBuildingsQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const list = await importReviewService.listBuildings(parsed.data);
                return reply.send(list);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/places",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPlacesSchema,
        },
        async (request, reply) => {
            const parsed = importReviewPlacesQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const list = await importReviewService.listPlaces(parsed.data);
                return reply.send(list);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/roads",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewRoadsSchema,
        },
        async (request, reply) => {
            const parsed = importReviewRoadsQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const list = await importReviewService.listRoads(parsed.data);
                return reply.send(list);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/buildings/bulk-decision",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postBulkImportReviewBuildingDecisionSchema,
        },
        async (request, reply) => {
            const parsed = bulkImportReviewBuildingDecisionBodySchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const result = await importReviewService.bulkBuildingsDecision(parsed.data, request.user);
                return reply.send(result);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/places/bulk-decision",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postBulkImportReviewPlacesDecisionSchema,
        },
        async (request, reply) => {
            const parsed = bulkImportReviewBuildingDecisionBodySchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const result = await importReviewService.bulkPlacesDecision(parsed.data, request.user);
                return reply.send(result);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/roads/bulk-decision",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postBulkImportReviewRoadsDecisionSchema,
        },
        async (request, reply) => {
            const parsed = bulkImportReviewBuildingDecisionBodySchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const result = await importReviewService.bulkRoadsDecision(parsed.data, request.user);
                return reply.send(result);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/buildings/:id/overrides",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewBuildingOverridesSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewBuildingIdParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewBuildingOverridesBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: bodyParsed.error.flatten(),
                });
            }

            try {
                const item = await importReviewService.patchBuildingReviewOverrides(
                    paramsParsed.data.id,
                    bodyParsed.data,
                    request.user
                );
                return reply.send(item);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/buildings/:id/decision",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewBuildingDecisionSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewBuildingIdParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewBuildingDecisionBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: bodyParsed.error.flatten(),
                });
            }

            try {
                const item = await importReviewService.patchBuildingDecision(
                    paramsParsed.data.id,
                    bodyParsed.data,
                    request.user
                );
                return reply.send(item);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/places/:id/decision",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewPlaceDecisionSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewBuildingIdParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewBuildingDecisionBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: bodyParsed.error.flatten(),
                });
            }

            try {
                const item = await importReviewService.patchPlaceDecision(
                    paramsParsed.data.id,
                    bodyParsed.data,
                    request.user
                );
                return reply.send(item);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/roads/:id/overrides",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewRoadOverridesSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewBuildingIdParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewRoadOverridesBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: bodyParsed.error.flatten(),
                });
            }

            try {
                const item = await importReviewService.patchRoadReviewOverrides(
                    paramsParsed.data.id,
                    bodyParsed.data,
                    request.user
                );
                return reply.send(item);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/roads/:id/validate-routing",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewRoadValidateRoutingSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewBuildingIdParamsSchema.safeParse(request.params);
            const bodyParsed = postImportReviewRoadValidateRoutingBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: bodyParsed.error.flatten(),
                });
            }

            try {
                const result = await importReviewService.validateRoadRouting(
                    paramsParsed.data.id,
                    bodyParsed.data,
                    request.user
                );
                return reply.send(result);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/roads/:id/decision",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewRoadDecisionSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewBuildingIdParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewBuildingDecisionBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: bodyParsed.error.flatten(),
                });
            }

            try {
                const item = await importReviewService.patchRoadDecision(
                    paramsParsed.data.id,
                    bodyParsed.data,
                    request.user
                );
                return reply.send(item);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/ready",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionReadySchema,
        },
        async (request, reply) => {
            const parsed = importReviewPromotionReadyQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                return reply.send(await promotionService.getReady(parsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/ready-candidates",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionReadyCandidatesSchema,
        },
        async (request, reply) => {
            const parsed = importReviewPromotionReadyCandidatesQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                return reply.send(await promotionService.listReadyCandidates(parsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionBatchesSchema,
        },
        async (request, reply) => {
            const parsed = importReviewPromotionBatchesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid query",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                return reply.send(await promotionService.listBatches(parsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches/:id",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionBatchByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await promotionService.getBatchById(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/promotion/batches",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPromotionBatchSchema,
        },
        async (request, reply) => {
            const parsed = postImportReviewPromotionBatchBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const result = await promotionService.createBatch(parsed.data, request.user);
                return reply.code(201).send(result);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/promotion/batches/:id/validate",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPromotionBatchValidateSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }
            try {
                const result = await promotionService.startValidateBatch(
                    BigInt(paramsParsed.data.id),
                    request.log
                );
                return reply.code(202).send(result);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches/:id/progress",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionBatchProgressSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await promotionService.getBatchProgress(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches/:id/logs",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionBatchLogsSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await promotionService.getBatchLogs(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/promotion/batches/:id/promote",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPromotionBatchPromoteSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }
            const bodyParsed = postImportReviewPromotionBatchPromoteBodySchema.safeParse(request.body);
            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid body",
                    issues: bodyParsed.error.flatten(),
                });
            }
            try {
                const result = await promotionService.startPromoteBatch(
                    BigInt(paramsParsed.data.id),
                    bodyParsed.data,
                    request.user,
                    request.log
                );
                return reply.code(202).send(result);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches/:id/verify",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionBatchVerifySchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await promotionService.getBatchVerify(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );
};

export default importReviewRoutes;
