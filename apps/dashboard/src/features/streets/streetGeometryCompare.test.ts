import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isStreetLineStringGeometryUnchanged,
    streetLineStringFromDetail,
} from "./streetGeometryCompare.js";

const lineA = {
    type: "LineString" as const,
    coordinates: [
        [96.3347661, 16.6354093],
        [96.3347608, 16.6351382],
        [96.3347546, 16.6348298],
    ],
};

describe("isStreetLineStringGeometryUnchanged", () => {
    it("returns true for identical coordinates", () => {
        assert.equal(isStreetLineStringGeometryUnchanged(lineA, { ...lineA }), true);
    });

    it("returns true within float epsilon (map/editor noise)", () => {
        const noisy = {
            type: "LineString" as const,
            coordinates: lineA.coordinates.map(([lng, lat]) => [lng + 1e-9, lat - 1e-9]),
        };
        assert.equal(isStreetLineStringGeometryUnchanged(lineA, noisy), true);
    });

    it("returns false when a vertex moves beyond epsilon", () => {
        const moved = {
            type: "LineString" as const,
            coordinates: [
                [96.3347661, 16.6354093],
                [96.3347608, 16.6351382],
                [96.335, 16.6348298],
            ],
        };
        assert.equal(isStreetLineStringGeometryUnchanged(lineA, moved), false);
    });

    it("returns false when vertex count changes", () => {
        const shorter = {
            type: "LineString" as const,
            coordinates: lineA.coordinates.slice(0, 2),
        };
        assert.equal(isStreetLineStringGeometryUnchanged(lineA, shorter), false);
    });

    it("normalizes MultiLineString baseline to first path", () => {
        const detail = {
            geometry: {
                type: "MultiLineString",
                coordinates: [lineA.coordinates],
            },
        };
        assert.equal(isStreetLineStringGeometryUnchanged(streetLineStringFromDetail(detail), lineA), true);
    });
});
