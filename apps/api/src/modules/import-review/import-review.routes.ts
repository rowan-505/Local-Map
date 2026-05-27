import type { FastifyPluginAsync } from "fastify";

import { getImportReviewPrisma } from "../../lib/import-review-prisma.js";
import {
    getImportReviewBuildingByIdSchema,
    getImportReviewBuildingsFilterOptionsSchema,
    getImportReviewBuildingsSchema,
    getImportReviewPlacesSchema,
    getImportReviewRoadsSchema,
    getImportReviewRoadDryRunSummarySchema,
    getImportReviewSummarySchema,
    getImportReviewBatchesSchema,
    getImportReviewReferenceOptionsSchema,
    getImportReviewFormOptionsSchema,
    patchImportReviewBuildingDecisionSchema,
    patchImportReviewBuildingOverridesSchema,
    patchImportReviewPlaceDecisionSchema,
    patchImportReviewRoadOverridesSchema,
    postImportReviewRoadValidateRoutingSchema,
    patchImportReviewRoadDecisionSchema,
    postBulkImportReviewBuildingDecisionSchema,
    postBulkImportReviewPlacesDecisionSchema,
    postBulkImportReviewRoadsDecisionSchema,
    getImportReviewPromotionBatchEligibilitySchema,
    getImportReviewPromotionReadySchema,
    getImportReviewPromotionReadyCandidatesSchema,
    getImportReviewPromotionBatchesSchema,
    getImportReviewPromotionBatchByIdSchema,
    postImportReviewPromotionBatchSchema,
    postImportReviewPromotionBatchValidateSchema,
    getImportReviewPromotionBatchProgressSchema,
    getImportReviewPromotionBatchLogsSchema,
    postImportReviewPromotionBatchPromoteSchema,
    postImportReviewRepairInvalidPromotedBatchesSchema,
    getImportReviewPromotionBatchVerifySchema,
    postImportReviewPromotionRoadDryRunSchema,
    getImportReviewPromotionRoadDryRunSchema,
    postImportReviewPromotionRoutingBarrierDryRunSchema,
    getImportReviewPromotionRoutingBarrierDryRunSchema,
    postImportReviewCleanupPromotedDryRunSchema,
    postImportReviewCleanupPromotedExecuteSchema,
    postImportReviewAddressAdminInferenceSchema,
    postImportReviewAddressValidateSchema,
    postImportReviewAddressPromotionDryRunSchema,
    postImportReviewAddressPromotionSchema,
    postImportReviewPlaceAddressLinkPromotionSchema,
    postImportReviewPlacePromotionSchema,
    getImportReviewAddressOptionsSchema,
    patchImportReviewAddressMatchesSchema,
    patchImportReviewAddressPlaceStatusSchema,
    postImportReviewPlaceAddressLinkValidateSchema,
    postImportReviewPlaceValidateSchema,
    postImportReviewAddressCreatePlaceCandidateSchema,
    patchImportReviewAddressComponentsSchema,
    getImportReviewHistoryReviewBatchesSchema,
    getImportReviewHistoryReviewBatchByIdSchema,
    getImportReviewHistoryPublishBatchesSchema,
    getImportReviewHistoryPublishBatchByIdSchema,
    getImportReviewHistoryPublishBatchItemsSchema,
    getImportReviewHistoryPublishBatchLogsSchema,
    getImportReviewFamilyCandidatesSchema,
    getImportReviewFamilyCandidateByIdSchema,
    getImportReviewFamilyFilterOptionsSchema,
    patchImportReviewFamilyCandidateDecisionSchema,
    patchImportReviewFamilyCandidateOverridesSchema,
    postImportReviewFamilyBulkDecisionSchema,
} from "./import-review.openapi.js";
import {
    authenticateImportReview,
    isImportReviewHeaderTokenGuardEnabled,
    requireImportReviewAdmin,
} from "./import-review-admin.guard.js";
import { createImportReviewDataRepository } from "./import-review-repository.factory.js";
import { sendImportReviewError } from "./import-review-error-handler.js";
import {
    sendImportReviewNotFoundError,
    sendImportReviewValidationError,
} from "./import-review-error-response.js";
import {
    bulkImportReviewBuildingDecisionBodySchema,
    importReviewBuildingIdParamsSchema,
    importReviewBuildingsQuerySchema,
    importReviewCandidatesListQuerySchema,
    importReviewEntityFamilyParamSchema,
    importReviewFamilyCandidateParamsSchema,
    importReviewPlacesQuerySchema,
    importReviewRoadsQuerySchema,
    importReviewRoadDryRunSummaryQuerySchema,
    importReviewScopedIncludeGeometryQuerySchema,
    importReviewSummaryQuerySchema,
    importReviewBatchesListQuerySchema,
    patchImportReviewBuildingDecisionBodySchema,
    patchImportReviewBuildingOverridesBodySchema,
    patchImportReviewCandidateOverridesBodySchema,
    patchImportReviewRoadOverridesBodySchema,
    postImportReviewRoadValidateRoutingBodySchema,
} from "./import-review.schema.js";
import { isImportReviewEntityFamily } from "./import-review-config.js";
import { ImportReviewService } from "./import-review.service.js";
import { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import { ImportReviewPromotionService } from "./import-review-promotion.service.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import { postImportReviewPromotionRoadDryRunBodySchema } from "./import-review-promotion-road-dry-run.schema.js";
import { postImportReviewPromotionRoutingBarrierDryRunBodySchema } from "./import-review-promotion-routing-barrier-dry-run.schema.js";
import {
    importReviewPromotionBatchEligibilityQuerySchema,
    importReviewPromotionBatchIdParamsSchema,
    importReviewPromotionBatchesListQuerySchema,
    importReviewPromotionReadyCandidatesQuerySchema,
    importReviewPromotionReadyQuerySchema,
    postImportReviewPromotionBatchBodySchema,
    postImportReviewPromotionBatchPromoteBodySchema,
    postImportReviewRepairInvalidPromotedBatchesBodySchema,
} from "./import-review-promotion.schema.js";
import {
    postImportReviewCleanupPromotedDryRunBodySchema,
    postImportReviewCleanupPromotedExecuteBodySchema,
} from "./import-review-cleanup-promoted.schema.js";
import { createImportReviewCleanupPromotedService } from "./import-review-cleanup-promoted.service.js";
import { createImportReviewAddressAdminInferenceService } from "./import-review-address-admin-inference.service.js";
import { postImportReviewAddressAdminInferenceBodySchema } from "./import-review-address-admin-inference.schema.js";
import { createImportReviewAddressValidationService } from "./import-review-address-validation.service.js";
import { postImportReviewAddressValidateBodySchema } from "./import-review-address-validation.schema.js";
import { createImportReviewAddressComponentsMutationService } from "./import-review-address-components-mutation.service.js";
import { createImportReviewAddressPromotionService } from "./import-review-address-promotion.service.js";
import { postImportReviewAddressPromotionBodySchema } from "./import-review-address-promotion.schema.js";
import { createImportReviewPlacePromotionService } from "./import-review-place-promotion.service.js";
import { postImportReviewPlacePromotionBodySchema } from "./import-review-place-promotion.schema.js";
import { createImportReviewPlaceAddressLinkPromotionService } from "./import-review-place-address-link-promotion.service.js";
import { postImportReviewPlaceAddressLinkPromotionBodySchema } from "./import-review-place-address-link-promotion.schema.js";
import { patchImportReviewAddressComponentsBodySchema } from "./import-review-address-components-mutation.schema.js";
import { createImportReviewAddressMatchesService } from "./import-review-address-matches.service.js";
import { createImportReviewAddressPlaceWorkflowService } from "./import-review-address-place-workflow.service.js";
import { patchImportReviewAddressPlaceStatusBodySchema } from "./import-review-address-place-workflow.schema.js";
import { createImportReviewPlaceValidationService } from "./import-review-place-validation.service.js";
import { postImportReviewPlaceValidateBodySchema } from "./import-review-place-validation.schema.js";
import { createImportReviewPlaceAddressLinkValidationService } from "./import-review-place-address-link-validation.service.js";
import { postImportReviewPlaceAddressLinkValidateBodySchema } from "./import-review-place-address-link-validation.schema.js";
import { registerImportReviewPluginErrorHandler } from "./import-review-plugin-error-handler.js";
import { registerImportReviewRequestLogging } from "./import-review-request-timing.js";
import {
    importReviewAddressCandidateIdParamsSchema,
    patchImportReviewAddressMatchesBodySchema,
} from "./import-review-address-matches.schema.js";
import { ImportReviewHistoryRepository } from "./import-review-history.repo.js";
import { ImportReviewHistoryService } from "./import-review-history.service.js";
import {
    importReviewHistoryPublishBatchIdParamsSchema,
    importReviewHistoryPublishBatchItemsQuerySchema,
    importReviewHistoryPublishBatchesListQuerySchema,
    importReviewHistoryReviewBatchIdParamsSchema,
    importReviewHistoryReviewBatchesListQuerySchema,
} from "./import-review-history.schema.js";

function importReviewAuthorizedPreHandlers(): [typeof requireImportReviewAdmin] {
    return [requireImportReviewAdmin];
}

function registerImportReviewFamilyRoutes(app: Parameters<FastifyPluginAsync>[0], service: ImportReviewService): void {
    app.get(
        "/:family/filter-options",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewFamilyFilterOptionsSchema,
        },
        async (request, reply) => {
            const familyRaw = (request.params as { family?: string }).family ?? "";
            if (!isImportReviewEntityFamily(familyRaw)) {
                return sendImportReviewNotFoundError(reply, `Unknown import-review entity family: `);
            }

            const parsed = importReviewSummaryQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }

            try {
                const options = await service.getFilterOptions(familyRaw, parsed.data);
                reply.header("Cache-Control", "private, max-age=300");
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
        "/:family/:id",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewFamilyCandidateByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewFamilyCandidateParamsSchema.safeParse(request.params);
            const queryParsed = importReviewScopedIncludeGeometryQuerySchema.safeParse(request.query);

            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!queryParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", queryParsed.error.flatten());
            }

            try {
                const item = await service.getCandidateById(paramsParsed.data.family, {
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
        "/:family",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewFamilyCandidatesSchema,
        },
        async (request, reply) => {
            const familyRaw = (request.params as { family?: string }).family ?? "";
            const familyParsed = importReviewEntityFamilyParamSchema.safeParse(familyRaw);
            if (!familyParsed.success) {
                return sendImportReviewNotFoundError(reply, `Unknown import-review entity family: `);
            }

            const parsed = importReviewCandidatesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }

            try {
                const list = await service.listCandidates(familyParsed.data, parsed.data);
                return reply.send(list);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/:family/:id/decision",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewFamilyCandidateDecisionSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewFamilyCandidateParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewBuildingDecisionBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }

            try {
                const item = await service.patchCandidateDecision(
                    paramsParsed.data.family,
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
        "/:family/:id/overrides",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewFamilyCandidateOverridesSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewFamilyCandidateParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewCandidateOverridesBodySchema.safeParse(request.body);

            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }

            try {
                const item = await service.patchCandidateOverrides(
                    paramsParsed.data.family,
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
        "/:family/bulk-decision",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewFamilyBulkDecisionSchema,
        },
        async (request, reply) => {
            const familyRaw = (request.params as { family?: string }).family ?? "";
            const familyParsed = importReviewEntityFamilyParamSchema.safeParse(familyRaw);
            if (!familyParsed.success) {
                return sendImportReviewNotFoundError(reply, `Unknown import-review entity family: `);
            }

            const bodyParsed = bulkImportReviewBuildingDecisionBodySchema.safeParse(request.body);
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }

            try {
                const result = await service.bulkCandidateDecision(
                    familyParsed.data,
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
}

const importReviewRoutes: FastifyPluginAsync = async (app) => {
    app.log.info(`import-review admin guard enabled: ${isImportReviewHeaderTokenGuardEnabled()}`);

    registerImportReviewPluginErrorHandler(app);
    registerImportReviewRequestLogging(app);

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
    const historyRepo = new ImportReviewHistoryRepository(prisma);
    const historyService = new ImportReviewHistoryService(historyRepo);
    const cleanupPromotedService = createImportReviewCleanupPromotedService(prisma);
    const addressAdminInferenceService = createImportReviewAddressAdminInferenceService(prisma);
    const addressMatchesService = createImportReviewAddressMatchesService(prisma);
    const addressPlaceWorkflowService = createImportReviewAddressPlaceWorkflowService(prisma);
    const addressValidationService = createImportReviewAddressValidationService(prisma);
    const placeValidationService = createImportReviewPlaceValidationService(prisma);
    const placeAddressLinkValidationService = createImportReviewPlaceAddressLinkValidationService(prisma);
    const addressPromotionService = createImportReviewAddressPromotionService(prisma);
    const placePromotionService = createImportReviewPlacePromotionService(prisma);
    const placeAddressLinkPromotionService = createImportReviewPlaceAddressLinkPromotionService(prisma);
    const addressComponentsMutationService = createImportReviewAddressComponentsMutationService(prisma);

    app.get(
        "/history/review-batches",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewHistoryReviewBatchesSchema,
        },
        async (request, reply) => {
            const parsed = importReviewHistoryReviewBatchesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(await historyService.listReviewBatches(parsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/history/review-batches/:id",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewHistoryReviewBatchByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewHistoryReviewBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            try {
                return reply.send(
                    await historyService.getReviewBatchById(BigInt(paramsParsed.data.id))
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
        "/history/publish-batches",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewHistoryPublishBatchesSchema,
        },
        async (request, reply) => {
            const parsed = importReviewHistoryPublishBatchesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(await historyService.listPublishBatches(parsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/history/publish-batches/:id",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewHistoryPublishBatchByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewHistoryPublishBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            try {
                return reply.send(
                    await historyService.getPublishBatchById(BigInt(paramsParsed.data.id))
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
        "/history/publish-batches/:id/items",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewHistoryPublishBatchItemsSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewHistoryPublishBatchIdParamsSchema.safeParse(request.params);
            const queryParsed = importReviewHistoryPublishBatchItemsQuerySchema.safeParse(request.query);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            if (!queryParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", queryParsed.error.flatten());
            }
            try {
                return reply.send(
                    await historyService.listPublishBatchItems(
                        BigInt(paramsParsed.data.id),
                        queryParsed.data
                    )
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
        "/history/publish-batches/:id/logs",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewHistoryPublishBatchLogsSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewHistoryPublishBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            try {
                return reply.send(
                    await historyService.getPublishBatchLogs(BigInt(paramsParsed.data.id))
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
        "/options",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewFormOptionsSchema,
        },
        async (_request, reply) => {
            try {
                const options = await importReviewService.getFormOptions();
                reply.header("Cache-Control", "private, max-age=600");
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
        "/reference-options",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewReferenceOptionsSchema,
        },
        async (_request, reply) => {
            try {
                const options = await importReviewService.getReferenceOptions();
                reply.header("Cache-Control", "private, max-age=300");
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
        "/batches",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewBatchesSchema,
        },
        async (request, reply) => {
            const parsed = importReviewBatchesListQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }

            try {
                const batches = await importReviewService.listBatches(parsed.data);
                return reply.send(batches);
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
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
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }

            try {
                const summary = await importReviewService.getSummary(parsed.data);
                return reply
                    .header("Cache-Control", "private, max-age=60, stale-while-revalidate=120")
                    .send(summary);
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
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }

            try {
                const options = await importReviewService.getBuildingFilterOptions(parsed.data);
                reply.header("Cache-Control", "private, max-age=300");
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!queryParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", queryParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
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

    app.get(
        "/roads/dry-run-summary",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewRoadDryRunSummarySchema,
        },
        async (request, reply) => {
            const parsed = importReviewRoadDryRunSummaryQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                const summary = await importReviewService.getRoadDryRunSummary(parsed.data);
                return reply.send(summary);
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
                return sendImportReviewValidationError(reply, "Invalid body", parsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid body", parsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid body", parsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }

            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
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
        "/promotion/batch-eligibility",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionBatchEligibilitySchema,
        },
        async (request, reply) => {
            const parsed = importReviewPromotionBatchEligibilityQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(await promotionService.getBatchEligibility(parsed.data));
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
                return sendImportReviewValidationError(reply, "Invalid query", parsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid body", parsed.error.flatten());
            }
            try {
                const result = await promotionService.createBatch(
                    parsed.data,
                    request.user,
                    request.log
                );
                if ("dry_run" in result && result.dry_run) {
                    return reply.send(result);
                }
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
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
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            const bodyParsed = postImportReviewPromotionBatchPromoteBodySchema.safeParse(request.body);
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
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

    app.post(
        "/promotion/batches/repair-invalid-promoted",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewRepairInvalidPromotedBatchesSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewRepairInvalidPromotedBatchesBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(
                    await promotionService.repairInvalidEmptyPromotedBatches({
                        batchId: bodyParsed.data.batch_id
                            ? BigInt(bodyParsed.data.batch_id)
                            : undefined,
                        reviewBatchId: bodyParsed.data.review_batch_id
                            ? BigInt(bodyParsed.data.review_batch_id)
                            : undefined,
                    })
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
        "/promotion/batches/:id/road-dry-run",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPromotionRoadDryRunSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            const bodyParsed = postImportReviewPromotionRoadDryRunBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(
                    await promotionService.runRoadDryRun(
                        BigInt(paramsParsed.data.id),
                        bodyParsed.data
                    )
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
        "/promotion/batches/:id/road-dry-run",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionRoadDryRunSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            try {
                return reply.send(
                    await promotionService.getRoadDryRun(BigInt(paramsParsed.data.id))
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
        "/promotion/batches/:id/routing-barrier-dry-run",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPromotionRoutingBarrierDryRunSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            const bodyParsed = postImportReviewPromotionRoutingBarrierDryRunBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(
                    await promotionService.runRoutingBarrierDryRun(
                        BigInt(paramsParsed.data.id),
                        bodyParsed.data
                    )
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
        "/promotion/batches/:id/routing-barrier-dry-run",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionRoutingBarrierDryRunSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            try {
                return reply.send(
                    await promotionService.getRoutingBarrierDryRun(BigInt(paramsParsed.data.id))
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
        "/promotion/batches/:id/verify",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewPromotionBatchVerifySchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
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

    app.post(
        "/cleanup/promoted/dry-run",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewCleanupPromotedDryRunSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewCleanupPromotedDryRunBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await cleanupPromotedService.dryRun(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/cleanup/promoted/execute",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewCleanupPromotedExecuteSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewCleanupPromotedExecuteBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await cleanupPromotedService.execute(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/addresses/:id/options",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: getImportReviewAddressOptionsSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewAddressCandidateIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            try {
                return reply.send(
                    await addressMatchesService.getOptions(paramsParsed.data.id)
                );
            } catch (error) {
                const candidateId = paramsParsed.data.id.toString();
                const message = error instanceof Error ? error.message : String(error);
                console.error(
                    `[import-review address options] candidate_id=${candidateId} request failed: ${message}`
                );
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/addresses/:id/create-place-candidate",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewAddressCreatePlaceCandidateSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewAddressCandidateIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            try {
                return reply.send(
                    await addressPlaceWorkflowService.createPlaceCandidate(paramsParsed.data.id)
                );
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/addresses/:id/place-status",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewAddressPlaceStatusSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewAddressCandidateIdParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewAddressPlaceStatusBodySchema.safeParse(request.body ?? {});
            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(
                    await addressPlaceWorkflowService.patchPlaceStatus(
                        paramsParsed.data.id,
                        bodyParsed.data
                    )
                );
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/addresses/:id/components",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewAddressComponentsSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewAddressCandidateIdParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewAddressComponentsBodySchema.safeParse(request.body ?? {});

            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(
                    await addressComponentsMutationService.patchComponents(
                        paramsParsed.data.id,
                        bodyParsed.data
                    )
                );
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.patch(
        "/addresses/:id/matches",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: patchImportReviewAddressMatchesSchema,
        },
        async (request, reply) => {
            const paramsParsed = importReviewAddressCandidateIdParamsSchema.safeParse(request.params);
            const bodyParsed = patchImportReviewAddressMatchesBodySchema.safeParse(request.body ?? {});

            if (!paramsParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid path parameters", paramsParsed.error.flatten());
            }
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(
                    await addressMatchesService.patchMatches(
                        paramsParsed.data.id,
                        bodyParsed.data
                    )
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
        "/addresses/validate",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewAddressValidateSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewAddressValidateBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await addressValidationService.validate(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/places/validate",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPlaceValidateSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewPlaceValidateBodySchema.safeParse(request.body ?? {});
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await placeValidationService.validate(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/place-address-links/validate",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPlaceAddressLinkValidateSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewPlaceAddressLinkValidateBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await placeAddressLinkValidationService.validate(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/addresses/infer-admin-components",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewAddressAdminInferenceSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewAddressAdminInferenceBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await addressAdminInferenceService.run(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/addresses/promote-dry-run",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewAddressPromotionDryRunSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewAddressPromotionBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await addressPromotionService.dryRun(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/addresses/promote",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewAddressPromotionSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewAddressPromotionBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await addressPromotionService.promote(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/places/promote-dry-run",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPlacePromotionSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewPlacePromotionBodySchema.safeParse(request.body ?? {});
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await placePromotionService.dryRun(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/places/promote",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPlacePromotionSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewPlacePromotionBodySchema.safeParse(request.body ?? {});
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await placePromotionService.promote(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/place-address-links/promote-dry-run",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPlaceAddressLinkPromotionSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewPlaceAddressLinkPromotionBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await placeAddressLinkPromotionService.dryRun(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/place-address-links/promote",
        {
            preHandler: importReviewAuthorizedPreHandlers(),
            schema: postImportReviewPlaceAddressLinkPromotionSchema,
        },
        async (request, reply) => {
            const bodyParsed = postImportReviewPlaceAddressLinkPromotionBodySchema.safeParse(
                request.body ?? {}
            );
            if (!bodyParsed.success) {
                return sendImportReviewValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(await placeAddressLinkPromotionService.promote(bodyParsed.data));
            } catch (error) {
                if (sendImportReviewError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    registerImportReviewFamilyRoutes(app, importReviewService);
};

export default importReviewRoutes;
