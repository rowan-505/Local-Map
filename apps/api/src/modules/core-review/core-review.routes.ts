import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
    coreReviewEntityIdParamSchema,
    coreReviewEntityParamSchema,
    coreReviewListQuerySchema,
} from "./core-review.schema.js";
import { CoreReviewService } from "./core-review.service.js";
import { getCoreReviewEntityByPath } from "./core-review.entity-registry.js";
import {
    getCoreReviewDetailSchema,
    getCoreReviewListSchema,
    postCoreReviewEntitySchema,
    patchCoreReviewEntitySchema,
    patchCoreReviewSoftDeleteSchema,
    patchCoreReviewRestoreSchema,
} from "./core-review.openapi.js";
import {
    EDIT_CORE_REVIEW_ROLES,
    getCoreReviewCreateSchema,
    getCoreReviewPatchSchema,
    sanitizeCoreReviewWriteBody,
    normalizeWriteBodyAliases,
} from "./core-review-write.schema.js";
import {
    CoreReviewLifecycleNotSupportedError,
    CoreReviewNotFoundError,
    CoreReviewValidationError,
} from "./core-review-write.errors.js";
import { mapDatabaseWriteError, sanitizeDevWriteErrorMessage } from "./core-review-write.helpers.js";

function replyCoreReviewReadError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
    context: string
) {
    request.log.error({ err: error }, context);
    return reply.code(500).send({
        message: "Unable to load core review data.",
    });
}

function replyCoreReviewWriteError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
    context: string,
    meta?: { entity?: string; operation?: string; payloadKeys?: string[] },
) {
    const mapped = mapDatabaseWriteError(error);
    if (mapped) {
        request.log.info(
            {
                entity: meta?.entity,
                operation: meta?.operation,
                payloadKeys: meta?.payloadKeys,
                validationIssues: mapped.issues,
            },
            `${context} (mapped validation)`,
        );
        return reply.code(400).send({ message: mapped.message, issues: mapped.issues });
    }

    request.log.error(
        {
            err: error,
            entity: meta?.entity,
            operation: meta?.operation,
            payloadKeys: meta?.payloadKeys,
        },
        context,
    );

    const isDev = process.env.NODE_ENV !== "production";
    const devDetail =
        isDev && error instanceof Error ? sanitizeDevWriteErrorMessage(error.message) : undefined;

    return reply.code(500).send({
        message: devDetail
            ? `Save failed: ${devDetail}`
            : "We could not save that core review change. Please try again.",
    });
}

function canEditCoreReview(request: FastifyRequest): boolean {
    return request.user.roles.some((role) => EDIT_CORE_REVIEW_ROLES.has(role));
}

async function handleCoreReviewLifecycle(
    request: FastifyRequest,
    reply: FastifyReply,
    service: CoreReviewService,
    operation: "soft-delete" | "restore",
) {
    const paramsParsed = coreReviewEntityIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
        return reply.code(400).send({
            message: "Invalid path parameters",
            issues: paramsParsed.error.flatten(),
        });
    }

    const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
    if (!def) {
        return reply.code(404).send({ message: "Unknown core-review entity" });
    }

    if (!canEditCoreReview(request)) {
        return reply.code(403).send({ message: "Admin or editor role required" });
    }

    try {
        const result =
            operation === "soft-delete"
                ? await service.softDelete(def.path, paramsParsed.data.id, request.user)
                : await service.restore(def.path, paramsParsed.data.id, request.user);

        request.log.info(
            { entity: def.slug, operation, id: paramsParsed.data.id },
            `core-review ${operation}`,
        );
        return reply.send(result);
    } catch (error) {
        if (error instanceof CoreReviewNotFoundError) {
            return reply.code(404).send({ message: error.message });
        }
        if (error instanceof CoreReviewLifecycleNotSupportedError) {
            return reply.code(400).send({ message: error.message });
        }
        if (error instanceof CoreReviewValidationError) {
            request.log.info(
                {
                    entity: def.slug,
                    operation,
                    id: paramsParsed.data.id,
                    validationIssues: error.issues,
                },
                `core-review ${operation} rejected`,
            );
            return reply.code(400).send({ message: error.message, issues: error.issues });
        }
        return replyCoreReviewWriteError(
            request,
            reply,
            error,
            `core-review ${operation} failed`,
        );
    }
}

