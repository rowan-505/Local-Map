import { randomUUID } from "node:crypto";

import { MediaStorageNotConfiguredError } from "../../config/env.js";
import type { FieldReportsRepository } from "../field/field-reports.repo.js";
import type { ReportsRepository } from "../reports/reports.repo.js";
import type { MediaRepository, MediaAssetRow, ReportMediaRow } from "./media.repo.js";
import { sanitizePublicStopPhotos } from "./public-photo-sanitize.js";
import {
    JPEG_MIME_TYPE,
    MEDIA_ACCESS_EXPIRES_SECONDS,
    MEDIA_UPLOAD_EXPIRES_SECONDS,
    type FieldReportMediaBody,
    type MediaUploadBody,
    type PublishStopPhotoBody,
} from "./media.schema.js";
import type { ObjectStore } from "./object-store.js";

export class MediaError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string = "MEDIA_ERROR"
    ) {
        super(message);
        this.name = "MediaError";
    }
}

export type MediaUploadResponse = {
    publicId: string;
    mediaType: MediaUploadBody["mediaType"];
    mimeType: MediaUploadBody["mimeType"];
    byteSize: number;
    status: "pending";
    upload: {
        method: "PUT";
        url: string;
        headers: { "Content-Type": string; "Content-Length": string };
        expiresAt: string;
    };
};

export type MediaCompleteResponse = {
    publicId: string;
    mediaType: string;
    mimeType: string;
    byteSize: number;
    storageScope: string;
    status: "ready";
    readyAt: string;
};

export type FieldReportMediaResponse = {
    reportPublicId: string;
    assetPublicId: string;
    note: string | null;
    sortOrder: number;
    createdAt: string;
};

export type AdminMediaAccessResponse = {
    publicId: string;
    mimeType: string;
    byteSize: number;
    method: "GET";
    url: string;
    expiresAt: string;
};

export type PublishStopPhotoResponse = {
    stopPublicId: string;
    sourceAssetPublicId: string;
    detail: { publicId: string; url: string; width: number; height: number };
    card: { publicId: string; url: string; width: number; height: number };
    isPrimary: boolean;
    note: string | null;
};

export class MediaService {
    constructor(
        private readonly mediaRepo: MediaRepository,
        private readonly reportsRepo: ReportsRepository,
        private readonly fieldRepo: FieldReportsRepository,
        private readonly objectStore: ObjectStore,
        private readonly config: {
            privateBucket: string;
            publicBucket?: string;
            publicBaseUrl?: string;
            uploadExpiresSeconds?: number;
            accessExpiresSeconds?: number;
        },
        private readonly createPublicId: () => string = () => randomUUID()
    ) {}

    async createUpload(jwtSub: string, body: MediaUploadBody): Promise<MediaUploadResponse> {
        this.assertConfigured();
        const createdBy = await this.requireUserId(jwtSub);
        const publicId = this.createPublicId();
        const objectKey = privateObjectKey(publicId, body.mediaType);
        await this.mediaRepo.insertPending({
            publicId,
            mediaType: body.mediaType,
            storageScope: "private",
            objectKey,
            mimeType: body.mimeType,
            byteSize: body.byteSize,
            createdBy,
        });
        const expiresInSeconds = this.config.uploadExpiresSeconds ?? MEDIA_UPLOAD_EXPIRES_SECONDS;
        const signed = await this.objectStore.createPresignedPut({
            bucket: this.config.privateBucket,
            objectKey,
            contentType: body.mimeType,
            contentLength: body.byteSize,
            expiresInSeconds,
        });
        return {
            publicId,
            mediaType: body.mediaType,
            mimeType: body.mimeType,
            byteSize: body.byteSize,
            status: "pending",
            upload: {
                method: "PUT",
                url: signed.url,
                headers: {
                    "Content-Type": body.mimeType,
                    "Content-Length": String(body.byteSize),
                },
                expiresAt: signed.expiresAt.toISOString(),
            },
        };
    }

