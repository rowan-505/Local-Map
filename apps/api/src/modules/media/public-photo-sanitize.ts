import sharp from "sharp";

export const PUBLIC_PHOTO_CARD_EDGE = 640;
export const PUBLIC_PHOTO_DETAIL_EDGE = 1280;
export const PUBLIC_JPEG_QUALITY = 78;
export const PUBLIC_BLUR_SIGMA = 28;

export type NormalizedRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type PublicPhotoTransform = {
    rotateDegrees: 0 | 90 | 180 | 270;
    crop: NormalizedRect | null;
    blurRects: NormalizedRect[];
};

export type SanitizedPublicPhotos = {
    detailJpeg: Buffer;
    cardJpeg: Buffer;
    detailWidth: number;
    detailHeight: number;
    cardWidth: number;
    cardHeight: number;
};

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}

function toPixelRect(rect: NormalizedRect, width: number, height: number): {
    left: number;
    top: number;
    width: number;
    height: number;
} | null {
    const left = Math.floor(clamp01(rect.x) * width);
    const top = Math.floor(clamp01(rect.y) * height);
    const right = Math.ceil(clamp01(rect.x + rect.width) * width);
    const bottom = Math.ceil(clamp01(rect.y + rect.height) * height);
    const nextWidth = Math.min(width - left, Math.max(0, right - left));
    const nextHeight = Math.min(height - top, Math.max(0, bottom - top));
    if (nextWidth < 2 || nextHeight < 2) {
        return null;
    }
    return { left, top, width: nextWidth, height: nextHeight };
}

async function jpegBuffer(image: ReturnType<typeof sharp>): Promise<Buffer> {
    return image
        .jpeg({ quality: PUBLIC_JPEG_QUALITY, mozjpeg: true, chromaSubsampling: "4:2:0" })
        .toBuffer();
}

async function fitJpeg(input: Buffer, maxEdge: number): Promise<{ jpeg: Buffer; width: number; height: number }> {
    const fitted = sharp(input, { failOn: "none" }).resize({
        width: maxEdge,
        height: maxEdge,
        fit: "inside",
        withoutEnlargement: true,
    });
    const jpeg = await jpegBuffer(fitted);
    const meta = await sharp(jpeg).metadata();
    return {
        jpeg,
        width: meta.width ?? 1,
        height: meta.height ?? 1,
    };
}

/**
 * Bake EXIF orientation, apply admin rotate/crop, then pixel-blur rectangles.
 * Writes new JPEG bytes with no GPS/EXIF. Does not mutate the source file.
 */
export async function sanitizePublicStopPhotos(
    input: Buffer,
    transform: PublicPhotoTransform
): Promise<SanitizedPublicPhotos> {
    // Auto-orient first so GPS/orientation EXIF is consumed and dropped.
    // Crop and pixel-blur in that display space, then apply admin rotation.
    let working = await sharp(input, { failOn: "none" }).rotate().toBuffer();

    if (transform.crop) {
        const meta = await sharp(working).metadata();
        const width = meta.width ?? 0;
        const height = meta.height ?? 0;
        const crop = toPixelRect(transform.crop, width, height);
        if (crop) {
            working = await sharp(working, { failOn: "none" }).extract(crop).toBuffer();
        }
    }

    if (transform.blurRects.length > 0) {
        const meta = await sharp(working).metadata();
        const width = meta.width ?? 0;
        const height = meta.height ?? 0;
        const composites: Array<{ input: Buffer; left: number; top: number }> = [];
        for (const rect of transform.blurRects) {
            const box = toPixelRect(rect, width, height);
            if (!box) {
                continue;
            }
            const blurred = await sharp(working, { failOn: "none" })
                .extract(box)
                .blur(PUBLIC_BLUR_SIGMA)
                .toBuffer();
            composites.push({ input: blurred, left: box.left, top: box.top });
        }
        if (composites.length > 0) {
            working = await sharp(working, { failOn: "none" }).composite(composites).toBuffer();
        }
    }

    if (transform.rotateDegrees !== 0) {
        working = await sharp(working, { failOn: "none" }).rotate(transform.rotateDegrees).toBuffer();
    }

    const full = await jpegBuffer(sharp(working, { failOn: "none" }));
    const detail = await fitJpeg(full, PUBLIC_PHOTO_DETAIL_EDGE);
    const card = await fitJpeg(full, PUBLIC_PHOTO_CARD_EDGE);
    return {
        detailJpeg: detail.jpeg,
        cardJpeg: card.jpeg,
        detailWidth: detail.width,
        detailHeight: detail.height,
        cardWidth: card.width,
        cardHeight: card.height,
    };
}
