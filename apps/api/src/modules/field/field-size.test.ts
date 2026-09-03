import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { randomUUID } from "node:crypto";

import type { FieldBootstrapResponse } from "./field.schema.js";

function syntheticSnapshot(): FieldBootstrapResponse {
    const routes = Array.from({ length: 140 }, (_, i) => {
        const publicId = randomUUID();
        return {
            publicId,
            routeCode: `YBS-${i + 1}`,
            nameMy: `လမ်းကြောင်း ${i + 1}`,
            nameEn: `Route ${i + 1}`,
        };
    });
    const variants = routes.flatMap((route) =>
        ([0, 1] as const).map((directionId) => ({
            publicId: randomUUID(),
            routePublicId: route.publicId,
            variantCode: directionId === 0 ? ("D0" as const) : ("D1" as const),
            directionId,
            originName: "Origin",
            destinationName: "Destination",
        }))
    );
    const stops = Array.from({ length: 80 }, (_, i) => ({
        publicId: randomUUID(),
        stopCode: `S${i}`,
        nameMy: `မှတ်တိုင် ${i}`,
        nameEn: `Stop ${i}`,
        lat: 16.8 + i * 0.001,
        lng: 96.15 + i * 0.001,
    }));
    const routeStops = variants.flatMap((variant) =>
        stops.slice(0, 20).map((stop, index) => ({
            variantPublicId: variant.publicId,
            stopPublicId: stop.publicId,
            stopSequence: index + 1,
        }))
    );
    const routePaths = variants.map((variant) => ({
        variantPublicId: variant.publicId,
        geometry: {
            type: "LineString" as const,
            coordinates: Array.from({ length: 40 }, (_, i) => [96.15 + i * 0.0002, 16.78 + i * 0.0001] as [number, number]),
        },
    }));

    return {
        snapshotRevision: "v1-synthetic",
        unchanged: false,
        routes,
        variants,
        stops,
        routeStops,
        routePaths,
    };
}

test("gzip of a representative YBS snapshot is smaller than raw JSON", () => {
    const json = Buffer.from(JSON.stringify(syntheticSnapshot()), "utf8");
    const gzipped = gzipSync(json);
    assert.ok(json.length > 200_000, `raw JSON too small: ${json.length}`);
    assert.ok(gzipped.length < json.length * 0.35, `gzip ratio too weak: ${gzipped.length}/${json.length}`);
});