    async complete(jwtSub: string, publicId: string): Promise<MediaCompleteResponse> {
        this.assertConfigured();
        const createdBy = await this.requireUserId(jwtSub);
        const asset = await this.requireOwnedAsset(publicId, createdBy);
        const head = await this.objectStore.headObject({
            bucket: this.config.privateBucket,
            objectKey: asset.object_key,
        });
        if (!head.exists) {
            throw new MediaError("Uploaded object was not found", 400, "OBJECT_NOT_FOUND");
        }
        if (head.contentLength !== Number(asset.byte_size)) {
            throw new MediaError("Uploaded object size does not match", 409, "OBJECT_SIZE_MISMATCH");
        }
        if (head.contentType && !mimeCompatible(asset.mime_type, head.contentType)) {
            throw new MediaError("Uploaded object type does not match", 409, "OBJECT_TYPE_MISMATCH");
        }
        if (asset.status === "ready") {
            return toCompleteResponse(asset);
        }
        const ready = await this.mediaRepo.markReady({ publicId, createdBy });
        if (!ready) {
            const refreshed = await this.requireOwnedAsset(publicId, createdBy);
            if (refreshed.status !== "ready") {
                throw new MediaError("Asset could not be marked ready", 409, "ASSET_NOT_READY");
            }
            return toCompleteResponse(refreshed);
        }
        return toCompleteResponse(ready);
    }

    async attachToFieldReport(
        jwtSub: string,
        reportPublicId: string,
        body: FieldReportMediaBody
    ): Promise<FieldReportMediaResponse> {
        this.assertConfigured();
        const createdBy = await this.requireUserId(jwtSub);
        const report = await this.fieldRepo.findByPublicId(reportPublicId);
        if (!report || report.source_code !== "field_survey" || report.created_by !== createdBy) {
            throw new MediaError("Report not found", 404, "NOT_FOUND");
        }
        const asset = await this.requireOwnedAsset(body.assetPublicId, createdBy);
        if (asset.status !== "ready" || !asset.ready_at) {
            throw new MediaError("Asset is not ready", 409, "ASSET_NOT_READY");
        }
        if (asset.storage_scope !== "private") {
            throw new MediaError("Only private assets can be attached here", 400, "INVALID_STORAGE_SCOPE");
        }
        const sortOrder =
            body.sortOrder ?? (await this.mediaRepo.nextReportMediaSortOrder(report.id));
        const link = await this.mediaRepo.attachToReport({
            reportId: report.id,
            assetId: asset.id,
            note: body.note ?? null,
            sortOrder,
        });
        return toAttachResponse(report.public_id, asset.public_id, link);
    }

    async adminAccess(assetPublicId: string): Promise<AdminMediaAccessResponse> {
        this.assertConfigured();
        const asset = await this.mediaRepo.findLinkedByPublicId(assetPublicId);
        if (!asset) {
            throw new MediaError("Asset not found", 404, "NOT_FOUND");
        }
        if (asset.status !== "ready" || !asset.ready_at) {
            throw new MediaError("Asset not found", 404, "NOT_FOUND");
        }
        if (asset.storage_scope !== "private") {
            throw new MediaError("Only private assets can be accessed here", 400, "INVALID_STORAGE_SCOPE");
        }
        const expiresInSeconds = this.config.accessExpiresSeconds ?? MEDIA_ACCESS_EXPIRES_SECONDS;
        const signed = await this.objectStore.createPresignedGet({
            bucket: this.config.privateBucket,
            objectKey: asset.object_key,
            expiresInSeconds,
        });
        return {
            publicId: asset.public_id,
            mimeType: asset.mime_type,
            byteSize: Number(asset.byte_size),
            method: "GET",
            url: signed.url,
            expiresAt: signed.expiresAt.toISOString(),
        };
    }

