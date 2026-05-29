import type { FastifyPluginAsync } from "fastify";

import {
    authenticateImportTransport,
    requireImportTransportAdmin,
} from "./import-transport-admin.guard.js";
import {
    sendImportTransportError,
    sendImportTransportUnknownFamilyError,
    sendImportTransportValidationError,
} from "./import-transport-error-response.js";
import {
    getImportTransportBatchesSchema,
    getImportTransportFamilyCandidateByIdSchema,
    getImportTransportFamilyCandidatesSchema,
    getImportTransportOptionsSchema,
    getImportTransportSummarySchema,
    getImportTransportValidationIssuesSchema,
    getImportTransportPromotionBatchByIdSchema,
    getImportTransportPromotionBatchLogsSchema,
    getImportTransportPromotionBatchProgressSchema,
    getImportTransportPromotionBatchesSchema,
    getImportTransportPromotionReadySchema,
    getImportTransportHistoryImportBatchesSchema,
    getImportTransportHistoryImportBatchByIdSchema,
    getImportTransportHistoryPromotionBatchesSchema,
    getImportTransportHistoryPromotionBatchByIdSchema,
    getImportTransportHistoryPromotionBatchItemsSchema,
    getImportTransportHistoryPromotionBatchLogsSchema,
    getImportTransportGtfsExportsSchema,
    getImportTransportGtfsExportByIdSchema,
    getImportTransportGtfsExportValidationSchema,
    getImportTransportGtfsOtpBuildsSchema,
    postImportTransportGtfsExportSchema,
    postImportTransportPromotionBatchPromoteSchema,
    postImportTransportPromotionBatchValidateSchema,
    postImportTransportBatchValidationSchema,
    postImportTransportPromotionBatchSchema,
    postImportTransportValidateCandidateSchema,
} from "./import-transport.openapi.js";
import { isImportTransportFamily } from "./import-transport.config.js";
import { ImportTransportRepository } from "./import-transport.repo.js";
import {
    importTransportBatchesListQuerySchema,
    importTransportBatchValidationBodySchema,
    importTransportCandidateDetailQuerySchema,
    importTransportCandidatesListQuerySchema,
    importTransportFamilyCandidateParamsSchema,
    importTransportScopeQuerySchema,
    importTransportValidateCandidateBodySchema,
    importTransportValidationIssuesQuerySchema,
    importTransportPromotionReadyQuerySchema,
    importTransportPromotionBatchesListQuerySchema,
    importTransportPromotionBatchIdParamsSchema,
    postImportTransportPromotionBatchBodySchema,
    postImportTransportPromotionBatchPromoteBodySchema,
    parseImportTransportScopeQuery,
} from "./import-transport.schema.js";
import { ImportTransportService } from "./import-transport.service.js";
import { ImportTransportUnknownFamilyError } from "./import-transport.errors.js";
import { ImportTransportValidationRepository } from "./import-transport-validation.repo.js";
import { ImportTransportValidationService } from "./import-transport-validation.service.js";
import { ImportTransportPromotionPromoteRepository } from "./import-transport-promotion-promote.repo.js";
import { ImportTransportPromotionPromoteService } from "./import-transport-promotion-promote.service.js";
import { ImportTransportPromotionRepository } from "./import-transport-promotion.repo.js";
import { ImportTransportPromotionService } from "./import-transport-promotion.service.js";
import { ImportTransportPromotionValidationRepository } from "./import-transport-promotion-validation.repo.js";
import { ImportTransportPromotionValidationService } from "./import-transport-promotion-validation.service.js";
import { ImportTransportHistoryRepository } from "./import-transport-history.repo.js";
import { ImportTransportHistoryService } from "./import-transport-history.service.js";
import {
    importTransportHistoryBatchIdParamsSchema,
    importTransportHistoryImportBatchesListQuerySchema,
    importTransportHistoryPromotionBatchItemsQuerySchema,
    importTransportHistoryPromotionBatchesListQuerySchema,
} from "./import-transport-history.schema.js";
import { ImportTransportGtfsRepository } from "./import-transport-gtfs.repo.js";
import { ImportTransportGtfsService } from "./import-transport-gtfs.service.js";
import {
    importTransportGtfsExportIdParamsSchema,
    importTransportGtfsExportsListQuerySchema,
    importTransportGtfsOtpBuildsListQuerySchema,
    postImportTransportGtfsExportBodySchema,
} from "./import-transport-gtfs.schema.js";

