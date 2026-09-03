import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { insertMidpointVertexAfterSelection } from "./reviewMapPathEdit.js";

describe("insertMidpointVertexAfterSelection", () => {
    const coords: Array<[number, number]> = [
        [96.1, 16.8],
        [96.2, 16.8],
        [96.3, 16.8],
    ];

    it("returns null when no vertex is selected", () => {
        assert.equal(insertMidpointVertexAfterSelection(coords, null), null);
    });

    it("inserts at the midpoint of the next segment", () => {
        const result = insertMidpointVertexAfterSelection(coords, 0);
        assert.ok(result);
        assert.equal(result.newVertexIndex, 1);
        assert.equal(result.coords.length, 4);
        assert.deepEqual(result.coords[1], [96.15, 16.8]);
        assert.deepEqual(result.coords[0], [96.1, 16.8]);
        assert.deepEqual(result.coords[2], [96.2, 16.8]);
    });

    it("inserts on the previous segment when the last vertex is selected", () => {
        const result = insertMidpointVertexAfterSelection(coords, 2);
        assert.ok(result);
        assert.equal(result.newVertexIndex, 2);
        assert.deepEqual(result.coords[2], [96.25, 16.8]);
        assert.deepEqual(coords, [
            [96.1, 16.8],
            [96.2, 16.8],
            [96.3, 16.8],
        ]);
    });
});