    async adminPublishStopPhoto(
        jwtSub: string,
        assetPublicId: string,
        body: PublishStopPhotoBody,
        audit: { ipAddress: string | null; userAgent: string | null }
    ): Promise<PublishStopPhotoResponse> {
        this.assertConfigured();
        const publicBucket = this.config.publicBucket;
        const publicBaseUrl = this.config.publicBaseUrl;
        if (!publicBucket || !publicBaseUrl) {
            throw new MediaStorageNotConfiguredError();
        }
        const createdBy = await this.requireUserId(jwtSub);
        const context = await this.mediaRepo.findPublishContext(assetPublicId);
        if (!context) {
            throw new MediaError("Asset not found", 404, "NOT_FOUND");
        }
        const original = context.asset;
        if (original.status !== "ready" || !original.ready_at) {
            throw new MediaError("Asset not found", 404, "NOT_FOUND");
        }
        if (original.storage_scope !== "private") {
            throw new MediaError("Only private evidence can be published", 400, "INVALID_STORAGE_SCOPE");
        }
        if (original.media_type !== "image" || original.mime_type !== JPEG_MIME_TYPE) {
            throw new MediaError("Only JPEG photos can be published", 400, "NOT_IMAGE");
        }
        if (original.object_key.startsWith("public/")) {
            throw new MediaError("Private original is required", 400, "INVALID_OBJECT_KEY");
        }
        const stopPublicId = context.stopPublicId;
        if (!stopPublicId) {
            throw new MediaError("This report is not linked to a stop", 400, "STOP_REQUIRED");
        }
        if (await this.mediaRepo.hasActiveStopMediaForReportMedia(context.reportMediaId)) {
            throw new MediaError("This photo is already published", 409, "ALREADY_PUBLISHED");
        }
        const stopId = await this.mediaRepo.findStopIdByPublicId(stopPublicId);
        if (stopId === null) {
            throw new MediaError("Stop not found", 404, "STOP_NOT_FOUND");
        }

        const privateBytes = await this.objectStore.getObject({
            bucket: this.config.privateBucket,
            objectKey: original.object_key,
        });
        const sanitized = await sanitizePublicStopPhotos(privateBytes, {
            rotateDegrees: body.rotateDegrees,
            crop: body.crop ?? null,
            blurRects: body.blurRects,
        });

        const detailPublicId = this.createPublicId();
        const cardPublicId = this.createPublicId();
        if (detailPublicId === original.public_id || cardPublicId === original.public_id) {
            throw new MediaError("Could not allocate public ids", 500, "PUBLIC_ID_COLLISION");
        }
        const detailKey = `public/${detailPublicId}/d1280.jpg`;
        const cardKey = `public/${cardPublicId}/c640.jpg`;
        const cacheControl = "public, max-age=31536000, immutable";
        await this.objectStore.putObject({
            bucket: publicBucket,
            objectKey: detailKey,
            body: sanitized.detailJpeg,
            contentType: JPEG_MIME_TYPE,
            cacheControl,
        });
        await this.objectStore.putObject({
            bucket: publicBucket,
            objectKey: cardKey,
            body: sanitized.cardJpeg,
            contentType: JPEG_MIME_TYPE,
            cacheControl,
        });

        const stillPrivate = await this.mediaRepo.findByPublicId(original.public_id);
        if (!stillPrivate || stillPrivate.storage_scope !== "private") {
            throw new MediaError("Private original must stay private", 500, "PRIVATE_MUTATION_BLOCKED");
        }

        const detailAsset = await this.mediaRepo.insertReadyPublic({
            publicId: detailPublicId,
            objectKey: detailKey,
            mimeType: JPEG_MIME_TYPE,
            byteSize: sanitized.detailJpeg.length,
            width: sanitized.detailWidth,
            height: sanitized.detailHeight,
            sourceAssetId: original.id,
            createdBy,
        });
        await this.mediaRepo.insertReadyPublic({
            publicId: cardPublicId,
            objectKey: cardKey,
            mimeType: JPEG_MIME_TYPE,
            byteSize: sanitized.cardJpeg.length,
            width: sanitized.cardWidth,
            height: sanitized.cardHeight,
            sourceAssetId: original.id,
            createdBy,
        });

        try {
            await this.mediaRepo.insertStopMedia({
                stopId,
                assetId: detailAsset.id,
                sourceReportMediaId: context.reportMediaId,
                note: body.note ?? null,
                isPrimary: body.isPrimary === true,
                audit: { actorUserId: createdBy, ipAddress: audit.ipAddress, userAgent: audit.userAgent },
            });
        } catch (error) {
            if (isAlreadyPublishedError(error)) {
                throw new MediaError("This photo is already published", 409, "ALREADY_PUBLISHED");
            }
            throw error;
        }

        return {
            stopPublicId,
            sourceAssetPublicId: original.public_id,
            detail: {
                publicId: detailPublicId,
                url: publicMediaUrl(publicBaseUrl, detailKey),
                width: sanitized.detailWidth,
                height: sanitized.detailHeight,
            },
            card: {
                publicId: cardPublicId,
                url: publicMediaUrl(publicBaseUrl, cardKey),
                width: sanitized.cardWidth,
                height: sanitized.cardHeight,
            },
            isPrimary: body.isPrimary === true,
            note: body.note ?? null,
        };
    }