const coreReviewRoutes: FastifyPluginAsync = async (app) => {
    const service = new CoreReviewService(app.prisma);

    app.get(
        "/:entity",
        {
            preHandler: app.authenticate,
            schema: getCoreReviewListSchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid entity path",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def) {
                return reply.code(404).send({ message: "Unknown core-review entity" });
            }

            const queryParsed = coreReviewListQuerySchema.safeParse(request.query);
            if (!queryParsed.success) {
                return reply.code(400).send({
                    message: "Invalid list query",
                    issues: queryParsed.error.flatten(),
                });
            }

            try {
                const result = await service.list(def.path, queryParsed.data);
                if (!result) {
                    return reply.code(404).send({ message: "Unknown core-review entity" });
                }

                request.log.info(
                    {
                        entity: def.slug,
                        page: queryParsed.data.page,
                        pageSize: queryParsed.data.pageSize,
                        total: result.pagination.total,
                        filters: result.filters,
                    },
                    "core-review list"
                );

                return reply.send(result);
            } catch (error) {
                return replyCoreReviewReadError(request, reply, error, "core-review list failed");
            }
        }
    );

    app.get(
        "/:entity/:id",
        {
            preHandler: app.authenticate,
            schema: getCoreReviewDetailSchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityIdParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def) {
                return reply.code(404).send({ message: "Unknown core-review entity" });
            }

            try {
                const result = await service.getDetail(def.path, paramsParsed.data.id);
                if (!result) {
                    return reply.code(404).send({ message: "Record not found" });
                }

                request.log.info(
                    { entity: def.slug, id: paramsParsed.data.id },
                    "core-review detail"
                );

                return reply.send(result);
            } catch (error) {
                return replyCoreReviewReadError(request, reply, error, "core-review detail failed");
            }
        }
    );

    app.post(
        "/:entity",
        {
            preHandler: app.authenticate,
            schema: postCoreReviewEntitySchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid entity path",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def) {
                return reply.code(404).send({ message: "Unknown core-review entity" });
            }

            if (!canEditCoreReview(request)) {
                return reply.code(403).send({ message: "Admin or editor role required" });
            }

            const sanitized = sanitizeCoreReviewWriteBody(normalizeWriteBodyAliases(request.body));
            const schema = getCoreReviewCreateSchema(def.slug);
            const bodyParsed = schema.safeParse(sanitized);
            if (!bodyParsed.success) {
                request.log.info(
                    { entity: def.slug, operation: "create", validationIssues: bodyParsed.error.flatten() },
                    "core-review create validation failed",
                );
                return reply.code(400).send({
                    message: "Invalid payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const payloadKeys = Object.keys(bodyParsed.data as Record<string, unknown>);

            try {
                const result = await service.create(
                    def.path,
                    bodyParsed.data as Record<string, unknown>,
                    request.user,
                    request.log,
                );
                if (!result) {
                    return reply.code(404).send({ message: "Unknown core-review entity" });
                }

                request.log.info(
                    { entity: def.slug, operation: "create", payloadKeys },
                    "core-review create",
                );
                return reply.code(201).send(result);
            } catch (error) {
                if (error instanceof CoreReviewValidationError) {
                    request.log.info(
                        {
                            entity: def.slug,
                            operation: "create",
                            payloadKeys,
                            validationIssues: error.issues,
                        },
                        "core-review create rejected",
                    );
                    return reply.code(400).send({ message: error.message, issues: error.issues });
                }
                return replyCoreReviewWriteError(request, reply, error, "core-review create failed", {
                    entity: def.slug,
                    operation: "create",
                    payloadKeys,
                });
            }
        },
    );

    app.patch(
        "/:entity/:id",
        {
            preHandler: app.authenticate,
            schema: patchCoreReviewEntitySchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityIdParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def) {
                return reply.code(404).send({ message: "Unknown core-review entity" });
            }

            if (!canEditCoreReview(request)) {
                return reply.code(403).send({ message: "Admin or editor role required" });
            }

            const sanitized = sanitizeCoreReviewWriteBody(normalizeWriteBodyAliases(request.body));
            const schema = getCoreReviewPatchSchema(def.slug);
            const bodyParsed = schema.safeParse(sanitized);
            if (!bodyParsed.success) {
                request.log.info(
                    {
                        entity: def.slug,
                        operation: "update",
                        id: paramsParsed.data.id,
                        validationIssues: bodyParsed.error.flatten(),
                    },
                    "core-review update validation failed",
                );
                return reply.code(400).send({
                    message: "Invalid payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            try {
                const result = await service.update(
                    def.path,
                    paramsParsed.data.id,
                    bodyParsed.data as Record<string, unknown>,
                    request.user,
                    request.log,
                );
                if (result === null) {
                    return reply.code(404).send({ message: "Record not found" });
                }

                request.log.info(
                    { entity: def.slug, operation: "update", id: paramsParsed.data.id },
                    "core-review update",
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof CoreReviewNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }
                if (error instanceof CoreReviewValidationError) {
                    request.log.info(
                        {
                            entity: def.slug,
                            operation: "update",
                            id: paramsParsed.data.id,
                            validationIssues: error.issues,
                        },
                        "core-review update rejected",
                    );
                    return reply.code(400).send({ message: error.message, issues: error.issues });
                }
                return replyCoreReviewWriteError(request, reply, error, "core-review update failed", {
                    entity: def.slug,
                    operation: "update",
                    payloadKeys: Object.keys(bodyParsed.data as Record<string, unknown>),
                });
            }
        },
    );

    app.patch(
        "/:entity/:id/soft-delete",
        {
            preHandler: app.authenticate,
            schema: patchCoreReviewSoftDeleteSchema,
        },
        async (request, reply) => handleCoreReviewLifecycle(request, reply, service, "soft-delete"),
    );

    app.patch(
        "/:entity/:id/restore",
        {
            preHandler: app.authenticate,
            schema: patchCoreReviewRestoreSchema,
        },
        async (request, reply) => handleCoreReviewLifecycle(request, reply, service, "restore"),
    );
};

export default coreReviewRoutes;
