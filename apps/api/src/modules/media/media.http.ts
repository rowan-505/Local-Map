import type { FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";

import { MediaStorageNotConfiguredError, getOptionalR2MediaEnv } from "../../config/env.js";
import { FieldReportsRepository } from "../field/field-reports.repo.js";
import { ReportsRepository } from "../reports/reports.repo.js";
import { MediaRepository } from "./media.repo.js";
import { MediaError, MediaService } from "./media.service.js";
import { R2ObjectStore, createR2S3Client } from "./r2-s3.adapter.js";

export function handleMediaError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof MediaStorageNotConfiguredError) {
        return reply.code(503).send({ code: "MEDIA_NOT_CONFIGURED", message: error.message });
    }
    if (error instanceof MediaError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
}

export function createMediaService(prisma: PrismaClient): MediaService {
    const r2 = getOptionalR2MediaEnv();
    if (!r2) {
        throw new MediaStorageNotConfiguredError();
    }
    return new MediaService(
        new MediaRepository(prisma),
        new ReportsRepository(prisma),
        new FieldReportsRepository(prisma),
        new R2ObjectStore(createR2S3Client(r2)),
        { privateBucket: r2.privateBucket, publicBucket: r2.publicBucket, publicBaseUrl: r2.publicBaseUrl }
    );
}
