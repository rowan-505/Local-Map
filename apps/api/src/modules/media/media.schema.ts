import { z } from "zod";

export const JPEG_MIME_TYPE = "image/jpeg";
export const JPEG_MAX_BYTES = 8 * 1024 * 1024;
export const AUDIO_MIME_TYPES = ["audio/mp4", "audio/m4a"] as const;
export const AUDIO_MAX_BYTES = 1 * 1024 * 1024;
export const MEDIA_UPLOAD_EXPIRES_SECONDS = 10 * 60;
export const MEDIA_ACCESS_EXPIRES_SECONDS = 5 * 60;

export const MEDIA_UPLOAD_RATE_LIMIT = {
    max: 20,
    timeWindow: "1 minute",
} as const;

export const MEDIA_ACCESS_RATE_LIMIT = {
    max: 30,
    timeWindow: "1 minute",
} as const;

export const MEDIA_PUBLISH_RATE_LIMIT = {
    max: 10,
    timeWindow: "1 minute",
} as const;

const normalizedRectSchema = z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
});

export const publishStopPhotoBodySchema = z.object({
    rotateDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    crop: normalizedRectSchema.nullable().optional(),
    blurRects: z.array(normalizedRectSchema).max(8).default([]),
    note: z.string().trim().max(500).nullable().optional(),
    isPrimary: z.boolean().optional(),
});

export const mediaUploadBodySchema = z.discriminatedUnion("mediaType", [
    z.object({
        mediaType: z.literal("image"),
        mimeType: z.literal(JPEG_MIME_TYPE),
        byteSize: z.number().int().positive().max(JPEG_MAX_BYTES),
    }),
    z.object({
        mediaType: z.literal("audio"),
        mimeType: z.enum(AUDIO_MIME_TYPES),
        byteSize: z.number().int().positive().max(AUDIO_MAX_BYTES),
    }),
]);

export const mediaPublicIdParamSchema = z.object({
    publicId: z.string().uuid(),
});

export const fieldReportMediaBodySchema = z.object({
    assetPublicId: z.string().uuid(),
    note: z.string().trim().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export type MediaUploadBody = z.infer<typeof mediaUploadBodySchema>;
export type FieldReportMediaBody = z.infer<typeof fieldReportMediaBodySchema>;
export type PublishStopPhotoBody = z.infer<typeof publishStopPhotoBodySchema>;