    private assertConfigured(): void {
        if (!this.config.privateBucket) {
            throw new MediaStorageNotConfiguredError();
        }
    }

    private async requireUserId(jwtSub: string): Promise<bigint> {
        const userId = await this.reportsRepo.findActiveUserIdByPublicId(jwtSub);
        if (userId === null) {
            throw new MediaError("User not found", 401, "UNAUTHORIZED");
        }
        return userId;
    }

    private async requireOwnedAsset(publicId: string, createdBy: bigint): Promise<MediaAssetRow> {
        const asset = await this.mediaRepo.findByPublicId(publicId);
        if (!asset || asset.created_by !== createdBy) {
            throw new MediaError("Asset not found", 404, "NOT_FOUND");
        }
        return asset;
    }
}

function publicMediaUrl(baseUrl: string, objectKey: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/${objectKey.replace(/^\/+/, "")}`;
}

function isAlreadyPublishedError(error: unknown): boolean {
    let current: unknown = error;
    for (let i = 0; i < 5 && current && typeof current === "object"; i += 1) {
        const item = current as {
            code?: string;
            message?: string;
            meta?: { code?: string; message?: string };
            cause?: unknown;
        };
        const blob = `${item.code ?? ""} ${item.message ?? ""} ${item.meta?.code ?? ""} ${item.meta?.message ?? ""}`;
        if (
            item.code === "P2002" ||
            blob.includes("23505") ||
            blob.includes("stop_media_active_source_report_media")
        ) {
            return true;
        }
        current = item.cause;
    }
    return false;
}

function privateObjectKey(publicId: string, mediaType: MediaUploadBody["mediaType"]): string {
    return mediaType === "audio" ? `private/${publicId}.m4a` : `private/${publicId}.jpg`;
}

function normalizeMime(value: string): string {
    return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

const AUDIO_MIME_EQUIV = new Set(["audio/mp4", "audio/m4a", "audio/aac"]);

function mimeCompatible(expected: string, actual: string): boolean {
    const left = normalizeMime(expected);
    const right = normalizeMime(actual);
    if (left === right) {
        return true;
    }
    return AUDIO_MIME_EQUIV.has(left) && AUDIO_MIME_EQUIV.has(right);
}

function toCompleteResponse(asset: MediaAssetRow): MediaCompleteResponse {
    if (!asset.ready_at) {
        throw new MediaError("Asset is not ready", 409, "ASSET_NOT_READY");
    }
    return {
        publicId: asset.public_id,
        mediaType: asset.media_type,
        mimeType: asset.mime_type,
        byteSize: Number(asset.byte_size),
        storageScope: asset.storage_scope,
        status: "ready",
        readyAt: asset.ready_at.toISOString(),
    };
}

function toAttachResponse(
    reportPublicId: string,
    assetPublicId: string,
    link: ReportMediaRow
): FieldReportMediaResponse {
    return {
        reportPublicId,
        assetPublicId,
        note: link.note,
        sortOrder: link.sort_order,
        createdAt: link.created_at.toISOString(),
    };
}