function importTransportAuthorizedPreHandlers(): [typeof requireImportTransportAdmin] {
    return [requireImportTransportAdmin];
}

function parseFamilyParam(familyRaw: string) {
    const normalized = familyRaw.trim().toLowerCase();
    if (!isImportTransportFamily(normalized)) {
        throw new ImportTransportUnknownFamilyError(familyRaw);
    }
    return normalized;
}

const importTransportRoutes: FastifyPluginAsync = async (app) => {
    app.addHook("onRequest", async (request, reply) => {
        await authenticateImportTransport(request, reply);
    });

    const repo = new ImportTransportRepository(app.prisma);
    const validationRepo = new ImportTransportValidationRepository(app.prisma);
    const service = new ImportTransportService(repo);
    const validationService = new ImportTransportValidationService(repo, validationRepo);
    const promotionRepo = new ImportTransportPromotionRepository(app.prisma);
    const promotionValidationRepo = new ImportTransportPromotionValidationRepository(app.prisma);
    const promotionValidationService = new ImportTransportPromotionValidationService(
        promotionValidationRepo,
        validationRepo
    );
    const promotionPromoteRepo = new ImportTransportPromotionPromoteRepository(app.prisma);
    const promotionPromoteService = new ImportTransportPromotionPromoteService(
        promotionPromoteRepo,
        promotionValidationRepo
    );
    const promotionService = new ImportTransportPromotionService(
        promotionRepo,
        promotionValidationService,
        promotionPromoteService
    );
    const historyRepo = new ImportTransportHistoryRepository(app.prisma);
    const historyService = new ImportTransportHistoryService(historyRepo);
    const gtfsRepo = new ImportTransportGtfsRepository(app.prisma);
    const gtfsService = new ImportTransportGtfsService(gtfsRepo);

    app.get(
        "/gtfs/exports",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportGtfsExportsSchema,
        },
        async (request, reply) => {
            const parsed = importTransportGtfsExportsListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(await gtfsService.listExports(parsed.data));
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/gtfs/exports",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: postImportTransportGtfsExportSchema,
        },
        async (request, reply) => {
            const parsed = postImportTransportGtfsExportBodySchema.safeParse(request.body ?? {});
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid body", parsed.error.flatten());
            }
            try {
                return reply.send(await gtfsService.createExport(parsed.data));
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/gtfs/exports/:id",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportGtfsExportByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportGtfsExportIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(await gtfsService.getExportById(BigInt(paramsParsed.data.id)));
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/gtfs/exports/:id/validation",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportGtfsExportValidationSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportGtfsExportIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(
                    await gtfsService.getExportValidation(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/gtfs/otp-builds",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportGtfsOtpBuildsSchema,
        },
        async (request, reply) => {
            const parsed = importTransportGtfsOtpBuildsListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(await gtfsService.listOtpBuilds(parsed.data));
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/history/import-batches",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportHistoryImportBatchesSchema,
        },
        async (request, reply) => {
            const parsed = importTransportHistoryImportBatchesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(await historyService.listImportBatches(parsed.data));
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/history/import-batches/:id",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportHistoryImportBatchByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportHistoryBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(
                    await historyService.getImportBatchById(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/history/promotion-batches",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportHistoryPromotionBatchesSchema,
        },
        async (request, reply) => {
            const parsed = importTransportHistoryPromotionBatchesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(await historyService.listPromotionBatches(parsed.data));
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/history/promotion-batches/:id",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportHistoryPromotionBatchByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportHistoryBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(
                    await historyService.getPromotionBatchById(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/history/promotion-batches/:id/items",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportHistoryPromotionBatchItemsSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportHistoryBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            const queryParsed = importTransportHistoryPromotionBatchItemsQuerySchema.safeParse(request.query);
            if (!queryParsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", queryParsed.error.flatten());
            }
            try {
                return reply.send(
                    await historyService.listPromotionBatchItems(
                        BigInt(paramsParsed.data.id),
                        queryParsed.data
                    )
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/history/promotion-batches/:id/logs",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportHistoryPromotionBatchLogsSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportHistoryBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(
                    await historyService.getPromotionBatchLogs(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/summary",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportSummarySchema,
        },
        async (request, reply) => {
            const parsed = importTransportScopeQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                const summary = await service.getSummary(parseImportTransportScopeQuery(parsed.data));
                return reply
                    .header("Cache-Control", "private, max-age=60, stale-while-revalidate=120")
                    .send(summary);
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/batches",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportBatchesSchema,
        },
        async (request, reply) => {
            const parsed = importTransportBatchesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(await service.listBatches(parsed.data));
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/options",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportOptionsSchema,
        },
        async (_request, reply) => {
            reply.header("Cache-Control", "private, max-age=600");
            return reply.send(service.getOptions());
        }
    );

    app.get(
        "/promotion/ready",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportPromotionReadySchema,
        },
        async (request, reply) => {
            const parsed = importTransportPromotionReadyQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(
                    await promotionService.getReadyCounts(
                        BigInt(parsed.data.import_batch_id),
                        parsed.data.include_warnings ?? false
                    )
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportPromotionBatchesSchema,
        },
        async (request, reply) => {
            const parsed = importTransportPromotionBatchesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                return reply.send(
                    await promotionService.listBatches({
                        import_batch_id:
                            parsed.data.import_batch_id != null
                                ? BigInt(parsed.data.import_batch_id)
                                : undefined,
                        limit: parsed.data.limit,
                        offset: parsed.data.offset,
                    })
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/promotion/batches",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: postImportTransportPromotionBatchSchema,
        },
        async (request, reply) => {
            const parsed = postImportTransportPromotionBatchBodySchema.safeParse(request.body ?? {});
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid body", parsed.error.flatten());
            }
            try {
                const entityFamily =
                    parsed.data.mode === "all_entities" ? null : (parsed.data.entity_family ?? null);
                return reply.send(
                    await promotionService.createBatch({
                        import_batch_id: BigInt(parsed.data.import_batch_id),
                        mode: parsed.data.mode,
                        entity_family: entityFamily,
                        include_warnings: parsed.data.include_warnings ?? false,
                    })
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches/:id",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportPromotionBatchByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(
                    await promotionService.getBatchById(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/promotion/batches/:id/validate",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: postImportTransportPromotionBatchValidateSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(
                    await promotionService.validateBatch(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches/:id/progress",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportPromotionBatchProgressSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(
                    await promotionService.getBatchProgress(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/promotion/batches/:id/logs",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportPromotionBatchLogsSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            try {
                return reply.send(
                    await promotionService.getBatchLogs(BigInt(paramsParsed.data.id))
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/promotion/batches/:id/promote",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: postImportTransportPromotionBatchPromoteSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportPromotionBatchIdParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }
            const bodyParsed = postImportTransportPromotionBatchPromoteBodySchema.safeParse(request.body ?? {});
            if (!bodyParsed.success) {
                return sendImportTransportValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }
            try {
                return reply.send(
                    await promotionService.promoteBatch(BigInt(paramsParsed.data.id), bodyParsed.data)
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/validation/issues",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportValidationIssuesSchema,
        },
        async (request, reply) => {
            const parsed = importTransportValidationIssuesQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }
            try {
                const { entity_kind, entity_id, severity, limit, offset, ...scopeInput } = parsed.data;
                return reply.send(
                    await validationService.listIssues(parseImportTransportScopeQuery(scopeInput), {
                        entity_kind,
                        entity_id,
                        severity,
                        limit,
                        offset,
                    })
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/validation/batch",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: postImportTransportBatchValidationSchema,
        },
        async (request, reply) => {
            const parsed = importTransportBatchValidationBodySchema.safeParse(request.body ?? {});
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid body", parsed.error.flatten());
            }
            try {
                const { families, confirm_warnings, review_note, ...scopeInput } = parsed.data;
                return reply.send(
                    await validationService.validateBatch(parseImportTransportScopeQuery(scopeInput), {
                        families,
                        confirm_warnings,
                        review_note,
                    })
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.post(
        "/:family/:id/validate",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: postImportTransportValidateCandidateSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportFamilyCandidateParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                const familyRaw = (request.params as { family?: string }).family ?? "";
                if (!isImportTransportFamily(familyRaw.trim().toLowerCase())) {
                    return sendImportTransportUnknownFamilyError(reply, familyRaw);
                }
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }

            const queryParsed = importTransportScopeQuerySchema.safeParse(request.query);
            if (!queryParsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", queryParsed.error.flatten());
            }

            const bodyParsed = importTransportValidateCandidateBodySchema.safeParse(request.body ?? {});
            if (!bodyParsed.success) {
                return sendImportTransportValidationError(reply, "Invalid body", bodyParsed.error.flatten());
            }

            try {
                return reply.send(
                    await validationService.validateCandidate(
                        paramsParsed.data.family,
                        BigInt(paramsParsed.data.id),
                        parseImportTransportScopeQuery(queryParsed.data),
                        bodyParsed.data
                    )
                );
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/:family/:id",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportFamilyCandidateByIdSchema,
        },
        async (request, reply) => {
            const paramsParsed = importTransportFamilyCandidateParamsSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                const familyRaw = (request.params as { family?: string }).family ?? "";
                if (!isImportTransportFamily(familyRaw.trim().toLowerCase())) {
                    return sendImportTransportUnknownFamilyError(reply, familyRaw);
                }
                return sendImportTransportValidationError(
                    reply,
                    "Invalid path parameters",
                    paramsParsed.error.flatten()
                );
            }

            const queryParsed = importTransportCandidateDetailQuerySchema.safeParse(request.query);
            if (!queryParsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", queryParsed.error.flatten());
            }

            try {
                const item = await service.getCandidateById(
                    paramsParsed.data.family,
                    BigInt(paramsParsed.data.id),
                    {
                        ...parseImportTransportScopeQuery(queryParsed.data),
                        include_geometry: queryParsed.data.include_geometry,
                    }
                );
                return reply.send(item);
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );

    app.get(
        "/:family",
        {
            preHandler: importTransportAuthorizedPreHandlers(),
            schema: getImportTransportFamilyCandidatesSchema,
        },
        async (request, reply) => {
            const familyRaw = (request.params as { family?: string }).family ?? "";
            let family;
            try {
                family = parseFamilyParam(familyRaw);
            } catch {
                return sendImportTransportUnknownFamilyError(reply, familyRaw);
            }

            const parsed = importTransportCandidatesListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return sendImportTransportValidationError(reply, "Invalid query", parsed.error.flatten());
            }

            try {
                const list = await service.listCandidates(family, {
                    ...parseImportTransportScopeQuery(parsed.data),
                    limit: parsed.data.limit,
                    offset: parsed.data.offset,
                    sort: parsed.data.sort,
                    review_status: parsed.data.review_status,
                    review_decision: parsed.data.review_decision,
                    promotion_status: parsed.data.promotion_status,
                    validation_status: parsed.data.validation_status,
                    mode_type: parsed.data.mode_type,
                    q: parsed.data.q,
                    include_total: parsed.data.include_total,
                    include_geometry: parsed.data.include_geometry,
                    include_promoted: parsed.data.include_promoted,
                });
                return reply.send(list);
            } catch (error) {
                if (sendImportTransportError(reply, error)) {
                    return;
                }
                throw error;
            }
        }
    );
};

export default importTransportRoutes;
