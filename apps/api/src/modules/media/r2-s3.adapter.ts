import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
    type S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { R2MediaEnvConfig } from "../../config/env.js";
import type {
    HeadObjectResult,
    ObjectStore,
    PresignedGetInput,
    PresignedPutInput,
    PutObjectInput,
} from "./object-store.js";

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }
    const err = error as S3ServiceException;
    return err.name === "NotFound" || err.$metadata?.httpStatusCode === 404;
}

export function createR2S3Client(config: R2MediaEnvConfig): S3Client {
    return new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
        // R2 rejects some AWS SDK default checksum headers on presigned PUT.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    });
}

export class R2ObjectStore implements ObjectStore {
    constructor(
        private readonly client: S3Client,
        private readonly now: () => Date = () => new Date()
    ) {}

    async createPresignedPut(input: PresignedPutInput): Promise<{ url: string; expiresAt: Date }> {
        const url = await getSignedUrl(
            this.client,
            new PutObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                ContentType: input.contentType,
                ContentLength: input.contentLength,
            }),
            { expiresIn: input.expiresInSeconds }
        );
        return {
            url,
            expiresAt: new Date(this.now().getTime() + input.expiresInSeconds * 1000),
        };
    }

    async createPresignedGet(input: PresignedGetInput): Promise<{ url: string; expiresAt: Date }> {
        const url = await getSignedUrl(
            this.client,
            new GetObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
            }),
            { expiresIn: input.expiresInSeconds }
        );
        return {
            url,
            expiresAt: new Date(this.now().getTime() + input.expiresInSeconds * 1000),
        };
    }

    async headObject(input: { bucket: string; objectKey: string }): Promise<HeadObjectResult> {
        try {
            const result = await this.client.send(
                new HeadObjectCommand({
                    Bucket: input.bucket,
                    Key: input.objectKey,
                })
            );
            return {
                exists: true,
                contentLength: typeof result.ContentLength === "number" ? result.ContentLength : null,
                contentType: result.ContentType ?? null,
            };
        } catch (error) {
            if (isNotFound(error)) {
                return { exists: false, contentLength: null, contentType: null };
            }
            throw error;
        }
    }

    async getObject(input: { bucket: string; objectKey: string }): Promise<Buffer> {
        const result = await this.client.send(
            new GetObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
            })
        );
        const bytes = await result.Body?.transformToByteArray();
        if (!bytes) {
            throw new Error("Empty object body");
        }
        return Buffer.from(bytes);
    }

    async putObject(input: PutObjectInput): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                Body: input.body,
                ContentType: input.contentType,
                CacheControl: input.cacheControl,
                ContentLength: input.body.length,
            })
        );
    }
}
