import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { sanitizePublicStopPhotos } from "./public-photo-sanitize.js";

async function rgbAt(jpeg: Buffer, x: number, y: number): Promise<[number, number, number]> {
    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const index = (y * info.width + x) * info.channels;
    return [data[index]!, data[index + 1]!, data[index + 2]!];
}

test("sanitizePublicStopPhotos drops EXIF, swaps size on 90° rotate, and pixel-blurs", async () => {
    const source = await sharp({
        create: { width: 80, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
        .composite([
            {
                input: await sharp({
                    create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } },
                })
                    .png()
                    .toBuffer(),
                left: 32,
                top: 12,
            },
        ])
        .withExif({ IFD0: { Copyright: "private-original" } })
        .jpeg()
        .toBuffer();

    const rotated = await sanitizePublicStopPhotos(source, {
        rotateDegrees: 90,
        crop: null,
        blurRects: [],
    });
    assert.equal(rotated.detailWidth, 40);
    assert.equal(rotated.detailHeight, 80);
    const rotatedMeta = await sharp(rotated.detailJpeg).metadata();
    assert.equal(rotatedMeta.exif, undefined);
    assert.equal(rotatedMeta.orientation, undefined);

    const blurred = await sanitizePublicStopPhotos(source, {
        rotateDegrees: 0,
        crop: null,
        blurRects: [{ x: 0.35, y: 0.2, width: 0.3, height: 0.6 }],
    });
    const [r] = await rgbAt(blurred.detailJpeg, 40, 20);
    assert.ok(r > 20, "pixel blur must change the black square, not CSS-only overlay");
});
